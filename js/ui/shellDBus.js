// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const EosMetrics = imports.gi.EosMetrics;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const AppActivation = imports.ui.appActivation;
const AppDisplay = imports.ui.appDisplay;
const Config = imports.misc.config;
const ExtensionSystem = imports.ui.extensionSystem;
const ExtensionDownloader = imports.ui.extensionDownloader;
const ExtensionUtils = imports.misc.extensionUtils;
const IconGridLayout = imports.ui.iconGridLayout;
const Main = imports.ui.main;
const Screencast = imports.ui.screencast;
const Screenshot = imports.ui.screenshot;

/* Occurs when an application is installed, meaning added to the desktop's app
 * grid.
 */
const SHELL_APP_ADDED_EVENT = '51640a4e-79aa-47ac-b7e2-d3106a06e129';

const GnomeShellIface = '<node> \
<interface name="org.gnome.Shell"> \
<method name="Eval"> \
    <arg type="s" direction="in" name="script" /> \
    <arg type="b" direction="out" name="success" /> \
    <arg type="s" direction="out" name="result" /> \
</method> \
<method name="FocusSearch"/> \
<method name="ShowOSD"> \
    <arg type="a{sv}" direction="in" name="params"/> \
</method> \
<method name="ShowMonitorLabels"> \
    <arg type="a{uv}" direction="in" name="params" /> \
</method> \
<method name="HideMonitorLabels" /> \
<method name="GrabAccelerator"> \
    <arg type="s" direction="in" name="accelerator"/> \
    <arg type="u" direction="in" name="flags"/> \
    <arg type="u" direction="out" name="action"/> \
</method> \
<method name="GrabAccelerators"> \
    <arg type="a(su)" direction="in" name="accelerators"/> \
    <arg type="au" direction="out" name="actions"/> \
</method> \
<method name="UngrabAccelerator"> \
    <arg type="u" direction="in" name="action"/> \
    <arg type="b" direction="out" name="success"/> \
</method> \
<signal name="AcceleratorActivated"> \
    <arg name="action" type="u" /> \
    <arg name="parameters" type="a{sv}" /> \
</signal> \
<property name="Mode" type="s" access="read" /> \
<property name="OverviewActive" type="b" access="readwrite" /> \
<property name="ShellVersion" type="s" access="read" /> \
</interface> \
</node>';

const ScreenSaverIface = '<node> \
<interface name="org.gnome.ScreenSaver"> \
<method name="Lock"> \
</method> \
<method name="GetActive"> \
    <arg name="active" direction="out" type="b" /> \
</method> \
<method name="SetActive"> \
    <arg name="value" direction="in" type="b" /> \
</method> \
<method name="GetActiveTime"> \
    <arg name="value" direction="out" type="u" /> \
</method> \
<signal name="ActiveChanged"> \
    <arg name="new_value" type="b" /> \
</signal> \
<signal name="ActiveResumed" /> \
</interface> \
</node>';

const GnomeShell = new Lang.Class({
    Name: 'GnomeShellDBus',

    _init: function() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(GnomeShellIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell');

        this._extensionsService = new GnomeShellExtensions();
        this._screencastService = new Screencast.ScreencastService();
        this._screenshotService = new Screenshot.ScreenshotService();
        this._appstoreService = new AppStoreService();
        this._appLauncherService = new AppLauncher();

        this._grabbedAccelerators = new Map();
        this._grabbers = new Map();

        global.display.connect('accelerator-activated', Lang.bind(this,
            function(display, action, deviceid, timestamp) {
                this._emitAcceleratorActivated(action, deviceid, timestamp);
            }));
    },

    /**
     * Eval:
     * @code: A string containing JavaScript code
     *
     * This function executes arbitrary code in the main
     * loop, and returns a boolean success and
     * JSON representation of the object as a string.
     *
     * If evaluation completes without throwing an exception,
     * then the return value will be [true, JSON.stringify(result)].
     * If evaluation fails, then the return value will be
     * [false, JSON.stringify(exception)];
     *
     */
    Eval: function(code) {
        if (!global.settings.get_boolean('development-tools'))
            return [false, null];

        let returnValue;
        let success;
        try {
            returnValue = JSON.stringify(eval(code));
            // A hack; DBus doesn't have null/undefined
            if (returnValue == undefined)
                returnValue = '';
            success = true;
        } catch (e) {
            returnValue = JSON.stringify(e);
            success = false;
        }
        return [success, returnValue];
    },

    FocusSearch: function() {
        Main.overview.focusSearch();
    },

    ShowOSD: function(params) {
        for (let param in params)
            params[param] = params[param].deep_unpack();

        let icon = null;
        if (params['icon'])
            icon = Gio.Icon.new_for_string(params['icon']);

        Main.osdWindow.setIcon(icon);
        Main.osdWindow.setLabel(params['label']);
        Main.osdWindow.setLevel(params['level']);

        Main.osdWindow.show();
    },

    GrabAcceleratorAsync: function(params, invocation) {
        let [accel, flags] = params;
        let sender = invocation.get_sender();
        let bindingAction = this._grabAcceleratorForSender(accel, flags, sender);
        return invocation.return_value(GLib.Variant.new('(u)', [bindingAction]));
    },

    GrabAcceleratorsAsync: function(params, invocation) {
        let [accels] = params;
        let sender = invocation.get_sender();
        let bindingActions = [];
        for (let i = 0; i < accels.length; i++) {
            let [accel, flags] = accels[i];
            bindingActions.push(this._grabAcceleratorForSender(accel, flags, sender));
        }
        return invocation.return_value(GLib.Variant.new('(au)', [bindingActions]));
    },

    UngrabAcceleratorAsync: function(params, invocation) {
        let [action] = params;
        let grabbedBy = this._grabbedAccelerators.get(action);
        if (invocation.get_sender() != grabbedBy)
            return invocation.return_value(GLib.Variant.new('(b)', [false]));

        let ungrabSucceeded = global.display.ungrab_accelerator(action);
        if (ungrabSucceeded)
            this._grabbedAccelerators.delete(action);
        return invocation.return_value(GLib.Variant.new('(b)', [ungrabSucceeded]));
    },

    _emitAcceleratorActivated: function(action, deviceid, timestamp) {
        let destination = this._grabbedAccelerators.get(action);
        if (!destination)
            return;

        let connection = this._dbusImpl.get_connection();
        let info = this._dbusImpl.get_info();
        let params = { 'device-id': GLib.Variant.new('u', deviceid),
                       'timestamp': GLib.Variant.new('u', timestamp),
                       'action-mode': GLib.Variant.new('u', Main.keybindingMode) };
        connection.emit_signal(destination,
                               this._dbusImpl.get_object_path(),
                               info ? info.name : null,
                               'AcceleratorActivated',
                               GLib.Variant.new('(ua{sv})', [action, params]));
    },

    _grabAcceleratorForSender: function(accelerator, flags, sender) {
        let bindingAction = global.display.grab_accelerator(accelerator);
        if (bindingAction == Meta.KeyBindingAction.NONE)
            return Meta.KeyBindingAction.NONE;

        let bindingName = Meta.external_binding_name_for_action(bindingAction);
        Main.wm.allowKeybinding(bindingName, flags);

        this._grabbedAccelerators.set(bindingAction, sender);

        if (!this._grabbers.has(sender)) {
            let id = Gio.bus_watch_name(Gio.BusType.SESSION, sender, 0, null,
                                        Lang.bind(this, this._onGrabberBusNameVanished));
            this._grabbers.set(sender, id);
        }

        return bindingAction;
    },

    _ungrabAccelerator: function(action) {
        let ungrabSucceeded = global.display.ungrab_accelerator(action);
        if (ungrabSucceeded)
            this._grabbedAccelerators.delete(action);
    },

    _onGrabberBusNameVanished: function(connection, name) {
        let grabs = this._grabbedAccelerators.entries();
        for (let [action, sender] of grabs) {
            if (sender == name)
                this._ungrabAccelerator(action);
        }
        Gio.bus_unwatch_name(this._grabbers.get(name));
        this._grabbers.delete(name);
    },

    ShowMonitorLabelsAsync: function(params, invocation) {
        let sender = invocation.get_sender();
        let [dict] = params;
        Main.osdMonitorLabeler.show(sender, dict);
    },

    HideMonitorLabelsAsync: function(params, invocation) {
        let sender = invocation.get_sender();
        Main.osdMonitorLabeler.hide(sender);
    },


    Mode: global.session_mode,

    get OverviewActive() {
        return Main.overview.visible;
    },

    set OverviewActive(visible) {
        if (visible)
            Main.overview.show();
        else
            Main.overview.hide();
    },

    ShellVersion: Config.PACKAGE_VERSION
});

const GnomeShellExtensionsIface = '<node> \
<interface name="org.gnome.Shell.Extensions"> \
<method name="ListExtensions"> \
    <arg type="a{sa{sv}}" direction="out" name="extensions" /> \
</method> \
<method name="GetExtensionInfo"> \
    <arg type="s" direction="in" name="extension" /> \
    <arg type="a{sv}" direction="out" name="info" /> \
</method> \
<method name="GetExtensionErrors"> \
    <arg type="s" direction="in" name="extension" /> \
    <arg type="as" direction="out" name="errors" /> \
</method> \
<signal name="ExtensionStatusChanged"> \
    <arg type="s" name="uuid"/> \
    <arg type="i" name="state"/> \
    <arg type="s" name="error"/> \
</signal> \
<method name="InstallRemoteExtension"> \
    <arg type="s" direction="in" name="uuid"/> \
    <arg type="s" direction="out" name="result"/> \
</method> \
<method name="UninstallExtension"> \
    <arg type="s" direction="in" name="uuid"/> \
    <arg type="b" direction="out" name="success"/> \
</method> \
<method name="LaunchExtensionPrefs"> \
    <arg type="s" direction="in" name="uuid"/> \
</method> \
<method name="ReloadExtension"> \
    <arg type="s" direction="in" name="uuid"/> \
</method> \
<method name="CheckForUpdates"> \
</method> \
<property name="ShellVersion" type="s" access="read" /> \
</interface> \
</node>';

const GnomeShellExtensions = new Lang.Class({
    Name: 'GnomeShellExtensionsDBus',

    _init: function() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(GnomeShellExtensionsIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell');
        ExtensionSystem.connect('extension-state-changed',
                                Lang.bind(this, this._extensionStateChanged));
    },


    ListExtensions: function() {
        let out = {};
        for (let uuid in ExtensionUtils.extensions) {
            let dbusObj = this.GetExtensionInfo(uuid);
            out[uuid] = dbusObj;
        }
        return out;
    },

    GetExtensionInfo: function(uuid) {
        let extension = ExtensionUtils.extensions[uuid];
        if (!extension)
            return {};

        let obj = {};
        Lang.copyProperties(extension.metadata, obj);

        // Only serialize the properties that we actually need.
        const serializedProperties = ["type", "state", "path", "error", "hasPrefs"];

        serializedProperties.forEach(function(prop) {
            obj[prop] = extension[prop];
        });

        let out = {};
        for (let key in obj) {
            let val = obj[key];
            let type;
            switch (typeof val) {
            case 'string':
                type = 's';
                break;
            case 'number':
                type = 'd';
                break;
            case 'boolean':
                type = 'b';
                break;
            default:
                continue;
            }
            out[key] = GLib.Variant.new(type, val);
        }

        return out;
    },

    GetExtensionErrors: function(uuid) {
        let extension = ExtensionUtils.extensions[uuid];
        if (!extension)
            return [];

        if (!extension.errors)
            return [];

        return extension.errors;
    },

    InstallRemoteExtensionAsync: function([uuid], invocation) {
        return ExtensionDownloader.installExtension(uuid, invocation);
    },

    UninstallExtension: function(uuid) {
        return ExtensionDownloader.uninstallExtension(uuid);
    },

    LaunchExtensionPrefs: function(uuid) {
        let appSys = Shell.AppSystem.get_default();
        let app = appSys.lookup_app('gnome-shell-extension-prefs.desktop');
        app.launch(global.display.get_current_time_roundtrip(),
                   ['extension:///' + uuid], -1, null);
    },

    ReloadExtension: function(uuid) {
        let extension = ExtensionUtils.extensions[uuid];
        if (!extension)
            return;

        ExtensionSystem.reloadExtension(extension);
    },

    CheckForUpdates: function() {
        ExtensionDownloader.checkForUpdates();
    },

    ShellVersion: Config.PACKAGE_VERSION,

    _extensionStateChanged: function(_, newState) {
        this._dbusImpl.emit_signal('ExtensionStatusChanged',
                                   GLib.Variant.new('(sis)', [newState.uuid, newState.state, newState.error]));
    }
});

const ScreenSaverDBus = new Lang.Class({
    Name: 'ScreenSaverDBus',

    _init: function(screenShield) {
        this.parent();

        this._screenShield = screenShield;
        screenShield.connect('active-changed', Lang.bind(this, function(shield) {
            this._dbusImpl.emit_signal('ActiveChanged', GLib.Variant.new('(b)', [shield.active]));
        }));

        screenShield.connect('active-resumed', Lang.bind(this, function() {
            this._dbusImpl.emit_signal('ActiveResumed', GLib.Variant.new('()', []));
        }));

        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(ScreenSaverIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/ScreenSaver');

        Gio.DBus.session.own_name('org.gnome.ScreenSaver', Gio.BusNameOwnerFlags.REPLACE, null, null);
    },

    Lock: function() {
        this._screenShield.lock(true);
    },

    SetActive: function(active) {
        if (active)
            this._screenShield.activate(true);
        else
            this._screenShield.unlock(false);
    },

    GetActive: function() {
        return this._screenShield.active;
    },

    GetActiveTime: function() {
        let started = this._screenShield.activationTime;
        if (started > 0)
            return Math.floor((GLib.get_monotonic_time() - started) / 1000000);
        else
            return 0;
    },
});

const AppStoreIface = '<node> \
<interface name="org.gnome.Shell.AppStore"> \
<method name="AddApplication"> \
    <arg type="s" direction="in" name="id" /> \
</method> \
<method name="RemoveApplication"> \
    <arg type="s" direction="in" name="id" /> \
</method> \
<method name="ListApplications"> \
    <arg type="as" direction="out" name="applications" /> \
</method> \
<method name="AddFolder"> \
    <arg type="s" direction="in" name="id" /> \
</method> \
<method name="RemoveFolder"> \
    <arg type="s" direction="in" name="id" /> \
</method> \
<method name="ResetDesktop"> \
</method> \
<signal name="ApplicationsChanged"> \
    <arg type="as" name="applications" /> \
</signal> \
</interface> \
</node>';

const AppStoreService = new Lang.Class({
    Name: 'AppStoreServiceDBus',

    _init: function() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(AppStoreIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell');

        IconGridLayout.layout.connect('changed', Lang.bind(this, this._emitApplicationsChanged));
    },

    AddApplication: function(id) {
        let eventRecorder = EosMetrics.EventRecorder.get_default();
        let appId = new GLib.Variant('s', id);
        eventRecorder.record_event(SHELL_APP_ADDED_EVENT, appId);

        if (!IconGridLayout.layout.iconIsFolder(id)) {
            IconGridLayout.layout.appendIcon(id, IconGridLayout.DESKTOP_GRID_ID);
        }
    },

    RemoveApplication: function(id) {
        if (!IconGridLayout.layout.iconIsFolder(id)) {
            IconGridLayout.layout.removeIcon(id, false);
        }
    },

    AddFolder: function(id) {
        if (IconGridLayout.layout.iconIsFolder(id)) {
            IconGridLayout.layout.appendIcon(id, IconGridLayout.DESKTOP_GRID_ID);
        }
    },

    RemoveFolder: function(id) {
        if (IconGridLayout.layout.iconIsFolder(id)) {
            IconGridLayout.layout.removeIcon(id, false);
        }
    },

    ResetDesktop: function() {
        IconGridLayout.layout.resetDesktop();
    },

    ListApplicationsAsync: function(params, invocation) {
        let allApps = IconGridLayout.layout.listApplications();
        return invocation.return_value(GLib.Variant.new('(as)', [allApps]));
    },

    _emitApplicationsChanged: function() {
        let allApps = IconGridLayout.layout.listApplications();
        this._dbusImpl.emit_signal('ApplicationsChanged', GLib.Variant.new('(as)', [allApps]));
    }
});

const AppLauncherIface = '<node> \
<interface name="org.gnome.Shell.AppLauncher"> \
<method name="Launch"> \
    <arg type="s" direction="in" name="name" /> \
    <arg type="u" direction="in" name="timestamp" /> \
    <arg type="b" direction="out" name="success" /> \
</method> \
</interface> \
</node>';

const AppLauncher = new Lang.Class({
    Name: 'AppLauncherDBus',

    _init: function() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(AppLauncherIface, this);
        this._dbusImpl.export(Gio.DBus.session, '/org/gnome/Shell');

        this._appSys = Shell.AppSystem.get_default();
    },

    Launch: function(name, timestamp) {
        if (name == 'eos-app-store') {
            Main.appStore.show(timestamp, true);
            return true;
        }

        let appName = name;
        if (!appName.endsWith('.desktop'))
            appName += '.desktop';

        let app = this._appSys.lookup_app(appName);
        if (!app) {
            log('Unable to launch app ' + appName + ': Not installed');
            return false;
        }

        let activationContext = new AppActivation.AppActivationContext(app);
        activationContext.activate(null, timestamp);

        Main.appStore.appLaunched = true;
        return true;
    }
});
