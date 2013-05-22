// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Tweener = imports.ui.tweener;

const Lang = imports.lang;
const Params = imports.misc.params;

const ICON_SIZE = 48;

const LEFT_DIVIDER_LEEWAY = 30;
const RIGHT_DIVIDER_LEEWAY = 20;

const NUDGE_ANIMATION_TIME = 0.35;

const BaseIcon = new Lang.Class({
    Name: 'BaseIcon',

    _init : function(label, params) {
        params = Params.parse(params, { createIcon: null,
                                        setSizeManually: false,
                                        showLabel: true });
        this.actor = new St.Bin({ style_class: 'overview-icon',
                                  x_fill: true,
                                  y_fill: true });
        this.actor._delegate = this;
        this.actor.connect('style-changed',
                           Lang.bind(this, this._onStyleChanged));
        this.actor.connect('destroy',
                           Lang.bind(this, this._onDestroy));

        this._spacing = 0;

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
            this.label = new St.Label({ text: label,
                                        style_class: 'overview-icon-label' });
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
        let nColumns, spacing;
        if (forWidth < 0) {
            nColumns = children.length;
            spacing = this._spacing;
        } else {
            [nColumns, , spacing] = this._computeLayout(forWidth);
        }

        let nRows;
        if (nColumns > 0)
            nRows = Math.ceil(children.length / nColumns);
        else
            nRows = 0;
        if (this._rowLimit)
            nRows = Math.min(nRows, this._rowLimit);
        let totalSpacing = Math.max(0, nRows - 1) * spacing;
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

        let [nColumns, usedWidth, spacing] = this._computeLayout(availWidth);

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
            let width = Math.min(this._hItemSize, childNaturalWidth);
            let childXSpacing = Math.max(0, width - childNaturalWidth) / 2;
            let height = Math.min(this._vItemSize, childNaturalHeight);
            let childYSpacing = Math.max(0, height - childNaturalHeight) / 2;

            let childBox = new Clutter.ActorBox();
            if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL) {
                let _x = box.x2 - (x + width);
                childBox.x1 = Math.floor(_x - childXSpacing);
            } else {
                childBox.x1 = Math.floor(x + childXSpacing);
            }
            childBox.y1 = Math.floor(y + childYSpacing);
            childBox.x2 = childBox.x1 + width;
            childBox.y2 = childBox.y1 + height;

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
                y += this._vItemSize + spacing;
                x = box.x1 + leftPadding;
            } else {
                x += this._hItemSize + spacing;
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
        let spacing = this._spacing;

        while ((this._colLimit == null || nColumns < this._colLimit) &&
               (usedWidth + this._hItemSize <= forWidth)) {
            usedWidth += this._hItemSize + spacing;
            nColumns += 1;
        }

        if (nColumns > 0)
            usedWidth -= spacing;

        return [nColumns, usedWidth, spacing];
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

    nudgeItemsAtIndex: function(index) {
        let leftItem = this.getItemAtIndex(index - 1);
        this._animateNudge(leftItem, -ICON_SIZE / 3);

        let rightItem = this.getItemAtIndex(index);
        this._animateNudge(rightItem, ICON_SIZE / 3);
    },

    removeNudgeTransforms: function() {
        let children = this._getVisibleChildren();
        for (let index = 0; index < this._getVisibleChildren().length; index++) {
            this._animateNudge(children[index], 0);
        }
    },

    _animateNudge: function(item, offset) {
        if (item != null) {
            Tweener.removeTweens(item);
            Tweener.addTween(item, { translation_x: offset,
                                     time: NUDGE_ANIMATION_TIME,
                                     transition: 'easeOutQuint'
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
    canDropAt: function(x, y, currentInsertIdx) {
        let [sw, sh] = this.actor.get_transformed_size();
        let [ok, sx, sy] = this.actor.transform_stage_point(x, y);

        let [nColumns, usedWidth, spacing] = this._computeLayout(sw);

        let row = Math.floor(sy / (this._vItemSize + spacing));

        // Correct sx to handle the left padding
        // to correctly calculate the column
        let gridx = sx - this._leftPadding;
        let column = Math.floor(gridx / (this._hItemSize + spacing));

        let children = this._getVisibleChildren();
        let childIdx;

        // If we're outside of the grid, find out where we should be
        if (gridx < 0) {
            column = 0;
        } else if (gridx > usedWidth) {
            column = 0;
            row += 1;
        }

        childIdx = Math.min((row * nColumns) + column, children.length);

        // If we're above the grid vertically, we are in an invalid drop location
        if (childIdx < 0) {
            return [-1, false];
        }

        // If we're to the right of the screen, we assume icon is wanted on
        // the right edge. We also need to make sure that we don't return a bad
        // location if the childIdx >= children.length
        if (gridx > usedWidth) {
            return [childIdx, false];
        }

        // If we're below the grid vertically, we are in an invalid drop location
        if (childIdx >= children.length) {
            return [-1, false];
        }

        let child = children[childIdx];
        let [childMinWidth, childMinHeight, childNaturalWidth, childNaturalHeight] = child.get_preferred_size();
        let [cx, cy] = child.get_position();

        // This is the width of the icon inside the 128x128 grid square
        let childIconWidth = Math.min(this._hItemSize, childNaturalWidth);

        // childIconWidth is used to determine whether or not a drag point
        // is inside the icon or the divider.

        // Reduce the size of the icon area further by only having it start
        // further in. if the drop point is in those initial pixels
        // then the drop point is the current icon
        //
        // Increasing cx and decreasing childIconWidth gives a greater priority
        // to rearranging icons on the desktop vs putting them into folders
        // Decreasing cx and increasing childIconWidth gives a greater priority
        // to putting icons in folders vs rearranging them on the desktop
        let iconX = cx + LEFT_DIVIDER_LEEWAY;
        let iconWidth = childIconWidth - RIGHT_DIVIDER_LEEWAY;
        if (sx >= iconX && sx <= cx + iconWidth) {
            return [childIdx, true];
        } else if (sx < iconX){
            return [childIdx, false];
        } else if (sx > cx + iconWidth) {
            return [childIdx + 1, false];
        }

        // This should never be reached, but Javascript complains
        // if it is not here.
        return [-1, false];
    }
});
