// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Shell = imports.gi.Shell;

const Hash = imports.misc.hash;
const Main = imports.ui.main;

const WorkspaceMonitor = new Lang.Class({
    Name: 'WorkspaceMonitor',

    _init: function() {
        this._trackedApps = new Hash.Map();
        this._visibleApps = new Set();

        this._windowTracker = Shell.WindowTracker.get_default();

        this._shellwm = global.window_manager;
        this._shellwm.connect('minimize', Lang.bind(this, this._minimizeWindow));
        this._shellwm.connect('minimize-completed', Lang.bind(this, this._minimizeWindowCompleted));
        this._shellwm.connect('unminimize', Lang.bind(this, this._unminimizeWindow));
        this._shellwm.connect('map', Lang.bind(this, this._mapWindow));

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

        if (app in this._trackedApps) {
            this._setAppVisible(app, this._appHasVisibleWindows(app));
            this._updateOverview();
        }
    },

    _minimizeWindow: function(shellwm, actor) {
        let app = this._windowTracker.get_window_app(actor.meta_window);

        if (app in this._trackedApps) {
            this._setAppVisible(app, this._appHasVisibleWindows(app));
            if (this._visibleApps.size == 0) {
                Main.layoutManager.prepareForOverview();
            }
        }
    },

    _minimizeWindowCompleted: function(shellwm, actor) {
        let app = this._windowTracker.get_window_app(actor.meta_window);

        if (app in this._trackedApps) {
            this._setAppVisible(app, this._appHasVisibleWindows(app));
        }

        this._updateOverview();
    },

    _unminimizeWindow: function(shellwm, actor) {
        let app = this._windowTracker.get_window_app(actor.meta_window);

        if (app in this._trackedApps ) {
            this._setAppVisible(app, this._appHasVisibleWindows(app));
        }
    },

    _updateOverview: function() {
        if (this._visibleApps.size == 0) {
            Main.overview.showApps();
        } else if (this._inFullscreen) {
            // Hide in fullscreen mode
            Main.overview.hide();
        }
    },

    _trackApp: function(app) {
        if (!(app in this._trackedApps))
            this._trackedApps[app] = app.connect('windows-changed', Lang.bind(this, this._onAppWindowsChanged));
    },

    _untrackApp: function(app) {
        if (app in this._trackedApps) {
            app.disconnect(this._trackedApps[app]);
            delete this._trackedApps[app];
        }
    },

    _setAppVisible: function(app, visible) {
        if (visible)
            this._visibleApps.add(app);
        else
            this._visibleApps.delete(app);
    },

    _onAppStateChange: function(appSystem, app) {
        if (app.get_state() == Shell.AppState.RUNNING) {
            this._trackApp(app);
        }
    },

    _onAppWindowsChanged: function(app) {
        this._setAppVisible(app, this._appHasVisibleWindows(app));

        // We need to track the stopped state here (instead of in _onAppStateChange),
        // and independently from setting an app visible, because there are apps
        // that go into "running" -> "stopped" -> "running" states because of the
        // way they show their windows. This is the case of the Maps (marble) app.
        if (app.get_state() == Shell.AppState.STOPPED) {
            let has_visible_windows = this._appHasVisibleWindows(app);
            this._setAppVisible(app, has_visible_windows);
            if (!has_visible_windows)
                this._untrackApp(app);
        }

        this._updateOverview();
    },

    _appHasVisibleWindows: function(app) {
        let windows = app.get_windows();
        for (let window of windows) {
            // We do not count transient windows because of an issue with Audacity
            // where a transient window was always being counted as visible even
            // though it was minimized
            if (window.get_transient_for())
                continue;

            if (!window.minimized)
                return true;
        }

        return false;
    },

    get visibleWindows() {
        let visible = this._visibleApps.size;

        // Count anything fullscreen as an extra window
        if (this._inFullscreen) {
            visible += 1;
        }
        return visible;
    }
});
