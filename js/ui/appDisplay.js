// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Shell = imports.gi.Shell;
const Lang = imports.lang;
const Pango = imports.gi.Pango;
const Signals = imports.signals;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Atk = imports.gi.Atk;

const AppFavorites = imports.ui.appFavorites;
const Background = imports.ui.background;
const BoxPointer = imports.ui.boxpointer;
const ButtonConstants = imports.ui.buttonConstants;
const DND = imports.ui.dnd;
const GrabHelper = imports.ui.grabHelper;
const IconGrid = imports.ui.iconGrid;
const IconGridLayout = imports.ui.iconGridLayout;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const Overview = imports.ui.overview;
const OverviewControls = imports.ui.overviewControls;
const Panel = imports.ui.panel;
const PopupMenu = imports.ui.popupMenu;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;
const Workspace = imports.ui.workspace;
const Params = imports.misc.params;
const Util = imports.misc.util;

const MAX_APPLICATION_WORK_MILLIS = 75;
const MENU_POPUP_TIMEOUT = 600;
const MAX_COLUMNS = 7;
const ROWS_FOR_ENTRY = 4;

const DRAG_OVER_FOLDER_OPACITY = 128;
const INACTIVE_GRID_OPACITY = 51;
const ACTIVE_GRID_OPACITY = 255;

const INACTIVE_GRID_TRANSITION = 'easeOutQuad';
const ACTIVE_GRID_TRANSITION = 'easeInQuad';

const INACTIVE_GRID_SATURATION = 1;
const ACTIVE_GRID_SATURATION = 0;

const DRAG_SCROLL_PIXELS_PER_SEC = 800;

const SPLASH_CIRCLE_INITIAL_TIMEOUT = 100;
const SPLASH_SCREEN_TIMEOUT = 700;
const SPLASH_SCREEN_FADE_OUT = 0.2;
const SPLASH_SCREEN_COMPLETE_TIME = 250;

// Don't show the flash frame until the final spinner cycle
const SPLASH_CIRCLE_SKIP_END_FRAMES = 1;

const FOLDER_POPUP_ANIMATION_PIXELS_PER_SEC = 600;
const FOLDER_POPUP_ANIMATION_TYPE = 'easeOutQuad';

const SPLASH_SCREEN_DESKTOP_KEY = 'X-Endless-Splash-Screen';

const ENABLE_APP_STORE_KEY = 'enable-app-store';
const EOS_APP_STORE_ID = 'eos-app-store.desktop';
const ALL_VIEW_ID = '';

const DESKTOP_LAUNCH_BACKGROUND_FIELD = 'X-Endless-launch-background';

const EndlessApplicationView = new Lang.Class({
    Name: 'EndlessApplicationView',
    Abstract: true,

    _init: function() {
        this._grid = new IconGrid.IconGrid({ xAlign: St.Align.MIDDLE,
                                             columnLimit: MAX_COLUMNS });

        // Standard hack for ClutterBinLayout
        this._grid.actor.x_expand = true;

        this._allIcons = [];
        this.repositionedIconData = [ null, null ];
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
        let isFolder = false;
        let item = null;

        if (IconGridLayout.layout.iconIsFolder(itemId)) {
            item = Shell.DesktopDirInfo.new(itemId);
            isFolder = true;
        } else {
            item = appSystem.lookup_app(itemId);
        }

        return [item, isFolder];
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
                return IconGridLayout.layout.iconIsFolder(itemId) || appSystem.lookup_app(itemId);
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
        return Util.ensureActorVisibleInScrollView(this.actor, icon);
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
            let [item, isFolder] = this._createItemForId(itemId);

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

            if (isFolder && currentIcon.view.iconsNeedRedraw()) {
                // Items inside the folder changed
                return true;
            }

            let oldIconInfo = null;
            let newIconInfo = null;

            if (isFolder) {
                oldIconInfo = currentIcon.folder.get_icon();
                newIconInfo = item.get_icon();
            } else {
                let appInfo = currentIcon.app.get_app_info();
                oldIconInfo = appInfo.get_icon();
                newIconInfo = item.get_app_info().get_icon();
            }

            if (!newIconInfo.equal(oldIconInfo)) {
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
            let [item, ] = this._createItemForId(itemId);

            if (item) {
                let icon = this._createItemIcon(item);
                this.addIcon(icon);
                icon.actor.connect('key-focus-in',
                                   Lang.bind(this, this._ensureIconVisible));
            }
        }
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
        return new AppIcon(item, null, { showMenu: false,
                                         parentView: this });
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

const AllView = new Lang.Class({
    Name: 'AllView',
    Extends: EndlessApplicationView,

    _init: function() {
        this.parent();

        this._grid.actor.y_expand = true;
        this._grid.actor.y_align = Clutter.ActorAlign.CENTER;

        let box = new St.BoxLayout({ vertical: true });
        this.stack = new St.Widget({ layout_manager: new AllViewLayout() });
        this.stack.add_actor(this._grid.actor);
        this._eventBlocker = new St.Widget({ x_expand: true, y_expand: true });
        this.stack.add_actor(this._eventBlocker);
        box.add(this.stack, { y_align: St.Align.START, expand: true });

        this.actor = new St.ScrollView({ x_fill: true,
                                         y_fill: false,
                                         y_align: St.Align.START,
                                         x_expand: true,
                                         y_expand: true,
                                         overlay_scrollbars: true,
                                         style_class: 'all-apps vfade' });
        this.actor._delegate = this;

        this.actor.add_actor(box);
        this.actor.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
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

        this.repositionedView = null;
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
        if (!source.parentView) {
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
        if (!source.parentView) {
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
        this.repositionedView = this._dragView;

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

    _createItemIcon: function(item) {
        if (item instanceof Shell.App) {
            if (item.get_id() == EOS_APP_STORE_ID) {
                this._appStoreIcon = new AppStoreIcon(item, this);
                return this._appStoreIcon;
            } else {
                return new AppIcon(item, null, { showMenu: false,
                                                 parentView: this });
            }
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
        return ALL_VIEW_ID;
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

const AppDisplayLayout = new Lang.Class({
    Name: 'AppDisplayLayout',
    Extends: Clutter.BinLayout,

    _init: function(allView, entry) {
        this.parent();

        this._allView = allView;
        this._allView.actor.connect('style-changed', Lang.bind(this, this._onStyleChanged));

        this._entry = entry;
        this._entry.connect('style-changed', Lang.bind(this, this._onStyleChanged));
    },

    _onStyleChanged: function() {
        this.layout_changed();
    },

    vfunc_allocate: function(container, box, flags) {
        let viewActor = this._allView.actor;
        let entry = this._entry;

        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        let viewHeight = viewActor.get_preferred_height(availWidth);
        viewHeight[1] = Math.max(viewHeight[1], this._allView.getEntryAnchor());

        let themeNode = entry.get_theme_node();
        let entryMinPadding = themeNode.get_length('-minimum-vpadding');
        let entryHeight = entry.get_preferred_height(availWidth);
        entryHeight[0] += entryMinPadding * 2;
        entryHeight[1] += entryMinPadding * 2;

        let entryBox = box.copy();
        let viewBox = box.copy();

        // Always give the view the whole allocation, unless
        // doing so wouldn't fit the entry
        let extraSpace = availHeight - viewHeight[1];
        let viewAllocHeight = viewHeight[1];

        if (extraSpace / 2 < entryHeight[0]) {
            extraSpace = 0;
            viewAllocHeight = availHeight - entryHeight[0];
        }

        viewBox.y1 = Math.floor(extraSpace / 2);
        viewBox.y2 = viewBox.y1 + viewAllocHeight;

        viewActor.allocate(viewBox, flags);

        // Now center the entry in the space below the grid
        let gridHeight = this._allView.getHeightForEntry(availWidth);

        extraSpace = availHeight - gridHeight[1];
        viewAllocHeight = gridHeight[1];

        if (extraSpace / 2 < entryHeight[0]) {
            extraSpace = 0;
            viewAllocHeight = availHeight - entryHeight[0];
        }

        entryBox.y1 = Math.floor(extraSpace / 2) + viewAllocHeight;
        entry.allocate(entryBox, flags);
    }
});

const AppDisplay = new Lang.Class({
    Name: 'AppDisplay',

    _init: function() {
        this._view = new AllView();

        this.entry = new St.Entry({ name: 'searchEntry',
                                    /* Translators: this is the text displayed
                                       in the search entry when no search is
                                       active; it should not exceed ~30
                                       characters. */
                                    hint_text: _("Type to search…"),
                                    track_hover: true,
                                    reactive: true,
                                    can_focus: true,
                                    x_align: Clutter.ActorAlign.CENTER,
                                    y_align: Clutter.ActorAlign.CENTER });

        let layoutManager = new AppDisplayLayout(this._view, this.entry);
        this.actor = new St.Widget({ layout_manager: layoutManager,
                                     x_expand: true,
                                     y_expand: true });

        this.actor.add_actor(this.entry);
        this.actor.add_actor(this._view.actor);

        // This makes sure that any DnD ops get channeled to the icon grid logic
        // otherwise dropping an item outside of the grid bounds fails
        this.actor._delegate = this;

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

    acceptDrop: function(source, actor, x, y, time) {
        // Forward all DnD releases to the scrollview
        this._view.acceptDrop(source, actor, x, y, time);
    },

    _redisplay: function() {
        if (this._view.getAllIcons().length == 0) {
            this._view.addIcons();
        } else {
            let animateView = this._view.repositionedView;
            if (!animateView) {
                animateView = this._view;
            }
            this._view.repositionedView = null;

            animateView.animateMovement();
        }
    }
});

const ViewIcon = new Lang.Class({
    Name: 'ViewIcon',

    _init: function(parentView, buttonParams, iconParams) {
        this.parentView = parentView;

        this.canDrop = false;
        this.customName = false;
        this.blockHandler = false;

        this._origIcon = null;

        this.actor = new St.Bin({ style_class: 'app-well-app' });
        this.actor.x_fill = true;
        this.actor.y_fill = true;
        this.actor.can_focus = true;

        this.actor._delegate = this;

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this.icon = new IconGrid.BaseIcon(this.getName(), iconParams, buttonParams);
        if (iconParams['showLabel'] !== false) {
            this.icon.label.connect('label-edit-update', Lang.bind(this, this._onLabelUpdate));
            this.icon.label.connect('label-edit-cancel', Lang.bind(this, this._onLabelCancel));
        }
        this.actor.set_child(this.icon.actor);

        this.actor.label_actor = this.icon.label;

        this.iconButton = this.icon.iconButton;
        this.iconButton._delegate = this;
    },

    _onDestroy: function() {
        if (this._origIcon) {
            let origIcon = this._origIcon;
            this._origIcon = null;
            origIcon.actor.destroy();
        }
    },

    _onLabelCancel: function() {
        this.actor.sync_hover();
    },

    handleViewDragBegin: function() {
        // Replace the dragged icon with an empty placeholder
        this._origIcon = this.icon;

        let dragBeginIcon = this.getDragBeginIcon();
        this.icon = dragBeginIcon;
        this.actor.set_child(dragBeginIcon.actor);
    },

    handleViewDragEnd: function() {
        if (!this.blockHandler && this._origIcon) {
            this.icon = this._origIcon;
            this.actor.set_child(this.icon.actor);
            this._origIcon = null;
        }
    },

    getDragBeginIcon: function() {
        let icon = new IconGrid.BaseIcon('', { createIcon: function(iconSize) {
            return new St.Icon({ icon_size: iconSize });
        }});
        icon.actor.add_style_class_name('dnd-begin');
        return icon;
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
        let iconParams = { 'createIcon': Lang.bind(this, this._createIcon),
                           'showLabel': (this.icon.label != null) };
        let icon = new IconGrid.BaseIcon(this.getName(), iconParams);
        icon.actor.add_style_class_name('dnd');
        return icon.actor;
    },

    // Returns the original actor that should align with the actor
    // we show as the item is being dragged.
    getDragActorSource: function() {
        return this.icon.actor;
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

        this.view = new FolderView(this);
        this.view.actor.reactive = false;

        this.iconButton.connect('clicked', Lang.bind(this,
            function() {
                if (this._createPopup()) {
                    this._popup.toggle();
                }
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

        this.closeButton = Util.makeCloseButton();
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

const AppActivationContext = new Lang.Class({
    Name: 'AppActivationContext',

    _init: function(app) {
        this._app = app;
        this._abort = false;

        this._cover = null;
        this._splash = null;

        this._appStateId = 0;
        this._splashId = 0;
    },

    activate: function() {
        try {
            this._app.activate();
        } catch (e) {
            logError(e, 'error while activating: ' + this._app.get_id());
            return;
        }

        // Don't show splash screen if the splash screen key is false
        let info = this._app.get_app_info();

        if (info && info.has_key(SPLASH_SCREEN_DESKTOP_KEY) && !info.get_boolean(SPLASH_SCREEN_DESKTOP_KEY)) {
            return;
        }

        // Don't show splash screen if default maximize is disabled
        if (global.settings.get_boolean(WindowManager.NO_DEFAULT_MAXIMIZE_KEY)) {
            return;
        }

        this._animateSplash();

        // We can't fully trust windows-changed to be emitted with the
        // same ShellApp we called activate() on, as WMClass matching might
        // fail. For this reason, just pick to the first application that
        // will flip its state to running
        let appSystem = Shell.AppSystem.get_default();
        this._appStateId = appSystem.connect('app-state-changed',
            Lang.bind(this, this._onAppStateChanged));
    },

    _getCoverPage: function() {
        let bgGroup = new Meta.BackgroundGroup();
        let bgManager = new Background.BackgroundManager({
                container: bgGroup,
                monitorIndex: Main.layoutManager.primaryIndex });

        bgGroup._bgManager = bgManager;
        return bgGroup;
    },

    _animateSplash: function() {
        this._cover = this._getCoverPage();
        Main.uiGroup.insert_child_below(this._cover, Main.layoutManager.panelBox);

        this._splash = new AppSplashPage(this._app);

        // Make sure that our events are captured
        Main.pushModal(this._splash);

        Main.uiGroup.add_actor(this._splash);
        this._splash.connect('close-clicked', Lang.bind(this, function() {
            /* If application doesn't quit very likely is because it
             * didn't reach running state yet; so wait for it to
             * finish */
            this._clearSplash();
            if (!this._app.request_quit()) {
                this._abort = true;
            }
        }));

        this._splash.translation_y = this._splash.height;
        Tweener.addTween(this._splash, { translation_y: 0,
                                         time: Overview.ANIMATION_TIME,
                                         transition: 'linear',
                                         onComplete: Lang.bind(this, function() {
                                             this._splash.spin();
                                             this._splashId = Mainloop.timeout_add(SPLASH_SCREEN_TIMEOUT,
                                                 Lang.bind(this, this._checkSplash));
                                         })
                                       });
    },

    _clearSplash: function() {
        if (this._cover) {
            this._cover._bgManager.destroy();
            this._cover.destroy();
            this._cover = null;
        }

        if (this._splash) {
            this._splash.completeInTime(SPLASH_SCREEN_COMPLETE_TIME, Lang.bind(this,
                function() {
                    Tweener.addTween(this._splash, { opacity: 0,
                                                     time: SPLASH_SCREEN_FADE_OUT,
                                                     transition: 'linear',
                                                     onComplete: Lang.bind(this,
                                                         function() {
                                                             // Release keybinding to overview again
                                                             Main.popModal(this._splash);

                                                             this._splash.destroy();
                                                             this._splash = null;
                                                         })
                                                   });
                }));
        }
    },

    _checkSplash: function() {
        this._splashId = 0;

        // FIXME: we can't rely on windows-changed being emited on the same
        // desktop file, as web apps right now all open tabs in the default browser
        let isLink = (this._app.get_id().indexOf('eos-link-') != -1);

        // (appStateId == 0) => window already created
        if (this._appStateId == 0 || isLink) {
            this._clearSplash();
        }

        return false;
    },

    _onAppStateChanged: function(appSystem, app) {
        if (app.state != Shell.AppState.RUNNING) {
            return;
        }

        appSystem.disconnect(this._appStateId);
        this._appStateId = 0;

        if (this._abort) {
            this._abort = false;
            app.request_quit();
            return;
        }

        // (splashId == 0) => the window took more than the stock
        // splash timeout to display
        if (this._splashId == 0) {
            // Wait for the minimize animation to complete in this case
            Mainloop.timeout_add(WindowManager.WINDOW_ANIMATION_TIME, Lang.bind(this,
                function() {
                    this._clearSplash();
                    return false;
                }));
        }
    }
});

const AppSplashPage = new Lang.Class({
    Name: 'AppSplashPage',
    Extends: St.Widget,

    _init: function(app) {
        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        this.parent({ x: workArea.x,
                      y: workArea.y,
                      width: workArea.width,
                      height: workArea.height,
                      layout_manager: new Clutter.BinLayout(),
                      style_class: 'app-splash-page' });

        this._app = app;
        this._spinner = null;

        let background = new St.Widget({ style_class: 'app-splash-page-background',
                                         x_expand: true,
                                         y_expand: true });

        let info = app.get_app_info();
        if (info !== undefined && info.has_key(DESKTOP_LAUNCH_BACKGROUND_FIELD)) {
            background.connect('allocation-changed', Lang.bind(this, function(actor, box, flags) {
                let bg_path = info.get_string(DESKTOP_LAUNCH_BACKGROUND_FIELD);
                background.style_class = 'app-splash-page-custom-background';
                background.style = 'background-image: url("%s");background-size: %dpx %dpx'.format(bg_path, box.x2 - box.x1, box.y2 - box.y1);
            }));
        }

        this.add_child(background);
        this.add_child(this._createCloseButton());
    },

    _createCloseButton: function() {
        let closeButton = new St.Button({ style_class: 'splash-close'});
        closeButton.set_x_align(Clutter.ActorAlign.END);
        closeButton.set_y_align(Clutter.ActorAlign.START);

        // XXX Clutter 2.0 workaround: ClutterBinLayout needs expand
        // to respect the alignments.
        closeButton.set_x_expand(true);
        closeButton.set_y_expand(true);

        closeButton.connect('clicked', Lang.bind(this, function() { this.emit('close-clicked'); }));
        closeButton.connect('style-changed', Lang.bind(this, this._closeButtonStyleChanged));

        return closeButton;
    },

    _closeButtonStyleChanged: function(closeButton) {
        let themeNode = closeButton.get_theme_node();
        closeButton.translation_x = themeNode.get_length('-splash-close-overlap-x');
        closeButton.translation_y = themeNode.get_length('-splash-close-overlap-y');
    },

    vfunc_style_changed: function() {
        if (this._spinner) {
            this._spinner.actor.destroy();
            this._spinner = null;
        }

        let themeNode = this.get_theme_node();
        let iconSize = themeNode.get_length('icon-size');

        let appIcon = this._app.create_icon_texture(iconSize);
        appIcon.x_align = Clutter.ActorAlign.CENTER;
        appIcon.y_align = Clutter.ActorAlign.CENTER;
        this.add_child(appIcon);

        let animationSize = themeNode.get_length('-animation-size');
        this._spinner = new Panel.VariableSpeedAnimation('splash-circle-animation.png',
                                                         animationSize,
                                                         SPLASH_CIRCLE_INITIAL_TIMEOUT,
                                                         SPLASH_CIRCLE_SKIP_END_FRAMES);
        this._spinner.actor.x_align = Clutter.ActorAlign.CENTER;
        this._spinner.actor.y_align = Clutter.ActorAlign.CENTER;
        this.add_child(this._spinner.actor);
    },

    spin: function() {
        this._spinner.play();
    },

    completeInTime: function(time, callback) {
        this._spinner.completeInTime(time, callback);
    }
});
Signals.addSignalMethods(AppSplashPage.prototype);

const AppIcon = new Lang.Class({
    Name: 'AppIcon',
    Extends: ViewIcon,

    _init : function(app, iconParams, params) {
        params = Params.parse(params, { showMenu: true,
                                        isDraggable: true,
                                        parentView: null });

        this.app = app;
        this._name = this.app.get_name();
        this._showMenu = params.showMenu;

        if (!iconParams) {
            iconParams = {};
        }

        iconParams['createIcon'] = Lang.bind(this, this._createIcon);
        iconParams['editableLabel'] = true;

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
                    this.popupMenu();
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

        this.actor.fake_release();

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
            let activationContext = new AppActivationContext(this.app);
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

const AppStoreIcon = new Lang.Class({
    Name: 'AppStoreIcon',
    Extends: AppIcon,

    _init : function(app, parentView) {
        this.parent(app, null,
                    { showMenu: false,
                      isDraggable: false,
                      parentView: parentView });

        this.actor.add_style_class_name('app-folder');

        this.canDrop = true;

        // For now, let's use the normal icon for the pressed state,
        // for consistency with the other app selector icons,
        // which just use the wells to represent the pressed state.
        // In the future, we may want to use the 'add_down' icon instead.
        // If so, the return to the normal state after the user
        // moves off the icon to cancel should be made more responsive;
        // the current implementation takes about a second for the change
        // back to the normal icon to occur.
        this.pressed_icon = new IconGrid.BaseIcon(_("Add"),
                                                  { createIcon: Lang.bind(this, this._createIcon) });
        this.empty_trash_icon = new IconGrid.BaseIcon(_("Delete"),
                                                      { createIcon: this._createTrashIcon });
        this.full_trash_icon = new IconGrid.BaseIcon(_("Delete"),
                                                     { createIcon: this._createFullTrashIcon });

        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
    },

    _createTrashIcon: function(iconSize) {
        return new St.Icon({ icon_size: iconSize,
                             icon_name: 'eos-app-store-remove'});
    },

    _createFullTrashIcon: function(iconSize) {
        return new St.Icon({ icon_size: iconSize,
                             icon_name: 'eos-app-store-remove-hover'});
    },

    _onButtonPress: function(actor, event) {
        let button = event.get_button();
        if (button == ButtonConstants.LEFT_MOUSE_BUTTON) {
            this.actor.set_child(this.pressed_icon.actor);
        }
        return false;
    },

    getDragBeginIcon: function() {
        return this.empty_trash_icon;
    },

    setDragHoverState: function(state) {
        this.parent(state);

        if (state) {
            this.actor.set_child(this.full_trash_icon.actor);
        } else {
            this.actor.set_child(this.empty_trash_icon.actor);
        }
    },

    _showDeleteConfirmation: function(draggedSource, deleteCallback) {
        draggedSource.blockHandler = true;
        this.blockHandler = true;
        let trashPopup = new TrashPopup({
            onCancel: Lang.bind(this, function() {
                this._restoreTrash(trashPopup, draggedSource);
            }),
            onAccept: Lang.bind(this, function() {
                this._restoreTrash(trashPopup, draggedSource);
                IconGridLayout.layout.removeIcon(draggedSource.getId());
                if (deleteCallback) {
                    deleteCallback();
                }
            }),
        });
        this.actor.set_child(trashPopup.actor);
    },

    _restoreTrash: function(trashPopup, source) {
        trashPopup.actor.visible = false;
        source.blockHandler = false;
        this.blockHandler = false;
        if (source.handleViewDragEnd) {
            source.handleViewDragEnd();
        }
        this.handleViewDragEnd();
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

    _acceptAppDrop: function(source) {
        let appInfo = source.app.get_app_info();
        this._showDeleteConfirmation(source,
                                     Lang.bind(this, function() {
                                         if (this._canDelete(appInfo)) {
                                             appInfo.delete();
                                         }
                                     }));
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
            this._showDeleteConfirmation(source,
                                         Lang.bind(this, function() {
                                             if (this._canDelete(folder)) {
                                                 folder.delete();
                                             }
                                         }));
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
            this._acceptAppDrop(source);
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

const TrashPopup = new Lang.Class({
    Name: 'TrashPopup',

    _init: function(params) {
        this.actor = new St.BoxLayout({ style_class: 'trash-popup',
                                        vertical: true });

        this._label = new St.Label({ text: _("Delete?"),
                                     style_class: 'trash-popup-label'
                                   });

        this._buttonsLayout = new St.BoxLayout({ style_class: 'trash-popup-buttons',
                                                 vertical: false
                                               });

        this.actor.add(this._label);
        this.actor.add(this._buttonsLayout, { expand: true });

        this._acceptButton = new St.Button({ style_class: 'trash-popup-accept' });
        this._cancelButton = new St.Button({ style_class: 'trash-popup-cancel' });

        this._buttonsLayout.add(this._cancelButton, { expand: true,
                                                      x_fill: false,
                                                      y_fill: false,
                                                      x_align: St.Align.START,
                                                      y_align: St.Align.END
                                                    });
        this._buttonsLayout.add(this._acceptButton, { expand: true,
                                                      x_fill: false,
                                                      y_fill: false,
                                                      x_align: St.Align.END,
                                                      y_align: St.Align.END
                                                    });

        this._grabHelper = new GrabHelper.GrabHelper(this.actor);
        this._grabHelper.addActor(this.actor);
        this._grabHelper.grab({ actor: this.actor,
                                focus: this.actor,
                                modal: true,
                                onUngrab: Lang.bind(this, this._onPopupUngrab)
                              });

        this._acceptButton.connect('clicked', params['onAccept']);
        this._cancelButton.connect('clicked', params['onCancel']);

        this.actor.connect('hide', Lang.bind(this, function() {
            this._grabHelper.ungrab({ actor: this.actor });
        }));
    },

    _onPopupUngrab: function(isUser) {
        if (isUser) {
            /* Re-new grab */
            this._grabHelper.grab({ actor: this.actor,
                                    focus: this.actor,
                                    modal: true,
                                    onUngrab: Lang.bind(this, this._onPopupUngrab)
                                  });
        }
    }
});

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

        let windows = this._source.app.get_windows();

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
