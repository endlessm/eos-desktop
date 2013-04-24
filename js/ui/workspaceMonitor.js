// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Meta = imports.gi.Meta;

const Hash = imports.misc.hash;
const Main = imports.ui.main;

const WorkspaceMonitor = new Lang.Class({
    Name: 'WorkspaceMonitor',

    _init: function() {
        this._metaScreen = global.screen;

        this._minimizedWindows = new Hash.Map();
        this._knownWindows = new Hash.Map();

        this._shellwm = global.window_manager;
        this._shellwm.connect('minimize', Lang.bind(this, this._minimizeWindow));
        this._shellwm.connect('map', Lang.bind(this, this._mapWindow));
        this._shellwm.connect('destroy', Lang.bind(this, this._destroyWindow));

        this._metaScreen.connect('workspace-switched', Lang.bind(this, this._workspaceSwitched));

        this._visibleWindows = 0;

        this._trackWorkspace(this._metaScreen.get_active_workspace());
    },

    _windowIsKnown: function(metaWindow) {
        return this._knownWindows.has(metaWindow);
    },

    _addKnownWindow: function(metaWindow) {
        this._knownWindows.set(metaWindow, true);
    },

    _removeKnownWindow: function(metaWindow) {
        this._knownWindows.delete(metaWindow);
    },

    _windowIsMinimized: function(metaWindow) {
        return this._minimizedWindows.has(metaWindow);
    },

    _addMinimizedWindow: function(metaWindow) {
        this._minimizedWindows.set(metaWindow, true);
    },

    _removeMinimizedWindow: function(metaWindow) {
        this._minimizedWindows.delete(metaWindow);
    },

    _trackWorkspace: function(workspace) {
        this._activeWorkspace = workspace;

        // Setup to listen to the number of windows being changed
        this._windowAddedId = this._activeWorkspace.connect('window-added', Lang.bind(this, this._windowAdded));
        this._windowRemovedId = this._activeWorkspace.connect('window-removed', Lang.bind(this, this._windowRemoved));

        // When we switch workspace or on startup we need to track what
        // windows already exist on the system. Currently we only have
        // one workspace so that isn't a problem.
        let windows = this._activeWorkspace.list_windows();
        for (let i = 0; i < windows.length; i++) {
            let metaWindow = windows[i];

            let added = this._realWindowAdded(metaWindow);
            if (added == false) {
                continue;
            }

            if (metaWindow.minimized) {
                this._addMinimizedWindow(metaWindow);
            } else {
                this._realMapWindow(metaWindow);
            }
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

        this._minimizedWindows = new Hash.Map();
        this._knownWindows = new Hash.Map();
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
            type == Meta.WindowType.DOCK ||
            type == Meta.WindowType.DROPDOWN_MENU ||
            type == Meta.WindowType.POPUP_MENU ||
            type == Meta.WindowType.TOOLTIP ||
            type == Meta.WindowType.NOTIFICATION ||
            type == Meta.WindowType.COMBO ||
            type == Meta.WindowType.DND ||
            type == Meta.WindowType.OVERRIDE_OTHER) {
            return false;
        }

        return true;
    },

    // The sequence of events is
    // Window is mapped but not yet in system: _windowAdded
    // Window is newly created: _windowAdded -> _mapWindow
    // Window is minimized: _minimizeWindow
    // Window is unminimized: _mapWindow
    // Window is closed: _destroyWindow -> _windowRemoved
    // Minimized window is closed: _windowRemoved
    //
    // This allows us to separate the work
    // _windowAdded: Handles tracking of known windows
    //               checks if a window is interesting and adds it to our list
    //               of known windows. Also checks if it is minimized and if so
    //               adds it to the list of minimized windows
    // _windowRemoved: Is the opposite of _windowAdded
    //
    // _mapWindow: Handles tracking of visible windows
    // _minimizeWindow:
    // _destroyWindow: These are the opposite of _mapWindow for the 2 different
    //                 ways a window can be taken off the screen: minimizing and
    //                 closing
    _realWindowAdded: function(metaWindow) {
        if (!this._interestingWindow(metaWindow)) {
            return false;
        }

        this._addKnownWindow(metaWindow);
        return true;
    },

    _windowAdded: function(metaWorkspace, metaWindow) {
        this._realWindowAdded(metaWindow);
    },

    _windowRemoved: function(metaWorkspace, metaWindow) {
        // Remove the window from our known windows
        // Window will not be in knownWindows if it wasn't
        // interesting to us.
        if (!this._windowIsKnown(metaWindow)) {
            return;
        }

        this._removeKnownWindow(metaWindow);

        // This window may also have been minimized
        // but this doesn't affect the visibleWindows count
        if (this._windowIsMinimized(metaWindow)) {
            this._removeMinimizedWindow(metaWindow);
        }
    },

    _destroyWindow: function(shellwm, actor) {
        // _destroyWindow is not called for minimized windows
        // so if the window is in _knownWindows then we handle it
        if (!this._windowIsKnown(actor.meta_window)) {
            return;
        }

        this._visibleWindows -= 1;
        this.updateOverview();
    },

    _minimizeWindow: function(shellwm, actor) {
        if (!this._windowIsKnown(actor.meta_window)) {
            return;
        }

        // Don't handle this window if it's already in the minimized
        // windows hashtable. Something has gone wrong and we've got
        // another minimize event without the window being remapped.
        if (this._windowIsMinimized(actor.meta_window)) {
            this.updateOverview();
            return;
        }


        this._visibleWindows -= 1;

        this._addMinimizedWindow(actor.meta_window);
        this.updateOverview();
    },

    _realMapWindow: function(metaWindow) {
        // If we don't know about it then we don't handle it
        if (!this._windowIsKnown(metaWindow)) {
            return;
        }

        // If the window was minimized remove it
        if (this._windowIsMinimized(metaWindow)) {
            this._removeMinimizedWindow(metaWindow);
        }

        this._visibleWindows += 1;

        this.updateOverview();
    },

    _mapWindow: function(shellwm, actor) {
        this._realMapWindow(actor.meta_window);
    },

    updateOverview: function() {
        // Check if the count has become messed up somehow
        if (this._visibleWindows < 0) {
            this._visibleWindows = 0;
        }

        if (this._visibleWindows == 0) {
            Main.overview.show();
        } else {
            Main.overview.hide();
        }
    }
});
