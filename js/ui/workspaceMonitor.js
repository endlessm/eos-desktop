// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;

const Main = imports.ui.main;

const WorkspaceMonitor = new Lang.Class({
    Name: 'WorkspaceMonitor',

    _init: function() {
        this._metaScreen = global.screen;

        this._minimizedWindows = [];
        this._knownWindows = [];

        this._shellwm = global.window_manager;
        this._shellwm.connect('minimize', Lang.bind(this, this._minimizeWindow));
        this._shellwm.connect('map', Lang.bind(this, this._mapWindow));
        this._shellwm.connect('destroy', Lang.bind(this, this._destroyWindow));

        this._metaScreen.connect('workspace-switched', Lang.bind(this, this._workspaceSwitched));

        this._visibleWindows = 0;

        this._trackWorkspace(this._metaScreen.get_active_workspace());
    },

    _trackWorkspace: function(workspace) {
        this._activeWorkspace = workspace;

        // Setup to listen to the number of windows being changed
        this._windowAddedId = this._activeWorkspace.connect('window-added', Lang.bind(this, this._windowAdded));
        this._windowRemovedId = this._activeWorkspace.connect('window-removed', Lang.bind(this, this._windowRemoved));

        // When we switch workspace or on startup we need to track what
        // windows already exist on the system. Currently we only have
        // one workspace so that isn't a problem.

        // The code below works for all windows, except gnome-terminal
        //  - for some reason gnome-terminal windows do not appear in
        // the list returned by list_windows().
        let windows = this._activeWorkspace.list_windows();
        global.log("Got " + windows.length + " windows");
        for (let i = 0; i < windows.length; i++) {
            let metaWindow = windows[i];

            if (metaWindow.minimized) {
                this._minimizedWindows.push(metaWindow);
            } else {
                this._visibleWindows += 1;
            }

            this._knownWindows.push(metaWindow);
        }

        this.updateOverview();
    },

    _untrackWorkspace: function() {
        if (this._windowAddedId > 0) {
            this._activeWorkspace.disconnect(this._windowAddedId);
            this._windowAddedId = 0;
        }

        if (this._windowRemovedId > 0) {
            this._activeWorkspace.disconnect(this._windowRemovedId);
            this._windowRemovedId = 0;
        }

        this._activeWorkspace = null;

        this._visibleWindows = 0;

        this._minimizedWindows = [];
        this._knownWindows = [];
    },

    _workspaceSwitched: function(from, to, direction) {
        this._untrackWorkspace();
        this._trackWorkspace(this._metaScreen.get_active_workspace());
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        // Sometimes on startup a pre-mapped window will not be in the system
        // when the code in trackWorkspace has been called.
        // So we add it when it comes in here because it won't get
        // a call to _mapWindow.
        let idx = this._knownWindows.indexOf(metaWindow);
        if (idx == -1) {
            this._knownWindows.push(metaWindow);
            this._visibleWindows += 1;
        }

        this.updateOverview();
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
    },

    _destroyWindow: function(shellwm, actor) {
        // _windowRemoved is called for both visible and minimized windows
        // so we only need to care about tracking it if it
        // hasn't been minimized
        let idx = this._minimizedWindows.indexOf(actor.meta_window);
        if (idx == -1) {
            this._visibleWindows -= 1;
        } else {
            // If it was minimized then remove it from the array
            this._minimizedWindows.splice(idx, 1);
        }

        // Remove the window from our known windows
        idx = this._knownWindows.indexOf(actor.meta_window);
        if (idx != -1) {
            this._knownWindows.splice(idx, 1);
        }

        this.updateOverview();
    },

    _minimizeWindow: function(shellwm, actor) {
        this._visibleWindows -= 1;

        this._minimizedWindows.push (actor.meta_window);

        this.updateOverview();
    },

    _mapWindow: function(shellwm, actor) {
        let idx = this._knownWindows.indexOf(actor.meta_window);
        if (idx != -1) {
            // If the window is already in _knownWindows, then
            // we don't need to deal with it here.
            return;
        }

        this._visibleWindows += 1;

        // mapWindow is called when a window is added to the screen
        // and when a window is unminimized.
        let idx = this._minimizedWindows.indexOf(actor.meta_window);
        if (idx != -1) {
            this._minimizedWindows.splice(idx, 1);
        }

        this.updateOverview();
    },

    updateOverview: function() {
        if (this._visibleWindows == 0) {
            Main.overview.show();
        } else {
            Main.overview.hide();
        }
    }
});
