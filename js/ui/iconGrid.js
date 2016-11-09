// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const GObject = imports.gi.GObject;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;
const Mainloop = imports.mainloop;
const Main = imports.ui.main;

const GrabHelper = imports.ui.grabHelper;
const Lang = imports.lang;
const Params = imports.misc.params;

const ICON_SIZE = 48;

const LEFT_DIVIDER_LEEWAY = 30;
const RIGHT_DIVIDER_LEEWAY = 30;

const NUDGE_ANIMATION_TYPE = 'easeOutElastic';
const NUDGE_DURATION = 0.8;
const NUDGE_PERIOD = 0.7;

const NUDGE_RETURN_ANIMATION_TYPE = 'easeOutQuint';
const NUDGE_RETURN_DURATION = 0.3;

const NUDGE_FACTOR = 0.2;

const SHUFFLE_ANIMATION_TIME = 0.250;
const SHUFFLE_ANIMATION_OPACITY = 255;

const CursorLocation = {
    DEFAULT: 0,
    ON_ICON: 1,
    START_EDGE: 2,
    END_EDGE: 3,
    EMPTY_AREA: 4
}

const EditableLabelMode = {
    DISPLAY: 0,
    HIGHLIGHT: 1,
    EDIT: 2
};

const EditableLabel = new Lang.Class({
    Name: 'EditableLabel',
    Extends: St.Entry,
    Signals: {
        'label-edit-update': { param_types: [ GObject.TYPE_STRING ] },
        'label-edit-cancel': { }
    },

    _init: function(params) {
        this.parent(params);

        this.clutter_text.editable = false;
        this.clutter_text.selectable = false;
        this.clutter_text.x_align = Clutter.ActorAlign.CENTER;
        this.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this.clutter_text.bind_property('editable', this.clutter_text, 'selectable',
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);

        this._activateId = 0;
        this._keyFocusId = 0;
        this._labelMode = EditableLabelMode.DISPLAY;
        this._oldLabelText = null;

        this.connect('button-press-event',
            Lang.bind(this, this._onButtonPressEvent));
        this.connect('destroy',
            Lang.bind(this, this._onDestroy));

        this._grabHelper = new GrabHelper.GrabHelper(this);
        this._grabHelper.addActor(this);
    },

    _onDestroy: function() {
        this._cancelEditing();
    },

    _onButtonPressEvent: function(label, event) {
        if (event.get_button() != Gdk.BUTTON_PRIMARY) {
            return false;
        }

        if (event.get_click_count() > 1 &&
            this._labelMode != EditableLabelMode.HIGHLIGHT) {
            return false;
        }

        // enter highlight mode if this is the first click
        if (this._labelMode == EditableLabelMode.DISPLAY) {
            this._labelMode = EditableLabelMode.HIGHLIGHT;
            this.add_style_pseudo_class('highlighted');

            this._grabHelper.grab({ actor: this,
                                    onUngrab: Lang.bind(this, this._onHighlightUngrab) });

            return true;
        }

        if (this._labelMode == EditableLabelMode.HIGHLIGHT) {
            // while in highlight mode, another extra click enters the
            // actual edit mode, which we handle from the highlight ungrab
            if (this._grabHelper.grabbed) {
                this._grabHelper.ungrab({ actor: this });
            }

            return true;
        }

        // ensure focus stays in the text field when clicking
        // on the entry empty space
        this.grab_key_focus();

        let [stageX, stageY] = event.get_coords();
        let [textX, textY] = this.clutter_text.get_transformed_position();

        if (stageX < textX) {
            this.clutter_text.cursor_position = 0;
            this.clutter_text.set_selection(0, 0);
        } else {
            this.clutter_text.cursor_position = -1;
            this.clutter_text.selection_bound = -1;
        }

        // eat button press events on the entry empty space in this mode
        return true;
    },

    _onHighlightUngrab: function(isUser) {
        // exit highlight mode
        this.remove_style_pseudo_class('highlighted');

        // clicked outside the label - cancel the edit
        if (isUser) {
            this._labelMode = EditableLabelMode.DISPLAY;
            this.emit('label-edit-cancel');
            return;
        }

        // now prepare for editing...
        this._labelMode = EditableLabelMode.EDIT;

        this._keyFocusId = this.connect('key-focus-in',
            Lang.bind(this, this._startEditing));
        this._grabHelper.grab({ actor: this,
                                focus: this,
                                onUngrab: Lang.bind(this, this._onEditUngrab) });
    },

    _onEditUngrab: function(isUser) {
        // edit has already been completed and this is an explicit
        // ungrab from endEditing()
        if (!isUser) {
            return;
        }

        let event = Clutter.get_current_event();
        let eventType;

        if (event) {
            eventType = event.type();
        }

        if (eventType == Clutter.EventType.KEY_PRESS) {
            let symbol = event.get_key_symbol();

            // abort editing
            if (symbol == Clutter.KEY_Escape) {
                this._cancelEditing();
            }

            return;
        }

        // confirm editing when clicked outside the label
        if (eventType == Clutter.EventType.BUTTON_PRESS) {
            this._confirmEditing();
            return;
        }

        // abort editing for other grab-breaking events
        this._cancelEditing();
    },

    _startEditing: function() {
        let text = this.get_text();

        // select the current text when editing starts
        this.clutter_text.editable = true;
        this.clutter_text.cursor_position = 0;
        this.clutter_text.selection_bound = text.length;

        // save the current contents of the label, in case we
        // need to roll back
        this._oldLabelText = text;

        this._activateId = this.clutter_text.connect('activate',
            Lang.bind(this, this._confirmEditing));
    },

    _endEditing: function() {
        this.clutter_text.editable = false;

        this._oldLabelText = null;

        if (this._activateId) {
            this.clutter_text.disconnect(this._activateId);
            this._activateId = 0;
        }

        if (this._keyFocusId) {
            this.disconnect(this._keyFocusId);
            this._keyFocusId = 0;
        }

        if (this._grabHelper.isActorGrabbed(this)) {
            this._grabHelper.ungrab({ actor: this });
        }

        this._labelMode = EditableLabelMode.DISPLAY;
    },

    _cancelEditing: function() {
        // _endEditing() below will unset oldLabelText
        let oldText = this._oldLabelText;

        this._endEditing();

        this.set_text(oldText);
        this.emit('label-edit-cancel');
    },

    _confirmEditing: function() {
        // _endEditing() below will unset oldLabelText
        let oldText = this._oldLabelText;
        let text = this.get_text();

        if (!text || text == oldText) {
            this._cancelEditing();
            return;
        }

        this._endEditing();
        this.emit('label-edit-update', text);
    }
});

const BaseIcon = new Lang.Class({
    Name: 'BaseIcon',

    _init : function(label, params, buttonParams) {
        params = Params.parse(params, { createIcon: null,
                                        createExtraIcons: null,
                                        setSizeManually: false,
                                        showLabel: true,
                                        editableLabel: false,
                                        shadowAbove: false });
        this.actor = new St.Bin({ style_class: 'overview-icon',
                                  x_fill: true,
                                  y_fill: true });
        this.actor._delegate = this;
        this.actor.connect('style-changed',
                           Lang.bind(this, this._onStyleChanged));
        this.actor.connect('destroy',
                           Lang.bind(this, this._onDestroy));

        this._spacing = 0;
        this._shadowAbove = params.shadowAbove;

        let box = new Shell.GenericContainer();
        box.connect('allocate', Lang.bind(this, this._allocate));
        box.connect('get-preferred-width',
                    Lang.bind(this, this._getPreferredWidth));
        box.connect('get-preferred-height',
                    Lang.bind(this, this._getPreferredHeight));
        this.actor.set_child(box);

        this.iconSize = ICON_SIZE;

        buttonParams = Params.parse(buttonParams, { x_align: St.Align.MIDDLE,
                                                    y_align: St.Align.MIDDLE },
                                    true);
        this.iconButton = new St.Button(buttonParams);
        this.iconButton.add_style_class_name('icon-button');
        box.add_actor(this.iconButton);

        this._layeredIcon = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                            x_expand: true,
                                            y_expand: true });
        this.iconButton.add_actor(this._layeredIcon);

        let shadow = new St.Widget({ style_class: 'shadow-icon',
                                     visible: true,
                                     x_expand: true,
                                     y_expand: true });
        this._layeredIcon.add_actor(shadow);

        if (params.showLabel) {
            if (params.editableLabel) {
                this.label = new EditableLabel({ text: label,
                                                 style_class: 'overview-icon-label' });
            } else {
                this.label = new St.Label({ text: label,
                                            style_class: 'overview-icon-label' });
            }
            box.add_actor(this.label);
        } else {
            this.label = null;
        }

        if (params.createIcon)
            this.createIcon = params.createIcon;
        if (params.createExtraIcons)
            this.createExtraIcons = params.createExtraIcons;
        this._setSizeManually = params.setSizeManually;

        this.icon = null;
        this.extraIcons = [];

        let cache = St.TextureCache.get_default();
        this._iconThemeChangedId = cache.connect('icon-theme-changed', Lang.bind(this, this._onIconThemeChanged));
    },

    _allocate: function(actor, box, flags) {
        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        let iconSize = availHeight;

        let [iconMinHeight, iconNatHeight] = this.iconButton.get_preferred_height(-1);
        let [iconMinWidth, iconNatWidth] = this.iconButton.get_preferred_width(-1);
        let preferredHeight = iconNatHeight;

        let childBox = new Clutter.ActorBox();

        if (this.label) {
            let [labelMinHeight, labelNatHeight] = this.label.get_preferred_height(-1);
            preferredHeight += this._spacing + labelNatHeight;

            let labelHeight = availHeight >= preferredHeight ? labelNatHeight
                                                             : labelMinHeight;

            let [labelMinWidth, labelNatWidth] = this.label.get_preferred_width(-1);
            let labelWidth = availWidth >= labelNatWidth? labelNatWidth : labelMinWidth;
            if (labelWidth > iconNatWidth) {
                iconNatWidth = labelWidth;
            }

            iconSize -= this._spacing + labelHeight;

            childBox.x1 = Math.floor((availWidth - labelWidth)/2);
            childBox.x2 = childBox.x1 + labelWidth;
            childBox.y1 = iconSize + this._spacing;
            childBox.y2 = childBox.y1 + labelHeight;
            this.label.allocate(childBox, flags);
        }

        childBox.x1 = Math.floor((availWidth - iconNatWidth) / 2);
        childBox.y1 = Math.floor((iconSize - iconNatHeight) / 2);
        childBox.x2 = childBox.x1 + iconNatWidth;
        childBox.y2 = childBox.y1 + iconNatHeight;
        this.iconButton.allocate(childBox, flags);
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        this._getPreferredHeight(actor, -1, alloc);
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        let [iconMinHeight, iconNatHeight] = this.iconButton.get_preferred_height(forWidth);
        alloc.min_size = iconMinHeight;
        alloc.natural_size = iconNatHeight;

        if (this.label) {
            let [labelMinHeight, labelNatHeight] = this.label.get_preferred_height(forWidth);
            alloc.min_size += this._spacing + labelMinHeight;
            alloc.natural_size += this._spacing + labelNatHeight;
        }
    },

    // This can be overridden by a subclass, or by the createIcon
    // parameter to _init()
    createIcon: function(size) {
        throw new Error('no implementation of createIcon in ' + this);
    },

    // This can be overridden by a subclass, or by the createExtraIcons
    // parameter to _init()
    createExtraIcons: function(size) {
        return [];
    },

    setIconSize: function(size) {
        if (!this._setSizeManually)
            throw new Error('setSizeManually has to be set to use setIconsize');

        if (size == this.iconSize)
            return;

        this._createIconTexture(size);
    },

    _createIconTexture: function(size) {
        if (this.icon)
            this.icon.destroy();
        this.extraIcons.forEach(function (i) {i.destroy()});
        this.iconSize = size;
        this.icon = this.createIcon(this.iconSize);
        this.extraIcons = this.createExtraIcons(this.iconSize);

        this._layeredIcon.add_actor(this.icon);
        if (this._shadowAbove) {
            this._layeredIcon.set_child_below_sibling(this.icon, null);
        }
        this.extraIcons.forEach(Lang.bind(this, function (i) {
            this._layeredIcon.add_actor(i);
        }));

        // The icon returned by createIcon() might actually be smaller than
        // the requested icon size (for instance StTextureCache does this
        // for fallback icons), so set the size explicitly.
        this._layeredIcon.set_size(this.iconSize, this.iconSize);
    },

    _onStyleChanged: function() {
        let node = this.actor.get_theme_node();
        this._spacing = node.get_length('spacing');

        let size;
        if (this._setSizeManually) {
            size = this.iconSize;
        } else {
            let [found, len] = node.lookup_length('icon-size', false);
            size = found ? len : ICON_SIZE;
        }

        if (this.iconSize == size && this.iconButton.child)
            return;

        this._createIconTexture(size);
    },

    _onDestroy: function() {
        this.actor._delegate = null;

        if (this._iconThemeChangedId > 0) {
            let cache = St.TextureCache.get_default();
            cache.disconnect(this._iconThemeChangedId);
            this._iconThemeChangedId = 0;
        }

        if (this._keyFocusId > 0) {
            global.stage.disconnect(this._keyFocusId);
            this._keyFocusId = 0;
        }
    },

    _onIconThemeChanged: function() {
        this._createIconTexture(this.iconSize);
    },

    reloadIcon: function() {
        this._createIconTexture(this.iconSize);
    }
});

const IconGrid = new Lang.Class({
    Name: 'IconGrid',

    _init: function(params) {
        params = Params.parse(params, { rowLimit: null,
                                        columnLimit: null,
                                        fillParent: false,
                                        xAlign: St.Align.MIDDLE });
        this._rowLimit = params.rowLimit;
        this._colLimit = params.columnLimit;
        this._xAlign = params.xAlign;
        this._fillParent = params.fillParent;

        // Pulled from CSS, but hardcode some defaults here
        this._spacing = 0;
        this._hItemSize = this._vItemSize = ICON_SIZE;
        this.actor = new Shell.GenericContainer({ style_class: 'icon-grid' });

        this.actor.connect('style-changed', Lang.bind(this, this._onStyleChanged));
        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));

        this.saturation = new Shell.GridDesaturateEffect({ factor: 0,
                                                           enabled: false });
        this.actor.add_effect(this.saturation);
        this._lowResolutionMode = false;

        /* Setup the composite mode of the grid */
        Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._updateLowResolutionMode));

        this._updateLowResolutionMode();
    },

    _getPreferredWidth: function (grid, forHeight, alloc) {
        if (this._fillParent)
            // Ignore all size requests of children and request a size of 0;
            // later we'll allocate as many children as fit the parent
            return;

        let children = this.actor.get_children();
        let nColumns = this._colLimit ? Math.min(this._colLimit,
                                                 children.length)
                                      : children.length;
        let totalSpacing = Math.max(0, nColumns - 1) * this._spacing;
        // Kind of a lie, but not really an issue right now.  If
        // we wanted to support some sort of hidden/overflow that would
        // need higher level design
        alloc.min_size = this._hItemSize;
        alloc.natural_size = nColumns * this._hItemSize + totalSpacing;
    },

    _getPreferredHeight: function (grid, forWidth, alloc) {
        if (this._fillParent)
            // Ignore all size requests of children and request a size of 0;
            // later we'll allocate as many children as fit the parent
            return;

        let children = this.actor.get_children();
        let nColumns;
        if (forWidth < 0) {
            nColumns = children.length;
        } else {
            [nColumns, ] = this._computeLayout(forWidth);
        }

        let nRows;
        if (nColumns > 0)
            nRows = Math.ceil(children.length / nColumns);
        else
            nRows = 0;
        if (this._rowLimit)
            nRows = Math.min(nRows, this._rowLimit);
        let height = this.getHeightForRows(nRows);
        alloc.min_size = height;
        alloc.natural_size = height;
    },

    getHeightForRows: function(nRows) {
        let totalSpacing = Math.max(0, nRows - 1) * this._spacing;
        return Math.max(1, nRows) * this._vItemSize + totalSpacing;
    },

    _allocate: function (grid, box, flags) {
        if (this._fillParent) {
            // Reset the passed in box to fill the parent
            let parentBox = this.actor.allocation;
            box = this.actor.get_theme_node().get_content_box(parentBox);
        }

        let children = this.actor.get_children();
        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        let [nColumns, usedWidth] = this._computeLayout(availWidth);

        let leftPadding;
        switch(this._xAlign) {
            case St.Align.START:
                leftPadding = 0;
                break;
            case St.Align.MIDDLE:
                leftPadding = Math.floor((availWidth - usedWidth) / 2);
                break;
            case St.Align.END:
                leftPadding = availWidth - usedWidth;
        }

        // Store some information about the allocated layout
        this._leftPadding = leftPadding;
        this._allocatedColumns = nColumns;

        for (let i = 0; i < children.length; i++) {
            let rowIndex = Math.floor(i / this._allocatedColumns);
            let childBox = this._childAllocation(children[i], box, i);

            if (this._rowLimit && rowIndex >= this._rowLimit ||
                this._fillParent && childBox.y2 > availHeight) {
                this.actor.set_skip_paint(children[i], true);
            } else {
                children[i].allocate(childBox, flags);
                this.actor.set_skip_paint(children[i], false);
            }
        }
    },

    _childAllocation: function(child, box, index) {
        let [childMinWidth, childMinHeight, childNaturalWidth, childNaturalHeight]
            = child.get_preferred_size();

        let column = index % this._allocatedColumns;
        let row = Math.floor(index / this._allocatedColumns);
        let x = box.x1 + this._leftPadding + column * (this._hItemSize + this._spacing);
        let y = box.y1 + row * (this._vItemSize + this._spacing);

        /* Center the item in its allocation horizontally */
        let width = Math.max(this._hItemSize, childNaturalWidth);
        let childXSpacing = Math.max(0, width - childNaturalWidth) / 2;
        let height = Math.max(this._vItemSize, childNaturalHeight);
        let childYSpacing = Math.max(0, height - childNaturalHeight) / 2;

        let childBox = new Clutter.ActorBox();
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL) {
            let _x = box.x2 - (x + width);
            childBox.x1 = Math.floor(_x - childXSpacing);
        } else {
            childBox.x1 = Math.floor(x + childXSpacing);
        }
        childBox.y1 = Math.floor(y + childYSpacing);
        childBox.x2 = childBox.x1 + childNaturalWidth;
        childBox.y2 = childBox.y1 + childNaturalHeight;

        return childBox;
    },

    childrenInRow: function(rowWidth) {
        return this._computeLayout(rowWidth)[0];
    },

    getRowLimit: function() {
        return this._rowLimit;
    },

    _computeLayout: function (forWidth) {
        let nColumns = 0;
        let usedWidth = 0;

        while ((this._colLimit == null || nColumns < this._colLimit) &&
               (usedWidth + this._hItemSize <= forWidth)) {
            usedWidth += this._hItemSize + this._spacing;
            nColumns += 1;
        }

        if (nColumns > 0)
            usedWidth -= this._spacing;

        return [nColumns, usedWidth];
    },

    _onStyleChanged: function() {
        let themeNode = this.actor.get_theme_node();
        this._spacing = themeNode.get_length('spacing');
        this._hItemSize = themeNode.get_length('-shell-grid-horizontal-item-size') || ICON_SIZE;
        this._vItemSize = themeNode.get_length('-shell-grid-vertical-item-size') || ICON_SIZE;
        this.actor.queue_relayout();
    },

    removeAll: function() {
        this.actor.remove_all_children();
    },

    destroyAll: function() {
        this.actor.destroy_all_children();
    },

    addItem: function(actor, index) {
        if (index !== undefined)
            this.actor.insert_child_at_index(actor, index);
        else
            this.actor.add_actor(actor);
    },

    removeItem: function(actor) {
        this.actor.remove_actor(actor);
    },

    getItemAtIndex: function(index) {
        return this.actor.get_child_at_index(index);
    },

    nudgeItemsAtIndex: function(index, cursorLocation) {
        // No nudging when the cursor is in an empty area
        if (cursorLocation == CursorLocation.EMPTY_AREA) {
            return;
        }

        let nudgeIdx = index;
        let rtl = (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL);

        if (cursorLocation != CursorLocation.START_EDGE) {
            let leftItem = this.getItemAtIndex(nudgeIdx - 1);
            this._animateNudge(leftItem, NUDGE_ANIMATION_TYPE, NUDGE_DURATION,
                               rtl ? Math.floor(this._hItemSize * NUDGE_FACTOR) : Math.floor(-this._hItemSize * NUDGE_FACTOR)
                              );
        }

        // Nudge the icon to the right if we are the first item or not at the
        // end of row
        if (cursorLocation != CursorLocation.END_EDGE) {
            let rightItem = this.getItemAtIndex(nudgeIdx);
            this._animateNudge(rightItem, NUDGE_ANIMATION_TYPE, NUDGE_DURATION,
                               rtl ? Math.floor(-this._hItemSize * NUDGE_FACTOR) : Math.floor(this._hItemSize * NUDGE_FACTOR)
                              );
        }
    },

    animateShuffling: function(changedItems, removedItems, originalItemData, callback) {
        // We need to repaint the grid since the last icon added might not be
        // drawn yet
        this.actor.paint();

        let children = this.actor.get_children();
        let node = this.actor.get_theme_node();
        let contentBox = node.get_content_box(this.actor.allocation);

        let movementMatrix = {};
        // Find out where icons need to move
        for (let sourceIndex in changedItems) {
            let targetIndex = changedItems[sourceIndex];
            let sourceActor = children[sourceIndex];
            let actorOffset;

            if (targetIndex >= children.length) {
                // calculate the position of the new slot
                let oldBox = sourceActor.allocation;
                let newBox = this._childAllocation(sourceActor, contentBox, targetIndex);
                actorOffset = [newBox.x1 - oldBox.x1, newBox.y1 - oldBox.y1];
            } else {
                actorOffset = this._findActorOffset(sourceActor, children[targetIndex]);
            }

            movementMatrix[sourceIndex] = actorOffset;
        }

        // Make the original icon look like it fell into its place
        let [originalIndex, dndDropPosition] = originalItemData;
        let originalIcon = children[originalIndex];
        if (originalIndex in movementMatrix) {
            let oldIcon = children[originalIndex];
            let newIcon = children[changedItems[originalIndex]];

            // We need to know what the coordinates of the icon center are
            dndDropPosition[0] -= Math.floor(oldIcon.get_size()[0] / 2);
            dndDropPosition[1] -= Math.floor(oldIcon.get_size()[1] / 2);

            // Draw it at the location where DnD accept occured
            let releaseOffset = this._findRelativeOffset(oldIcon, dndDropPosition);
            oldIcon.translation_x = releaseOffset[0];
            oldIcon.translation_y = releaseOffset[1];

            movementMatrix[originalIndex] = this._findActorOffset(oldIcon, newIcon);
        }

        // Move icons that need animating
        for (let sourceIndex in changedItems) {
            this._moveIcon(children[sourceIndex], movementMatrix[sourceIndex]);
        }

        // Hide any removed icons (only temporary)
        for (let removedIndex in removedItems) {
            children[removedItems[removedIndex]].opacity = 0;
        }

        // Make sure that everything gets redrawn after the animation
        Mainloop.timeout_add(SHUFFLE_ANIMATION_TIME * 1000 * St.get_slow_down_factor(), callback);
    },

    _findRelativeOffset: function(source, targetCoords) {
        let [x2, y2] = targetCoords;

        let [x1, y1] = source.get_transformed_position();
        x1 = x1 - source.translation_x;
        y1 = y1 - source.translation_y;

        return [x2-x1, y2-y1];
    },

    _findActorOffset: function(source, target) {
        let [x, y] = target.get_transformed_position();
        x = x - target.translation_x;
        y = y - target.translation_y;

        return this._findRelativeOffset(source, [x, y]);
    },

    _moveIcon: function(icon, destPoint) {
        Tweener.removeTweens(icon);

        icon.opacity = SHUFFLE_ANIMATION_OPACITY;

        Tweener.addTween(icon, { translation_x: destPoint[0],
                                 translation_y: destPoint[1],
                                 time: SHUFFLE_ANIMATION_TIME,
                                 transition: 'easeInOutCubic'
                                });
    },

    removeNudgeTransforms: function() {
        let children = this.actor.get_children();
        for (let index = 0; index < children.length; index++) {
            this._animateNudge(children[index], NUDGE_RETURN_ANIMATION_TYPE,
                               NUDGE_RETURN_DURATION,
                               0
                              );
        }
    },

    _animateNudge: function(item, animationType, duration, offset) {
        if (item != null) {
            Tweener.addTween(item, { translation_x: offset,
                                     time: duration,
                                     transition: animationType,
                                     transitionParams: { period: duration * 1000 * NUDGE_PERIOD }
                                    });
        }
    },

    indexOf: function(item) {
        let children = this.actor.get_children();
        for (let i = 0; i < children.length; i++) {
            if (item == children[i]) {
                return i;
            }
        }

        return -1;
    },

    visibleItemsCount: function() {
        return this.actor.get_n_children() - this.actor.get_n_skip_paint();
    },

    // DnD support

    // Returns the drop point index or -1 if we can't drop there
    canDropAt: function(x, y, canDropPastEnd) {
        let [sw, sh] = this.actor.get_transformed_size();
        let [ok, sx, sy] = this.actor.transform_stage_point(x, y);

        let rtl = (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL);
        let usedWidth = sw;

        // Undo the align translation from _allocate()
        if (this._xAlign == St.Align.MIDDLE) {
            usedWidth -= 2 * this._leftPadding;
        } else if (this._xAlign == St.Align.END) {
            usedWidth -= this._leftPadding;
        }

        let rowHeight = this._vItemSize + this._spacing;
        let row = Math.floor(sy / rowHeight);

        // Correct sx to handle the left padding
        // to correctly calculate the column
        let gridx = sx - this._leftPadding;
        if (rtl) {
            gridx = usedWidth - gridx;
        }

        let columnWidth = this._hItemSize + this._spacing;
        let column = Math.floor(gridx / columnWidth);

        // If we're outside of the grid, we are in an invalid drop location
        if (gridx < 0 || gridx > usedWidth) {
            return [-1, CursorLocation.DEFAULT];
        }

        let children = this.actor.get_children();
        let childIdx = Math.min((row * this._allocatedColumns) + column, children.length);

        // If we're above the grid vertically,
        // we are in an invalid drop location
        if (childIdx < 0) {
            return [-1, CursorLocation.DEFAULT];
        }

        // If we're past the last visible element in the grid,
        // we might be allowed to drop there.
        if (childIdx >= children.length) {
            if (canDropPastEnd) {
                return [children.length, CursorLocation.EMPTY_AREA];
            } else {
                return [-1, CursorLocation.DEFAULT];
            }
        }

        let child = children[childIdx];
        let [childMinWidth, childMinHeight, childNaturalWidth, childNaturalHeight] = child.get_preferred_size();

        // This is the width of the cell that contains the icon
        // (excluding spacing between cells)
        let childIconWidth = Math.max(this._hItemSize, childNaturalWidth);

        // Calculate the original position of the child icon (prior to nudging)
        let cx;
        if (rtl) {
            cx = this._leftPadding + usedWidth - (column * columnWidth) - childIconWidth;
        } else {
            cx = this._leftPadding + (column * columnWidth);
        }

        // childIconWidth is used to determine whether or not a drag point
        // is inside the icon or the divider.

        // Reduce the size of the icon area further by only having it start
        // further in.  If the drop point is in those initial pixels
        // then the drop point is the current icon
        //
        // Increasing cx and decreasing childIconWidth gives a greater priority
        // to rearranging icons on the desktop vs putting them into folders
        // Decreasing cx and increasing childIconWidth gives a greater priority
        // to putting icons in folders vs rearranging them on the desktop
        let iconLeftX = cx + LEFT_DIVIDER_LEEWAY;
        let iconRightX = cx + childIconWidth - RIGHT_DIVIDER_LEEWAY;
        let leftEdge = this._leftPadding + LEFT_DIVIDER_LEEWAY;
        let rightEdge = this._leftPadding + usedWidth - RIGHT_DIVIDER_LEEWAY;

        let dropIdx;
        let cursorLocation;

        if (sx < iconLeftX) {
            // We are to the left of the icon target
            if (sx < leftEdge) {
                // We are before the leftmost icon on the grid
                if (rtl) {
                    dropIdx = childIdx + 1;
                    cursorLocation = CursorLocation.END_EDGE;
                } else {
                    dropIdx = childIdx;
                    cursorLocation = CursorLocation.START_EDGE;
                }
            } else {
                // We are between the previous icon (next in RTL) and this one
                if (rtl) {
                    dropIdx = childIdx + 1;
                } else {
                    dropIdx = childIdx;
                }

                cursorLocation = CursorLocation.DEFAULT;
            }
        } else if (sx >= iconRightX) {
            // We are to the right of the icon target
            if (childIdx >= children.length - (canDropPastEnd ? 0 : 1)) {
                // We are beyond the last valid icon
                // (to the right of the app store / trash can, if present)
                dropIdx = -1;
                cursorLocation = CursorLocation.DEFAULT;
            } else if (sx >= rightEdge) {
                // We are beyond the rightmost icon on the grid
                if (rtl) {
                    dropIdx = childIdx;
                    cursorLocation = CursorLocation.START_EDGE;
                } else {
                    dropIdx = childIdx + 1;
                    cursorLocation = CursorLocation.END_EDGE;
                }
            } else {
                // We are between this icon and the next one (previous in RTL)
                if (rtl) {
                    dropIdx = childIdx;
                } else {
                    dropIdx = childIdx + 1;
                }

                cursorLocation = CursorLocation.DEFAULT;
            }
        } else {
            // We are over the icon target area
            dropIdx = childIdx;
            cursorLocation = CursorLocation.ON_ICON;
        }

        return [dropIdx, cursorLocation];
    },

    _updateLowResolutionMode: function() {
        if (this._lowResolutionMode == Main.lowResolutionDisplay)
            return;

        this._lowResolutionMode = Main.lowResolutionDisplay;

        /* When we're running on small screens, to make it fit 5 columns
         * on the available space, we shall reduce the icon size. Do
         * this by adding (or removing, in case the screen is big enough)
         * the .low-resolution style class.
         */
        if (this._lowResolutionMode) {
            this.actor.add_style_class_name('low-resolution');
        } else {
            this.actor.remove_style_class_name('low-resolution');
        }
    }
});
