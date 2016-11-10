// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Signals = imports.signals;

const FileUtils = imports.misc.fileUtils;
const Main = imports.ui.main;
const Params = imports.misc.params;

const DEFAULT_MODE = 'restrictive';

const _modes = {
    'restrictive': {
        parentMode: null,
        stylesheetName: 'gnome-shell.css',
        hasOverview: false,
        showCalendarEvents: false,
        allowSettings: false,
        allowExtensions: false,
        allowScreencast: false,
        enabledExtensions: [],
        hasRunDialog: false,
        hasWorkspaces: false,
        hasWindows: false,
        hasNotifications: false,
        isLocked: false,
        isGreeter: false,
        isPrimary: false,
        unlockDialog: null,
        components: [],
        panel: {
            left: [],
            right: []
        },
        panelStyle: null
    },

    'gdm': {
        hasNotifications: true,
        isGreeter: true,
        isPrimary: true,
        unlockDialog: imports.gdm.loginDialog.LoginDialog,
        components: ['polkitAgent'],
        panel: {
            left: ['logo'],
            right: ['a11yGreeter', 'keyboard', 'aggregateMenu', 'panelSeparator2', 'dateMenu']
        },
        panelStyle: 'login-screen'
    },

    // Note: since the user menu now simply has the settings icon,
    // it does not make sense to display it as part of the
    // lock screen or the unlock dialog.
    'unlock-dialog': {
        isLocked: true,
        unlockDialog: undefined,
        components: ['polkitAgent'],
        panel: {
            left: [],
            right: ['aggregateMenu', 'panelSeparator2', 'dateMenu']
        },
        panelStyle: 'unlock-screen'
    },

    'initial-setup': {
        hasWindows: true,
        isPrimary: true,
        components: [ 'networkAgent', 'keyring'],
        panel: {
            left: [],
            right: ['dateMenu', 'a11yGreeter', 'keyboard', 'volume', 'battery']
        }
    },

    'user': {
        hasOverview: true,
        showCalendarEvents: true,
        allowSettings: true,
        allowExtensions: true,
        allowScreencast: true,
        hasRunDialog: true,
        hasWorkspaces: true,
        hasWindows: true,
        hasNotifications: true,
        isLocked: false,
        isPrimary: true,
        unlockDialog: imports.ui.unlockDialog.UnlockDialog,
        components: ['networkAgent', 'polkitAgent',
                     'keyring', 'autorunManager', 'automountManager',
                     'updaterManager', 'socialBar', 'appStore'],
        panel: {
            left: ['showApps', 'panelSeparator', 'appIcons'],
            right: ['a11y', 'keyboard', 'aggregateMenu', 'panelSeparator2', 'dateMenu', 'hotCornerIndicator']
        }
    },

    'user-coding': {
        hasOverview: true,
        showCalendarEvents: true,
        allowSettings: true,
        allowExtensions: true,
        allowScreencast: true,
        hasRunDialog: true,
        hasWorkspaces: true,
        hasWindows: true,
        hasNotifications: true,
        isLocked: false,
        isPrimary: true,
        unlockDialog: imports.ui.unlockDialog.UnlockDialog,
        components: ['networkAgent', 'polkitAgent',
                     'keyring', 'autorunManager', 'automountManager',
                     'updaterManager', 'socialBar', 'appStore', 'codingManager', 'codingGameService'],
        panel: {
            left: ['userMenu', 'panelSeparator', 'appIcons'],
            right: ['dateMenu', 'a11y', 'keyboard', 'volume', 'bluetooth',
                    'network', 'battery', 'codingGame',
                    'socialBar', 'hotCornerIndicator']
        }
    }
};

function _getModes(modesLoadedCallback) {
    FileUtils.collectFromDatadirsAsync('modes',
                                       { processFile: _loadMode,
                                         loadedCallback: modesLoadedCallback,
                                         data: _modes });
}

function _loadMode(file, info, loadedData) {
    let name = info.get_name();
    let suffix = name.indexOf('.json');
    let modeName = suffix == -1 ? name : name.slice(name, suffix);

    if (loadedData.hasOwnProperty(modeName))
        return;

    let fileContent, success, tag, newMode;
    try {
        [success, fileContent, tag] = file.load_contents(null);
        newMode = JSON.parse(fileContent);
    } catch(e) {
        return;
    }

    loadedData[modeName] = {};
    let propBlacklist = ['unlockDialog'];
    for (let prop in loadedData[DEFAULT_MODE]) {
        if (newMode[prop] !== undefined &&
            propBlacklist.indexOf(prop) == -1)
            loadedData[modeName][prop]= newMode[prop];
    }
    loadedData[modeName]['isPrimary'] = true;
}

function listModes() {
    _getModes(function(modes) {
        let names = Object.getOwnPropertyNames(modes);
        for (let i = 0; i < names.length; i++)
            if (_modes[names[i]].isPrimary)
                print(names[i]);
        Mainloop.quit('listModes');
    });
    Mainloop.run('listModes');
}

const SessionMode = new Lang.Class({
    Name: 'SessionMode',

    init: function() {
        _getModes(Lang.bind(this, function(modes) {
            this._modes = modes;
            let primary = modes[global.session_mode] &&
                          modes[global.session_mode].isPrimary;
            let mode = primary ? global.session_mode : 'user';

            if (mode == 'user' &&
                global.settings.get_boolean('enable-coding-game'))
                mode = 'user-coding';

            this._modeStack = [mode];
            this._sync();

            this.emit('sessions-loaded');
        }));
    },

    pushMode: function(mode) {
        this._modeStack.push(mode);
        this._sync();
    },

    popMode: function(mode) {
        if (this.currentMode != mode || this._modeStack.length === 1)
            throw new Error("Invalid SessionMode.popMode");
        this._modeStack.pop();
        this._sync();
    },

    switchMode: function(to) {
        if (this.currentMode == to)
            return;
        this._modeStack[this._modeStack.length - 1] = to;
        this._sync();
    },

    get currentMode() {
        return this._modeStack[this._modeStack.length - 1];
    },

    _sync: function() {
        let params = this._modes[this.currentMode];
        let defaults;
        if (params.parentMode)
            defaults = Params.parse(this._modes[params.parentMode],
                                    this._modes[DEFAULT_MODE]);
        else
            defaults = this._modes[DEFAULT_MODE];
        params = Params.parse(params, defaults);

        // A simplified version of Lang.copyProperties, handles
        // undefined as a special case for "no change / inherit from previous mode"
        for (let prop in params) {
            if (params[prop] !== undefined)
                this[prop] = params[prop];
        }

        this.emit('updated');
    }
});
Signals.addSignalMethods(SessionMode.prototype);
