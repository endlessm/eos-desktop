// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const ButtonConstants = imports.ui.buttonConstants;
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

const CursorLocation = {
    DEFAULT: 0,
    ON_ICON: 1,
    LEFT_EDGE: 2,
    RIGHT_EDGE: 3
}

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
        this.clutter_text.x_align = Clutter.ActorAlign.CENTER;

        this._activateId = 0;
        this._keyFocusId = 0;
        this._oldLabelText = null;

        this._grabHelper = new GrabHelper.GrabHelper(this);
        this._grabHelper.addActor(this);

        this._editStartId = this.connect('button-press-event',
            Lang.bind(this, this._onButtonPressEvent));
    },

    _onButtonPressEvent: function(label, event) {
        let button = event.get_button();
        if (button != ButtonConstants.LEFT_MOUSE_BUTTON) {
            return false;
        }

        // disconnect the signal that enters editing mode
        if (this._editStartId > 0) {
            this.disconnect(this._editStartId);
            this._editStartId = 0;
        }

        this._keyFocusId = this.connect('key-focus-in',
            Lang.bind(this, this._startEditing));
        this._grabHelper.grab({ actor: this,
                                focus: this,
                                modal: true,
                                onUngrab: Lang.bind(this, this._onEditUngrab) });

        return true;
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

        if (eventType == Clutter.EventType.BUTTON_PRESS) {
            let [stageX, stageY] = event.get_coords();
            let target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE,
                                                       stageX,
                                                       stageY);

            if (this.contains(target)) {
                this._cancelEditing();
            } else {
                this._confirmEditing();
            }

            return;
        }

        this._cancelEditing();
    },

    _startEditing: function() {
        this.clutter_text.editable = true;

        // save the current contents of the label, in case we
        // need to roll back
        this._oldLabelText = this.get_text();

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

        if (this._grabHelper.grabbed) {
            this._grabHelper.ungrab({ actor: this });
        }

        // reconnect signal to enter editing mode
        this._editStartId = this.connect('button-press-event',
            Lang.bind(this, this._onButtonPressEvent));
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

    _init : function(label, params) {
        params = Params.parse(params, { createIcon: null,
                                        setSizeManually: false,
                                        showLabel: true,
                                        editableLabel: false });
        this.actor = new St.Bin({ style_class: 'overview-icon',
                                  x_fill: true,
                                  y_fill: true });
        this.actor._delegate = this;
        this.actor.connect('style-changed',
                           Lang.bind(this, this._onStyleChanged));
        this.actor.connect('destroy',
                           Lang.bind(this, this._onDestroy));

        this._spacing = 0;

        this._editStartId = 0;

        let box = new Shell.GenericContainer();
        box.connect('allocate', Lang.bind(this, this._allocate));
        box.connect('get-preferred-width',
                    Lang.bind(this, this._getPreferredWidth));
        box.connect('get-preferred-height',
                    Lang.bind(this, this._getPreferredHeight));
        this.actor.set_child(box);

        this.iconSize = ICON_SIZE;
        this._iconBin = new St.Bin({ x_align: St.Align.MIDDLE,
                                     y_align: St.Align.MIDDLE });

        box.add_actor(this._iconBin);

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
        this._setSizeManually = params.setSizeManually;

        this.icon = null;

        let cache = St.TextureCache.get_default();
        this._iconThemeChangedId = cache.connect('icon-theme-changed', Lang.bind(this, this._onIconThemeChanged));
    },

    _allocate: function(actor, box, flags) {
        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        let iconSize = availHeight;

        let [iconMinHeight, iconNatHeight] = this._iconBin.get_preferred_height(-1);
        let [iconMinWidth, iconNatWidth] = this._iconBin.get_preferred_width(-1);
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
        this._iconBin.allocate(childBox, flags);
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        this._getPreferredHeight(actor, -1, alloc);
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        let [iconMinHeight, iconNatHeight] = this._iconBin.get_preferred_height(forWidth);
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
        this.iconSize = size;
        this.icon = this.createIcon(this.iconSize);

        this._iconBin.child = this.icon;

        // The icon returned by createIcon() might actually be smaller than
        // the requested icon size (for instance StTextureCache does this
        // for fallback icons), so set the size explicitly.
        this._iconBin.set_size(this.iconSize, this.iconSize);
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

        if (this.iconSize == size && this._iconBin.child)
            return;

        this._createIconTexture(size);
    },

    _onDestroy: function() {
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

        this.actor = new St.BoxLayout({ style_class: 'icon-grid',
                                        vertical: true });

        // Pulled from CSS, but hardcode some defaults here
        this._spacing = 0;
        this._hItemSize = this._vItemSize = ICON_SIZE;
        this._grid = new Shell.GenericContainer();
        this.actor.add(this._grid, { expand: true, y_align: St.Align.START });
        this.actor.connect('style-changed', Lang.bind(this, this._onStyleChanged));

        this._grid.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this._grid.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this._grid.connect('allocate', Lang.bind(this, this._allocate));
    },

    _getPreferredWidth: function (grid, forHeight, alloc) {
        if (this._fillParent)
            // Ignore all size requests of children and request a size of 0;
            // later we'll allocate as many children as fit the parent
            return;

        let children = this._grid.get_children();
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

    _getVisibleChildren: function() {
        let children = this._grid.get_children();
        children = children.filter(function(actor) {
            return actor.visible;
        });
        return children;
    },

    _getPreferredHeight: function (grid, forWidth, alloc) {
        if (this._fillParent)
            // Ignore all size requests of children and request a size of 0;
            // later we'll allocate as many children as fit the parent
            return;

        let children = this._getVisibleChildren();
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
        let totalSpacing = Math.max(0, nRows - 1) * this._spacing;
        let height = nRows * this._vItemSize + totalSpacing;
        alloc.min_size = height;
        alloc.natural_size = height;
    },

    _allocate: function (grid, box, flags) {
        if (this._fillParent) {
            // Reset the passed in box to fill the parent
            let parentBox = this.actor.get_parent().allocation;
            let gridBox = this.actor.get_theme_node().get_content_box(parentBox);
            box = this._grid.get_theme_node().get_content_box(gridBox);
        }

        let children = this._getVisibleChildren();
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

        // Store this so we know where the icon grid starts
        this._leftPadding = leftPadding;

        let x = box.x1 + leftPadding;
        let y = box.y1;
        let columnIndex = 0;
        let rowIndex = 0;
        for (let i = 0; i < children.length; i++) {
            let [childMinWidth, childMinHeight, childNaturalWidth, childNaturalHeight]
                = children[i].get_preferred_size();

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

            if (this._rowLimit && rowIndex >= this._rowLimit ||
                this._fillParent && childBox.y2 > availHeight) {
                this._grid.set_skip_paint(children[i], true);
            } else {
                children[i].allocate(childBox, flags);
                this._grid.set_skip_paint(children[i], false);
            }

            columnIndex++;
            if (columnIndex == nColumns) {
                columnIndex = 0;
                rowIndex++;
            }

            if (columnIndex == 0) {
                y += this._vItemSize + this._spacing;
                x = box.x1 + leftPadding;
            } else {
                x += this._hItemSize + this._spacing;
            }
        }
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
        this._grid.queue_relayout();
    },

    removeAll: function() {
        this._grid.destroy_all_children();
    },

    addItem: function(actor, index) {
        if (index !== undefined)
            this._grid.insert_child_at_index(actor, index);
        else
            this._grid.add_actor(actor);
    },

    removeItem: function(actor) {
        this._grid.remove_actor(actor);
    },

    getItemAtIndex: function(index) {
        return this._grid.get_child_at_index(index);
    },

    nudgeItemsAtIndex: function(index, cursorLocation) {
        let nudgeIdx = index;

        if (cursorLocation != CursorLocation.LEFT_EDGE) {
            let leftItem = this.getItemAtIndex(nudgeIdx - 1);
            this._animateNudge(leftItem, NUDGE_ANIMATION_TYPE, NUDGE_DURATION,
                               -this._hItemSize * NUDGE_FACTOR
                              );
        }

        // Nudge the icon to the right if we are the first item or not at the
        // end of row
        if (cursorLocation != CursorLocation.RIGHT_EDGE) {
            let rightItem = this.getItemAtIndex(nudgeIdx);
            this._animateNudge(rightItem, NUDGE_ANIMATION_TYPE, NUDGE_DURATION,
                               this._hItemSize * NUDGE_FACTOR
                              );
        }
    },

    removeNudgeTransforms: function() {
        let children = this._grid.get_children();
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
        let children = this._getVisibleChildren();
        for (let i = 0; i < children.length; i++) {
            if (item == children[i]) {
                return i;
            }
        }

        return -1;
    },

    visibleItemsCount: function() {
        return this._grid.get_n_children() - this._grid.get_n_skip_paint();
    },

    // DnD support

    // Returns the drop point index or -1 if we can't drop there
    canDropAt: function(x, y) {
        let [sw, sh] = this.actor.get_transformed_size();
        let [ok, sx, sy] = this.actor.transform_stage_point(x, y);

        let [nColumns, usedWidth] = this._computeLayout(sw);

        let rowHeight = this._vItemSize + this._spacing;
        let row = Math.floor(sy / rowHeight);

        // Correct sx to handle the left padding
        // to correctly calculate the column
        let gridx = sx - this._leftPadding;
        let columnWidth = this._hItemSize + this._spacing;
        let column = Math.floor(gridx / columnWidth);

        // If we're outside of the grid, we are in an invalid drop location
        if (gridx < 0 || gridx > usedWidth) {
            return [-1, CursorLocation.DEFAULT];
        }

        let children = this._getVisibleChildren();
        let childIdx = Math.min((row * nColumns) + column, children.length);

        // If we're above/below the grid vertically or to the right of the grid, 
        // we are in an invalid drop location
        if (childIdx < 0 || childIdx >= children.length) {
            return [-1, CursorLocation.DEFAULT];
        }

        let child = children[childIdx];
        let [childMinWidth, childMinHeight, childNaturalWidth, childNaturalHeight] = child.get_preferred_size();

        // Calculate the original position of the child icon (prior to nudging)
        let cx = this._leftPadding + (childIdx % nColumns) * columnWidth;

        // This is the width of the cell that contains the icon
        // (excluding spacing between cells)
        let childIconWidth = Math.max(this._hItemSize, childNaturalWidth);

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
                dropIdx = childIdx;
                cursorLocation = CursorLocation.LEFT_EDGE;
            } else {
                // We are between the previous icon and this one
                dropIdx = childIdx;
                cursorLocation = CursorLocation.DEFAULT;
            }
        } else if (sx >= iconRightX) {
            // We are to the right of the icon target
            if (childIdx >= children.length - 1) {
                // We are beyond the last valid icon
                // (to the right of the trash can)
                dropIdx = -1;
                cursorLocation = CursorLocation.DEFAULT;
            } else if (sx >= rightEdge) {
                // We are beyond the rightmost icon on the grid
                dropIdx = childIdx + 1;
                cursorLocation = CursorLocation.RIGHT_EDGE;
            } else {
                // We are between this icon and the next one
                dropIdx = childIdx + 1;
                cursorLocation = CursorLocation.DEFAULT;
            }
        } else {
            // We are over the icon target area
            dropIdx = childIdx;
            cursorLocation = CursorLocation.ON_ICON;
        }

        return [dropIdx, cursorLocation];
    }
});
