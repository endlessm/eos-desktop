// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Meta = imports.gi.Meta;

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

        //global.log('Start up: visibleWindows: ' + this._visibleWindows);
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

            if (!this._interestingWindow(metaWindow)) {
                continue;
            }

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

    _interestingWindow: function(metaWindow) {
        // If this window isn't interesting to us, then we
        // can ditch it
        let type = metaWindow.get_window_type();
        if (type == Meta.WindowType.DESKTOP ||
            type == Meta.WindowType.DOCK) {
            global.log('Uninteresting window: ignoring');
            return false;
        }

        global.log('Interesting window');
        return true;
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        if (!this._interestingWindow(metaWindow)) {
            return;
        }

        // Sometimes on startup a pre-mapped window will not be in the system
        // when the code in trackWorkspace has been called.
        // So we add it when it comes in here because it won't get
        // a call to _mapWindow.
        let knownIdx = this._knownWindows.indexOf(metaWindow);
        let minimizedIdx = this._minimizedWindows.indexOf(metaWindow);

        if (knownIdx != -1 && minimizedIdx == -1) {
            // If the window is already in _knownWindows,
            // and it's not minimized, then
            // we don't need to deal with it here.
            return;
        }

        if (metaWindow.minimized) {
            this._minimizedWindows.push(metaWindow);
        } else {
            this._visibleWindows += 1;
        }

        if (knownIdx == -1) {
            this._knownWindows.push(metaWindow);
        }

        //global.log('_windowAdded called for unknown window: ' + metaWindow.get_title());
        //global.log('   _knownWindows: ' + this._knownWindows.length);
        //global.log('   _visibleWindows: ' + this._visibleWindows);

        this.updateOverview();
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        //global.log('_windowRemoved called for window: ' + metaWindow.get_title());
        //global.log('   _visibleWindows: ' + this._visibleWindows);
    },

    _destroyWindow: function(shellwm, actor) {
        if (!this._interestingWindow(actor.meta_window)) {
            return;
        }

        // _windowRemoved is called for both visible and minimized windows
        // so we only need to care about tracking it if it
        // hasn't been minimized
        let idx = this._minimizedWindows.indexOf(actor.meta_window);
        if (idx == -1) {
            this._visibleWindows -= 1;

            if (this._visibleWindows < 0) {
                global.log('WARNING: _visibleWindows == ' + this._visibleWindows + ' in _destroyWindow. Resetting to 0');
                this._visibleWindows = 0;

                this._dumpMinimizedWindows();
            } else {
                //global.log('_destroyWindow called for window: ' + actor.meta_window.get_title());
                //global.log('   _visibleWindows: ' + this._visibleWindows);
            }
        } else {
            //global.log('_destroyWindow called for minimized window: ' + actor.meta_window.get_title());
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
        if (!this._interestingWindow(actor.meta_window)) {
            return;
        }

        // Don't handle this window if it's already in the minimized
        // windows array. Something has gone wrong and we've got
        // another minimize event without the window being remapped.
        let idx = this._minimizedWindows.indexOf(actor.meta_window);
        if (idx != -1) {
            //global.log('_minimizeWindow called for already minimized window: ' + actor.meta_window.get_title());

            this.updateOverview();
            return;
        }

        //global.log('_minimizedWindow called for non-minimized window: ' + actor.meta_window.get_title());

        this._visibleWindows -= 1;

        //global.log ('   _visibleWindows: ' + this._visibleWindows);

        this._minimizedWindows.push (actor.meta_window);

        if (this._visibleWindows < 0) {
            global.log('WARNING: _visibleWindows == ' + this._visibleWindows + ' in _minimizeWindow. Resetting to 0');
            this._visibleWindows = 0;

            this._dumpMinimizedWindows();
        }

        this.updateOverview();
    },

    _mapWindow: function(shellwm, actor) {
        if (!this._interestingWindow(actor.meta_window)) {
            return;
        }

        //global.log('_mapWindow called for window: ' + actor.meta_window.get_title());
        let knownIdx = this._knownWindows.indexOf(actor.meta_window);
        let minimizedIdx = this._minimizedWindows.indexOf(actor.meta_window);
        if (knownIdx != -1 && minimizedIdx == -1) {
            // If the window is already in _knownWindows,
            // and it's not minimized, then
            // we don't need to deal with it here.

            //global.log('Got map for known but not minimized window: ' + actor.meta_window.get_title());
            //global.log('   Ignoring');

            return;
        }

        this._visibleWindows += 1;

        //global.log('   _visibleWindows: ' + this._visibleWindows);
        if (knownIdx == -1) {
            this._knownWindows.push(actor.meta_window);
        }

        // mapWindow is called when a window is added to the screen
        // and when a window is unminimized.
        if (minimizedIdx != -1) {
            this._minimizedWindows.splice(minimizedIdx, 1);
        }

        this.updateOverview();
    },

    updateOverview: function() {
        if (this._visibleWindows <= 0) {
            Main.overview.show();
        } else {
            Main.overview.hide();
        }
    },

    _dumpMinimizedWindows: function() {
        global.log('Dumping Minimized Windows: - ' + this._minimizedWindows.length);
        for (let i = 0; i < this._minimizedWindows.length; i++) {
            let w = this._minimizedWindows[i];
            global.log('   ' + w.get_title());
        }
    }
});
