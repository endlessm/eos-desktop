// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Hash = imports.misc.hash;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const PANEL_ICON_SIZE = 22;
const PANEL_ICON_PADDING = 5;

/** AppIconButton:
 *
 * This class handles the application icon
 */
const AppIconButton = new Lang.Class({
    Name: 'AppIconButton',

    _init: function(app) {
        this._app = app;

        this.actor = app.create_icon_texture(PANEL_ICON_SIZE);
        this.actor.reactive = true;

        let clickAction = new Clutter.ClickAction();
        clickAction.connect('clicked', Lang.bind(this, function(action) {
            if (Main.overview.visible) {
                Main.overview.hide();
            }

            app.activate();
        }));

        this.actor.add_action(clickAction);
    },
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