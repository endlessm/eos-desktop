// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const ButtonConstants = imports.ui.buttonConstants;
const Hash = imports.misc.hash;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const PANEL_ICON_SIZE = 28;
const PANEL_ICON_PADDING = 14;

const PANEL_WINDOW_MENU_THUMBNAIL_SIZE = 128;

function _compareByStableSequence(winA, winB) {
    let seqA = winA.get_stable_sequence();
    let seqB = winB.get_stable_sequence();

    return seqA - seqB;
}

const WindowMenuItem = new Lang.Class({
    Name: 'WindowMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (window, params) {
        this.parent(params);

        this.window = window;

        this.actor.add_style_class_name('panel-window-menu-item');

        let windowActor = this._findWindowActor();
        let monitor = Main.layoutManager.primaryMonitor;

        // constraint the max size of the clone to the aspect ratio
        // of the primary display, where the panel lives
        let ratio = monitor.width / monitor.height;
        let maxW = (ratio > 1) ?
            PANEL_WINDOW_MENU_THUMBNAIL_SIZE : PANEL_WINDOW_MENU_THUMBNAIL_SIZE * ratio;
        let maxH = (ratio > 1) ?
            PANEL_WINDOW_MENU_THUMBNAIL_SIZE / ratio : PANEL_WINDOW_MENU_THUMBNAIL_SIZE;

        let clone = new Clutter.Clone({ source: windowActor.get_texture() });
        let cloneW = clone.width;
        let cloneH = clone.height;
        let scale = Math.min(maxW / cloneW, maxH / cloneH);
        clone.set_size(Math.round(cloneW * scale), Math.round(cloneH * scale));

        this.cloneBin = new St.Bin({ child: clone,
                                     style_class: 'panel-window-menu-item-clone' });
        this.addActor(this.cloneBin, { align: St.Align.MIDDLE });

        this.label = new St.Label({ text: window.title,
                                    style_class: 'panel-window-menu-item-label' });

        this.addActor(this.label);
        this.actor.label_actor = this.label;
    },

    _findWindowActor: function() {
        let actors = global.get_window_actors();
        let windowActors = actors.filter(Lang.bind(this,
            function(actor) {
                return actor.meta_window == this.window;
            }));

        return windowActors[0];
    }
});

const APP_ICON_MENU_ARROW_XALIGN = 0.5;

const AppIconMenu = new Lang.Class({
    Name: 'AppIconMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(app, parentActor) {
        this.parent(parentActor, APP_ICON_MENU_ARROW_XALIGN, St.Side.BOTTOM);

        // We want to popdown the menu when clicked on the source icon itself
        this.blockSourceEvents = true;

        this._app = app;

        this.connect('activate', Lang.bind(this, this._onActivate));

        // Chain our visibility and lifecycle to that of the source
        parentActor.connect('notify::mapped', Lang.bind(this, function () {
            if (!parentActor.mapped) {
                this.close();
            }
        }));
        parentActor.connect('destroy', Lang.bind(this, function () { this.actor.destroy(); }));

        Main.uiGroup.add_actor(this.actor);
    },

    _redisplay: function() {
        this.removeAll();

        let tracker = Shell.WindowTracker.get_default();
        let activeWorkspace = global.screen.get_active_workspace();

        let windows = this._app.get_windows();
        let workspaceWindows = [];
        let otherWindows = [];

        windows.forEach(function(w) {
            if (!tracker.is_window_interesting(w)) {
                return;
            }

            if (w.located_on_workspace(activeWorkspace)) {
                workspaceWindows.push(w);
            } else {
                otherWindows.push(w);
            }
        });

        workspaceWindows.sort(Lang.bind(this, _compareByStableSequence));
        otherWindows.sort(Lang.bind(this, _compareByStableSequence));

        let hasWorkspaceWindows = (workspaceWindows.length > 0);
        let hasOtherWindows = (otherWindows.length > 0);

        // Display windows from other workspaces first, if present, since our panel
        // is at the bottom, and it's much more convenient to just move up the pointer
        // to switch windows in the current workspace
        if (hasOtherWindows) {
            this._appendOtherWorkspacesLabel();
        }

        otherWindows.forEach(Lang.bind(this,
            function(w) {
                this._appendMenuItem(w, hasOtherWindows);
            }));

        if (hasOtherWindows && hasWorkspaceWindows) {
            this._appendCurrentWorkspaceSeparator();
        }

        workspaceWindows.forEach(Lang.bind(this,
            function(w) {
                this._appendMenuItem(w, hasOtherWindows);
            }));
    },

    _appendOtherWorkspacesLabel: function () {
        let label = new PopupMenu.PopupMenuItem(_("Other workspaces"));
        label.label.add_style_class_name('panel-window-menu-workspace-label');
        this.addMenuItem(label);
    },

    _appendCurrentWorkspaceSeparator: function () {
        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.addMenuItem(separator);

        let label = new PopupMenu.PopupMenuItem(_("Current workspace"));
        label.label.add_style_class_name('panel-window-menu-workspace-label');
        this.addMenuItem(label);
    },

    _appendMenuItem: function(window, hasOtherWindows) {
        let item = new WindowMenuItem(window);
        this.addMenuItem(item);

        if (hasOtherWindows) {
            item.cloneBin.add_style_pseudo_class('indented');
        }
    },

    popup: function() {
        this._redisplay();
        this.open();
    },

    _onActivate: function (actor, item) {
        Main.activateWindow(item.window);
        this.close();
    }
});
Signals.addSignalMethods(AppIconMenu.prototype);

/** AppIconButton:
 *
 * This class handles the application icon
 */
const AppIconButton = new Lang.Class({
    Name: 'AppIconButton',

    _init: function(app) {
        this._app = app;

        let icon = app.create_icon_texture(PANEL_ICON_SIZE);

        this.actor = new St.Button({ child: icon, button_mask: St.ButtonMask.ONE });
        this.actor.reactive = true;

        // Handle the menu-on-press case for multiple windows
        this.actor.connect('button-press-event', Lang.bind(this,
            function(actor, event) {
                let button = event.get_button();

                if (button == ButtonConstants.LEFT_MOUSE_BUTTON) {
                    let windows = app.get_windows();
                    if (windows.length > 1) {
                        this._ensureMenu();
                        this._menu.popup();
                        this._menuManager.ignoreRelease();

                        // This will block the clicked signal from being emitted
                        return true;
                    }
                }

                this.actor.sync_hover();
                return false;
            }));

        this.actor.connect('clicked', Lang.bind(this,
            function() {
                // The multiple windows case is handled in button-press-event
                let windows = app.get_windows();
                if (windows.length == 1) {
                    Main.activateWindow(windows[0]);
                }
            }));

        Main.layoutManager.connect('startup-complete', Lang.bind(this,
            this._updateIconGeometry));
        this.actor.connect('notify::allocation', Lang.bind(this,
            this._updateIconGeometry));
        this.actor.connect('destroy', Lang.bind(this,
            this._resetIconGeometry));
    },

    _resetIconGeometry: function() {
        let windows = this._app.get_windows();
        windows.forEach(Lang.bind(this,
            function(win) {
                win.set_icon_geometry(null);
            }));
    },

    _updateIconGeometry: function() {
        let rect = new Meta.Rectangle();
        [rect.x, rect.y] = this.actor.get_transformed_position();
        [rect.width, rect.height] = this.actor.get_transformed_size();

        let windows = this._app.get_windows();
        windows.forEach(Lang.bind(this,
            function(win) {
                win.set_icon_geometry(rect);
            }));
    },

    _ensureMenu: function() {
        this.actor.fake_release();

        if (this._menu) {
            return;
        }

        this._menuManager = new PopupMenu.PopupMenuManager(this);

        this._menu = new AppIconMenu(this._app, this.actor);
        this._menuManager.addMenu(this._menu);
    }
});

/** AppIconBar:
 *
 * This class handles positioning all the application icons and listening
 * for app state change signals
 */
const AppIconBar = new Lang.Class({
    Name: 'AppIconBar',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, null, true);

        let bin = new St.Bin({ name: 'appIconBar' });
        this.actor.add_actor(bin);

        this._container = new Shell.GenericContainer();

        bin.set_child(this._container);
        this._container.connect('get-preferred-width', Lang.bind(this, this._getContentPreferredWidth));
        this._container.connect('get-preferred-height', Lang.bind(this, this._getContentPreferredHeight));
        this._container.connect('allocate', Lang.bind(this, this._contentAllocate));

        this._numberOfApps = 0;
        this._runningApps = new Hash.Map();

        let appSys = Shell.AppSystem.get_default();

        // Update for any apps running before the system started
        // (after a crash or a restart)
        let currentlyRunning = appSys.get_running();
        for (let i = 0; i < currentlyRunning.length; i++) {
            let app = currentlyRunning[i];

            let newChild = new AppIconButton(app);
            this._runningApps.set(app, newChild);
            this._numberOfApps++;
            this._container.add_actor(newChild.actor);
        }
        appSys.connect('app-state-changed', Lang.bind(this, this._onAppStateChanged));
    },

    _getContentPreferredWidth: function(actor, forHeight, alloc) {
        alloc.min_size = PANEL_ICON_SIZE * this._numberOfApps;
        alloc.natural_size = alloc.min_size + (PANEL_ICON_PADDING * (this._numberOfApps - 1));
    },

    _getContentPreferredHeight: function(actor, forWidth, alloc) {
        alloc.min_size = PANEL_ICON_SIZE;
        alloc.natural_size = PANEL_ICON_SIZE;
    },

    _contentAllocate: function(actor, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let childBox = new Clutter.ActorBox();

        let [minWidth, minHeight, naturalWidth, naturalHeight] = this._container.get_preferred_size();

        let direction = this.actor.get_text_direction();

        let yPadding = Math.floor(Math.max(0, allocHeight - naturalHeight) / 2);
        childBox.y1 = yPadding;
        childBox.y2 = childBox.y1 + Math.min(naturalHeight, allocWidth);

        let children = this._runningApps.items();

	// Calculate the spacing between the icons based on
	// the splitting the difference between the width the bar has been
	// allocated, and the minimum width we can handle over each of the
	// icons
	// Normally padding will be 5 but we can handle right down to 0
	let spacing;
	if ((children.length - 1) == 0) {
	    spacing = 0;
	} else {
            spacing = (allocWidth - minWidth) / (children.length - 1);
	}

        for (let i = 0; i < children.length; i++) {
            let [key, child] = children[i];

            childBox.x1 = (PANEL_ICON_SIZE + spacing) * i;
            childBox.x2 = childBox.x1 + PANEL_ICON_SIZE;

            child.actor.allocate(childBox, flags);
        }
    },

    _onAppStateChanged: function(appSys, app) {
        let state = app.state;

        switch(state) {
        case Shell.AppState.STARTING:
            let newChild = new AppIconButton(app);
            this._runningApps.set(app, newChild);
            this._numberOfApps++;
            this._container.add_actor(newChild.actor);
            break;

        case Shell.AppState.RUNNING:
	    // The normal sequence of events appears to be
	    // STARTING -> STOPPED -> RUNNING -> STOPPED
	    // but sometimes it can go STARTING -> RUNNING -> STOPPED
	    // So we only want to add an app here if we don't already
	    // have an icon for @app
            if (!this._runningApps.has(app)) {
                let newChild = new AppIconButton(app);
                this._runningApps.set(app, newChild);
                this._numberOfApps++;
                this._container.add_actor(newChild.actor);
            }
            break;

        case Shell.AppState.STOPPED:
            let oldChild = this._runningApps.get(app);
	    if (oldChild) {
                this._container.remove_actor(oldChild.actor);
                this._runningApps.delete(app);
                this._numberOfApps--;
            }
            break;
        }
    }
});