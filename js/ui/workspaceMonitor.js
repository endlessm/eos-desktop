// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Shell = imports.gi.Shell;

const Hash = imports.misc.hash;
const Main = imports.ui.main;

const WorkspaceMonitor = new Lang.Class({
    Name: 'WorkspaceMonitor',

    _init: function() {
        this._trackedApps = new Set();
        this._visibleApps = new Set();

        this._windowTracker = Shell.WindowTracker.get_default();

        this._shellwm = global.window_manager;
        this._shellwm.connect('minimize', Lang.bind(this, this._windowDisappearing));
        this._shellwm.connect('minimize-completed', Lang.bind(this, this._minimizeWindowCompleted));
        this._shellwm.connect('unminimize', Lang.bind(this, this._unminimizeWindow));
        this._shellwm.connect('map', Lang.bind(this, this._mapWindow));
        this._shellwm.connect('destroy', Lang.bind(this, this._windowDisappearing));
        this._shellwm.connect('destroy-completed', Lang.bind(this, this._destroyCompleted));

        this._metaScreen = global.screen;
        this._metaScreen.connect('in-fullscreen-changed', Lang.bind(this, this._fullscreenChanged));

        let primaryMonitor = Main.layoutManager.primaryMonitor;
        this._inFullscreen = primaryMonitor && primaryMonitor.inFullscreen;

        this._appSystem = Shell.AppSystem.get_default();
        this._appSystem.connect('app-state-changed', Lang.bind(this, this._onAppStateChange));
    },

    _fullscreenChanged: function() {
        let primaryMonitor = Main.layoutManager.primaryMonitor;
        let inFullscreen = primaryMonitor && primaryMonitor.inFullscreen;

        if (this._inFullscreen != inFullscreen) {
            this._inFullscreen = inFullscreen;
            this._updateOverview();
        }
    },

    _mapWindow: function(shellwm, actor) {
        let app = this._windowTracker.get_window_app(actor.meta_window);

        if (this._appIsTracked(app)) {
            this._setAppVisible(app, true);
        }
    },

    _windowDisappearing: function(shellwm, actor) {
        let app = this._windowTracker.get_window_app(actor.meta_window);

        if (this._appIsTracked(app)) {
            this._setAppVisible(app, this._appHasVisibleWindows(app));
            if (this.visibleApps == 0) {
                Main.layoutManager.prepareForOverview();
            }
        }
    },

    _minimizeWindowCompleted: function(shellwm, actor) {
        let app = this._windowTracker.get_window_app(actor.meta_window);
        this._setAppVisible(app, this._appHasVisibleWindows(app));

        this._updateOverview();
    },

    _unminimizeWindow: function(shellwm, actor) {
        let app = this._windowTracker.get_window_app(actor.meta_window);

        if (this._appIsTracked(app)) {
            this._setAppVisible(app, this._appHasVisibleWindows(app));
        }
    },

    _destroyCompleted: function(shellwm, actor) {
        this._updateOverview();
    },

    _updateOverview: function() {
        if (this.visibleApps == 0) {
            // Even if no apps are visible, if there is an app starting up, we
            // do not show the overview as it's likely that a window will be
            // shown. This avoids problems of windows being mapped while the
            // overview is being shown.
            if (!this._hasStartingApps()) {
                Main.overview.showApps();
            }
        } else if (this._inFullscreen) {
            // Hide in fullscreen mode
            Main.overview.hide();
        }
    },

    _trackApp: function(app) {
        this._trackedApps.add(app);
    },

    _untrackApp: function(app) {
        this._trackedApps.delete(app);
    },

    _setAppVisible: function(app, visible) {
        if (visible) {
            this._visibleApps.add(app);
        } else {
            this._visibleApps.delete(app);
        }
    },

    _onAppStateChange: function(appSystem, app) {
        if (app.get_state() == Shell.AppState.STOPPED) {
            this._setAppVisible(app, false);
            this._untrackApp(app);
        } else {
            this._trackApp(app);
        }
    },

    _appHasVisibleWindows: function(app) {
        let windows = app.get_windows();
        for (let window of windows) {
            // We do not count transient windows because of an issue with Audacity
            // where a transient window was always being counted as visible even
            // though it was minimized
            if (window.get_transient_for()) {
                continue;
            }

            if (!window.minimized) {
                return true;
            }
        }

        return false;
    },

    _appIsTracked: function(app) {
        return this._trackedApps.has(app);

    },

    _hasStartingApps: function() {
        for (let app of this._trackedApps) {
            if (app.get_state() == Shell.AppState.STARTING) {
                return true;
            }
        }
        return false;
    },

    get visibleApps() {
        return this._visibleApps.size;
    },

    get visibleWindows() {
        let visible = this.visibleApps;

        // Count anything fullscreen as an extra window
        if (this._inFullscreen) {
            visible += 1;
        }
        return visible;
    }
});
