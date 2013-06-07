// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Shell = imports.gi.Shell;
const Lang = imports.lang;
const Signals = imports.signals;
const Meta = imports.gi.Meta;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Atk = imports.gi.Atk;

const AppFavorites = imports.ui.appFavorites;
const BoxPointer = imports.ui.boxpointer;
const ButtonConstants = imports.ui.buttonConstants;
const DND = imports.ui.dnd;
const IconGrid = imports.ui.iconGrid;
const IconGridLayout = imports.ui.iconGridLayout;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const Overview = imports.ui.overview;
const OverviewControls = imports.ui.overviewControls;
const PopupMenu = imports.ui.popupMenu;
const Tweener = imports.ui.tweener;
const Workspace = imports.ui.workspace;
const Params = imports.misc.params;
const Util = imports.misc.util;

const MAX_APPLICATION_WORK_MILLIS = 75;
const MENU_POPUP_TIMEOUT = 600;
const MAX_COLUMNS = 7;

const INACTIVE_GRID_OPACITY = 77;
const FOLDER_SUBICON_FRACTION = .4;

const EndlessApplicationView = new Lang.Class({
    Name: 'EndlessApplicationView',
    Abstract: true,

    _init: function() {
        this._grid = new IconGrid.IconGrid({ xAlign: St.Align.MIDDLE,
                                             columnLimit: MAX_COLUMNS });

        // Standard hack for ClutterBinLayout
        this._grid.actor.x_expand = true;

        this._items = {};
        this._allItems = [];
    },

    removeAll: function() {
        this._grid.removeAll();
        this._items = {};
        this._allItems = [];
    },

    removeItem: function(item) {
        this._grid.removeItem(item.actor);
    },

    _getItemId: function(item) {
        return item.get_id();
    },

    _createItemIcon: function(item) {
        throw new Error('Not implemented');
    },

    _addItem: function(item) {
        let id = this._getItemId(item);
        if (this._items[id] !== undefined) {
            return null;
        }

        let itemIcon = this._createItemIcon(item);
        itemIcon.parentView = this;
        this._allItems.push(item);
        this._items[id] = itemIcon;

        return itemIcon;
    },

    _removeItem: function(item) {
        let id = this._getItemId(item);
        if (this._items[id] === undefined) {
            return;
        }

        delete this._items[id];

        let idx = this._allItems.indexOf(item);
        if (idx != -1) {
            this._allItems.splice(idx, 1);
        }
    },

    _showItem: function(item) {
        let id = this._getItemId(item);
        if (this._items[id] === undefined) {
            return;
        }

        this._items[id].actor.show();
    },

    loadGrid: function() {
        for (let i = 0; i < this._allItems.length; i++) {
            let id = this._getItemId(this._allItems[i]);
            if (!id) {
                continue;
            }

            this._grid.addItem(this._items[id].actor);
        }
    },

    indexOf: function(item) {
        return this._grid.indexOf(item.actor);
    },

    nudgeItemsAtIndex: function(index, location) {
        this._grid.nudgeItemsAtIndex(index, location);
    },

    removeNudgeTransforms: function() {
        this._grid.removeNudgeTransforms();
    },

    canDropAt: function(x, y, index) {
        return this._grid.canDropAt(x, y, index);
    },

    getItem: function(id) {
        return this._items[id];
    }
});

const FolderView = new Lang.Class({
    Name: 'FolderView',
    Extends: EndlessApplicationView,

    _init: function(folderIcon) {
        this.parent();
        this.folderIcon = folderIcon;
        this.actor = this._grid.actor;
    },

    _createItemIcon: function(item) {
        return new AppIcon(item, null, { showMenu: false });
    },

    addApp: function(app) {
        this._addItem(app);
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
        this._stack = new St.Widget({ layout_manager: new AllViewLayout() });
        this._stack.add_actor(this._grid.actor);
        this._eventBlocker = new St.Widget({ x_expand: true, y_expand: true });
        this._stack.add_actor(this._eventBlocker);
        box.add(this._stack, { y_align: St.Align.START, expand: true });

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

        Main.overview.connect('item-drag-begin', Lang.bind(this, this._onDragBegin));
        Main.overview.connect('item-drag-end', Lang.bind(this, this._onDragEnd));

        this._clickAction = new Clutter.ClickAction();
        this._clickAction.connect('clicked', Lang.bind(this, function() {
            if (!this._currentPopup) {
                return;
            }

            let [x, y] = this._clickAction.get_coords();
            let actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
            if (!this._currentPopup.actor.contains(actor)) {
                this._currentPopup.popdown();
            }

        }));
        this._eventBlocker.add_action(this._clickAction);
    },

    _onPan: function(action) {
        this._clickAction.release();

        let [dist, dx, dy] = action.get_motion_delta(0);
        let adjustment = this.actor.vscroll.adjustment;
        adjustment.value -= (dy / this.actor.height) * adjustment.page_size;
        return false;
    },

    _createEmptyIcon: function(iconSize) {
        return new St.Icon({ icon_size: iconSize });
    },

    _setupDragState: function(source) {
        this._dragItem = source;
        this._dragView = undefined;

        this._dragMonitor = {
            dragMotion: Lang.bind(this, this._onDragMotion)
        };
        DND.addDragMonitor(this._dragMonitor);

        this._insertIdx = -1;
        this._onIconIdx = -1;
        this._onIcon = false;
        this._originalIdx = source.parentView.indexOf(source);

        // Replace the dragged icon with an empty placeholder
        this._originalSourceIcon = source.icon;

        let insertActor = new IconGrid.BaseIcon('', { createIcon: this._createEmptyIcon });
        source.icon = insertActor;
        source.actor.set_child(insertActor.actor);
    },

    _clearDragState: function(source) {
        source.icon = this._originalSourceIcon;
        source.actor.set_child(source.icon.actor);
        this._originalSourceIcon = null;

        this._insertIdx = -1;
        this._onIconIdx = -1;
        this._onIcon = false;
        this._originalIdx = -1;

        this._dragItem = null;
        this._dragView = null;

        DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
    },

    _onDragBegin: function(overview, source) {
        if (source.parentView) {
            // Dragging an icon from grid
            // Save the currently dragged item info
            this._setupDragState(source);
        }

        // Hide the event blocker in all cases to allow for dash DnD
        this._eventBlocker.hide();
    },

    _onDragEnd: function(overview, source) {
        source.parentView.removeNudgeTransforms();
        if (source.parentView != this) {
            this.removeNudgeTransforms();
        }

        this._eventBlocker.show();
        this._clearDragState(source);
    },

    _onDragMotion: function(dragEvent) {
        // Handle motion over grid
        if (this.actor.contains(dragEvent.targetActor)) {
            this._dragView = this;
        }

        if (this._dragItem.parentView.actor.contains(dragEvent.targetActor)) {
            this._dragView = this._dragItem.parentView;
        }

        if (!this._dragView) {
            return DND.DragMotionResult.CONTINUE;
        }

        let [idx, cursorLocation] = this._dragView.canDropAt(dragEvent.x,
                                                             dragEvent.y,
                                                             this._insertIdx);

        let onIcon = (cursorLocation == IconGrid.CursorLocation.ON_ICON);
        let isNewPosition = (!onIcon && idx != this._insertIdx) || (onIcon != this._onIcon);

        // If we are not over our last hovered icon, remove its hover state
        if (this._onIconIdx != -1 &&
            ((idx != this._onIconIdx) || !onIcon)) {
            this._setDragHoverState(false);
        }

        // If we are in a new spot, remove the previous nudges
        if (isNewPosition) {
            this._dragView.removeNudgeTransforms();
        }

        // Update our insert/hover index and if we are currently on an icon
        this._onIcon = onIcon;
        if (this._onIcon) {
            this._onIconIdx = idx;
            this._insertIdx = -1;

            let hoverResult = this._getDragHoverResult();
            if (hoverResult == DND.DragMotionResult.MOVE_DROP) {
                // If we are hovering over a drop target, set its hover state
                this._setDragHoverState(true);
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

    _shouldNudgeItems: function(isNewPosition) {
        if (this._insertIdx == -1) {
            return false;
        }

        if (this._insertIdx == this._originalIdx &&
            this._dragView == this._dragItem.parentView) {
            return false;
        }

        // If we are between icons at a new position
        // (but not immediately to the left of the original position),
        // nudge the icons apart
        let isLeftOfOrig = (this._insertIdx == this._originalIdx + 1 &&
                            this._dragView == this._dragItem.parentView);
        return (isNewPosition && !isLeftOfOrig);
    },

    _getDragHoverResult: function() {
        // If we are hovering over our own icon placeholder, ignore it
        if (this._onIconIdx == this._originalIdx &&
            this._dragView == this._dragItem.parentView) {
            return DND.DragMotionResult.NO_DROP;
        }

        // Note that the app store icon is not in the all items array
        let item = this._dragView._allItems[this._onIconIdx];
        let validHoverDrop = false;
        
        if (item) {
            let viewItem = this._dragView._items[item.get_id()];
            // We can only move applications into folders
            validHoverDrop = (viewItem instanceof FolderIcon &&
                              this._dragItem instanceof AppIcon);
        }

        if (validHoverDrop) {
            return DND.DragMotionResult.MOVE_DROP;
        } else {
            return DND.DragMotionResult.CONTINUE;
        }
    },

    _setDragHoverState: function(state) {
        let item = this._dragView._allItems[this._onIconIdx];

        if (item) {
            let viewItem = this._dragView._items[item.get_id()];
            viewItem.actor.set_hover(state);
        }
    },

    acceptDrop: function(source, actor, x, y, time) {
        // Get the id of the icon dragged
        let originalId = this._getIdFromIndex(source.parentView, this._originalIdx);

        if (this._onIcon) {
            // Find out what icon the drop is under
            let id = this._getIdFromIndex(this._dragView, this._onIconIdx);
            if (!id) {
                return false;
            }

            // If we are dropping an icon on another icon, cancel the request
            let dropIcon = this._dragView.getItem(id);
            if (!(dropIcon instanceof FolderIcon)) {
                return false;
            }

            // If we are hovering over a folder, the icon needs to be moved
            IconGridLayout.layout.repositionIcon(originalId, null, id);
            return true;
        } else {
            // If we are not over an icon and we are outside of the grid area,
            // ignore the request to move
            if (this._insertIdx == -1) {
                return false;
            } else {
                // If we are not over an icon but within the grid, shift the
                // grid around to accomodate it
                let insertId = this._getIdFromIndex(this._dragView, this._insertIdx);

                let folderId;
                if (this._dragView == this) {
                    folderId = '';
                } else {
                    folderId = this._dragView.folderIcon.getId();
                }

                IconGridLayout.layout.repositionIcon(originalId, insertId, folderId);
                return true;
            }
        }
    },

    _getIdFromIndex: function(view, index){
       let item = view._allItems[index];
       if (item) {
           return view._getItemId(item);
       }
       return null;
    },

    _createItemIcon: function(item) {
        if (item instanceof Shell.App) {
            return new AppIcon(item, null, { showMenu: false });
        } else {
            return new FolderIcon(item, this);
        }
    },

    loadGrid: function() {
        this.parent();

        this._grid.addItem((new AppStoreIcon()).actor);
    },

    addApp: function(app) {
        let appIcon = this._addItem(app);
        if (appIcon)
            appIcon.actor.connect('key-focus-in',
                                  Lang.bind(this, this._ensureIconVisible));
    },

    addFolder: function(dir) {
        let folderIcon = this._addItem(dir);
        if (folderIcon)
            folderIcon.actor.connect('key-focus-in',
                                     Lang.bind(this, this._ensureIconVisible));
    },

    addFolderPopup: function(popup) {
        this._stack.add_actor(popup.actor);
        popup.connect('open-state-changed', Lang.bind(this,
            function(popup, isOpen) {
                this._eventBlocker.reactive = isOpen;
                this._currentPopup = isOpen ? popup : null;
                this._updateIconOpacities(isOpen);

                if (isOpen) {
                    this._ensureIconVisible(popup.actor);
                    this._grid.actor.y = popup.parentOffset;
                } else {
                    this._grid.actor.y = 0;
                }
            }));
    },

    _ensureIconVisible: function(icon) {
        Util.ensureActorVisibleInScrollView(this.actor, icon);
    },

    _updateIconOpacities: function(folderOpen) {
        for (let id in this._items) {
            if (folderOpen && !this._items[id].actor.checked)
                this._items[id].actor.opacity = INACTIVE_GRID_OPACITY;
            else
                this._items[id].actor.opacity = 255;
        }
    }
});

const FrequentView = new Lang.Class({
    Name: 'FrequentView',

    _init: function() {
        this._grid = new IconGrid.IconGrid({ xAlign: St.Align.MIDDLE,
                                             fillParent: true,
                                             columnLimit: MAX_COLUMNS });
        this.actor = new St.Widget({ style_class: 'frequent-apps',
                                     x_expand: true, y_expand: true });
        this.actor.add_actor(this._grid.actor);

        this._usage = Shell.AppUsage.get_default();
    },

    removeAll: function() {
        this._grid.removeAll();
    },

    loadApps: function() {
        let mostUsed = this._usage.get_most_used ("");
        for (let i = 0; i < mostUsed.length; i++) {
            let appIcon = new AppIcon(mostUsed[i]);
            this._grid.addItem(appIcon.actor, -1);
        }
    }
});

const Views = {
    FREQUENT: 0,
    ALL: 1
};

const AppDisplay = new Lang.Class({
    Name: 'AppDisplay',

    _init: function() {
        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connect('installed-changed', Lang.bind(this, function() {
            Main.queueDeferredWork(this._allAppsWorkId);
        }));
        Main.overview.connect('showing', Lang.bind(this, function() {
            Main.queueDeferredWork(this._frequentAppsWorkId);
        }));
        global.settings.connect('changed::app-folder-categories', Lang.bind(this, function() {
            Main.queueDeferredWork(this._allAppsWorkId);
        }));

        IconGridLayout.layout.connect('changed', Lang.bind(this, function() {
            Main.queueDeferredWork(this._allAppsWorkId);
        }));

        this._views = [];

        let view, button;
        view = new FrequentView();
        button = new St.Button({ label: _("Frequent"),
                                 style_class: 'app-view-control',
                                 can_focus: true,
                                 x_expand: true });
        this._views[Views.FREQUENT] = { 'view': view, 'control': button };

        view = new AllView();
        button = new St.Button({ label: _("All"),
                                 style_class: 'app-view-control',
                                 can_focus: true,
                                 x_expand: true });
        this._views[Views.ALL] = { 'view': view, 'control': button };

        this.actor = new St.BoxLayout({ style_class: 'app-display',
                                        vertical: true,
                                        x_expand: true, y_expand: true });

        this._viewStack = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                          x_expand: true, y_expand: true });
        this.actor.add(this._viewStack, { expand: true });

        for (let i = 0; i < this._views.length; i++) {
            this._viewStack.add_actor(this._views[i].view.actor);

            let viewIndex = i;
            this._views[i].control.connect('clicked', Lang.bind(this,
                function(actor) {
                    this._showView(viewIndex);
                }));
        }

        // Default to all apps rather than frequently used
        this._showView(Views.ALL);

        // We need a dummy actor to catch the keyboard focus if the
        // user Ctrl-Alt-Tabs here before the deferred work creates
        // our real contents
        this._focusDummy = new St.Bin({ can_focus: true });
        this._viewStack.add_actor(this._focusDummy);

        this._allAppsWorkId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._redisplayAllApps));
        this._frequentAppsWorkId = Main.initializeDeferredWork(this.actor, Lang.bind(this, this._redisplayFrequentApps));
    },

    _showView: function(activeIndex) {
        for (let i = 0; i < this._views.length; i++) {
            let actor = this._views[i].view.actor;
            let params = { time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                           opacity: (i == activeIndex) ? 255 : 0 };
            if (i == activeIndex)
                actor.visible = true;
            else
                params.onComplete = function() { actor.hide(); };
            Tweener.addTween(actor, params);

            if (i == activeIndex)
                this._views[i].control.add_style_pseudo_class('checked');
            else
                this._views[i].control.remove_style_pseudo_class('checked');
        }
    },

    _redisplay: function() {
        this._redisplayFrequentApps();
        this._redisplayAllApps();
    },

    _redisplayFrequentApps: function() {
        let view = this._views[Views.FREQUENT].view;

        view.removeAll();
        view.loadApps();
    },

    _redisplayAllApps: function() {
        let view = this._views[Views.ALL].view;
        view.removeAll();

        let topLevelIcons = IconGridLayout.layout.getIcons();

        for (let i = 0; i < topLevelIcons.length; i++) {
            let itemId = topLevelIcons[i];

            if (IconGridLayout.layout.iconIsFolder(itemId)) {
                view.addFolder({
                    get_id: function() { return itemId; }
                });
            } else {
                let app = this._appSystem.lookup_app(itemId);
                if (app) {
                    view.addApp(app);
                }
            }
        }
        view.loadGrid();

        if (this._focusDummy) {
            let focused = this._focusDummy.has_key_focus();
            this._focusDummy.destroy();
            this._focusDummy = null;
            if (focused)
                this.actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
        }
    }
});

const FolderIcon = new Lang.Class({
    Name: 'FolderIcon',

    _init: function(dir, parentView) {
        this._dir = dir;

        this._dirInfo = Shell.DesktopDirInfo.new(this._dir.get_id());

        this._parentView = parentView;

        this.actor = new St.Button({ style_class: 'app-well-app app-folder',
                                     button_mask: St.ButtonMask.ONE,
                                     toggle_mode: true,
                                     can_focus: true,
                                     x_fill: true,
                                     y_fill: true });
        this.actor._delegate = this;

        let label = this._dirInfo.get_name();
        this.icon = new IconGrid.BaseIcon(label,
                                          { createIcon: Lang.bind(this, this._createIcon) });
        this.actor.set_child(this.icon.actor);
        this.actor.label_actor = this.icon.label;

        this.view = new FolderView(this);
        this.view.actor.reactive = false;

        this.view.removeAll();
        this._loadCategory(this._dir, this.view);
        this.view.loadGrid();

        this.actor.connect('clicked', Lang.bind(this,
            function() {
                this._ensurePopup();
                this._popup.toggle();
            }));
        this.actor.connect('notify::mapped', Lang.bind(this,
            function() {
                if (!this.actor.mapped && this._popup)
                    this._popup.popdown();
            }));

        // DND implementation
        this._draggable = DND.makeDraggable(this.actor);
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

    _loadCategory: function(dir) {
        let appSystem = Shell.AppSystem.get_default();

        let icons = IconGridLayout.layout.getIcons(dir.get_id());
        if (! icons) {
            return;
        }

        for (let i = 0; i < icons.length; i++) {
            let app = appSystem.lookup_app(icons[i]);
            if (app) {
                this.view.addApp(app);
            }
        }
    },

    _createIcon: function(size) {
        let icon = this._dirInfo.get_icon();
        return new St.Icon({ icon_size: size,
                             gicon: icon });
    },

    _ensurePopup: function() {
        if (this._popup)
            return;

        let [sourceX, sourceY] = this.actor.get_transformed_position();
        let [sourceXP, sourceYP] = this._parentView.actor.get_transformed_position();
        let relY = sourceY - sourceYP;
        let spaceTop = relY;
        let spaceBottom = this._parentView.actor.height - (relY + this.actor.height);
        let side = spaceTop > spaceBottom ? St.Side.BOTTOM : St.Side.TOP;

        this._popup = new AppFolderPopup(this, side);
        this._parentView.addFolderPopup(this._popup);
        this._reposition(side);

        this._popup.connect('open-state-changed', Lang.bind(this,
            function(popup, isOpen) {
                if (!isOpen)
                    this.actor.checked = false;
            }));
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
        let grid = this.actor.get_parent().get_parent();

        // Position the popup above or below the source icon
        if (side == St.Side.BOTTOM) {
            this._popup.actor.show();
            let y = grid.y + this.actor.y - this._popup.actor.height;
            let yWithButton = y - closeButtonOffset;
            this._popup.parentOffset = yWithButton < 0 ? -yWithButton : 0;
            this._popup.actor.y = Math.max(y, closeButtonOffset);
            this._popup.actor.hide();
        } else {
            this._popup.actor.y = grid.y + this.actor.y + this.actor.height + closeButtonOffset;
        }
    },

    getId: function() {
        return this._dir.get_id();
    },

    getDragActor: function() {
        let icon = this._dirInfo.get_icon();
        let textureCache = St.TextureCache.get_default();
        return textureCache.load_gicon(null, icon, Main.overview.dashIconSize);
    },

    getDragActorSource: function() {
        return this.icon.icon;
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

        source.actor.connect('destroy', Lang.bind(this,
            function() {
                this.actor.destroy();
            }));
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
                                  this.emit('open-state-changed', false);
                              }));
        this._isOpen = false;
    }
});
Signals.addSignalMethods(AppFolderPopup.prototype);

const AppIcon = new Lang.Class({
    Name: 'AppIcon',

    _init : function(app, iconParams, params) {
        params = Params.parse(params, { showMenu: true,
                                        isDraggable: true });

        this.app = app;
        this._showMenu = params.showMenu;

        this.actor = new St.Button({ style_class: 'app-well-app',
                                     reactive: true,
                                     button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
                                     can_focus: true,
                                     x_fill: true,
                                     y_fill: true });
        this.actor._delegate = this;

        if (!iconParams)
            iconParams = {};

        iconParams['createIcon'] = Lang.bind(this, this._createIcon);
        this.icon = new IconGrid.BaseIcon(app.get_name(), iconParams);
        this.actor.set_child(this.icon.actor);

        this.actor.label_actor = this.icon.label;

        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        this.actor.connect('clicked', Lang.bind(this, this._onClicked));
        this.actor.connect('popup-menu', Lang.bind(this, this._onKeyboardPopupMenu));

        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);

        if (params.isDraggable) {
            this._draggable = DND.makeDraggable(this.actor);
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

        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._menuTimeoutId = 0;
        this._stateChangedId = this.app.connect('notify::state',
                                                Lang.bind(this,
                                                          this._onStateChanged));
        this._onStateChanged();
    },

    _onDestroy: function() {
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
        return false;
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
        let modifiers = event.get_state();

        if (modifiers & Clutter.ModifierType.CONTROL_MASK
            && this.app.state == Shell.AppState.RUNNING) {
            this.app.open_new_window(-1);
        } else {
            this.app.activate();
        }

        Main.overview.hide();
    },

    shellWorkspaceLaunch : function(params) {
        params = Params.parse(params, { workspace: -1,
                                        timestamp: 0 });

        this.app.open_new_window(params.workspace);
    },

    getDragActor: function() {
        return this.app.create_icon_texture(Main.overview.dashIconSize);
    },

    // Returns the original actor that should align with the actor
    // we show as the item is being dragged.
    getDragActorSource: function() {
        return this.icon.icon;
    },
});
Signals.addSignalMethods(AppIcon.prototype);

// FIXME: this should be removed once we install the app
// store application with its desktop file and everything
const AppStore = new Lang.Class({
    Name: 'AppStore',
    Extends: Shell.App,

    get_name: function() {
        return _("Add");
    },

    get_id: function() {
        return "appstoreid";
    },

    activate: function(){
        Util.spawn(["eos-app-store"]);
    }
});

const AppStoreIcon = new Lang.Class({
    Name: 'AppStoreIcon',
    Extends: AppIcon,

    _init : function() {
        this.parent(new AppStore(),
                    { createIcon: this._createIcon },
                    { showMenu: false,
                      isDraggable: false });

        this.pressed_icon = new IconGrid.BaseIcon(_("Add"),
                                                  { createIcon: this._createPressedIcon });
        this.empty_trash_icon = new IconGrid.BaseIcon(_("Delete"),
                                                      { createIcon: this._createTrashIcon });
        this.full_trash_icon = new IconGrid.BaseIcon(_("Delete"),
                                                     { createIcon: this._createFullTrashIcon });

        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));

        Main.overview.connect('item-drag-begin', Lang.bind(this, this._onDragBegin));
        Main.overview.connect('item-drag-end', Lang.bind(this, this._onDragEnd));
    },

    _createPressedIcon: function(iconSize) {
        // For now, let's use the normal icon for the pressed state,
        // for consistency with the other app selector icons,
        // which just use the wells to represent the pressed state.
        // In the future, we may want to use the 'add_down' icon instead.
        // If so, the return to the normal state after the user
        // moves off the icon to cancel should be made more responsive;
        // the current implementation takes about a second for the change
        // back to the normal icon to occur.
        return new St.Icon({ icon_size: iconSize,
                             icon_name: 'add_normal'});
    },

    _createIcon: function(iconSize) {
        return new St.Icon({ icon_size: iconSize,
                             icon_name: 'add_normal'});
    },

    _createTrashIcon: function(iconSize) {
        return new St.Icon({ icon_size: iconSize,
                             icon_name: 'trash-can_normal'});
    },

    _createFullTrashIcon: function(iconSize) {
        return new St.Icon({ icon_size: iconSize,
                             icon_name: 'trash-can_hover'});
    },

    _onButtonPress: function(actor, event) {
        let button = event.get_button();
        if (button == ButtonConstants.LEFT_MOUSE_BUTTON) {
            this.actor.set_child(this.pressed_icon.actor);
        }
        return false;
    },

    _getAppFromSource: function(source) {
        if (source instanceof AppIcon) {
            return source.app;
        } else {
            return null;
        }
    },

    _onDragBegin: function() {
        this.actor.set_child(this.empty_trash_icon.actor);
        this._dragCancelled = false;
        this._dragMonitor = {
            dragMotion: Lang.bind(this, this._onDragMotion)
        };
        DND.addDragMonitor(this._dragMonitor);
    },

    _onDragEnd: function(actor, event) {
        this.actor.set_child(this.icon.actor);
        DND.removeDragMonitor(this._dragMonitor);
    },

    _onDragMotion: function(dragEvent) {
        let app = this._getAppFromSource(dragEvent.source);
        if (app == null) {
            return DND.DragMotionResult.CONTINUE;
        }

        let showAppsHovered = this.actor.contains(dragEvent.targetActor);

        if (showAppsHovered) {
            this.actor.set_child(this.full_trash_icon.actor);
            this.actor.set_hover(true);
        } else {
            this.actor.set_child(this.empty_trash_icon.actor);
            this.actor.set_hover(false);
        }

        return DND.DragMotionResult.CONTINUE;
    },

    handleDragOver: function(source, actor, x, y, time) {
        let app = this._getAppFromSource(source);
        if (app == null) {
            return DND.DragMotionResult.NO_DROP;
        }
        let id = app.get_id();
        return DND.DragMotionResult.MOVE_DROP;
    },

    acceptDrop: function(source, actor, x, y, time) {
        let app = source.app;
        if (app == null) {
            return false;
        }

        let id = app.get_id();

        let dialog = new ModalDialog.ModalDialog();
        let subjectLabel = new St.Label({ text: _("Delete?") });
        dialog.contentLayout.add(subjectLabel, { y_fill: true,
                                                 y_align: St.Align.START });
        let noButton = { label: _("No"),
                         action: Lang.bind(this, function() {
                             dialog.close();
                         }),
                         key: Clutter.Escape };
        let yesButton = { label: _("Yes"),
                          action: Lang.bind(this, function() {
                              dialog.close();
                              source.parentView.removeItem(source);
                              IconGridLayout.layout.repositionIcon(id, 0, null);
                          }),
                          default: true };
        dialog.setButtons([yesButton, noButton]);
        dialog.open();

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
            function () {
                return false;
            }));

        return true;
    },
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
