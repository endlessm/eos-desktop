// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Signals = imports.signals;

const DND = imports.ui.dnd;
const Lightbox = imports.ui.lightbox;
const Main = imports.ui.main;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
const SideComponent = imports.ui.sideComponent;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;

const FOCUS_ANIMATION_TIME = 0.15;

const WINDOW_DND_SIZE = 256;

const SCROLL_SCALE_AMOUNT = 100 / 5;

const WINDOW_CLONE_MAXIMUM_SCALE = 0.7;

const LIGHTBOX_FADE_TIME = 0.1;
const CLOSE_BUTTON_FADE_TIME = 0.1;

const DRAGGING_WINDOW_OPACITY = 100;

// When calculating a layout, we calculate the scale of windows and the percent
// of the available area the new layout uses. If the values for the new layout,
// when weighted with the values as below, are worse than the previous layout's,
// we stop looking for a new layout and use the previous layout.
// Otherwise, we keep looking for a new layout.
const LAYOUT_SCALE_WEIGHT = 1;
const LAYOUT_SPACE_WEIGHT = 0.1;

function _interpolate(start, end, step) {
    return start + (end - start) * step;
}

const WindowClone = new Lang.Class({
    Name: 'WindowClone',

    _init : function(realWindow, workspace) {
        this.realWindow = realWindow;
        this.metaWindow = realWindow.meta_window;
        this.metaWindow._delegate = this;
        this._workspace = workspace;

        let [borderX, borderY] = this._getInvisibleBorderPadding();
        this._windowClone = new Clutter.Clone({ source: realWindow.get_texture(),
                                                x: -borderX,
                                                y: -borderY });
        // We expect this.actor to be used for all interaction rather than
        // this._windowClone; as the former is reactive and the latter
        // is not, this just works for most cases. However, for DND all
        // actors are picked, so DND operations would operate on the clone.
        // To avoid this, we hide it from pick.
        Shell.util_set_hidden_from_pick(this._windowClone, true);

        this.origX = realWindow.x + borderX;
        this.origY = realWindow.y + borderY;

        let outerRect = realWindow.meta_window.get_outer_rect();

        // The MetaShapedTexture that we clone has a size that includes
        // the invisible border; this is inconvenient; rather than trying
        // to compensate all over the place we insert a ClutterActor into
        // the hierarchy that is sized to only the visible portion.
        this.actor = new Clutter.Actor({ reactive: true,
                                         x: this.origX,
                                         y: this.origY,
                                         width: outerRect.width,
                                         height: outerRect.height });

        this.actor.add_child(this._windowClone);

        this.actor._delegate = this;

        this._slot = [0, 0, 0, 0];
        this._dragSlot = [0, 0, 0, 0];
        this._stackAbove = null;

        this._sizeChangedId = this.realWindow.connect('size-changed',
            Lang.bind(this, this._onRealWindowSizeChanged));
        this._realWindowDestroyId = this.realWindow.connect('destroy',
            Lang.bind(this, this._disconnectRealWindowSignals));

        let clickAction = new Clutter.ClickAction();
        clickAction.connect('clicked', Lang.bind(this, this._onClicked));
        clickAction.connect('long-press', Lang.bind(this, this._onLongPress));

        this.actor.add_action(clickAction);

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._draggable = DND.makeDraggable(this.actor,
                                            { restoreOnSuccess: true,
                                              manualMode: true,
                                              dragActorMaxSize: WINDOW_DND_SIZE,
                                              dragActorOpacity: DRAGGING_WINDOW_OPACITY });
        this._draggable.connect('drag-begin', Lang.bind(this, this._onDragBegin));
        this._draggable.connect('drag-cancelled', Lang.bind(this, this._onDragCancelled));
        this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));
        this.inDrag = false;

        this._selected = false;
    },

    set slot(slot) {
        this._slot = slot;
    },

    get slot() {
        if (this.inDrag)
            return this._dragSlot;
        else
            return this._slot;
    },

    // Find the actor just below us, respecting reparenting done
    // by DND code
    getActualStackAbove: function() {
        if (this._stackAbove == null)
            return null;

        if (this.inDrag || this._zooming) {
            if (this._stackAbove._delegate)
                return this._stackAbove._delegate.getActualStackAbove();
            else
                return null;
        } else {
            return this._stackAbove;
        }
    },

    setStackAbove: function (actor) {
        this._stackAbove = actor;
        if (this.inDrag)
            // We'll fix up the stack after the drag
            return;

        let actualAbove = this.getActualStackAbove();
        if (actualAbove == null)
            this.actor.lower_bottom();
        else
            this.actor.raise(actualAbove);
    },

    destroy: function () {
        this.actor.destroy();
    },

    _disconnectRealWindowSignals: function() {
        if (this._sizeChangedId > 0)
            this.realWindow.disconnect(this._sizeChangedId);
        this._sizeChangedId = 0;

        if (this._realWindowDestroyId > 0)
            this.realWindow.disconnect(this._realWindowDestroyId);
        this._realWindowDestroyId = 0;
    },

    _getInvisibleBorderPadding: function() {
        // We need to adjust the position of the actor because of the
        // consequences of invisible borders -- in reality, the texture
        // has an extra set of "padding" around it that we need to trim
        // down.

        // The outer rect paradoxically is the smaller rectangle,
        // containing the positions of the visible frame. The input
        // rect contains everything, including the invisible border
        // padding.
        let outerRect = this.metaWindow.get_outer_rect();
        let inputRect = this.metaWindow.get_input_rect();
        let [borderX, borderY] = [outerRect.x - inputRect.x,
                                  outerRect.y - inputRect.y];

        return [borderX, borderY];
    },

    _onRealWindowSizeChanged: function() {
        let [borderX, borderY] = this._getInvisibleBorderPadding();
        let outerRect = this.metaWindow.get_outer_rect();
        this.actor.set_size(outerRect.width, outerRect.height);
        this._windowClone.set_position(-borderX, -borderY);
        this.emit('size-changed');
    },

    _onDestroy: function() {
        this._disconnectRealWindowSignals();

        this.metaWindow._delegate = null;
        this.actor._delegate = null;

        if (this.inDrag) {
            this.emit('drag-end');
            this.inDrag = false;
        }

        this.disconnectAll();
    },

    _onClicked: function(action, actor) {
        this._selected = true;
        this.emit('selected', global.get_current_time());
    },

    _onLongPress: function(action, actor, state) {
        // Take advantage of the Clutter policy to consider
        // a long-press canceled when the pointer movement
        // exceeds dnd-drag-threshold to manually start the drag
        if (state == Clutter.LongPressState.CANCEL) {
            // A click cancels a long-press before any click handler is
            // run - make sure to not start a drag in that case
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
                function() {
                    if (this._selected)
                        return;
                    let [x, y] = action.get_coords();
                    action.release();
                    this._draggable.startDrag(x, y, global.get_current_time());
                }));
        }
        return true;
    },

    _onDragBegin : function (draggable, time) {
        this._dragSlot = this._slot;
        [this.dragOrigX, this.dragOrigY] = this.actor.get_position();
        this.dragOrigScale = this.actor.scale_x;
        this.inDrag = true;
        this.emit('drag-begin');
    },

    handleDragOver : function(source, actor, x, y, time) {
        return this._workspace.handleDragOver(source, actor, x, y, time);
    },

    acceptDrop : function(source, actor, x, y, time) {
        this._workspace.acceptDrop(source, actor, x, y, time);
    },

    _onDragCancelled : function (draggable, time) {
        this.emit('drag-cancelled');
    },

    _onDragEnd : function (draggable, time, snapback) {
        this.inDrag = false;

        // We may not have a parent if DnD completed successfully, in
        // which case our clone will shortly be destroyed and replaced
        // with a new one on the target workspace.
        if (this.actor.get_parent() != null) {
            if (this._stackAbove == null)
                this.actor.lower_bottom();
            else
                this.actor.raise(this._stackAbove);
        }


        this.emit('drag-end');
    }
});
Signals.addSignalMethods(WindowClone.prototype);


/**
 * @windowClone: Corresponding window clone
 * @parentActor: The actor which will be the parent of all overlay items
 *               such as app icon and window caption
 */
const WindowOverlay = new Lang.Class({
    Name: 'WindowOverlay',

    _init : function(windowClone, parentActor) {
        let metaWindow = windowClone.metaWindow;

        this._windowClone = windowClone;
        this._parentActor = parentActor;
        this._hidden = false;

        this.borderSize = 0;
        this.border = new St.Bin({ style_class: 'window-clone-border' });

        let title = new St.Label({ style_class: 'window-caption',
                                   text: metaWindow.title });
        Util.blockClickEventsOnActor(title);

        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        title._spacing = 0;

        this._updateCaptionId = metaWindow.connect('notify::title',
            Lang.bind(this, function(w) {
                this.title.text = w.title;
                this.relayout(false);
            }));

        let button = new St.Button({ style_class: 'window-close' });
        button._overlap = 0;

        this._idleToggleCloseId = 0;
        button.connect('clicked', Lang.bind(this, this._closeWindow));

        windowClone.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        windowClone.actor.connect('enter-event',
                                  Lang.bind(this, this._onEnter));
        windowClone.actor.connect('leave-event',
                                  Lang.bind(this, this._onLeave));

        this._windowAddedId = 0;

        button.hide();

        this.title = title;
        this.closeButton = button;

        parentActor.add_actor(this.title);
        parentActor.add_actor(this.border);
        parentActor.add_actor(this.closeButton);
        title.connect('style-changed',
                      Lang.bind(this, this._onStyleChanged));
        button.connect('style-changed',
                       Lang.bind(this, this._onStyleChanged));
        this.border.connect('style-changed', Lang.bind(this, this._onStyleChanged));
        // force a style change if we are already on a stage - otherwise
        // the signal will be emitted normally when we are added
        if (parentActor.get_stage())
            this._onStyleChanged();
    },

    hide: function() {
        this._hidden = true;
        this.title.hide();

        this.hideCloseButton();
    },

    show: function() {
        this._hidden = false;

        this.title.show();
        if (this._windowClone.actor.has_pointer)
            this._animateVisible();
    },

    fadeIn: function() {
        if (!this._hidden)
            return;

        this.show();
        this.title.opacity = 0;
        this._parentActor.raise_top();
        Tweener.addTween(this.title,
                         { opacity: 255,
                           time: CLOSE_BUTTON_FADE_TIME,
                           transition: 'easeOutQuad' });
    },

    chromeHeights: function () {
        return [Math.max(this.borderSize, this.closeButton.height - this.closeButton._overlap),
                this.title.height + this.title._spacing];
    },

    chromeWidths: function () {
        return [this.borderSize,
                Math.max(this.borderSize, this.closeButton.width - this.closeButton._overlap)];
    },

    relayout: function(animate) {
        let button = this.closeButton;
        let title = this.title;
        let border = this.border;

        Tweener.removeTweens(button);
        Tweener.removeTweens(title);
        Tweener.removeTweens(border);

        let [cloneX, cloneY, cloneWidth, cloneHeight] = this._windowClone.slot;

        let layout = Meta.prefs_get_button_layout();
        let side = layout.left_buttons.indexOf(Meta.ButtonFunction.CLOSE) > -1 ? St.Side.LEFT : St.Side.RIGHT;

        let buttonX;
        let buttonY = cloneY - (button.height - button._overlap);
        if (side == St.Side.LEFT)
            buttonX = cloneX - (button.width - button._overlap);
        else
            buttonX = cloneX + (cloneWidth - button._overlap);

        if (animate)
            this._animateOverlayActor(button, Math.floor(buttonX), Math.floor(buttonY), button.width);
        else
            button.set_position(Math.floor(buttonX), Math.floor(buttonY));

        // Clutter.Actor.get_preferred_width() will return the fixed width if one
        // is set, so we need to reset the width by calling set_width(-1), to forward
        // the call down to StLabel.
        // We also need to save and restore the current width, otherwise the animation
        // starts from the wrong point.
        let prevTitleWidth = title.width;
        title.set_width(-1);
        let [titleMinWidth, titleNatWidth] = title.get_preferred_width(-1);
        let titleWidth = Math.max(titleMinWidth, Math.min(titleNatWidth, cloneWidth));
        title.width = prevTitleWidth;

        let titleX = cloneX + (cloneWidth - titleWidth) / 2;
        let titleY = cloneY + cloneHeight + title._spacing;

        if (animate)
            this._animateOverlayActor(title, Math.floor(titleX), Math.floor(titleY), titleWidth);
        else {
            title.width = titleWidth;
            title.set_position(Math.floor(titleX), Math.floor(titleY));
        }

        let borderX = cloneX - this.borderSize;
        let borderY = cloneY - this.borderSize;
        let borderWidth = cloneWidth + 2 * this.borderSize;
        let borderHeight = cloneHeight + 2 * this.borderSize;

        if (animate) {
            this._animateOverlayActor(this.border, borderX, borderY,
                                      borderWidth, borderHeight);
        } else {
            this.border.set_position(borderX, borderY);
            this.border.set_size(borderWidth, borderHeight);
        }
    },

    _animateOverlayActor: function(actor, x, y, width, height) {
        let params = { x: x,
                       y: y,
                       width: width,
                       time: Overview.ANIMATION_TIME,
                       transition: 'easeOutQuad' };

        if (height !== undefined)
            params.height = height;

        Tweener.addTween(actor, params);
    },

    _closeWindow: function(actor) {
        let metaWindow = this._windowClone.metaWindow;
        this._workspace = metaWindow.get_workspace();

        this._windowAddedId = this._workspace.connect('window-added',
                                                      Lang.bind(this,
                                                                this._onWindowAdded));

        metaWindow.delete(global.get_current_time());
    },

    _onWindowAdded: function(workspace, win) {
        let metaWindow = this._windowClone.metaWindow;

        if (win.get_transient_for() == metaWindow) {
            workspace.disconnect(this._windowAddedId);
            this._windowAddedId = 0;

            // use an idle handler to avoid mapping problems -
            // see comment in Workspace._windowAdded
            Mainloop.idle_add(Lang.bind(this,
                                        function() {
                                            this._windowClone.emit('selected');
                                            return false;
                                        }));
        }
    },

    _onDestroy: function() {
        if (this._windowAddedId > 0) {
            this._workspace.disconnect(this._windowAddedId);
            this._windowAddedId = 0;
        }
        if (this._idleToggleCloseId > 0) {
            Mainloop.source_remove(this._idleToggleCloseId);
            this._idleToggleCloseId = 0;
        }
        this._windowClone.metaWindow.disconnect(this._updateCaptionId);
        this.title.destroy();
        this.closeButton.destroy();
        this.border.destroy();
    },

    _animateVisible: function() {
        this._parentActor.raise_top();

        this.closeButton.show();
        this.closeButton.opacity = 0;
        Tweener.addTween(this.closeButton,
                         { opacity: 255,
                           time: CLOSE_BUTTON_FADE_TIME,
                           transition: 'easeOutQuad' });

        this.border.show();
        this.border.opacity = 0;
        Tweener.addTween(this.border,
                         { opacity: 255,
                           time: CLOSE_BUTTON_FADE_TIME,
                           transition: 'easeOutQuad' });

        this.title.add_style_pseudo_class('hover');
    },

    _animateInvisible: function() {
        this.closeButton.opacity = 255;
        Tweener.addTween(this.closeButton,
                         { opacity: 0,
                           time: CLOSE_BUTTON_FADE_TIME,
                           transition: 'easeInQuad' });

        this.border.opacity = 255;
        Tweener.addTween(this.border,
                         { opacity: 0,
                           time: CLOSE_BUTTON_FADE_TIME,
                           transition: 'easeInQuad' });

        this.title.remove_style_pseudo_class('hover');
    },

    _onEnter: function() {
        // We might get enter events on the clone while the overlay is
        // hidden, e.g. during animations, we ignore these events,
        // as the close button will be shown as needed when the overlays
        // are shown again
        if (this._hidden)
            return;

        this._animateVisible();
        this.emit('show-close-button');
    },

    _onLeave: function() {
        if (this._idleToggleCloseId == 0)
            this._idleToggleCloseId = Mainloop.timeout_add(750, Lang.bind(this, this._idleToggleCloseButton));
    },

    _idleToggleCloseButton: function() {
        this._idleToggleCloseId = 0;

        if (!this._windowClone.actor.has_pointer &&
            !this.closeButton.has_pointer)
            this._animateInvisible();

        return false;
    },

    hideCloseButton: function() {
        if (this._idleToggleCloseId > 0) {
            Mainloop.source_remove(this._idleToggleCloseId);
            this._idleToggleCloseId = 0;
        }
        this.closeButton.hide();
        this.border.hide();
        this.title.remove_style_pseudo_class('hover');
    },

    _onStyleChanged: function() {
        let titleNode = this.title.get_theme_node();
        this.title._spacing = titleNode.get_length('-shell-caption-spacing');

        let closeNode = this.closeButton.get_theme_node();
        this.closeButton._overlap = closeNode.get_length('-shell-close-overlap');

        let borderNode = this.border.get_theme_node();
        this.borderSize = borderNode.get_border_width(St.Side.TOP);

        this._parentActor.queue_relayout();
    }
});
Signals.addSignalMethods(WindowOverlay.prototype);

const WindowPositionFlags = {
    NONE: 0,
    INITIAL: 1 << 0,
    ANIMATE: 1 << 1
};

// Window Thumbnail Layout Algorithm
// =================================
//
// General overview
// ----------------
//
// The window thumbnail layout algorithm calculates some optimal layout
// by computing layouts with some number of rows, calculating how good
// each layout is, and stopping iterating when it finds one that is worse
// than the previous layout. A layout consists of which windows are in
// which rows, row sizes and other general state tracking that would make
// calculating window positions from this information fairly easy.
//
// We don't compute some global order of windows right now for optimal
// travel when animating into the overview; windows are assumed to be
// in some stable order.
//
// After a layout is computed that's considered the best layout, we
// compute the layout scale to fit it in the area, and then compute
// slots (sizes and positions) for each thumbnail.
//
// Layout generation
// -----------------
//
// Layout generation is naive and simple: we simply add windows to a row
// until we've added too many windows to a row, and then make a new row,
// until we have our required N rows. The potential issue with this strategy
// is that we may have too many windows at the bottom in some pathological
// cases, which tends to make the thumbnails have the shape of a pile of
// sand with a peak, with one window at the top.
//
// Scaling factors
// ---------------
//
// Thumbnail position is mostly straightforward -- the main issue is
// computing an optimal scale for each window that fits the constraints,
// and doesn't make the thumbnail too small to see. There are two factors
// involved in thumbnail scale to make sure that these two goals are met:
// the window scale (calculated by _computeWindowScale) and the layout
// scale (calculated by computeSizeAndScale).
//
// The calculation logic becomes slightly more complicated because row
// and column spacing are not scaled, they're constant, so we can't
// simply generate a bunch of window positions and then scale it. In
// practice, it's not too bad -- we can simply try to fit the layout
// in the input area minus whatever spacing we have, and then add
// it back afterwards.
//
// The window scale is constant for the window's size regardless of the
// input area or the layout scale or rows or anything else, and right
// now just enlarges the window if it's too small. The fact that this
// factor is stable makes it easy to calculate, so there's no sense
// in not applying it in most calculations.
//
// The layout scale depends on the input area, the rows, etc, but is the
// same for the entire layout, rather than being per-window. After
// generating the rows of windows, we basically do some basic math to
// fit the full, unscaled layout to the input area, as described above.
//
// With these two factors combined, the final scale of each thumbnail is
// simply windowScale * layoutScale... almost.
//
// There's one additional constraint: the thumbnail scale must never be
// larger than WINDOW_CLONE_MAXIMUM_SCALE, which means that the inequality:
//
//   windowScale * layoutScale <= WINDOW_CLONE_MAXIMUM_SCALE
//
// must always be true. This is for each individual window -- while we
// could adjust layoutScale to make the largest thumbnail smaller than
// WINDOW_CLONE_MAXIMUM_SCALE, it would shrink windows which are already
// under the inequality. To solve this, we simply cheat: we simply keep
// each window's "cell" area to be the same, but we shrink the thumbnail
// and center it horizontally, and align it to the bottom vertically.

const LayoutStrategy = new Lang.Class({
    Name: 'LayoutStrategy',
    Abstract: true,

    _init: function(monitor, rowSpacing, columnSpacing) {
        this._monitor = monitor;
        this._rowSpacing = rowSpacing;
        this._columnSpacing = columnSpacing;
    },

    _newRow: function() {
        // Row properties:
        //
        // * x, y are the position of row, relative to area
        //
        // * width, height are the scaled versions of fullWidth, fullHeight
        //
        // * width also has the spacing in between windows. It's not in
        //   fullWidth, as the spacing is constant, whereas fullWidth is
        //   meant to be scaled
        //
        // * neither height/fullHeight have any sort of spacing or padding
        return { x: 0, y: 0,
                 width: 0, height: 0,
                 fullWidth: 0, fullHeight: 0,
                 windows: [] };
    },

    // Computes and returns an individual scaling factor for @window,
    // to be applied in addition to the overal layout scale.
    _computeWindowScale: function(window) {
        // Since we align windows next to each other, the height of the
        // thumbnails is much more important to preserve than the width of
        // them, so two windows with equal height, but maybe differering
        // widths line up.
        let ratio = window.actor.height / this._monitor.height;

        // The purpose of this manipulation here is to prevent windows
        // from getting too small. For something like a calculator window,
        // we need to bump up the size just a bit to make sure it looks
        // good. We'll use a multiplier of 1.5 for this.

        // Map from [0, 1] to [1.5, 1]
        return _interpolate(1.5, 1, ratio);
    },

    // Compute the size of each row, by assigning to the properties
    // row.width, row.height, row.fullWidth, row.fullHeight, and
    // (optionally) for each row in @layout.rows. This method is
    // intended to be called by subclasses.
    _computeRowSizes: function(layout) {
        throw new Error('_computeRowSizes not implemented');
    },

    // Compute strategy-specific window slots for each window in
    // @windows, given the @layout. The strategy may also use @layout
    // as strategy-specific storage.
    //
    // This must calculate:
    //  * maxColumns - The maximum number of columns used by the layout.
    //  * gridWidth - The total width used by the grid, unscaled, unspaced.
    //  * gridHeight - The totial height used by the grid, unscaled, unspaced.
    //  * rows - A list of rows, which should be instantiated by _newRow.
    computeLayout: function(windows, layout) {
        throw new Error('computeLayout not implemented');
    },

    // Given @layout, compute the overall scale and space of the layout.
    // The scale is the individual, non-fancy scale of each window, and
    // the space is the percentage of the available area eventually
    // used by the layout.

    // This method does not return anything, but instead installs
    // the properties "scale" and "space" on @layout directly.
    //
    // Make sure to call this methods before calling computeWindowSlots(),
    // as it depends on the scale property installed in @layout here.
    computeScaleAndSpace: function(layout) {
        let area = layout.area;

        let hspacing = (layout.maxColumns - 1) * this._columnSpacing;
        let vspacing = (layout.numRows - 1) * this._rowSpacing;

        let spacedWidth = area.width - hspacing;
        let spacedHeight = area.height - vspacing;

        let horizontalScale = spacedWidth / layout.gridWidth;
        let verticalScale = spacedHeight / layout.gridHeight;

        // Thumbnails should be less than 70% of the original size
        let scale = Math.min(horizontalScale, verticalScale, WINDOW_CLONE_MAXIMUM_SCALE);

        let scaledLayoutWidth = layout.gridWidth * scale + hspacing;
        let scaledLayoutHeight = layout.gridHeight * scale + vspacing;
        let space = (scaledLayoutWidth * scaledLayoutHeight) / (area.width * area.height);

        layout.scale = scale;
        layout.space = space;
    },

    _getDistance: function (row, actor) {
        let dist_x = actor.x - row.x;
        let dist_y = actor.y - row.y;

        return Math.sqrt(Math.pow(dist_x, 2) + Math.pow(dist_y, 2));
    },

    computeWindowSlots: function(layout, area) {
        this._computeRowSizes(layout);

        let { rows: rows, scale: scale } = layout;

        let slots = [];

        let y = 0;
        for (let i = 0; i < rows.length; i++) {
            let row = rows[i];
            row.x = area.x + (area.width - row.width) / 2;
            row.y = area.y + y;
            y += row.height + this._rowSpacing;
            row.windows.sort(Lang.bind(this, function(a, b) {
                return this._getDistance(row, a.realWindow) - this._getDistance(row, b.realWindow);
            }));
        }

        let height = y - this._rowSpacing;
        let baseY = (area.height - height) / 2;

        for (let i = 0; i < rows.length; i++) {
            let row = rows[i];
            row.y += baseY;
            let x = row.x;
            for (let j = 0; j < row.windows.length; j++) {
                let window = row.windows[j];

                let s = scale * this._computeWindowScale(window);
                let cellWidth = window.actor.width * s;
                let cellHeight = window.actor.height * s;

                s = Math.min(s, WINDOW_CLONE_MAXIMUM_SCALE);
                let cloneWidth = window.actor.width * s;

                let cloneX = x + (cellWidth - cloneWidth) / 2;
                let cloneY = row.y + row.height - cellHeight;

                slots.push([cloneX, cloneY, s, window]);
                x += cellWidth + this._columnSpacing;
            }
        }
        return slots;
    }
});

const UnalignedLayoutStrategy = new Lang.Class({
    Name: 'UnalignedLayoutStrategy',
    Extends: LayoutStrategy,

    _computeRowSizes: function(layout) {
        let { rows: rows, scale: scale } = layout;
        for (let i = 0; i < rows.length; i++) {
            let row = rows[i];
            row.width = row.fullWidth * scale + (row.windows.length - 1) * this._columnSpacing;
            row.height = row.fullHeight * scale;
        }
    },

    _keepSameRow: function(row, window, width, idealRowWidth) {
        if (row.fullWidth + width <= idealRowWidth)
            return true;

        let oldRatio = row.fullWidth / idealRowWidth;
        let newRatio = (row.fullWidth + width) / idealRowWidth;

        if (Math.abs(1 - newRatio) < Math.abs(1 - oldRatio))
            return true;

        return false;
    },

    computeLayout: function(windows, layout) {
        let numRows = layout.numRows;

        let rows = [];
        let totalWidth = 0;
        for (let i = 0; i < windows.length; i++) {
            let window = windows[i];
            let s = this._computeWindowScale(window);
            totalWidth += window.actor.width * s;
        }

        let idealRowWidth = totalWidth / numRows;
        let windowIdx = 0;
        for (let i = 0; i < numRows; i++) {
            let col = 0;
            let row = this._newRow();
            rows.push(row);

            for (; windowIdx < windows.length; windowIdx++) {
                let window = windows[windowIdx];
                let s = this._computeWindowScale(window);
                let width = window.actor.width * s;
                let height = window.actor.height * s;
                row.fullHeight = Math.max(row.fullHeight, height);

                // either new width is < idealWidth or new width is nearer from idealWidth then oldWidth
                if (this._keepSameRow(row, window, width, idealRowWidth) || (i == numRows - 1)) {
                    row.windows.push(window);
                    row.fullWidth += width;
                } else {
                    break;
                }
            }
        }

        let gridHeight = 0;
        let maxRow;
        for (let i = 0; i < numRows; i++) {
            let row = rows[i];
            if (!maxRow || row.fullWidth > maxRow.fullWidth)
                maxRow = row;
            gridHeight += row.fullHeight;
        }

        layout.rows = rows;
        layout.maxColumns = maxRow.windows.length;
        layout.gridWidth = maxRow.fullWidth;
        layout.gridHeight = gridHeight;
    }
});


/**
 * @metaWorkspace: a #Meta.Workspace, or null
 */
const Workspace = new Lang.Class({
    Name: 'Workspace',

    _init : function(metaWorkspace, monitorIndex) {
        // When dragging a window, we use this slot for reserve space.
        this._reservedSlot = null;
        this.metaWorkspace = metaWorkspace;
        this._x = 0;
        this._y = 0;
        this._width = 0;
        this._height = 0;

        this.monitorIndex = monitorIndex;
        this._monitor = Main.layoutManager.monitors[this.monitorIndex];
        this._windowOverlaysGroup = new Clutter.Actor();
        // Without this the drop area will be overlapped.
        this._windowOverlaysGroup.set_size(0, 0);

        this.actor = new St.Widget({ style_class: 'window-picker' });
        if (monitorIndex != Main.layoutManager.primaryIndex)
            this.actor.add_style_class_name('external-monitor');
        this.actor.set_size(0, 0);

        this._dropRect = new Clutter.Actor({ opacity: 0 });
        this._dropRect._delegate = this;

        this.actor.add_actor(this._dropRect);
        this.actor.add_actor(this._windowOverlaysGroup);

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        let windows = global.get_window_actors().filter(this._isMyWindow, this);

        // Create clones for windows that should be
        // visible in the Overview
        this._windows = [];
        this._sideComponents = [];
        this._windowOverlays = [];
        for (let i = 0; i < windows.length; i++) {
            if (this._isOverviewWindow(windows[i])) {
                this._addWindowClone(windows[i], true);
            }
            if (SideComponent.isSideComponentWindow(windows[i].meta_window)) {
                this._addSideComponentClone(windows[i]);
            }
        }

        // Track window changes
        if (this.metaWorkspace) {
            this._windowAddedId = this.metaWorkspace.connect('window-added',
                                                             Lang.bind(this, this._windowAdded));
            this._windowRemovedId = this.metaWorkspace.connect('window-removed',
                                                               Lang.bind(this, this._windowRemoved));
        }
        this._windowEnteredMonitorId = global.screen.connect('window-entered-monitor',
                                                             Lang.bind(this, this._windowEnteredMonitor));
        this._windowLeftMonitorId = global.screen.connect('window-left-monitor',
                                                          Lang.bind(this, this._windowLeftMonitor));
        this._repositionWindowsId = 0;

        this.leavingOverview = false;

        this._positionWindowsFlags = 0;
        this._positionWindowsId = 0;

        this._currentLayout = null;
    },

    setGeometry: function(x, y, width, height) {
        this._x = x;
        this._y = y;
        this._width = width;
        this._height = height;

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
            this._dropRect.set_position(x, y);
            this._dropRect.set_size(width, height);
            return false;
        }));

        this.positionWindows(Main.overview.animationInProgress ?
                             WindowPositionFlags.ANIMATE : WindowPositionFlags.NONE);
    },

    _lookupIndex: function (metaWindow) {
        for (let i = 0; i < this._windows.length; i++) {
            if (this._windows[i].metaWindow == metaWindow) {
                return i;
            }
        }
        return -1;
    },

    _lookupSideComponentIndex: function(metaWindow) {
        for (let i = 0; i < this._sideComponents.length; i++) {
            if (this._sideComponents[i].metaWindow == metaWindow) {
                return i;
            }
        }
        return -1;
    },

    containsMetaWindow: function (metaWindow) {
        return this._lookupIndex(metaWindow) >= 0;
    },

    isEmpty: function() {
        return this._windows.length == 0;
    },

    setReservedSlot: function(clone) {
        if (this._reservedSlot == clone)
            return;

        if (clone && this.containsMetaWindow(clone.metaWindow))
            clone = null;

        this._reservedSlot = clone;
        this._currentLayout = null;
        this.positionWindows(WindowPositionFlags.ANIMATE);
    },

    /**
     * positionWindows:
     * @flags:
     *  INITIAL - this is the initial positioning of the windows.
     *  ANIMATE - Indicates that we need animate changing position.
     */
    positionWindows: function(flags) {
        this._positionWindowsFlags |= flags;

        if (!this.actor.mapped)
            return;

        if (this._positionWindowsId > 0)
            return;

        this._positionWindowsId = Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
            this._realPositionWindows(this._positionWindowsFlags);
            this._positionWindowsFlags = 0;
            this._positionWindowsId = 0;
            return false;
        }));
    },

    _realPositionWindows : function(flags) {
        if (this._repositionWindowsId > 0) {
            Mainloop.source_remove(this._repositionWindowsId);
            this._repositionWindowsId = 0;
        }

        let clones = this._windows.slice();

        clones.sort(function(a, b) {
            return a.metaWindow.get_stable_sequence() - b.metaWindow.get_stable_sequence();
        });

        if (this._reservedSlot)
            clones.push(this._reservedSlot);

        let initialPositioning = flags & WindowPositionFlags.INITIAL;
        let animate = flags & WindowPositionFlags.ANIMATE;

        // Start the animations
        let slots = this._computeAllWindowSlots(clones);

        // Now push fake empty slots for the side components, at the top
        for (let i = 0; i < this._sideComponents.length; i++) {
            slots.push([0, this._sideComponents[i].origY, 1.0, this._sideComponents[i]]);
        }

        let currentWorkspace = global.screen.get_active_workspace();
        let isOnCurrentWorkspace = this.metaWorkspace == null || this.metaWorkspace == currentWorkspace;

        for (let i = 0; i < slots.length; i++) {
            let slot = slots[i];
            let [x, y, scale, clone] = slot;
            let metaWindow = clone.metaWindow;
            let overlay = clone.overlay;
            clone.slotId = i;

            // Positioning a window currently being dragged must be avoided;
            // we'll just leave a blank spot in the layout for it.
            if (clone.inDrag)
                continue;

            let cloneWidth = clone.actor.width * scale;
            let cloneHeight = clone.actor.height * scale;
            clone.slot = [x, y, cloneWidth, cloneHeight];

            if (overlay && (initialPositioning || !clone.positioned))
                overlay.hide();

            if (!clone.positioned) {
                // This window appeared after the overview was already up
                // Grow the clone from the center of the slot
                clone.actor.x = x + cloneWidth / 2;
                clone.actor.y = y + cloneHeight / 2;
                clone.actor.scale_x = 0;
                clone.actor.scale_y = 0;
                clone.positioned = true;
            }

            if (SideComponent.isSideComponentWindow(clone.realWindow.meta_window)) {
                if (clone.origX == this._monitor.x) {
                    x = -clone.actor.width;
                } else {
                    x = this._monitor.width;
                }
            }

            if (animate && isOnCurrentWorkspace) {
                if (!metaWindow.showing_on_its_workspace()) {
                    /* Hidden windows should fade in and grow
                     * therefore we need to resize them now so they
                     * can be scaled up later */
                    if (initialPositioning) {
                        clone.actor.opacity = 0;
                        clone.actor.scale_x = 0;
                        clone.actor.scale_y = 0;
                        clone.actor.x = x;
                        clone.actor.y = y;
                    }

                    Tweener.addTween(clone.actor,
                                     { opacity: 255,
                                       time: Overview.ANIMATION_TIME,
                                       transition: 'easeInQuad'
                                     });
                }

                this._animateClone(clone, overlay, x, y, scale, initialPositioning);
            } else {
                // cancel any active tweens (otherwise they might override our changes)
                Tweener.removeTweens(clone.actor);
                clone.actor.set_position(x, y);
                clone.actor.set_scale(scale, scale);
                clone.actor.opacity = 255;

                if (clone.overlay) {
                    clone.overlay.relayout(false);
                    this._showWindowOverlay(clone, overlay, isOnCurrentWorkspace);
                }
            }
        }
    },

    syncStacking: function(stackIndices) {
        let clones = this._windows.slice();
        clones.sort(function (a, b) { return stackIndices[a.metaWindow.get_stable_sequence()] - stackIndices[b.metaWindow.get_stable_sequence()]; });

        for (let i = 0; i < clones.length; i++) {
            let clone = clones[i];
            let metaWindow = clone.metaWindow;
            if (i == 0) {
                clone.setStackAbove(this._dropRect);
            } else {
                let previousClone = clones[i - 1];
                clone.setStackAbove(previousClone.actor);
            }
        }
    },

    _animateClone: function(clone, overlay, x, y, scale, initialPositioning) {
        Tweener.addTween(clone.actor,
                         { x: x,
                           y: y,
                           scale_x: scale,
                           scale_y: scale,
                           time: Overview.ANIMATION_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, function() {
                               this._showWindowOverlay(clone, overlay, true);
                           })
                         });

        if (overlay) {
            overlay.relayout(true);
        }
    },

    _showWindowOverlay: function(clone, overlay, fade) {
        if (clone.inDrag)
            return;

        if (overlay) {
            if (fade)
                overlay.fadeIn();
            else
                overlay.show();
        }
    },

    _delayedWindowRepositioning: function() {
        let [x, y, mask] = global.get_pointer();

        let pointerHasMoved = (this._cursorX != x && this._cursorY != y);
        let inWorkspace = (this._x < x && x < this._x + this._width &&
                           this._y < y && y < this._y + this._height);

        if (pointerHasMoved && inWorkspace) {
            // store current cursor position
            this._cursorX = x;
            this._cursorY = y;
            return true;
        }

        let actorUnderPointer = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        for (let i = 0; i < this._windows.length; i++) {
            if (this._windows[i].actor == actorUnderPointer)
                return true;
        }

        this.positionWindows(WindowPositionFlags.ANIMATE);
        this._repositionWindowsId = 0;
        return false;
    },

    _doRemoveSideComponentWindow: function(metaWin) {
        // find the position of the window in our list
        let index = this._lookupSideComponentIndex(metaWin);
        let win = metaWin.get_compositor_private();

        if (index == -1)
            return null;

        // Check if window still should be here
        if (win && this._isMyWindow(win))
            return null;

        let clone = this._sideComponents[index];

        this._sideComponents.splice(index, 1);

        return clone;
    },

    _doRemoveRegularWindow: function(metaWin) {
        // find the position of the window in our list
        let index = this._lookupIndex (metaWin);
        let win = metaWin.get_compositor_private();

        if (index == -1)
            return null;

        // Check if window still should be here
        if (win && this._isMyWindow(win))
            return null;

        let clone = this._windows[index];

        this._windows.splice(index, 1);
        this._windowOverlays.splice(index, 1);

        return clone;
    },

    _doRemoveWindow : function(metaWin) {
        let win = metaWin.get_compositor_private();
        let clone = null;

        if (SideComponent.isSideComponentWindow(metaWin)) {
            clone = this._doRemoveSideComponentWindow(metaWin);
        } else {
            clone = this._doRemoveRegularWindow(metaWin);
        }

        if (!clone) {
            return;
        }

        // If metaWin.get_compositor_private() returned non-NULL, that
        // means the window still exists (and is just being moved to
        // another workspace or something), so set its overviewHint
        // accordingly. (If it returned NULL, then the window is being
        // destroyed; we'd like to animate this, but it's too late at
        // this point.)
        if (win) {
            let [stageX, stageY] = clone.actor.get_transformed_position();
            let [stageWidth, stageHeight] = clone.actor.get_transformed_size();
            win._overviewHint = {
                x: stageX,
                y: stageY,
                scale: stageWidth / clone.actor.width
            };
        }
        clone.destroy();


        // We need to reposition the windows; to avoid shuffling windows
        // around while the user is interacting with the workspace, we delay
        // the positioning until the pointer remains still for at least 750 ms
        // or is moved outside the workspace

        // remove old handler
        if (this._repositionWindowsId > 0) {
            Mainloop.source_remove(this._repositionWindowsId);
            this._repositionWindowsId = 0;
        }

        // setup new handler
        let [x, y, mask] = global.get_pointer();
        this._cursorX = x;
        this._cursorY = y;

        this._currentLayout = null;
        this._repositionWindowsId = Mainloop.timeout_add(750,
            Lang.bind(this, this._delayedWindowRepositioning));
    },

    _doAddWindow : function(metaWin) {
        if (this.leavingOverview)
            return;

        let win = metaWin.get_compositor_private();

        if (!win) {
            // Newly-created windows are added to a workspace before
            // the compositor finds out about them...
            Mainloop.idle_add(Lang.bind(this,
                                        function () {
                                            if (this.actor &&
                                                metaWin.get_compositor_private() &&
                                                metaWin.get_workspace() == this.metaWorkspace)
                                                this._doAddWindow(metaWin);
                                            return false;
                                        }));
            return;
        }

        // We might have the window in our list already if it was on all workspaces and
        // now was moved to this workspace
        if (this._lookupIndex (metaWin) != -1)
            return;

        if (this._lookupSideComponentIndex(metaWin) != -1)
            return;

        if (!this._isMyWindow(win) || !this._isOverviewWindow(win) || SideComponent.isSideComponentWindow(win.meta_window))
            return;

        let clone;

        if (SideComponent.isSideComponentWindow(win.meta_window)) {
            clone = this._addSideComponentClone(win);
        } else {
            [clone, ] = this._addWindowClone(win, false);
        }

        if (clone && win._overviewHint) {
            let x = win._overviewHint.x - this.actor.x;
            let y = win._overviewHint.y - this.actor.y;
            let scale = win._overviewHint.scale;
            delete win._overviewHint;

            clone.slot = [x, y, clone.actor.width * scale, clone.actor.height * scale];
            clone.positioned = true;
            clone.actor.set_position (x, y);
            clone.actor.set_scale (scale, scale);
            clone.overlay.relayout(false);
        }

        this._currentLayout = null;
        this.positionWindows(WindowPositionFlags.ANIMATE);
    },

    _windowAdded : function(metaWorkspace, metaWin) {
        this._doAddWindow(metaWin);
    },

    _windowRemoved : function(metaWorkspace, metaWin) {
        this._doRemoveWindow(metaWin);
    },

    _windowEnteredMonitor : function(metaScreen, monitorIndex, metaWin) {
        if (monitorIndex == this.monitorIndex) {
            this._doAddWindow(metaWin);
        }
    },

    _windowLeftMonitor : function(metaScreen, monitorIndex, metaWin) {
        if (monitorIndex == this.monitorIndex) {
            this._doRemoveWindow(metaWin);
        }
    },

    // check for maximized windows on the workspace
    hasMaximizedWindows: function() {
        for (let i = 0; i < this._windows.length; i++) {
            let metaWindow = this._windows[i].metaWindow;
            if (metaWindow.showing_on_its_workspace() &&
                metaWindow.maximized_horizontally &&
                metaWindow.maximized_vertically)
                return true;
        }
        return false;
    },

    // Animate the full-screen to Overview transition.
    zoomToOverview : function() {
        this._currentLayout = null;

        // Position and scale the windows.
        if (Main.overview.animationInProgress)
            this.positionWindows(WindowPositionFlags.ANIMATE | WindowPositionFlags.INITIAL);
        else
            this.positionWindows(WindowPositionFlags.INITIAL);
    },

    // Animates the return from Overview mode
    zoomFromOverview : function() {
        let currentWorkspace = global.screen.get_active_workspace();

        this.leavingOverview = true;

        for (let i = 0; i < this._windows.length; i++) {
            let clone = this._windows[i];
            Tweener.removeTweens(clone.actor);
        }

        for (let i = 0; i < this._sideComponents.length; i++) {
            let clone = this._sideComponents[i];
            Tweener.removeTweens(clone.actor);
        }

        if (this._repositionWindowsId > 0) {
            Mainloop.source_remove(this._repositionWindowsId);
            this._repositionWindowsId = 0;
        }
        this._overviewHiddenId = Main.overview.connect('hidden', Lang.bind(this,
                                                                           this._doneLeavingOverview));

        if (this.metaWorkspace != null && this.metaWorkspace != currentWorkspace)
            return;

        // Position and scale the windows.
        for (let i = 0; i < this._windows.length; i++) {
            let clone = this._windows[i];
            let overlay = this._windowOverlays[i];

            if (overlay)
                overlay.hide();

            if (clone.metaWindow.showing_on_its_workspace()) {
                Tweener.addTween(clone.actor,
                                 { x: clone.origX,
                                   y: clone.origY,
                                   scale_x: 1.0,
                                   scale_y: 1.0,
                                   time: Overview.ANIMATION_TIME,
                                   opacity: 255,
                                   transition: 'easeOutQuad'
                                 });
            } else {
                // The window is hidden, make it shrink and fade it out
                Tweener.addTween(clone.actor,
                                 { scale_x: 0,
                                   scale_y: 0,
                                   opacity: 0,
                                   time: Overview.ANIMATION_TIME,
                                   transition: 'easeOutQuad'
                                 });
            }
        }

        // Now do the same for side components
        for (let i = 0; i < this._sideComponents.length; i++) {
            let clone = this._sideComponents[i];

            Tweener.addTween(clone.actor,
                             { x: clone.origX,
                               y: clone.origY,
                               scale_x: 1.0,
                               scale_y: 1.0,
                               time: Overview.ANIMATION_TIME,
                               opacity: 255,
                               transition: 'easeOutQuad'
                             });
        }
    },

    destroy : function() {
        this.actor.destroy();
    },

    _onDestroy: function(actor) {
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }
        Tweener.removeTweens(actor);

        if (this.metaWorkspace) {
            this.metaWorkspace.disconnect(this._windowAddedId);
            this.metaWorkspace.disconnect(this._windowRemovedId);
        }
        global.screen.disconnect(this._windowEnteredMonitorId);
        global.screen.disconnect(this._windowLeftMonitorId);

        if (this._repositionWindowsId > 0)
            Mainloop.source_remove(this._repositionWindowsId);

        if (this._positionWindowsId > 0)
            Meta.later_remove(this._positionWindowsId);
        this._windows = [];
        this._sideComponents = [];
    },

    // Sets this.leavingOverview flag to false.
    _doneLeavingOverview : function() {
        this.leavingOverview = false;
    },

    // Tests if @actor belongs to this workspaces and monitor
    _isMyWindow : function (actor) {
        let win = actor.meta_window;
        return (this.metaWorkspace == null || win.located_on_workspace(this.metaWorkspace)) &&
            (win.get_monitor() == this.monitorIndex);
    },

    // Tests if @win should be shown in the Overview
    _isOverviewWindow : function (win) {
        let metaWindow = win.get_meta_window();
        return Shell.WindowTracker.is_window_interesting(metaWindow) &&
            !SideComponent.isSideComponentWindow(metaWindow);
    },

    // Create a clone of a side component window and add it to the
    // side components list
    _addSideComponentClone: function(win) {
        let clone = new WindowClone(win, this);
        clone.positioned = true;
        this.actor.add_actor(clone.actor);
        this._sideComponents.push(clone);

        return clone;
    },

    // Create a clone of a (non-desktop) window and add it to the window list
    _addWindowClone : function(win, positioned) {
        let clone = new WindowClone(win, this);
        let overlay = new WindowOverlay(clone, this._windowOverlaysGroup);
        clone.overlay = overlay;
        clone.positioned = positioned;

        clone.connect('selected',
                      Lang.bind(this, this._onCloneSelected));
        clone.connect('drag-begin',
                      Lang.bind(this, function(clone) {
                          Main.overview.beginWindowDrag();
                          overlay.hide();
                      }));
        clone.connect('drag-cancelled',
                      Lang.bind(this, function(clone) {
                          Main.overview.cancelledWindowDrag();
                      }));
        clone.connect('drag-end',
                      Lang.bind(this, function(clone) {
                          Main.overview.endWindowDrag();
                          overlay.show();
                      }));
        clone.connect('size-changed',
                      Lang.bind(this, function() {
                          this.positionWindows(0);
                      }));

        this.actor.add_actor(clone.actor);

        overlay.connect('show-close-button', Lang.bind(this, this._onShowOverlayClose));

        if (this._windows.length == 0)
            clone.setStackAbove(null);
        else
            clone.setStackAbove(this._windows[this._windows.length - 1].actor);

        this._windows.push(clone);
        this._windowOverlays.push(overlay);

        return [clone, overlay];
    },

    _onShowOverlayClose: function (windowOverlay) {
        for (let i = 0; i < this._windowOverlays.length; i++) {
            let overlay = this._windowOverlays[i];
            if (overlay == windowOverlay)
                continue;
            overlay.hideCloseButton();
        }
    },

    _isBetterLayout: function(oldLayout, newLayout) {
        if (oldLayout.scale === undefined)
            return true;

        let spacePower = (newLayout.space - oldLayout.space) * LAYOUT_SPACE_WEIGHT;
        let scalePower = (newLayout.scale - oldLayout.scale) * LAYOUT_SCALE_WEIGHT;

        if (newLayout.scale > oldLayout.scale && newLayout.space > oldLayout.space) {
            // Win win -- better scale and better space
            return true;
        } else if (newLayout.scale > oldLayout.scale && newLayout.space <= oldLayout.space) {
            // Keep new layout only if scale gain outweights aspect space loss
            return scalePower > spacePower;
        } else if (newLayout.scale <= oldLayout.scale && newLayout.space > oldLayout.space) {
            // Keep new layout only if aspect space gain outweights scale loss
            return spacePower > scalePower;
        } else {
            // Lose -- worse scale and space
            return false;
        }
    },

    _computeLayout: function(windows, area, rowSpacing, columnSpacing) {
        // We look for the largest scale that allows us to fit the
        // largest row/tallest column on the workspace.

        let lastLayout = {};

        for (let numRows = 1; ; numRows++) {
            let numColumns = Math.ceil(windows.length / numRows);

            // If adding a new row does not change column count just stop
            // (for instance: 9 windows, with 3 rows -> 3 columns, 4 rows ->
            // 3 columns as well => just use 3 rows then)
            if (numColumns == lastLayout.numColumns)
                break;

            let strategy = new UnalignedLayoutStrategy(this._monitor, rowSpacing, columnSpacing);

            let layout = { area: area, strategy: strategy, numRows: numRows, numColumns: numColumns };
            strategy.computeLayout(windows, layout);
            strategy.computeScaleAndSpace(layout);

            if (!this._isBetterLayout(lastLayout, layout))
                break;

            lastLayout = layout;
        }

        return lastLayout;
    },

    _rectEqual: function(one, two) {
        if (one == two)
            return true;

        return (one.x == two.x &&
                one.y == two.y &&
                one.width == two.width &&
                one.height == two.height);
    },

    _computeAllWindowSlots: function(windows) {
        let totalWindows = windows.length;
        let node = this.actor.get_theme_node();

        // Window grid spacing
        let columnSpacing = node.get_length('-horizontal-spacing');
        let rowSpacing = node.get_length('-vertical-spacing');
        let padding = {
            left: node.get_padding(St.Side.LEFT),
            top: node.get_padding(St.Side.TOP),
            bottom: node.get_padding(St.Side.BOTTOM),
            right: node.get_padding(St.Side.RIGHT),
        };

        if (!totalWindows)
            return [];

        let closeButtonHeight, captionHeight;
        let leftBorder, rightBorder;
        if (this._windowOverlays.length) {
            // All of the overlays have the same chrome sizes,
            // so just pick the first one.
            let overlay = this._windowOverlays[0];
            [closeButtonHeight, captionHeight] = overlay.chromeHeights();
            [leftBorder, rightBorder] = overlay.chromeWidths();
        } else {
            [closeButtonHeight, captionHeight] = [0, 0];
            [leftBorder, rightBorder] = [0, 0];
        }

        rowSpacing += captionHeight;
        columnSpacing += (rightBorder + leftBorder) / 2;
        padding.top += closeButtonHeight;
        padding.bottom += captionHeight;
        padding.left += leftBorder;
        padding.right += rightBorder;

        let area = {
            x: this._x + padding.left,
            y: this._y + padding.top,
            width: this._width - padding.left - padding.right,
            height: this._height - padding.top - padding.bottom,
        };

        if (!this._currentLayout)
            this._currentLayout = this._computeLayout(windows, area, rowSpacing, columnSpacing);

        let layout = this._currentLayout;
        let strategy = layout.strategy;

        if (!this._rectEqual(area, layout.area)) {
            layout.area = area;
            strategy.computeScaleAndSpace(layout);
        }

        return strategy.computeWindowSlots(layout, area);
    },

    _onCloneSelected : function (clone, time) {
        let wsIndex = undefined;
        if (this.metaWorkspace)
            wsIndex = this.metaWorkspace.index();
        Main.activateWindow(clone.metaWindow, time, wsIndex);
    },

    // Draggable target interface
    handleDragOver : function(source, actor, x, y, time) {
        if (source.realWindow && !this._isMyWindow(source.realWindow))
            return DND.DragMotionResult.MOVE_DROP;

        return DND.DragMotionResult.CONTINUE;
    },

    acceptDrop : function(source, actor, x, y, time) {
        if (source.realWindow) {
            let win = source.realWindow;
            if (this._isMyWindow(win))
                return false;

            // Set a hint on the Mutter.Window so its initial position
            // in the new workspace will be correct
            win._overviewHint = {
                x: actor.x,
                y: actor.y,
                scale: actor.scale_x
            };

            let metaWindow = win.get_meta_window();

            // We need to move the window before changing the workspace, because
            // the move itself could cause a workspace change if the window enters
            // the primary monitor
            if (metaWindow.get_monitor() != this.monitorIndex)
                metaWindow.move_to_monitor(this.monitorIndex);

            let index = this.metaWorkspace ? this.metaWorkspace.index() : global.screen.get_active_workspace_index();
            metaWindow.change_workspace_by_index(index,
                                                 false, // don't create workspace
                                                 time);
            return true;
        }

        return false;
    }
});

Signals.addSignalMethods(Workspace.prototype);
