// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
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
const DND = imports.ui.dnd;
const Hash = imports.misc.hash;
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

const ICON_ANIMATION_TIME = 0.6;
const ICON_ANIMATION_DELAY = 0.3;
const ICON_ANIMATION_TRANSLATION = 50;

const DRAG_OVER_FOLDER_OPACITY = 128;
const INACTIVE_GRID_OPACITY = 96;
const ACTIVE_GRID_OPACITY = 255;

const INACTIVE_GRID_TRANSITION = 'easeOutQuad';
const ACTIVE_GRID_TRANSITION = 'easeInQuad';

const INACTIVE_GRID_SATURATION = 1;
const ACTIVE_GRID_SATURATION = 0;

const DRAG_SCROLL_PIXELS_PER_SEC = 800;

const FOLDER_POPUP_ANIMATION_PIXELS_PER_SEC = 600;
const FOLDER_POPUP_ANIMATION_TYPE = 'easeOutQuad';

const NEW_ICON_ANIMATION_TIME = 0.5;
const NEW_ICON_ANIMATION_DELAY = 0.7;

const ENABLE_APP_STORE_KEY = 'enable-app-store';
const EOS_APP_STORE_ID = 'com.endlessm.AppStore';

const EOS_APP_PREFIX = 'eos-app-';
const EOS_LINK_PREFIX = 'eos-link-';

function _sanitizeAppId(appId) {
    if (appId.startsWith(EOS_APP_PREFIX)) {
        return appId.substr(EOS_APP_PREFIX.length);
    }

    return appId;
}

const AppSearchProvider = new Lang.Class({
    Name: 'AppSearchProvider',

    _init: function() {
        this._appSys = Shell.AppSystem.get_default();
        this.id = 'applications';
    },

    getResultMetas: function(apps, callback) {
        let metas = [];
        for (let i = 0; i < apps.length; i++) {
            let app = this._appSys.lookup_heuristic_basename(apps[i]);
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

    getInitialResultSet: function(terms, callback, cancellable) {
        let query = terms.join(' ');
        let groups = Gio.DesktopAppInfo.search(query);
        let usage = Shell.AppUsage.get_default();
        let results = [];
        let seenIds = new Hash.Map();

        groups.forEach(function(group) {
            let groupResults = [];
            group.forEach(function(appID) {
                // GIO will search between both the unprefixed and prefixed
                // desktop file overrides we install. Since we can potentially
                // get results for both, and we don't want to show duplicate
                // results, keep track of the unprefixed desktop files, and discard
                // those we have already seen.
                let actualId = _sanitizeAppId(appID);
                if (seenIds.has(actualId)) {
                    return;
                }

                seenIds.set(actualId, true);

                let app = Gio.DesktopAppInfo.new(actualId);

                // exclude links that are not part of the desktop grid
                if (app && app.should_show() &&
                    !(actualId.startsWith(EOS_LINK_PREFIX) && !IconGridLayout.layout.hasIcon(actualId))) {
                    groupResults.push(actualId);
                }
            });

            results = results.concat(groupResults.sort(function(a, b) {
                return usage.compare('', a, b);
            }));
        });

        // resort to keep results on the desktop grid before the others
        results = results.sort(function(a, b) {
            let hasA = IconGridLayout.layout.hasIcon(a);
            let hasB = IconGridLayout.layout.hasIcon(b);

            if (hasA)
                return -1;
            if (hasB)
                return 1;

            return 0;
        });

        callback(results);
    },

    getSubsearchResultSet: function(previousResults, terms, callback, cancellable) {
        this.getInitialResultSet(terms, callback, cancellable);
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

    createResultObject: function (resultMeta) {
        let app = resultMeta['id'];
        return new AppIcon(app, null, { showMenu: false });
    }
});

const EndlessApplicationView = new Lang.Class({
    Name: 'EndlessApplicationView',
    Abstract: true,

    _init: function() {
        this._grid = new IconGrid.IconGrid({ xAlign: St.Align.MIDDLE,
                                             columnLimit: MAX_COLUMNS });

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
        this._grid.destroyAll();
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
                return IconGridLayout.layout.iconIsFolder(itemId) ||
                    appSystem.lookup_app(itemId) ||
                    (itemId == EOS_APP_STORE_ID);
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

            if (oldItemIdx != newItemIdx) {
                if (newItemIdx < 0) {
                    removedList.push(oldItemIdx);
                } else {
                    movedList[oldItemIdx] = newItemIdx;
                }
            }
        }

        return [movedList, removedList];
    },

    _findAddedIcons: function() {
        let oldItemLayout = this._allIcons.map(function(icon) { return icon.getId(); });
        if (oldItemLayout.length === 0) return [];

        let newItemLayout = this.getLayoutIds();
        newItemLayout = this._trimInvisible(newItemLayout);

        let addedIds = [];
        for (let newItemIdx in newItemLayout) {
            let newItem = newItemLayout[newItemIdx];
            let oldItemIdx = oldItemLayout.indexOf(newItem);

            if (oldItemIdx < 0) {
                addedIds.push(newItem);
            }
        }

        return addedIds;
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

    addIcons: function(isHidden) {
        // Don't do anything if we don't have more up-to-date information, since
        // re-adding icons unnecessarily can cause UX problems
        if (!this.iconsNeedRedraw()) {
            return;
        }

        let addedIds = this._findAddedIcons();

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
                let iconActor = icon.actor;

                if (isHidden) {
                    iconActor.hide();
                }

                if (addedIds.indexOf(itemId) != -1) {
                    icon.scheduleScaleIn();
                }

                this.addIcon(icon);
                iconActor.connect('key-focus-in',
                                   Lang.bind(this, this._ensureIconVisible));
            }
        }
    },

    get gridActor() {
        return this._grid.actor;
    }
});

const FolderView = new Lang.Class({
    Name: 'FolderView',
    Extends: EndlessApplicationView,

    _init: function(folderIcon) {
        this.parent();
        this._folderIcon = folderIcon;
        this.actor = this._grid.actor;

        this.addIcons();
    },

    _createItemIcon: function(item) {
        return new AppIcon(item, null, { parentView: this });
    },

    getViewId: function() {
        return this._folderIcon.getId();
    }
});

const AllViewLayout = new Lang.Class({
    Name: 'AllViewLayout',
    Extends: Clutter.BinLayout,

    vfunc_get_preferred_height: function(container, forWidth) {
        let minBottom = 0;
        let naturalBottom = 0;

        for (let child = container.get_first_child();
             child;
             child = child.get_next_sibling()) {

            if (!child.visible) {
                continue;
            }

            let childY = child.y;
            let [childMin, childNatural] = child.get_preferred_height(forWidth);

            if (childMin + childY > minBottom) {
                minBottom = childMin + childY;
            }

            if (childNatural + childY > naturalBottom) {
                naturalBottom = childNatural + childY;
            }
        }
        return [minBottom, naturalBottom];
    }
});

const AllViewContainer = new Lang.Class({
    Name: 'AllViewContainer',
    Extends: St.ScrollView,

    _init: function(gridActor) {
        gridActor.y_expand = true;
        gridActor.y_align = Clutter.ActorAlign.CENTER;

        this.parent({ x_fill: true,
                      y_fill: false,
                      y_align: Clutter.ActorAlign.START,
                      x_expand: true,
                      y_expand: true,
                      overlay_scrollbars: true,
                      hscrollbar_policy: Gtk.PolicyType.NEVER,
                      vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
                      style_class: 'all-apps vfade' });

        let box = new St.BoxLayout({ vertical: true });
        this.stack = new St.Widget({ layout_manager: new AllViewLayout() });
        this.stack.add_actor(gridActor);
        box.add(this.stack, { y_align: St.Align.START, expand: true });

        this.add_actor(box);
    }
});

const AllView = new Lang.Class({
    Name: 'AllView',
    Extends: EndlessApplicationView,

    _init: function() {
        this.parent();

        this._appStoreIcon = null;

        this.actor = new AllViewContainer(this._grid.actor);
        this.actor._delegate = this;
        this.stack = this.actor.stack;

        this._eventBlocker = new St.Widget({ x_expand: true, y_expand: true });
        this.stack.add_actor(this._eventBlocker);

        let action = new Clutter.PanAction({ interpolate: true });
        action.connect('pan', Lang.bind(this, this._onPan));
        this.actor.add_action(action);

        this.actor.vscroll.adjustment.connect('notify::value',
            Lang.bind(this, this._onAdjustmentChanged));

        Main.overview.connect('item-drag-begin', Lang.bind(this, this._onDragBegin));
        Main.overview.connect('item-drag-end', Lang.bind(this, this._onDragEnd));

        this._clickAction = new Clutter.ClickAction();
        this._clickAction.connect('clicked', Lang.bind(this, this._closePopup));
        Main.overview.addAction(this._clickAction, false);
        this._eventBlocker.bind_property('reactive', this._clickAction, 'enabled', GObject.BindingFlags.SYNC_CREATE);

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
    },

    _redisplay: function() {
        if (this.getAllIcons().length == 0) {
            if (Main.layoutManager.startingUp) {
                this.addIcons(true);

                Main.layoutManager.connect('startup-complete',
                                           Lang.bind(this, this._animateIconsIn));
            } else {
                this.addIcons();
            }
        } else {
            let animateView = this._repositionedView;
            if (!animateView) {
                animateView = this;
            }
            this._repositionedView = null;

            animateView.animateMovement();
        }
    },

    _animateIconsIn: function() {
        let allIcons = this.getAllIcons();
        for (let i in allIcons) {
            let icon = allIcons[i];
            icon.actor.opacity = 0;
            icon.actor.translation_y = ICON_ANIMATION_TRANSLATION;
            icon.actor.show();

            Tweener.addTween(icon.actor, {
                translation_y: 0,
                opacity: 255,
                time: ICON_ANIMATION_TIME,
                delay: ICON_ANIMATION_DELAY
            });
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

    _onPan: function(action) {
        this._clickAction.release();

        let [dist, dx, dy] = action.get_motion_delta(0);
        let adjustment = this.actor.vscroll.adjustment;
        adjustment.value -= (dy / this.actor.height) * adjustment.page_size;
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
            return new AppIcon(item, null, { parentView: this });
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
                    this._ensureIconVisible(popup.actor);

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
    }
});

const ViewIconMenu = new Lang.Class({
    Name: 'ViewIconMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(source) {
        this.parent(source.actor, 0.5, St.Side.TOP);

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
        this._removeItem = this._appendMenuItem(_("Remove from desktop"));
    },

    _appendMenuItem: function(labelText) {
        let item = new PopupMenu.PopupMenuItem(labelText);
        this.addMenuItem(item);
        return item;
    },

    popup: function(activatingButton) {
        this._redisplay();
        this.open();
    },

    _onActivate: function (actor, child) {
        if (child == this._removeItem) {
        }
        this.close();
    }
});

const ViewIconState = {
    NORMAL: 0,
    DND_PLACEHOLDER: 1,
    NUM_STATES: 2
};

const ViewIcon = new Lang.Class({
    Name: 'ViewIcon',

    _init: function(params, buttonParams, iconParams) {
        params = Params.parse(params,
                              { parentView: null,
                                showMenu: true },
                              true);
        this.parentView = params.parentView;
        this.showMenu = params.showMenu;

        this.canDrop = false;
        this.customName = false;
        this.blockHandler = false;

        this._iconState = ViewIconState.NORMAL;
        this._scaleInId = 0;

        this.actor = new St.Bin({ style_class: 'app-well-app' });
        this.actor.x_fill = true;
        this.actor.y_fill = true;
        this.actor.can_focus = true;

        this.actor._delegate = this;
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._menu = null;
        this._menuTimeoutId = 0;
        this._menuManager = new PopupMenu.PopupMenuManager(this);

        this._origText = null;
        this._createIconFunc = iconParams['createIcon'];
        iconParams['createIcon'] = Lang.bind(this, this._createIconBase);

        buttonParams = Params.parse(buttonParams,
                                    { button_mask: St.ButtonMask.ONE |
                                                   St.ButtonMask.TWO |
                                                   St.ButtonMask.THREE },
                                    true);

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
        this.iconButton.connect('clicked', Lang.bind(this, this._onClicked));
        this.iconButton.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        this.iconButton.connect('popup-menu', Lang.bind(this, this._onKeyboardPopupMenu));
    },

    _onDestroy: function() {
        this._unscheduleScaleIn();
        this._removeMenuTimeout();

        this.iconButton._delegate = null;
        this.actor._delegate = null;
    },

    _onClicked: function(actor, button) {
        this._removeMenuTimeout();
    },

    _onButtonPress: function(actor, event) {
        let button = event.get_button();

        if (button == Gdk.BUTTON_PRIMARY) {
            this._removeMenuTimeout();
            this._menuTimeoutId = Mainloop.timeout_add(MENU_POPUP_TIMEOUT,
                Lang.bind(this, function() {
                    this._menuTimeoutId = 0;
                    this._popupMenu();
                    return false;
                }));
        } else if (button == Gdk.BUTTON_SECONDARY) {
            return this._popupMenu();
        }

        return false;
    },

    _onKeyboardPopupMenu: function() {
        if (this._popupMenu()) {
            this._menu.actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
        }
    },

    _popupMenu: function() {
        this._removeMenuTimeout();

        if (!this.showMenu) {
            return false;
        }

        if (!this._menu) {
            this._menu = this._createPopupMenu();
        }

        if (!this._menu) {
            return false;
        }

        this.iconButton.fake_release();

        if (this._draggable) {
            this._draggable.fakeRelease();
        }

        this._menu.connect('open-state-changed', Lang.bind(this, function (menu, isPoppedUp) {
            if (!isPoppedUp) {
                this._onMenuPoppedDown();
            }
        }));
        Main.overview.connect('hiding', Lang.bind(this, function () { this._menu.close(); }));

        this._menuManager.addMenu(this._menu);

        this.actor.set_hover(true);
        this._menu.popup();
        this._menuManager.ignoreRelease();

        return true;
    },

    _removeMenuTimeout: function() {
        if (this._menuTimeoutId > 0) {
            Mainloop.source_remove(this._menuTimeoutId);
            this._menuTimeoutId = 0;
        }
    },

    _onMenuPoppedDown: function() {
        this.actor.sync_hover();
    },

    _createPopupMenu: function() {
        return new ViewIconMenu(this);
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

    _scaleIn: function() {
        this.actor.scale_x = 0;
        this.actor.scale_y = 0;
        this.actor.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });

        Tweener.addTween(this.actor, {
            scale_x: 1,
            scale_y: 1,
            time: NEW_ICON_ANIMATION_TIME,
            delay: NEW_ICON_ANIMATION_DELAY,
            transition: function(t, b, c, d) {
                // Similar to easeOutElastic, but less aggressive.
                t /= d;
                let p = 0.5;
                return b + c * (Math.pow(2, -11 * t) * Math.sin(2 * Math.PI * (t - p / 4) / p) + 1);
            }
        });
    },

    _unscheduleScaleIn: function() {
        if (this._scaleInId != 0) {
            Main.overview.disconnect(this._scaleInId);
            this._scaleInId = 0;
        }
    },

    scheduleScaleIn: function() {
        if (this._scaleInId != 0) {
            return;
        }

        if (Main.overview.visible) {
            this._scaleIn();
            return;
        }

        this._scaleInId = Main.overview.connect('shown', Lang.bind(this, function() {
            this._unscheduleScaleIn();
            this._scaleIn();
        }));
    },

    remove: function() {
        this.blockHandler = true;
        IconGridLayout.layout.removeIcon(this.getId(), true);
        this.blockHandler = false;

        this.handleViewDragEnd();
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
        let params = { parentView: parentView };
        let buttonParams = { toggle_mode: true };
        let iconParams = { createIcon: Lang.bind(this, this._createIcon),
                           editableLabel: true };

        this.folder = dirInfo;
        this._name = this.folder.get_name();
        this.parent(params, buttonParams, iconParams);

        this.actor.add_style_class_name('app-folder');

        this.canDrop = true;

        this.view = new FolderView(this);
        this.view.actor.reactive = false;

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

    _onClicked: function(actor, button) {
        this.parent(actor, button);

        if (button != Gdk.BUTTON_PRIMARY) {
            actor.checked = false;
            return;
        }

        if (this._createPopup()) {
            this._popup.toggle();
        }
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

    _createIcon: function(size) {
        let icon = this.folder.get_icon();
        return new St.Icon({ icon_size: size,
                             gicon: icon });
    },

    _createPopup: function() {
        if (this._popup || this.parentView.isAnimatingGrid()) {
            return false;
        }

        let [sourceX, sourceY] = this.actor.get_transformed_position();
        let [sourceXP, sourceYP] = this.parentView.stack.get_transformed_position();
        let relY = sourceY - sourceYP;
        let spaceTop = relY;
        let spaceBottom = this.parentView.stack.height - (relY + this.actor.height);
        let side = spaceTop > spaceBottom ? St.Side.BOTTOM : St.Side.TOP;

        this._popup = new AppFolderPopup(this, side);
        this.parentView.addFolderPopup(this._popup, this);
        this._reposition(side);

        this._popup.connect('open-state-changed', Lang.bind(this,
            function(popup, isOpen) {
                if (!isOpen) {
                    this.iconButton.checked = false;
                }
            }));
        this._popup.actor.connect('notify::visible', Lang.bind(this,
            function() {
                if (this._popup.actor.visible) {
                    return;
                }

                // save the view for future reuse before destroying
                // the popup
                let viewActor = this.view.actor;
                let viewParent = viewActor.get_parent();
                viewParent.remove_actor(viewActor);

                this._popup.actor.destroy();
                this._popup = null;
            }));
        return true;
    },

    _reposition: function(side) {
        let [iconX, ] = this.actor.get_transformed_position();

        // If folder icon is not enterily above or below the app folder, move
        // the latter so the pointer can point correctly to the icon
        let popupAllocation = Shell.util_get_transformed_allocation(this._popup.actor);
        let actorLeft = iconX;
        let actorRight = iconX + this.actor.width;
        let popupLeft = popupAllocation.x1;
        let popupRight = popupAllocation.x2;
        if (actorLeft < popupLeft) {
            this._popup.actor.set_anchor_point(Math.max(0, popupLeft - actorLeft), 0);
        }
        if (actorRight > popupRight) {
            this._popup.actor.set_anchor_point(-Math.max(0, actorRight - popupRight), 0);
        }

        let closeButtonOffset = -this._popup.closeButton.translation_y;

        // Get the actor coordinates relative to the scrolled content
        let edgePoint = new Clutter.Vertex({ x: 0, y: 0, z: 0 });
        let actorCoords = this.actor.apply_relative_transform_to_point(this.parentView.stack,
                                                                       edgePoint);

        // Position the popup above or below the source icon
        if (side == St.Side.BOTTOM) {
            let y = actorCoords.y - this._popup.actor.height;
            this._popup.actor.y = Math.max(y, closeButtonOffset);
            this._popup.parentOffset = this._popup.actor.y - y;
        } else {
            let y = actorCoords.y + this.actor.height;
            let viewBottom = this.parentView.stack.y + this.parentView.stack.height;
       
            let yBottom = y + this._popup.actor.height;
            this._popup.actor.y = y;

            // Because the folder extends the size of the grid
            // while it is centered, the offset we need is actually
            // half what might be expected
            this._popup.parentOffset = Math.min(viewBottom - yBottom, 0) / 2;
        }
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
    },

    remove: function() {
        let sourceId = this.getId();
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
            // remove if empty
            this.parent();
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
                                                       x_align: St.Align.START });

        this._boxPointer.actor.style_class = 'app-folder-popup';
        this.actor.add_actor(this._boxPointer.actor);
        this._boxPointer.bin.set_child(this._view.actor);

        this.closeButton = CloseButton.makeCloseButton();
        this.closeButton.connect('clicked', Lang.bind(this, this.popdown));
        this.actor.add_actor(this.closeButton);

        this._boxPointer.actor.bind_property('opacity', this.closeButton, 'opacity',
                                             GObject.BindingFlags.SYNC_CREATE);
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
    }
});
Signals.addSignalMethods(AppFolderPopup.prototype);

const AppIcon = new Lang.Class({
    Name: 'AppIcon',
    Extends: ViewIcon,

    _init : function(app, iconParams, params) {
        params = Params.parse(params, { isDraggable: true }, true);

        this._baseApp = app;

        let id = app.get_id();
        let appSystem = Shell.AppSystem.get_default();
        let displayApp = appSystem.lookup_heuristic_basename(id);

        this.app = displayApp;
        this._name = this.app.get_name();

        iconParams = Params.parse(iconParams, { createIcon: Lang.bind(this, this._createIcon),
                                                editableLabel: true,
                                                shadowAbove: true },
                                  true);

        this.parent(params, null, iconParams);

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
    },

    _createIcon: function(iconSize) {
        return this.app.create_icon_texture(iconSize);
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

    _onClicked: function(actor, button) {
        this.parent(actor, button);

        let event = Clutter.get_current_event();
        if (event.get_click_count() > 1) {
            return;
        }

        if (button == Gdk.BUTTON_PRIMARY) {
            this._onActivate(Clutter.get_current_event());
        } else if (button == Gdk.BUTTON_MIDDLE) {
            // Last workspace is always empty
            let launchWorkspace = global.screen.get_workspace_by_index(global.screen.n_workspaces - 1);
            launchWorkspace.activate(global.get_current_time());
            this.emit('launching');
            this.app.open_new_window(-1);
            Main.overview.hide();
        }
    },

    getId: function() {
        return this._baseApp.get_id();
    },

    getName: function() {
        return this._name;
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
        return true;
    }
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
        let params = { parentView: parentView,
                       showMenu: false };
        let iconParams = { createIcon: Lang.bind(this, this._createIcon),
                           editableLabel: false,
                           shadowAbove: false };

        this.parent(params, null, iconParams);

        this.actor.add_style_class_name('app-store-icon');

        this.canDrop = true;
    },

    _setStyleClass: function(state) {
        if (state == AppStoreIconState.EMPTY_TRASH) {
            this.actor.remove_style_class_name('trash-icon-full');
            this.actor.add_style_class_name('trash-icon-empty');
        } else if (state == AppStoreIconState.FULL_TRASH) {
            this.actor.remove_style_class_name('trash-icon-empty');
            this.actor.add_style_class_name('trash-icon-full');
        } else {
            this.actor.remove_style_class_name('trash-icon-empty');
            this.actor.remove_style_class_name('trash-icon-full');
        }
    },

    _createIcon: function(iconSize) {
        // Set the icon image as a background via CSS,
        // and return an empty icon to satisfy the caller
        this._setStyleClass(this.iconState);
        return new St.Icon({ icon_size: iconSize });
    },

    _onClicked: function(actor, button) {
        this.parent(actor, button);

        if (button != Gdk.BUTTON_PRIMARY) {
            return;
        }

        Main.appStore.show(global.get_current_time(), true);
    },

    getName: function() {
        return _("More Apps");
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

    handleIconDrop: function(source) {
        if (source.remove()) {
            this.handleViewDragEnd();
            return true;
        }

        return false;
    }
});
Signals.addSignalMethods(AppStoreIcon.prototype);
