// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;

const GnomeSession = imports.misc.gnomeSession;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;

const UpdaterIface =
    <interface name="org.gnome.OSTree">
      <method name="Poll" ></method>
      <method name="Fetch"></method>
      <method name="Apply"></method>

      <property name="State"            type="u" access="read"/>
      <property name="UpdateID"         type="s" access="read"/>
      <property name="CurrentID"        type="s" access="read"/>
      <property name="UpdateLabel"      type="s" access="read"/>
      <property name="UpdateMessage"    type="s" access="read"/>
      <property name="DownloadSize"     type="x" access="read"/>
      <property name="DownloadedBytes"  type="x" access="read"/>
      <property name="UnpackedSize"     type="x" access="read"/>
      <property name="FullDownloadSize" type="x" access="read"/>
      <property name="FullUnpackedSize" type="x" access="read"/>
      <property name="ErrorCode"        type="u" access="read"/>
      <property name="ErrorMessage"     type="s" access="read"/>

      <signal name="StateChanged">
        <arg type="u" name="state"/>
      </signal>

      <signal name="Progress">
        <arg type="x" name="fetched"/>
        <arg type="x" name="expected"/>
      </signal>
    </interface>;

const UpdaterState = {
    NONE: 0,
    READY: 1,
    ERROR: 2,
    POLLING: 3,
    UPDATE_AVAILABLE: 4,
    FETCHING: 5,
    UPDATE_READY: 6,
    APPLYING_UPDATE: 7,
    UPDATE_APPLIED: 8
};

const UpdaterStep = {
    NONE: 0,
    POLL: 1,
    FETCH: 2,
    APPLY: 3
};
const AUTO_UPDATES_DEFAULT_STEP = UpdaterStep.POLL;

const AUTO_UPDATES_GROUP_NAME = 'Automatic Updates';
const AUTO_UPDATES_LAST_STEP_KEY = 'LastAutomaticStep';

const UpdaterNotification = new Lang.Class({
    Name: 'UpdaterNotification',
    Extends: MessageTray.Notification,

    _init: function(source, title, banner) {
        this.parent(source, title, banner);

        this.setResident(true);
        this.setUrgency(MessageTray.Urgency.CRITICAL);
    }
});

const UpdaterProxy = Gio.DBusProxy.makeProxyWrapper(UpdaterIface);

const UpdaterManager = new Lang.Class({
    Name: 'UpdaterManager',

    _init: function() {
        this._proxy = new UpdaterProxy(Gio.DBus.system, 'org.gnome.OSTree',
                                       '/org/gnome/OSTree', Lang.bind(this, this._onProxyConstructed));

        this._session = new GnomeSession.SessionManager();

        this._config = new GLib.KeyFile();
        this._lastAutoStep = AUTO_UPDATES_DEFAULT_STEP;

        this._constructed = false;
        this._enabled = false;
        this._notification = null;
        this._source = null;
        this._proxyChangedId = 0;

        try {
            this._config.load_from_file('/etc/eos-updater.conf',
                                        GLib.KeyFileFlags.NONE);
            this._lastAutoStep = this._config.get_integer(AUTO_UPDATES_GROUP_NAME,
                                                          AUTO_UPDATES_LAST_STEP_KEY);
        } catch (e) {
            // don't spam if the file doesn't exist
            if (!e.matches(GLib.FileError, GLib.FileError.NOENT)) {
                logError(e, 'Can\'t load updater configuration');
            }
        }
    },

    enable: function() {
        this._proxyChangedId = this._proxy.connect('g-properties-changed', Lang.bind(this, this._onPropertiesChanged));
        this._enabled = true;

        if (this._constructed) {
            this._onStateChanged();
        }
    },

    disable: function() {
        if (this._proxyChangedId > 0) {
            this._proxy.disconnect(this._proxyChangedId);
            this._proxyChangedId = 0;
        }

        this._enabled = false;
    },

    _onProxyConstructed: function() {
        this._constructed = true;

        if (this._enabled) {
            this._onStateChanged();
        }
    },

    _onPropertiesChanged: function(proxy, changedProps, invalidatedProps) {
        let propsDict = changedProps.deep_unpack();
        if (propsDict.hasOwnProperty('State')) {
            this._onStateChanged();
        }
    },

    _onStateChanged: function() {
        let state = this._proxy.State;
        if (state == UpdaterState.UPDATE_AVAILABLE) {
            this._notifyUpdateAvailable();
        } else if (state == UpdaterState.UPDATE_READY) {
            this._notifyUpdateReady();
        } else if (state == UpdaterState.UPDATE_APPLIED) {
            this._notifyUpdateApplied();
        }
    },

    _onActionInvoked: function(notification, actionId) {
        if (actionId == 'download-updates') {
            this._proxy.FetchRemote();
        } else if (actionId == 'apply-updates') {
            this._proxy.ApplyRemote();
        } else if (actionId == 'restart-updates') {
            this._session.RebootRemote();
        }
    },

    _sendNotification: function() {
        this._notification.connect('action-invoked', Lang.bind(this, this._onActionInvoked));
        this._source.notify(this._notification);
    },

    _ensureSource: function() {
        if (this._notification) {
            this._notification.destroy();
        }

        if (this._source) {
            return;
        }

        this._source = new MessageTray.Source(_("Software Update"),
                                              'software-update-available-symbolic');
        this._source.connect('destroy', Lang.bind(this, function() {
            this._source = null;
        }));
        Main.messageTray.add(this._source);
    },

    _notifyUpdateAvailable: function() {
        if (this._lastAutoStep > UpdaterStep.POLL) {
            return;
        }

        this._ensureSource();

        this._notification = new UpdaterNotification(this._source,
            _("Updates available"),
            _("Software updates are available for your system"));
        this._notification.addButton('download-updates', _("Download now"));

        this._sendNotification();
    },

    _notifyUpdateReady: function() {
        if (this._lastAutoStep > UpdaterStep.FETCH) {
            return;
        }

        this._ensureSource();

        this._notification = new UpdaterNotification(this._source,
            _("Updates ready"),
            _("Software updates are ready to be installed on your system"));
        this._notification.addButton('apply-updates', _("Install now"));

        this._sendNotification();
    },

    _notifyUpdateApplied: function() {
        this._ensureSource();

        this._notification = new UpdaterNotification(this._source,
            _("Updates installed"),
            _("Software updates were installed on your system"));
        this._notification.addButton('restart-updates', _("Restart now"));

        this._sendNotification();
    }
});
const Component = UpdaterManager;
