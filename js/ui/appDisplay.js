// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const EosMetrics = imports.gi.EosMetrics;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Shell = imports.gi.Shell;
const Lang = imports.lang;
const Pango = imports.gi.Pango;
const Signals = imports.signals;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Atk = imports.gi.Atk;

const ActorVisibility = imports.misc.actorVisibility;
const AppActivation = imports.ui.appActivation;
const AppFavorites = imports.ui.appFavorites;
const BackgroundMenu = imports.ui.backgroundMenu;
const BoxPointer = imports.ui.boxpointer;
const CloseButton = imports.ui.closeButton;
const ButtonConstants = imports.ui.buttonConstants;
const DND = imports.ui.dnd;
const IconGrid = imports.ui.iconGrid;
const IconGridLayout = imports.ui.iconGridLayout;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PopupMenu = imports.ui.popupMenu;
const Tweener = imports.ui.tweener;
const Workspace = imports.ui.workspace;
const Params = imports.misc.params;
const Util = imports.misc.util;

const MAX_APPLICATION_WORK_MILLIS = 75;
const MENU_POPUP_TIMEOUT = 600;
const MAX_COLUMNS = 7;
const ROWS_FOR_ENTRY = 4;
const MIN_COLUMNS = 4;
const MIN_ROWS = 4;

const DRAG_OVER_FOLDER_OPACITY = 128;
const INACTIVE_GRID_OPACITY = 96;
const INACTIVE_GRID_OPACITY_ANIMATION_TIME = 0.40;
const ACTIVE_GRID_OPACITY = 255;

const INACTIVE_GRID_TRANSITION = 'easeOutQuad';
const ACTIVE_GRID_TRANSITION = 'easeInQuad';

const INACTIVE_GRID_SATURATION = 1;
const ACTIVE_GRID_SATURATION = 0;

const DRAG_SCROLL_PIXELS_PER_SEC = 800;

const FOLDER_POPUP_ANIMATION_PIXELS_PER_SEC = 600;
const FOLDER_POPUP_ANIMATION_TYPE = 'easeOutQuad';

const SHOW_IN_APP_STORE_DESKTOP_KEY = 'X-Endless-ShowInAppStore';

const ENABLE_APP_STORE_KEY = 'enable-app-store';
const EOS_APP_STORE_ID = 'com.endlessm.AppStore';

const MIN_FREQUENT_APPS_COUNT = 3;

const INDICATORS_BASE_TIME = 0.25;
const INDICATORS_ANIMATION_DELAY = 0.125;
const INDICATORS_ANIMATION_MAX_TIME = 0.75;
// Fraction of page height the finger or mouse must reach
// to change page
const PAGE_SWITCH_TRESHOLD = 0.2;
const PAGE_SWITCH_TIME = 0.3;


const BaseAppView = new Lang.Class({
    Name: 'BaseAppView',
    Abstract: true,

    _init: function(params, gridParams) {
        gridParams = Params.parse(gridParams, { xAlign: St.Align.MIDDLE,
                                                columnLimit: MAX_COLUMNS,
                                                minRows: MIN_ROWS,
                                                minColumns: MIN_COLUMNS,
                                                fillParent: false,
                                                padWithSpacing: true });
        params = Params.parse(params, { usePagination: false });

        if(params.usePagination)
            this._grid = new IconGrid.PaginatedIconGrid(gridParams);
        else
            this._grid = new IconGrid.IconGrid(gridParams);

        // Standard hack for ClutterBinLayout
        this._grid.actor.x_expand = true;
        this._grid.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._allIcons = [];
        this.repositionedIconData = [ null, null ];
    },

    _onDestroy: function() {
        this._allIcons = [];
    },

    removeAll: function() {
        this._grid.removeAll();
        this._allIcons = [];
    },

    _createItemIcon: function(item) {
        throw new Error('Not implemented');
    },

    _createItemForId: function(itemId) {
        let appSystem = Shell.AppSystem.get_default();
        let item = null;

        if (IconGridLayout.layout.iconIsFolder(itemId)) {
            item = Shell.DesktopDirInfo.new(itemId);
        } else {
            item = appSystem.lookup_app(itemId);
        }

        return item;
    },

    addIcon: function(icon) {
        let idx = this._allIcons.indexOf(icon);
        if (idx == -1) {
            this._allIcons.push(icon);
            this._grid.addItem(icon.actor);
        }
    },

    removeIcon: function(icon) {
        let idx = this._allIcons.indexOf(icon);
        if (idx != -1) {
            this._allIcons.splice(idx, 1);
        }

        this._grid.removeItem(icon.actor);
    },

    indexOf: function(icon) {
        return this._grid.indexOf(icon.actor);
    },

    getIconForIndex: function(index) {
        return this._allIcons[index];
    },

    nudgeItemsAtIndex: function(index, location) {
        this._grid.nudgeItemsAtIndex(index, location);
    },

    removeNudgeTransforms: function() {
        this._grid.removeNudgeTransforms();
    },

    canDropAt: function(x, y, canDropPastEnd) {
        return this._grid.canDropAt(x, y, canDropPastEnd);
    },

    getAllIcons: function() {
        return this._allIcons;
    },

    getLayoutIds: function() {
        let viewId = this.getViewId();
        return IconGridLayout.layout.getIcons(viewId).slice();
    },

    _trimInvisible: function(items) {
        let appSystem = Shell.AppSystem.get_default();
        return items.filter(Lang.bind(this,
            function(itemId) {
                return IconGridLayout.layout.iconIsFolder(itemId) || appSystem.lookup_app(itemId) || (itemId == EOS_APP_STORE_ID);
            }));
    },

    _findIconChanges: function() {
        let oldItemLayout = this._allIcons.map(function(icon) { return icon.getId(); });
        let newItemLayout = this.getLayoutIds();
        newItemLayout = this._trimInvisible(newItemLayout);

        let movedList = {};
        let removedList = [];
        for (let oldItemIdx in oldItemLayout) {
            let oldItem = oldItemLayout[oldItemIdx];
            let newItemIdx = newItemLayout.indexOf(oldItem);

            // Did this icon move?
            if (newItemIdx != -1 && oldItemIdx != newItemIdx) {
                movedList[oldItemIdx] = newItemIdx;
            // Did it get removed?
            } else if (newItemIdx == -1) {
                removedList.push(oldItemIdx);
            }
        }

        return [movedList, removedList];
    },

    animateMovement: function() {
        let [movedList, removedList] = this._findIconChanges();
        this._grid.animateShuffling(movedList,
                                    removedList,
                                    this.repositionedIconData,
                                    Lang.bind(this, this.addIcons)
                                   );
        this.repositionedIconData = [ null, null ];
    },

    _ensureIconVisible: function(icon) {
        return ActorVisibility.ensureActorVisibleInScrollView(this.actor, icon);
    },

    iconsNeedRedraw: function() {
        // Check if the icons moved around
        let [movedList, removedList] = this._findIconChanges();
        let movedLength = Object.keys(movedList).length;
        if (movedLength > 0 || removedList.length > 0) {
            return true;
        }

        // Create a map from app ids to icon objects
        let iconTable = {};
        for (let idx in this._allIcons) {
            iconTable[this._allIcons[idx].getId()] = this._allIcons[idx];
        }

        let layoutIds = this.getLayoutIds();

        // Iterate through all visible icons
        for (let idx in layoutIds) {
            let itemId = layoutIds[idx];
            let item = this._createItemForId(itemId);

            if (!item) {
                continue;
            }

            let currentIcon = iconTable[itemId];

            if (!currentIcon) {
                // This icon is new
                return true;
            }

            if (currentIcon.customName &&
                currentIcon.getName() == item.get_name()) {
                // Rename was confirmed, fall through the
                // other checks
                currentIcon.customName = false;
            }

            if (currentIcon.getName() != item.get_name() &&
                !currentIcon.customName) {
                // This icon was renamed out of band
                return true;
            }

            let isFolder = IconGridLayout.layout.iconIsFolder(itemId);

            if (isFolder && currentIcon.view.iconsNeedRedraw()) {
                // Items inside the folder changed
                return true;
            }

            let oldIconInfo = null;
            let newIconInfo = null;

            if (isFolder) {
                oldIconInfo = currentIcon.folder.get_icon();
                newIconInfo = item.get_icon();
            } else if (currentIcon.app) {
                let appInfo = currentIcon.app.get_app_info();
                oldIconInfo = appInfo.get_icon();
                newIconInfo = item.get_app_info().get_icon();
            }

            if (newIconInfo && !newIconInfo.equal(oldIconInfo)) {
                // The icon image changed
                return true;
            }
        }

        return false;
    },

    addIcons: function() {
        // Don't do anything if we don't have more up-to-date information, since
        // re-adding icons unnecessarily can cause UX problems
        if (!this.iconsNeedRedraw()) {
            return;
        }

        this.removeAll();

        let ids = this.getLayoutIds();

        for (let i = 0; i < ids.length; i++) {
            let itemId = ids[i];

            let icon = null;
            let item = this._createItemForId(itemId);

            if (item) {
                icon = this._createItemIcon(item);
            }

            if (icon) {
                this.addIcon(icon);
                icon.actor.connect('key-focus-in',
                                   Lang.bind(this, this._ensureIconVisible));
            }
        }
    },

    get gridActor() {
        return this._grid.actor;
    },

    _selectAppInternal: function(id) {
        if (this._items[id])
            this._items[id].actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
        else
            log('No such application ' + id);
    },

    selectApp: function(id) {
        if (this._items[id] && this._items[id].actor.mapped) {
            this._selectAppInternal(id);
        } else if (this._items[id]) {
            // Need to wait until the view is mapped
            let signalId = this._items[id].actor.connect('notify::mapped', Lang.bind(this, function(actor) {
                if (actor.mapped) {
                    actor.disconnect(signalId);
                    this._selectAppInternal(id);
                }
            }));
        } else {
            // Need to wait until the view is built
            let signalId = this.connect('view-loaded', Lang.bind(this, function() {
                this.disconnect(signalId);
                this.selectApp(id);
            }));
        }
    }
});
Signals.addSignalMethods(BaseAppView.prototype);

const PageIndicators = new Lang.Class({
    Name:'PageIndicators',

    _init: function() {
        this.actor = new St.BoxLayout({ style_class: 'page-indicators',
                                        vertical: true,
                                        x_expand: true, y_expand: true,
                                        x_align: Clutter.ActorAlign.END,
                                        y_align: Clutter.ActorAlign.CENTER,
                                        reactive: true });
        this._nPages = 0;
        this._currentPage = undefined;

        this.actor.connect('notify::mapped',
                           Lang.bind(this, this._animateIndicators));
    },

    setNPages: function(nPages) {
        if (this._nPages == nPages)
            return;

        let diff = nPages - this._nPages;
        if (diff > 0) {
            for (let i = 0; i < diff; i++) {
                let pageIndex = this._nPages + i;
                let indicator = new St.Button({ style_class: 'page-indicator',
                                                button_mask: St.ButtonMask.ONE |
                                                             St.ButtonMask.TWO |
                                                             St.ButtonMask.THREE,
                                                toggle_mode: true,
                                                checked: pageIndex == this._currentPage });
                indicator.child = new St.Widget({ style_class: 'page-indicator-icon' });
                indicator.connect('clicked', Lang.bind(this,
                    function() {
                        this.emit('page-activated', pageIndex);
                    }));
                this.actor.add_actor(indicator);
            }
        } else {
            let children = this.actor.get_children().splice(diff);
            for (let i = 0; i < children.length; i++)
                children[i].destroy();
        }
        this._nPages = nPages;
        this.actor.visible = (this._nPages > 1);
    },

    setCurrentPage: function(currentPage) {
        this._currentPage = currentPage;

        let children = this.actor.get_children();
        for (let i = 0; i < children.length; i++)
            children[i].set_checked(i == this._currentPage);
    },

    _animateIndicators: function() {
        if (!this.actor.mapped)
            return;

        let children = this.actor.get_children();
        if (children.length == 0)
            return;

        let offset;
        if (this.actor.get_text_direction() == Clutter.TextDirection.RTL)
            offset = -children[0].width;
        else
            offset = children[0].width;

        let delay = INDICATORS_ANIMATION_DELAY;
        let totalAnimationTime = INDICATORS_BASE_TIME + INDICATORS_ANIMATION_DELAY * this._nPages;
        if (totalAnimationTime > INDICATORS_ANIMATION_MAX_TIME)
            delay -= (totalAnimationTime - INDICATORS_ANIMATION_MAX_TIME) / this._nPages;

        for (let i = 0; i < this._nPages; i++) {
            children[i].translation_x = offset;
            Tweener.addTween(children[i],
                             { translation_x: 0,
                               time: INDICATORS_BASE_TIME + delay * i,
                               transition: 'easeInOutQuad'
                             });
        }
    }
});
Signals.addSignalMethods(PageIndicators.prototype);

const AllView = new Lang.Class({
    Name: 'AllView',
    Extends: BaseAppView,

    _init: function() {
        this.parent({ usePagination: true }, null);

        this._appStoreIcon = null;
        this._scrollView = new St.ScrollView({ style_class: 'all-apps',
                                               x_expand: true,
                                               y_expand: true,
                                               x_fill: true,
                                               y_fill: false,
                                               reactive: true,
                                               y_align: St.Align.START });
        this.actor = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                     x_expand:true, y_expand:true });
        this.actor.add_actor(this._scrollView);

        this._scrollView.set_policy(Gtk.PolicyType.NEVER,
                                    Gtk.PolicyType.AUTOMATIC);
        // we are only using ScrollView for the fade effect, hide scrollbars
        this._scrollView.vscroll.hide();
        this._adjustment = this._scrollView.vscroll.adjustment;

        this._pageIndicators = new PageIndicators();
        this._pageIndicators.connect('page-activated', Lang.bind(this,
            function(indicators, pageIndex) {
                this.goToPage(pageIndex);
            }));
        this._pageIndicators.actor.connect('scroll-event', Lang.bind(this, this._onScroll));
        this.actor.add_actor(this._pageIndicators.actor);

        this._folderIcons = [];

        this._stack = new St.Widget({ layout_manager: new Clutter.BinLayout() });
        let box = new St.BoxLayout({ vertical: true });

        this._currentPage = 0;
        this._stack.add_actor(this._grid.actor);
        this._eventBlocker = new St.Widget({ x_expand: true, y_expand: true });
        this._stack.add_actor(this._eventBlocker);

        box.add_actor(this._stack);
        this._scrollView.add_actor(box);

        this._scrollView.connect('scroll-event', Lang.bind(this, this._onScroll));

        Main.overview.connect('item-drag-begin', Lang.bind(this, this._onDragBegin));
        Main.overview.connect('item-drag-end', Lang.bind(this, this._onDragEnd));

        let panAction = new Clutter.PanAction({ interpolate: false });
        panAction.connect('pan', Lang.bind(this, this._onPan));
        panAction.connect('gesture-cancel', Lang.bind(this, this._onPanEnd));
        panAction.connect('gesture-end', Lang.bind(this, this._onPanEnd));
        this._panAction = panAction;
        this._scrollView.add_action(panAction);
        this._panning = false;
        this._clickAction = new Clutter.ClickAction();
        this._clickAction.connect('clicked', Lang.bind(this, function() {
            if (!this._currentPopup)
                return;

            let [x, y] = this._clickAction.get_coords();
            let actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
            if (!this._currentPopup.actor.contains(actor))
                this._currentPopup.popdown();
        }));
        this._eventBlocker.add_action(this._clickAction);

        this._displayingPopup = false;

        this._availWidth = 0;
        this._availHeight = 0;

        Main.overview.connect('hidden', Lang.bind(this,
            function() {
                this.goToPage(0);
            }));
        this._grid.connect('space-opened', Lang.bind(this,
            function() {
                this._scrollView.get_effect('fade').enabled = false;
                this.emit('space-ready');
            }));
        this._grid.connect('space-closed', Lang.bind(this,
            function() {
                this._displayingPopup = false;
            }));

        this.actor.connect('notify::mapped', Lang.bind(this,
            function() {
                if (this.actor.mapped) {
                    this._keyPressEventId =
                        global.stage.connect('key-press-event',
                                             Lang.bind(this, this._onKeyPressEvent));
                } else {
                    if (this._keyPressEventId)
                        global.stage.disconnect(this._keyPressEventId);
                    this._keyPressEventId = 0;
                }
            }));

        this._bgAction = new Clutter.ClickAction();
        Main.overview.addAction(this._bgAction, true);
        BackgroundMenu.addBackgroundMenu(this._bgAction, Main.layoutManager);
        this._clickAction.bind_property('enabled', this._bgAction, 'enabled',
                                        GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.INVERT_BOOLEAN);
        this.actor.bind_property('mapped', this._bgAction, 'enabled',
                                 GObject.BindingFlags.SYNC_CREATE);

        this._repositionedView = null;

        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connect('installed-changed', Lang.bind(this, function() {
            Main.queueDeferredWork(this._allAppsWorkId);
        }));
        global.settings.connect('changed::app-folder-categories', Lang.bind(this, function() {
            Main.queueDeferredWork(this._allAppsWorkId);
        }));

        IconGridLayout.layout.connect('changed', Lang.bind(this, function() {
            Main.queueDeferredWork(this._allAppsWorkId);
        }));
        global.settings.connect('changed::enable-app-store', Lang.bind(this, function() {
            Main.queueDeferredWork(this._allAppsWorkId);
        }));

        this._allAppsWorkId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._redisplay));
    },

      removeAll: function() {
        this.parent();
        this._appStoreIcon = null;
        this._folderIcons = [];
    },

    _redisplay: function() {
        if (this.getAllIcons().length == 0) {
            this.addIcons();
        } else {
            let animateView = this._repositionedView;
            if (!animateView) {
                animateView = this;
            }
            this._repositionedView = null;

            animateView.animateMovement();
        }
    },

    _closePopup: function() {
        if (!this._currentPopup) {
            return;
        }

        let [x, y] = this._clickAction.get_coords();
        let actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
        if (!this._currentPopup.actor.contains(actor)) {
            this._currentPopup.popdown();
        }
    },

    getCurrentPageY: function() {
        return this._grid.getPageY(this._currentPage);
    },

    goToPage: function(pageNumber) {
        if(pageNumber < 0 || pageNumber > this._grid.nPages() - 1)
            return;
        if (this._currentPage == pageNumber && this._displayingPopup && this._currentPopup)
            return;
        if (this._displayingPopup && this._currentPopup)
            this._currentPopup.popdown();

        let velocity;
        if (!this._panning)
            velocity = 0;
        else
            velocity = Math.abs(this._panAction.get_velocity(0)[2]);
        // Tween the change between pages.
        // If velocity is not specified (i.e. scrolling with mouse wheel),
        // use the same speed regardless of original position
        // if velocity is specified, it's in pixels per milliseconds
        let diffToPage = this._diffToPage(pageNumber);
        let childBox = this._scrollView.get_allocation_box();
        let totalHeight = childBox.y2 - childBox.y1;
        let time;
        // Only take the velocity into account on page changes, otherwise
        // return smoothly to the current page using the default velocity
        if (this._currentPage != pageNumber) {
            let minVelocity = totalHeight / (PAGE_SWITCH_TIME * 1000);
            velocity = Math.max(minVelocity, velocity);
            time = (diffToPage / velocity) / 1000;
        } else {
            time = PAGE_SWITCH_TIME * diffToPage / totalHeight;
        }
        // When changing more than one page, make sure to not take
        // longer than PAGE_SWITCH_TIME
        time = Math.min(time, PAGE_SWITCH_TIME);

        if (pageNumber < this._grid.nPages() && pageNumber >= 0) {
            this._currentPage = pageNumber;
            Tweener.addTween(this._adjustment,
                             { value: this._grid.getPageY(this._currentPage),
                               time: time,
                               transition: 'easeOutQuad' });
            this._pageIndicators.setCurrentPage(pageNumber);
        }
    },

    _diffToPage: function (pageNumber) {
        let currentScrollPosition = this._adjustment.value;
        return Math.abs(currentScrollPosition - this._grid.getPageY(pageNumber));
    },

    openSpaceForPopup: function(item, side, nRows) {
        this._updateIconOpacities(true);
        this._displayingPopup = true;
        this._grid.openExtraSpace(item, side, nRows);
    },

    _closeSpaceForPopup: function() {
        this._updateIconOpacities(false);
        this._scrollView.get_effect('fade').enabled = true;
        this._grid.closeExtraSpace();
    },

    _onScroll: function(actor, event) {
        if (this._displayingPopup)
            return true;

        let direction = event.get_scroll_direction();
        if (direction == Clutter.ScrollDirection.UP)
            this.goToPage(this._currentPage - 1);
        else if (direction == Clutter.ScrollDirection.DOWN)
            this.goToPage(this._currentPage + 1);

        return true;
    },

    _onPan: function(action) {
        if (this._displayingPopup)
            return false;
        this._panning = true;
        this._clickAction.release();
        let [dist, dx, dy] = action.get_motion_delta(0);
        let adjustment = this._adjustment;
        adjustment.value -= (dy / this._scrollView.height) * adjustment.page_size;
        return false;
    },

    _onPanEnd: function(action) {
         if (this._displayingPopup)
            return;
        let diffCurrentPage = this._diffToPage(this._currentPage);
        if (diffCurrentPage > this._scrollView.height * PAGE_SWITCH_TRESHOLD) {
            if (action.get_velocity(0)[2] > 0)
                this.goToPage(this._currentPage - 1);
            else
                this.goToPage(this._currentPage + 1);
        } else {
            this.goToPage(this._currentPage);
        }
        this._panning = false;
    },

    _onKeyPressEvent: function(actor, event) {
        if (this._displayingPopup)
            return true;

        if (event.get_key_symbol() == Clutter.Page_Up) {
            this.goToPage(this._currentPage - 1);
            return true;
        } else if (event.get_key_symbol() == Clutter.Page_Down) {
            this.goToPage(this._currentPage + 1);
            return true;
        }

        return false;
    },

    _resetNudgeState: function() {
        if (this._dragView) {
            this._dragView.removeNudgeTransforms();
        }
    },

    _resetDragViewState: function() {
        this._resetNudgeState();

        this._insertIdx = -1;
        this._onIconIdx = -1;
        this._lastCursorLocation = -1;
        this._dragView = null;
    },

    _setupDragState: function(source) {
        if (!source || !source.parentView) {
            return;
        }

        if (!source.handleViewDragBegin) {
            return;
        }

        this._dragIcon = source;
        this._originalIdx = source.parentView.indexOf(source);

        this._dragMonitor = {
            dragMotion: Lang.bind(this, this._onDragMotion)
        };
        DND.addDragMonitor(this._dragMonitor);

        this._resetDragViewState();

        source.handleViewDragBegin();
        if (this._appStoreIcon && (source.canDragOver(this._appStoreIcon))) {
            this._appStoreIcon.handleViewDragBegin();
        }
    },

    _clearDragState: function(source) {
        if (!source || !source.parentView) {
            return;
        }

        if (!source.handleViewDragEnd) {
            return;
        }

        this._dragIcon = null;
        this._originalIdx = -1;

        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }

        this._resetDragViewState();

        source.handleViewDragEnd();
        if (this._appStoreIcon && (source.canDragOver(this._appStoreIcon))) {
            this._appStoreIcon.handleViewDragEnd();
        }
    },

    _onDragBegin: function(overview, source) {
        // Save the currently dragged item info
        this._setupDragState(source);

        // Hide the event blocker in all cases to allow for dash DnD
        this._eventBlocker.hide();
    },

    _onDragEnd: function(overview, source) {
        this._eventBlocker.show();
        this._clearDragState(source);
    },

    _onDragMotion: function(dragEvent) {
        // If the icon is dragged to the top or the bottom of the grid,
        // we want to scroll it, if possible
        if (this._handleDragOvershoot(dragEvent)) {
            this._resetDragViewState();
            return DND.DragMotionResult.CONTINUE;
        }

        // Handle motion over grid
        let dragView = null;

        if (this._dragIcon.parentView.actor.contains(dragEvent.targetActor)) {
            dragView = this._dragIcon.parentView;
        } else if (this.actor.contains(dragEvent.targetActor)) {
            dragView = this;
        }

        if (dragView != this._dragView) {
            this._resetDragViewState();
            this._dragView = dragView;
        }

        if (!this._dragView) {
            return DND.DragMotionResult.CONTINUE;
        }

        let draggingWithinFolder =
            this._currentPopup && (this._dragView == this._dragIcon.parentView);
        let canDropPastEnd = draggingWithinFolder || !this._appStoreIcon;

        // Ask grid can we drop here
        let [idx, cursorLocation] = this._dragView.canDropAt(dragEvent.x,
                                                             dragEvent.y,
                                                             canDropPastEnd);

        let onIcon = (cursorLocation == IconGrid.CursorLocation.ON_ICON);
        let isNewPosition = (!onIcon && idx != this._insertIdx) ||
            (cursorLocation != this._lastCursorLocation);

        // If we are not over our last hovered icon, remove its hover state
        if (this._onIconIdx != -1 &&
            ((idx != this._onIconIdx) || !onIcon)) {
            this._setDragHoverState(false);
            dragEvent.dragActor.opacity = ACTIVE_GRID_OPACITY;
        }

        // If we are in a new spot, remove the previous nudges
        if (isNewPosition) {
            this._resetNudgeState();
        }

        // Update our insert/hover index and the last cursor location
        this._lastCursorLocation = cursorLocation;
        if (onIcon) {
            this._onIconIdx = idx;
            this._insertIdx = -1;

            let hoverResult = this._getDragHoverResult();
            if (hoverResult == DND.DragMotionResult.MOVE_DROP) {
                // If we are hovering over a drop target, set its hover state
                this._setDragHoverState(true);
                dragEvent.dragActor.opacity = DRAG_OVER_FOLDER_OPACITY;
            }

            return hoverResult;
        } else {
            this._onIconIdx = -1;
            this._insertIdx = idx;

            if (this._shouldNudgeItems(isNewPosition)) {
                this._dragView.nudgeItemsAtIndex(this._insertIdx, cursorLocation);
            }

            // Propagate the signal in any case when moving icons
            return DND.DragMotionResult.CONTINUE;
        }
    },

    _handleDragOvershoot: function(dragEvent) {
        let [ gridX, gridY ] = this.actor.get_transformed_position();
        let [ gridW, gridH ] = this.actor.get_transformed_size();
        let gridBottom = gridY + gridH;

        let adjustment = this.actor.vscroll.adjustment;

        if (dragEvent.y > gridY && dragEvent.y < gridBottom) {
            // We're within the grid boundaries - cancel any existing
            // scrolling
            if (Tweener.isTweening(adjustment)) {
                Tweener.removeTweens(adjustment);
            }

            return false;
        }

        if (dragEvent.y <= gridY &&
            adjustment.value > 0) {
            let seconds = adjustment.value / DRAG_SCROLL_PIXELS_PER_SEC;
            Tweener.addTween(adjustment, { value: 0,
                                           time: seconds,
                                           transition: 'linear' });

            return true;
        }

        let maxAdjust = adjustment.upper - adjustment.page_size;
        if (dragEvent.y >= gridBottom &&
            adjustment.value < maxAdjust) {
            let seconds = (maxAdjust - adjustment.value) /
                DRAG_SCROLL_PIXELS_PER_SEC;
            Tweener.addTween(adjustment, { value: maxAdjust,
                                           time: seconds,
                                           transition: 'linear' });

            return true;
        }

        return false;
    },

    _positionReallyMoved: function() {
        if (this._insertIdx == -1) {
            return false;
        }

        // If we're immediately right of the original position,
        // we didn't really move
        if ((this._insertIdx == this._originalIdx ||
             this._insertIdx == this._originalIdx + 1) &&
            this._dragView == this._dragIcon.parentView) {
            return false;
        }

        return true;
    },

    _shouldNudgeItems: function(isNewPosition) {
        return (isNewPosition && this._positionReallyMoved());
    },

    _getDragHoverResult: function() {
        // If we are hovering over our own icon placeholder, ignore it
        if (this._onIconIdx == this._originalIdx &&
            this._dragView == this._dragIcon.parentView) {
            return DND.DragMotionResult.NO_DROP;
        }

        let validHoverDrop = false;
        let viewIcon = this._dragView.getIconForIndex(this._onIconIdx);

        if (viewIcon) {
            // We can only move applications into folders or the app store
            validHoverDrop = viewIcon.canDrop && this._dragIcon.canDragOver(viewIcon);
        }

        if (validHoverDrop) {
            return DND.DragMotionResult.MOVE_DROP;
        } else {
            return DND.DragMotionResult.CONTINUE;
        }
    },

    _setDragHoverState: function(state) {
        let viewIcon = this._dragView.getIconForIndex(this._onIconIdx);

        if (viewIcon && this._dragIcon.canDragOver(viewIcon)) {
            viewIcon.setDragHoverState(state);
        }
    },

    acceptDrop: function(source, actor, x, y, time) {
        let position = [x, y];

        // This makes sure that if we dropped an icon outside of the grid,
        // we use the root grid as our target. This can only happen when
        // dragging an icon out of a folder
        if (this._dragView == null) {
            this._dragView = this;
        }

        let droppedOutsideOfFolder = this._currentPopup && (this._dragView != this._dragIcon.parentView);
        let dropIcon = this._dragView.getIconForIndex(this._onIconIdx);
        let droppedOnAppOutsideOfFolder = droppedOutsideOfFolder && dropIcon && !dropIcon.canDrop;

        if (this._onIconIdx != -1 && !droppedOnAppOutsideOfFolder) {
            // Find out what icon the drop is under
            if (!dropIcon || !dropIcon.canDrop) {
                return false;
            }

            if (!source.canDragOver(dropIcon)) {
                return false;
            }

            let accepted  = dropIcon.handleIconDrop(source);
            if (!accepted) {
                return false;
            }

            this._dragView.repositionedIconData = [ this._originalIdx, position ];

            if (this._currentPopup) {
                this._eventBlocker.reactive = false;
                this._currentPopup.popdown();
            }

            return true;
        }

        // If we are not dropped outside of a folder (allowed move) and we're
        // outside of the grid area, or didn't actually change position, ignore
        // the request to move
        if (!this._positionReallyMoved() && !droppedOutsideOfFolder) {
            return false;
        }

        // If we are not over an icon but within the grid, shift the
        // grid around to accomodate it
        let icon = this._dragView.getIconForIndex(this._insertIdx);
        let insertId = icon ? icon.getId() : null;
        let folderId = this._dragView.getViewId();

        this._dragView.repositionedIconData = [ this._originalIdx, position ];
        this._repositionedView = this._dragView;

        // If we dropped the icon outside of the folder, close the popup and
        // add the icon to the main view
        if (droppedOutsideOfFolder) {
            source.blockHandler = true;
            this._eventBlocker.reactive = false;
            this._currentPopup.popdown();

            // Append the inserted icon to the end of the grid
            let appSystem = Shell.AppSystem.get_default();
            let item = appSystem.lookup_app(source.getId());
            let icon = this._dragView._createItemIcon(item);
            this._dragView.addIcon(icon);

            // Set it as the repositioned icon
            let desktopIcons = this._dragView.getAllIcons();
            this._dragView.repositionedIconData = [ desktopIcons.length - 1, position ];
        }

        IconGridLayout.layout.repositionIcon(source.getId(), insertId, folderId);
        return true;
    },

    _ensureAppStoreIcon: function() {
        if (this._appStoreIcon) {
            return;
        }

        this._appStoreIcon = new AppStoreIcon(this);
        this._appStoreItem = {
            get_name: Lang.bind(this, function() {
                return this._appStoreIcon.getName();
            })
        };
    },

    _createItemForId: function(itemId) {
        if (itemId == EOS_APP_STORE_ID) {
            this._ensureAppStoreIcon();
            return this._appStoreItem;
        }

        return this.parent(itemId);
    },

    _createItemIcon: function(item) {
        if (item == this._appStoreItem) {
            return this._appStoreIcon;
        } else if (item instanceof Shell.App) {
            return new AppIcon(item, null, { showMenu: false,
                                             parentView: this });
        } else {
            return new FolderIcon(item, this);
        }
    },

    getLayoutIds: function() {
        let ids = this.parent();
        if (global.settings.get_boolean(ENABLE_APP_STORE_KEY)) {
            ids.push(EOS_APP_STORE_ID);
        }
        return ids;
    },

    getViewId: function() {
        return IconGridLayout.DESKTOP_GRID_ID;
    },

    getViewForId: function(viewId) {
        if (viewId == this.getViewId()) {
            return this;
        }

        let icons = this.getAllIcons();
        for (let idx in icons) {
            let icon = icons[idx];
            if (!icon.view) {
                continue;
            }

            if (icon.view.getViewId() == viewId) {
                return icon.view;
            }
        }

        return null;
    },

    addFolderPopup: function(popup, source) {
        this.stack.add_actor(popup.actor);
        popup.connect('open-state-changed', Lang.bind(this,
            function(popup, isOpen) {
                this._eventBlocker.reactive = isOpen;
                this._currentPopup = isOpen ? popup : null;
                this._popupSource = isOpen ? source: null;

                this._updateIconsForPopup(isOpen, source);

                // Removing the tweening is mandatory to have the correct
                // tweening parameters set on the next tweener
                let wasTweening = Tweener.removeTweens(this._grid.actor, "y");

                if (isOpen) {
                    // Save the current offset before we switch off centered mode
                    let currentY = this._grid.actor.get_allocation_box().y1;

                    if (!wasTweening) {
                        this._centeredAbsOffset = currentY;

                        // In order for the parent offset to be interpreted
                        // properly, we have to temporarily disable the
                        // centering of the grid
                        this._grid.actor.y_align = Clutter.ActorAlign.START;
                        this._grid.actor.y = currentY;
                    }

                    let targetY = this._centeredAbsOffset + popup.parentOffset;
                    let distance = Math.abs(targetY - this._grid.actor.y);

                    if (this._grid.actor.y == targetY) {
                        return;
                    }

                    Tweener.addTween(this._grid.actor, { y: targetY,
                                                         time: distance / FOLDER_POPUP_ANIMATION_PIXELS_PER_SEC,
                                                         transition: FOLDER_POPUP_ANIMATION_TYPE });
                } else {
                    this._closeSpaceForPopup();

                    if (this._grid.actor.y == this._centeredAbsOffset) {
                        this._resetGrid();
                        return;
                    }

                    let distance = Math.abs(this._centeredAbsOffset - this._grid.actor.y);
                    Tweener.addTween(this._grid.actor, { y: this._centeredAbsOffset,
                                                         time: distance / FOLDER_POPUP_ANIMATION_PIXELS_PER_SEC,
                                                         transition: FOLDER_POPUP_ANIMATION_TYPE,
                                                         onComplete: Lang.bind(this, this._resetGrid)
                                                        });
                }
            }));
    },

    _resetGrid: function() {
        this._grid.actor.y_align = Clutter.ActorAlign.CENTER;
        this._grid.actor.y = 0;
    },

    isAnimatingGrid: function() {
        return Tweener.isTweening(this._grid.actor);
    },

    _onAdjustmentChanged: function() {
        if (!this._grid.saturation.enabled) {
            return;
        }

        let value = this.actor.vscroll.adjustment.value;
        let iconRect = Util.getRectForActor(this._popupSource.actor);
        iconRect.origin.y -= value;

        this._grid.saturation.unshaded_rect = iconRect;
    },

    _updateIconsForPopup: function(folderOpen, sourceIcon) {
        let transition = folderOpen ?
            INACTIVE_GRID_TRANSITION : ACTIVE_GRID_TRANSITION;

        this._updateIconSaturations(folderOpen, sourceIcon, transition);
        this._updateIconOpacities(folderOpen, sourceIcon, transition);
    },

    _updateIconSaturations: function(folderOpen, sourceIcon, transition) {
        let iconRect = Util.getRectForActor(sourceIcon.actor);
        let saturation = folderOpen ?
            INACTIVE_GRID_SATURATION : ACTIVE_GRID_SATURATION;

        if (folderOpen) {
            this._grid.saturation.enabled = true;
            this._grid.saturation.unshaded_rect = iconRect;
        }

        Tweener.addTween(this._grid.saturation, { factor: saturation,
                                                  time: BoxPointer.POPUP_ANIMATION_TIME,
                                                  transition: transition,
                                                  onComplete: Lang.bind(this, function() {
                                                      if (!folderOpen) {
                                                          this._grid.saturation.enabled = false;
                                                      }
                                                  })
                                                });
    },

    _updateIconOpacities: function(folderOpen, sourceIcon, transition) {
        let opacity = folderOpen ?
            INACTIVE_GRID_OPACITY : ACTIVE_GRID_OPACITY;

        // FIXME: maybe integrate the opacity setting into the
        // saturation shader?
        let icons = this.getAllIcons();
        for (let idx in icons) {
            let icon = icons[idx];
            if (icon == sourceIcon) {
                continue;
            }

            Tweener.addTween(icon.actor, { opacity: opacity,
                                           time: BoxPointer.POPUP_ANIMATION_TIME,
                                           transition: transition });
        }
    },

    getEntryAnchor: function() {
        return this._grid.getHeightForRows(ROWS_FOR_ENTRY);
    },

    getHeightForEntry: function(forWidth) {
        let gridHeight = this._grid.actor.get_preferred_height(forWidth);
        gridHeight[1] = Math.max(gridHeight[1], this.getEntryAnchor());

        return gridHeight;
    },

    // Called before allocation to calculate dynamic spacing
    adaptToSize: function(width, height) {
        let box = new Clutter.ActorBox();
        box.x1 = 0;
        box.x2 = width;
        box.y1 = 0;
        box.y2 = height;
        box = this.actor.get_theme_node().get_content_box(box);
        box = this._scrollView.get_theme_node().get_content_box(box);
        box = this._grid.actor.get_theme_node().get_content_box(box);
        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;
        let oldNPages = this._grid.nPages();

        this._grid.adaptToSize(availWidth, availHeight);

        let fadeOffset = Math.min(this._grid.topPadding,
                                  this._grid.bottomPadding);
        this._scrollView.update_fade_effect(fadeOffset, 0);
        this._scrollView.get_effect('fade').fade_edges = true;

        if (this._availWidth != availWidth || this._availHeight != availHeight || oldNPages != this._grid.nPages()) {
            this._adjustment.value = 0;
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
                function() {
                    this._pageIndicators.setNPages(this._grid.nPages());
                    this._pageIndicators.setCurrentPage(0);
                }));
        }

        this._availWidth = availWidth;
        this._availHeight = availHeight;
        // Update folder views
        for (let i = 0; i < this._folderIcons.length; i++)
            this._folderIcons[i].adaptToSize(availWidth, availHeight);
    }
});
Signals.addSignalMethods(AllView.prototype);

const ControlsBoxLayout = Lang.Class({
    Name: 'ControlsBoxLayout',
    Extends: Clutter.BoxLayout,

    /**
     * Override the BoxLayout behavior to use the maximum preferred width of all
     * buttons for each child
     */
    vfunc_get_preferred_width: function(container, forHeight) {
        let maxMinWidth = 0;
        let maxNaturalWidth = 0;
        for (let child = container.get_first_child();
             child;
             child = child.get_next_sibling()) {
             let [minWidth, natWidth] = child.get_preferred_width(forHeight);
             maxMinWidth = Math.max(maxMinWidth, minWidth);
             maxNaturalWidth = Math.max(maxNaturalWidth, natWidth);
        }
        let childrenCount = container.get_n_children();
        let totalSpacing = this.spacing * (childrenCount - 1);
        return [maxMinWidth * childrenCount + totalSpacing,
                maxNaturalWidth * childrenCount + totalSpacing];
    }
});

const ViewStackLayout = new Lang.Class({
    Name: 'ViewStackLayout',
    Extends: Clutter.BinLayout,

    vfunc_allocate: function (actor, box, flags) {
        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;
        // Prepare children of all views for the upcoming allocation, calculate all
        // the needed values to adapt available size
        this.emit('allocated-size-changed', availWidth, availHeight);
        this.parent(actor, box, flags);
    }
});
Signals.addSignalMethods(ViewStackLayout.prototype);

const AppSearchProvider = new Lang.Class({
    Name: 'AppSearchProvider',

    _init: function() {
        this._appSys = Shell.AppSystem.get_default();
        this.id = 'applications';
    },

    _filterLayoutIds: function(results) {
        return results.filter(function(app) {
            let appId = app.get_id();
            return IconGridLayout.layout.hasIcon(appId);
        });
    },

    getResultMetas: function(apps, callback) {
        let metas = [];
        for (let i = 0; i < apps.length; i++) {
            let app = this._appSys.lookup_app(apps[i]);
            metas.push({ 'id': app,
                         'name': app.get_name(),
                         'createIcon': function(size) {
                             return app.create_icon_texture(size);
                         }
                       });
        }
        callback(metas);
    },

    filterResults: function(results, maxNumber) {
        return results.slice(0, maxNumber);
    },

    getInitialResultSet: function(terms) {
        let query = terms.join(' ');
        let groups = Gio.DesktopAppInfo.search(query);
        let usage = Shell.AppUsage.get_default();
        let results = [];
        groups.forEach(function(group) {
            group = group.filter(function(appID) {
                let app = Gio.DesktopAppInfo.new(appID);
                return app && app.should_show() && IconGridLayout.layout.hasIcon(appID);
            });
            results = results.concat(group.sort(function(a, b) {
                return usage.compare('', a, b);
            }));
        });
        this.searchSystem.setResults(this, results);
    },

    getSubsearchResultSet: function(previousResults, terms) {
        this.getInitialResultSet(terms);
    },

    activateResult: function(app) {
        let event = Clutter.get_current_event();
        let modifiers = event ? event.get_state() : 0;
        let openNewWindow = modifiers & Clutter.ModifierType.CONTROL_MASK;

        if (openNewWindow) {
            app.open_new_window(-1);
        } else {
            let activationContext = new AppActivation.AppActivationContext(app);
            activationContext.activate();
        }

        Main.overview.hide();
    },

    dragActivateResult: function(id, params) {
        params = Params.parse(params, { workspace: -1,
                                        timestamp: 0 });

        let app = this._appSys.lookup_app(id);
        app.open_new_window(workspace);
    },

    createResultObject: function (resultMeta, terms) {
        let app = resultMeta['id'];
        return new AppIcon(app);
    }
});

const FolderView = new Lang.Class({
    Name: 'FolderView',
    Extends: BaseAppView,

    _init: function() {
        this.parent(null, null);
        // If it not expand, the parent doesn't take into account its preferred_width when allocating
        // the second time it allocates, so we apply the "Standard hack for ClutterBinLayout"
        this._grid.actor.x_expand = true;

        this.actor = new St.ScrollView({ overlay_scrollbars: true });
        this.actor.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        let scrollableContainer = new St.BoxLayout({ vertical: true, reactive: true });
        scrollableContainer.add_actor(this._grid.actor);
        this.actor.add_actor(scrollableContainer);

        let action = new Clutter.PanAction({ interpolate: true });
        action.connect('pan', Lang.bind(this, this._onPan));
        this.actor.add_action(action);

        this._folderIcon = folderIcon;
        this.addIcons();
    },

    _createItemIcon: function(item) {
        return new AppIcon(item, null, { showMenu: false,
                                         parentView: this });
    },

    getViewId: function() {
        return this._folderIcon.getId();
    },

    _onPan: function(action) {
        let [dist, dx, dy] = action.get_motion_delta(0);
        let adjustment = this.actor.vscroll.adjustment;
        adjustment.value -= (dy / this.actor.height) * adjustment.page_size;
        return false;
    },

    adaptToSize: function(width, height) {
        this._parentAvailableWidth = width;
        this._parentAvailableHeight = height;

        this._grid.adaptToSize(width, height);

        // To avoid the fade effect being applied to the unscrolled grid,
        // the offset would need to be applied after adjusting the padding;
        // however the final padding is expected to be too small for the
        // effect to look good, so use the unadjusted padding
        let fadeOffset = Math.min(this._grid.topPadding,
                                  this._grid.bottomPadding);
        this.actor.update_fade_effect(fadeOffset, 0);

        // Set extra padding to avoid popup or close button being cut off
        this._grid.topPadding = Math.max(this._grid.topPadding - this._offsetForEachSide, 0);
        this._grid.bottomPadding = Math.max(this._grid.bottomPadding - this._offsetForEachSide, 0);
        this._grid.leftPadding = Math.max(this._grid.leftPadding - this._offsetForEachSide, 0);
        this._grid.rightPadding = Math.max(this._grid.rightPadding - this._offsetForEachSide, 0);

        this.actor.set_width(this.usedWidth());
        this.actor.set_height(this.usedHeight());
    },

    _getPageAvailableSize: function() {
        let pageBox = new Clutter.ActorBox();
        pageBox.x1 = pageBox.y1 = 0;
        pageBox.x2 = this._parentAvailableWidth;
        pageBox.y2 = this._parentAvailableHeight;

        let contentBox = this.actor.get_theme_node().get_content_box(pageBox);
        // We only can show icons inside the collection view boxPointer
        // so we have to substract the required padding etc of the boxpointer
        return [(contentBox.x2 - contentBox.x1) - 2 * this._offsetForEachSide, (contentBox.y2 - contentBox.y1) - 2 * this._offsetForEachSide];
    },

    usedWidth: function() {
        let [availWidthPerPage, availHeightPerPage] = this._getPageAvailableSize();
        return this._grid.usedWidth(availWidthPerPage);
    },

    usedHeight: function() {
        return this._grid.usedHeightForNRows(this.nRowsDisplayedAtOnce());
    },

    nRowsDisplayedAtOnce: function() {
        let [availWidthPerPage, availHeightPerPage] = this._getPageAvailableSize();
        let maxRows = this._grid.rowsForHeight(availHeightPerPage) - 1;
        return Math.min(this._grid.nRows(availWidthPerPage), maxRows);
    },

    setPaddingOffsets: function(offset) {
        this._offsetForEachSide = offset;
    }
});

const ViewIconState = {
    NORMAL: 0,
    DND_PLACEHOLDER: 1,
    NUM_STATES: 2
};

const ViewIcon = new Lang.Class({
    Name: 'ViewIcon',

    _init: function(parentView, buttonParams, iconParams) {
        this.parentView = parentView;

        this.canDrop = false;
        this.customName = false;
        this.blockHandler = false;

        this._iconState = ViewIconState.NORMAL;

        this.actor = new St.Bin({ style_class: 'app-well-app' });
        this.actor.x_fill = true;
        this.actor.y_fill = true;
        this.actor.can_focus = true;

        this.actor._delegate = this;

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._origText = null;
        this._createIconFunc = iconParams['createIcon'];
        iconParams['createIcon'] = Lang.bind(this, this._createIconBase);

        this.icon = new IconGrid.BaseIcon(this.getName(), iconParams, buttonParams);
        if (iconParams['showLabel'] !== false &&
            iconParams['editableLabel']) {
            this.icon.label.connect('label-edit-update', Lang.bind(this, this._onLabelUpdate));
            this.icon.label.connect('label-edit-cancel', Lang.bind(this, this._onLabelCancel));
        }
        this.actor.set_child(this.icon.actor);

        this.actor.label_actor = this.icon.label;

        this.iconButton = this.icon.iconButton;
        this.iconButton._delegate = this;
    },

    _onDestroy: function() {
        this.iconButton._delegate = null;
        this.actor._delegate = null;
    },

    _createIconBase: function(iconSize) {
        if (this._iconState == ViewIconState.DND_PLACEHOLDER) {
            // Replace the original icon with an empty placeholder
            return new St.Icon({ icon_size: iconSize });
        }

        return this._createIconFunc(iconSize);
    },

    _onLabelCancel: function() {
        this.actor.sync_hover();
    },

    replaceText: function(newText) {
        if (this.icon.label) {
            this._origText = this.icon.label.text;
            this.icon.label.text = newText;
        }
    },

    restoreText: function() {
        if (this._origText) {
            this.icon.label.text = this._origText;
            this._origText = null;
        }
    },

    handleViewDragBegin: function() {
        this.iconState = ViewIconState.DND_PLACEHOLDER;
        this.actor.add_style_class_name('dnd-begin');
        this.replaceText(null);
    },

    handleViewDragEnd: function() {
        if (!this.blockHandler) {
            this.iconState = ViewIconState.NORMAL;
            this.actor.remove_style_class_name('dnd-begin');
            this.restoreText();
        }
    },

    setDragHoverState: function(state) {
        this.actor.set_hover(state);
    },

    handleIconDrop: function(source) {
        logError('handleIconDrop not implemented');
    },

    canDragOver: function(dest) {
        return false;
    },

    getDragActor: function() {
        let iconParams = { createIcon: Lang.bind(this, this._createIcon),
                           showLabel: (this.icon.label != null) };
        let icon = new IconGrid.BaseIcon(this.getName(), iconParams);
        icon.actor.add_style_class_name('dnd');
        return icon.actor;
    },

    // Returns the original actor that should align with the actor
    // we show as the item is being dragged.
    getDragActorSource: function() {
        return this.icon.actor;
    },

    set iconState(iconState) {
        if (this._iconState == iconState) {
            return;
        }

        this._iconState = iconState;
        this.icon.reloadIcon();
    },

    get iconState() {
        return this._iconState;
    }
});

const FolderIcon = new Lang.Class({
    Name: 'FolderIcon',
    Extends: ViewIcon,

    _init: function(dirInfo, parentView) {
        let buttonParams = { button_mask: St.ButtonMask.ONE,
                             toggle_mode: true };
        let iconParams = { createIcon: Lang.bind(this, this._createIcon),
                           editableLabel: true };

        this.folder = dirInfo;
        this._name = this.folder.get_name();
        this.parent(parentView, buttonParams, iconParams);

        this.actor.add_style_class_name('app-folder');

        this.canDrop = true;

        // whether we need to update arrow side, position etc.
        this._popupInvalidated = false;

        this.view = new FolderView(this);

        this.iconButton.connect('clicked', Lang.bind(this,
            function() {
                this._ensurePopup();
                this.view.actor.vscroll.adjustment.value = 0;
                this._openSpaceForPopup();
            }));

        this.actor.connect('notify::mapped', Lang.bind(this,
            function() {
                if (!this.actor.mapped && this._popup)
                    this._popup.popdown();
            }));

        // DND implementation
        this._draggable = DND.makeDraggable(this.iconButton);
        this._draggable.connect('drag-begin', Lang.bind(this,
            function () {
                Main.overview.beginItemDrag(this);
            }));
        this._draggable.connect('drag-cancelled', Lang.bind(this,
            function () {
                Main.overview.cancelledItemDrag(this);
            }));
        this._draggable.connect('drag-end', Lang.bind(this,
            function () {
                Main.overview.endItemDrag(this);
            }));
    },

    _onDestroy: function() {
        this.parent();
        this.view.actor.destroy();
    },

    _onLabelUpdate: function(label, newText) {
        try {
            this.folder.create_custom_with_name(newText);
            this._name = newText;
            this.customName = true;
        } catch(e) {
            logError(e, 'error while creating a custom dirInfo for: '
                      + this.getName()
                      + ' using new name: '
                      + newText);
        }
    },

    _createIcon: function(iconSize) {
        let icon = this.folder.get_icon();
        return new St.Icon({ icon_size: iconSize,
                             gicon: icon });
    },

    _popupHeight: function() {
        let usedHeight = this.view.usedHeight() + this._popup.getOffset(St.Side.TOP) + this._popup.getOffset(St.Side.BOTTOM);
        return usedHeight;
    },

    _openSpaceForPopup: function() {
        let id = this._parentView.connect('space-ready', Lang.bind(this,
            function() {
                this._parentView.disconnect(id);
                this._popup.popup();
                this._updatePopupPosition();
            }));
        this._parentView.openSpaceForPopup(this, this._boxPointerArrowside, this.view.nRowsDisplayedAtOnce());
    },

    _calculateBoxPointerArrowSide: function() {
        let spaceTop = this.actor.y - this._parentView.getCurrentPageY();
        let spaceBottom = this._parentView.actor.height - (spaceTop + this.actor.height);

        return spaceTop > spaceBottom ? St.Side.BOTTOM : St.Side.TOP;
    },

    _updatePopupSize: function() {
        // StWidget delays style calculation until needed, make sure we use the correct values
        this.view._grid.actor.ensure_style();

        let offsetForEachSide = Math.ceil((this._popup.getOffset(St.Side.TOP) +
                                           this._popup.getOffset(St.Side.BOTTOM) -
                                           this._popup.getCloseButtonOverlap()) / 2);
        // Add extra padding to prevent boxpointer decorations and close button being cut off
        this.view.setPaddingOffsets(offsetForEachSide);
        this.view.adaptToSize(this._parentAvailableWidth, this._parentAvailableHeight);
    },

    _updatePopupPosition: function() {
        if (!this._popup)
            return;

        if (this._boxPointerArrowside == St.Side.BOTTOM)
            this._popup.actor.y = this.actor.allocation.y1 + this.actor.translation_y - this._popupHeight();
        else
            this._popup.actor.y = this.actor.allocation.y1 + this.actor.translation_y + this.actor.height;
    },

    _ensurePopup: function() {
        if (this._popup && !this._popupInvalidated)
            return;
        this._boxPointerArrowside = this._calculateBoxPointerArrowSide();
        if (!this._popup) {
            this._popup = new AppFolderPopup(this, this._boxPointerArrowside);
            this._parentView.addFolderPopup(this._popup);
            this._popup.connect('open-state-changed', Lang.bind(this,
                function(popup, isOpen) {
                    if (!isOpen)
                        this.actor.checked = false;
                }));
        } else {
            this._popup.updateArrowSide(this._boxPointerArrowside);
        }
        this._updatePopupSize();
        this._updatePopupPosition();
        this._popupInvalidated = false;
    },

    adaptToSize: function(width, height) {
        this._parentAvailableWidth = width;
        this._parentAvailableHeight = height;
        if(this._popup)
            this.view.adaptToSize(width, height);
        this._popupInvalidated = true;
    },

    getId: function() {
        return this.folder.get_id();
    },

    getName: function() {
        return this._name;
    },

    handleIconDrop: function(source) {
        // Move the source icon into this folder
        IconGridLayout.layout.appendIcon(source.getId(), this.getId());
        return true;
    },

    canDragOver: function(dest) {
        // Can't drag folders over other folders
        if (dest.folder) {
            return false;
        }

        return true;
    },

    getDragActor: function() {
        let actor = this.parent();
        actor.add_style_class_name('app-folder');
        return actor;
    }
});

const AppFolderPopup = new Lang.Class({
    Name: 'AppFolderPopup',

    _init: function(source, side) {
        this._source = source;
        this._view = source.view;
        this._arrowSide = side;

        this._isOpen = false;
        this.parentOffset = 0;

        this.actor = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                     style_class: 'app-folder-popup-stack',
                                     visible: true,
                                     // We don't want to expand really, but look
                                     // at the layout manager of our parent...
                                     //
                                     // DOUBLE HACK: if you set one, you automatically
                                     // get the effect for the other direction too, so
                                     // we need to set the y_align
                                     x_expand: true,
                                     y_expand: true,
                                     x_align: Clutter.ActorAlign.CENTER,
                                     y_align: Clutter.ActorAlign.START });
        this._boxPointer = new BoxPointer.BoxPointer(this._arrowSide,
                                                     { style_class: 'app-folder-popup-bin',
                                                       x_fill: true,
                                                       y_fill: true,
                                                       x_expand: true,
                                                       x_align: St.Align.START });

        this._boxPointer.actor.style_class = 'app-folder-popup';
        this.actor.add_actor(this._boxPointer.actor);
        this._boxPointer.bin.set_child(this._view.actor);

        this.closeButton = CloseButton.makeCloseButton();
        this.closeButton.connect('clicked', Lang.bind(this, this.popdown));
        this.actor.add_actor(this.closeButton);

        this._boxPointer.actor.bind_property('opacity', this.closeButton, 'opacity',
                                             GObject.BindingFlags.SYNC_CREATE);

        global.focus_manager.add_group(this.actor);

        this.actor.connect('key-press-event', Lang.bind(this, this._onKeyPress));
    },

    _onKeyPress: function(actor, event) {
        if (!this._isOpen)
            return false;

        if (event.get_key_symbol() != Clutter.KEY_Escape)
            return false;

        this.popdown();
        return true;
    },

    toggle: function() {
        if (this._isOpen)
            this.popdown();
        else
            this.popup();
    },

    popup: function() {
        if (this._isOpen)
            return;

        this.actor.show();

        this._boxPointer.setArrowActor(this._source.actor);
        this._boxPointer.show(BoxPointer.PopupAnimation.FADE |
                              BoxPointer.PopupAnimation.SLIDE);

        this.actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);

        this._isOpen = true;
        this.emit('open-state-changed', true);
    },

    popdown: function() {
        if (!this._isOpen)
            return;

        this._boxPointer.hide(BoxPointer.PopupAnimation.FADE |
                              BoxPointer.PopupAnimation.SLIDE,
                              Lang.bind(this, function () {
                                  this.actor.hide();
                              }));
        this._isOpen = false;
        this.emit('open-state-changed', false);
    },

    getCloseButtonOverlap: function() {
        return this.closeButton.get_theme_node().get_length('-shell-close-overlap-y');
    },

    getOffset: function (side) {
        let offset = this._boxPointer.getPadding(side);
        if (this._arrowSide == side)
            offset += this._boxPointer.getArrowHeight();
        return offset;
    },

    updateArrowSide: function (side) {
        this._arrowSide = side;
        this._boxPointer.updateArrowSide(side);
    }
});
Signals.addSignalMethods(AppFolderPopup.prototype);

const AppIcon = new Lang.Class({
    Name: 'AppIcon',
    Extends: ViewIcon,

    _init : function(app, iconParams, params) {
        params = Params.parse(params, { showMenu: true,
                                        isDraggable: true,
                                        parentView: null });

        this.app = app;
        this._name = this.app.get_name();

        this._isDeletable = true;
        let appInfo = app.get_app_info();
        if (appInfo &&
            appInfo.has_key(SHOW_IN_APP_STORE_DESKTOP_KEY) &&
            !appInfo.get_boolean(SHOW_IN_APP_STORE_DESKTOP_KEY)) {
            this._isDeletable = false;
        }

        this._showMenu = params.showMenu;

        iconParams = Params.parse(iconParams, { createIcon: Lang.bind(this, this._createIcon),
                                                editableLabel: true,
                                                shadowAbove: true },
                                  true);

        let buttonParams = { button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO };

        this.parent(params.parentView, buttonParams, iconParams);

        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        this.iconButton.connect('clicked', Lang.bind(this, this._onClicked));
        this.actor.connect('popup-menu', Lang.bind(this, this._onKeyboardPopupMenu));

        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);

        if (params.isDraggable) {
            this._draggable = DND.makeDraggable(this.iconButton);
            this._draggable.connect('drag-begin', Lang.bind(this,
                function () {
                    // Notify view that something is dragging
                    this._removeMenuTimeout();
                    Main.overview.beginItemDrag(this);
                }));
            this._draggable.connect('drag-cancelled', Lang.bind(this,
                function () {
                    Main.overview.cancelledItemDrag(this);
                }));
            this._draggable.connect('drag-end', Lang.bind(this,
                function () {
                    // Are we in the trashcan area?
                    Main.overview.endItemDrag(this);
                }));
        }

        this._menuTimeoutId = 0;
        this._stateChangedId = this.app.connect('notify::state',
                                                Lang.bind(this,
                                                          this._onStateChanged));
        this._onStateChanged();
    },

    _onDestroy: function() {
        this.parent();

        if (this._stateChangedId > 0) {
            this.app.disconnect(this._stateChangedId);
        }
        this._stateChangedId = 0;
        this._removeMenuTimeout();
    },

    _createIcon: function(iconSize) {
        return this.app.create_icon_texture(iconSize);
    },

    _removeMenuTimeout: function() {
        if (this._menuTimeoutId > 0) {
            Mainloop.source_remove(this._menuTimeoutId);
            this._menuTimeoutId = 0;
        }
    },

    _onStateChanged: function() {
        if (this.app.state != Shell.AppState.STOPPED) {
            this.actor.add_style_class_name('running');
        } else {
            this.actor.remove_style_class_name('running');
        }
    },

    _onLabelUpdate: function(label, newText) {
        try {
            this.app.create_custom_launcher_with_name(newText);
            this._name = newText;
            this.customName = true;
        } catch(e) {
            logError(e, 'error while creating a custom launcher for: '
                      + this.getName()
                      + ' using new name: '
                      + newText);
        }
    },

    _onButtonPress: function(actor, event) {
        let button = event.get_button();
        if (button == ButtonConstants.LEFT_MOUSE_BUTTON) {
            this._removeMenuTimeout();
            this._menuTimeoutId = Mainloop.timeout_add(MENU_POPUP_TIMEOUT,
                Lang.bind(this, function() {
                    this._menuTimeoutId = 0;
                    this.popupMenu();
                    return false;
                }));
        } else if (button == ButtonConstants.RIGHT_MOUSE_BUTTON) {
            this.popupMenu();
            return true;
        }
        return false;
    },

    _onClicked: function(actor, button) {
        this._removeMenuTimeout();

        if (button == ButtonConstants.LEFT_MOUSE_BUTTON) {
            this._onActivate(Clutter.get_current_event());
        } else if (button == ButtonConstants.MIDDLE_MOUSE_BUTTON) {
            // Last workspace is always empty
            let launchWorkspace = global.screen.get_workspace_by_index(global.screen.n_workspaces - 1);
            launchWorkspace.activate(global.get_current_time());
            this.emit('launching');
            this.app.open_new_window(-1);
            Main.overview.hide();
        }
    },

    _onKeyboardPopupMenu: function() {
        if (!this._showMenu) {
            return;
        }

        this.popupMenu();
        this._menu.actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    },

    getId: function() {
        return this.app.get_id();
    },

    getName: function() {
        return this._name;
    },

    popupMenu: function() {
        this._removeMenuTimeout();

        if (!this._showMenu) {
            return false;
        }

        this.iconButton.fake_release();

        if (this._draggable) {
            this._draggable.fakeRelease();
        }

        if (!this._menu) {
            this._menu = new AppIconMenu(this);
            this._menu.connect('activate-window', Lang.bind(this, function (menu, window) {
                this.activateWindow(window);
            }));
            this._menu.connect('open-state-changed', Lang.bind(this, function (menu, isPoppedUp) {
                if (!isPoppedUp) {
                    this._onMenuPoppedDown();
                }
            }));
            Main.overview.connect('hiding', Lang.bind(this, function () { this._menu.close(); }));

            this._menuManager.addMenu(this._menu);
        }

        this.emit('menu-state-changed', true);

        this.actor.set_hover(true);
        this._menu.popup();
        this._menuManager.ignoreRelease();
        this.emit('sync-tooltip');

        return false;
    },

    activateWindow: function(metaWindow) {
        if (metaWindow) {
            Main.activateWindow(metaWindow);
        } else {
            Main.overview.hide();
        }
    },

    _onMenuPoppedDown: function() {
        this.actor.sync_hover();
        this.emit('menu-state-changed', false);
    },

    _onActivate: function (event) {
        this.emit('launching');

        if (this.app.state == Shell.AppState.RUNNING) {
            let modifiers = event.get_state();
            if (modifiers & Clutter.ModifierType.CONTROL_MASK) {
                this.app.open_new_window(-1);
            } else {
                this.app.activate();
            }
        } else {
            let activationContext = new AppActivation.AppActivationContext(this.app);
            activationContext.activate();
        }

        Main.overview.hide();
    },

    shellWorkspaceLaunch : function(params) {
        params = Params.parse(params, { workspace: -1,
                                        timestamp: 0 });

        this.app.open_new_window(params.workspace);
    },

    canDragOver: function(dest) {
        let canDragOver = true;

        if (!this._isDeletable && dest instanceof AppStoreIcon) {
            canDragOver = false;
        }
        return canDragOver;
    },

    shouldShowTooltip: function() {
        return this.actor.hover && (!this._menu || !this._menu.isOpen);
    },
});
Signals.addSignalMethods(AppIcon.prototype);

const AppStoreIconState = {
    EMPTY_TRASH: ViewIconState.NUM_STATES,
    FULL_TRASH: ViewIconState.NUM_STATES + 1
};

const AppStoreIcon = new Lang.Class({
    Name: 'AppStoreIcon',
    Extends: ViewIcon,

    _init : function(parentView) {
        let buttonParams = { button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO };
        let iconParams = { createIcon: Lang.bind(this, this._createIcon),
                           editableLabel: false,
                           shadowAbove: false };

        this.parent(parentView, buttonParams, iconParams);

        this.actor.add_style_class_name('app-folder');

        this.canDrop = true;

        this._removeUndone = false;
        this._removedItemPos = -1;
        this._removedItemFolder = null;

        this.iconButton.connect('clicked', Lang.bind(this, this._onClicked));
    },

    _stIconFromState: function(state, iconSize) {
        let iconName = null;
        if (state == AppStoreIconState.EMPTY_TRASH) {
            iconName = 'trash-icon-empty.png';
        } else if (state == AppStoreIconState.FULL_TRASH) {
            iconName = 'trash-icon-full.png';
        } else {
            iconName = 'app-store-symbolic.svg';
        }

        let gfile = Gio.File.new_for_path(global.datadir + '/theme/' + iconName);
        return new St.Icon({ icon_size: iconSize,
                             gicon: new Gio.FileIcon({ file: gfile }) });
    },

    _createIcon: function(iconSize) {
        return this._stIconFromState(this.iconState, iconSize);
    },

    _onClicked: function(actor, button) {
        Main.appStore.show(global.get_current_time(), true);
    },

    getName: function() {
        return _("Add");
    },

    getId: function() {
        return EOS_APP_STORE_ID;
    },

    handleViewDragBegin: function() {
        this.iconState = AppStoreIconState.EMPTY_TRASH;
        this.replaceText(_("Delete"));
    },

    handleViewDragEnd: function() {
        this.iconState = ViewIconState.NORMAL;
        this.restoreText();
    },

    setDragHoverState: function(state) {
        this.parent(state);

        let appStoreIconState = state ?
            AppStoreIconState.FULL_TRASH : AppStoreIconState.EMPTY_TRASH;
        this.iconState = appStoreIconState;
    },

    _removeItem: function(source) {
        source.blockHandler = true;

        // store the location of the removed item in order to undo it
        let folderId = source.parentView.getViewId();
        let idx = source.parentView.indexOf(source);
        this._removedItemFolder = folderId;
        this._removedItemPos = idx;
        this._removeUndone = false;

        IconGridLayout.layout.removeIcon(source.getId());

        source.blockHandler = false;

        if (source.handleViewDragEnd) {
            source.handleViewDragEnd();
        }

        this.handleViewDragEnd();

        Main.overview.setMessage(_("%s has been deleted").format(source.getName()),
                                 { forFeedback: true,
                                   destroyCallback: Lang.bind(this, this._onMessageDestroy, source),
                                   undoCallback: Lang.bind(this, this._undoRemoveItem, source)
                                 });
    },

    _canDelete: function(item) {
        let canDelete = false;
        let filename = item.get_filename();
        let userDir = GLib.get_user_data_dir();
        if (filename && userDir && GLib.str_has_prefix(filename, userDir)) {
            canDelete = true;
        }
        return canDelete;
    },

    _deleteItem: function(source) {
        if (source.app) {
            let eventRecorder = EosMetrics.EventRecorder.prototype.get_default();
            eventRecorder.record_event(EosMetrics.EVENT_SHELL_APP_REMOVED, new GLib.Variant('s', source.getId()));

            let appInfo = source.app.get_app_info();
            if (this._canDelete(appInfo)) {
                appInfo.delete();
            }
        }

        if (source.folder) {
            if (this._canDelete(source.folder)) {
                source.folder.delete();
            }
        }
    },

    _onMessageDestroy: function(source) {
        if (!this._removeUndone) {
            this._deleteItem(source);
        }

        this._removeUndone = false;
        this._removedItemFolder = null;
        this._removedItemPos = -1;
    },

    _undoRemoveItem: function(source) {
        let allView = this.parentView;
        let folderId = this._removedItemFolder;
        let view = allView.getViewForId(folderId);

        if (!view) {
            return;
        }

        this._removeUndone = true;

        let icon = view.getIconForIndex(this._removedItemPos);
        let iconId = (icon != null) ? icon.getId() : null;
        IconGridLayout.layout.repositionIcon(source.getId(), iconId, folderId);
    },

    _acceptFolderDrop: function(source) {
        let folder = source.folder;
        let sourceId = folder.get_id();

        let icons = IconGridLayout.layout.getIcons(sourceId);
        let isEmpty = (icons.length == 0);
        if (!isEmpty) {
            // ensure the applications in the folder actually exist
            // on the system
            let appSystem = Shell.AppSystem.get_default();
            isEmpty = !icons.some(function(icon) {
                return appSystem.lookup_app(icon) != null;
            });
        }

        if (isEmpty) {
            this._removeItem(source);
            return;
        }

        let dialog = new ModalDialog.ModalDialog();

        let subjectLabel = new St.Label({ text: _("Warning"),
                                          style_class: 'delete-folder-dialog-subject',
                                          x_align: Clutter.ActorAlign.CENTER });
        dialog.contentLayout.add(subjectLabel, { y_fill: false,
                                                 y_align: St.Align.START });

        let descriptionLabel = new St.Label({ text: _("To delete a folder you have to remove all of the items inside of it first."),
                                              style_class: 'delete-folder-dialog-description' });
        dialog.contentLayout.add(descriptionLabel, { y_fill: true });
        descriptionLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        descriptionLabel.clutter_text.line_wrap = true;

        let safeLabel = new St.Label({ text: _("We are just trying to keep you safe."),
                                       style_class: 'delete-folder-dialog-safe' });
        dialog.contentLayout.add(safeLabel, { y_fill: true });
        safeLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        safeLabel.clutter_text.line_wrap = true;

        let okButton = { label: _("OK"),
                         action: Lang.bind(this, function() {
                             dialog.close();
                         }),
                         key: Clutter.Escape,
                         default: true };
        dialog.setButtons([okButton]);
        dialog.open();
    },

    handleIconDrop: function(source) {
        if (source.app) {
            this._removeItem(source);
            return true;
        }

        if (source.folder) {
            this._acceptFolderDrop(source);
            return true;
        }

        return false;
    }
});
Signals.addSignalMethods(AppStoreIcon.prototype);

const AppIconMenu = new Lang.Class({
    Name: 'AppIconMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(source) {
        let side = St.Side.LEFT;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            side = St.Side.RIGHT;

        this.parent(source.actor, 0.5, side);

        // We want to keep the item hovered while the menu is up
        this.blockSourceEvents = true;

        this._source = source;

        this.connect('activate', Lang.bind(this, this._onActivate));

        this.actor.add_style_class_name('app-well-menu');

        // Chain our visibility and lifecycle to that of the source
        source.actor.connect('notify::mapped', Lang.bind(this, function () {
            if (!source.actor.mapped)
                this.close();
        }));
        source.actor.connect('destroy', Lang.bind(this, function () { this.actor.destroy(); }));

        Main.uiGroup.add_actor(this.actor);
    },

    _redisplay: function() {
        this.removeAll();

        let windows = this._source.app.get_windows().filter(function(w) {
            return Shell.WindowTracker.is_window_interesting(w);
        });

        // Display the app windows menu items and the separator between windows
        // of the current desktop and other windows.
        let activeWorkspace = global.screen.get_active_workspace();
        let separatorShown = windows.length > 0 && windows[0].get_workspace() != activeWorkspace;

        for (let i = 0; i < windows.length; i++) {
            if (!separatorShown && windows[i].get_workspace() != activeWorkspace) {
                this._appendSeparator();
                separatorShown = true;
            }
            let item = this._appendMenuItem(windows[i].title);
            item._window = windows[i];
        }

        if (!this._source.app.is_window_backed()) {
            if (windows.length > 0)
                this._appendSeparator();

            let isFavorite = AppFavorites.getAppFavorites().isFavorite(this._source.app.get_id());

            this._newWindowMenuItem = this._appendMenuItem(_("New Window"));
            this._appendSeparator();

            this._toggleFavoriteMenuItem = this._appendMenuItem(isFavorite ? _("Remove from Favorites")
                                                                : _("Add to Favorites"));
        }
    },

    _appendSeparator: function () {
        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.addMenuItem(separator);
    },

    _appendMenuItem: function(labelText) {
        // FIXME: app-well-menu-item style
        let item = new PopupMenu.PopupMenuItem(labelText);
        this.addMenuItem(item);
        return item;
    },

    popup: function(activatingButton) {
        this._redisplay();
        this.open();
    },

    _onActivate: function (actor, child) {
        if (child._window) {
            let metaWindow = child._window;
            this.emit('activate-window', metaWindow);
        } else if (child == this._newWindowMenuItem) {
            this._source.app.open_new_window(-1);
            this.emit('activate-window', null);
        } else if (child == this._toggleFavoriteMenuItem) {
            let favs = AppFavorites.getAppFavorites();
            let isFavorite = favs.isFavorite(this._source.app.get_id());
            if (isFavorite)
                favs.removeFavorite(this._source.app.get_id());
            else
                favs.addFavorite(this._source.app.get_id());
        }
        this.close();
    }
});
Signals.addSignalMethods(AppIconMenu.prototype);
