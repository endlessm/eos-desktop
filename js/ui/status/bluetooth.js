// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const GnomeBluetoothApplet = imports.gi.GnomeBluetoothApplet;
const GnomeBluetooth = imports.gi.GnomeBluetooth;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const NotificationDaemon = imports.ui.notificationDaemon;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Indicator = new Lang.Class({
    Name: 'BTIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('bluetooth-disabled-symbolic', _("Bluetooth"));

        this._applet = new GnomeBluetoothApplet.Applet();

        this._killswitch = new PopupMenu.PopupSwitchMenuItem(_("Bluetooth"), false);
        this._applet.connect('notify::killswitch-state', Lang.bind(this, this._updateKillswitch));
        this._killswitch.connect('toggled', Lang.bind(this, function() {
            let current_state = this._applet.killswitch_state;
            if (current_state != GnomeBluetooth.KillswitchState.HARD_BLOCKED &&
                current_state != GnomeBluetooth.KillswitchState.NO_ADAPTER) {
                this._applet.killswitch_state = this._killswitch.state ?
                    GnomeBluetooth.KillswitchState.UNBLOCKED:
                    GnomeBluetooth.KillswitchState.SOFT_BLOCKED;
            } else
                this._killswitch.setToggleState(false);
        }));

        this._updateKillswitch();
        this.menu.addMenuItem(this._killswitch);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addSettingsAction(_("Bluetooth Settings"), 'gnome-bluetooth-panel.desktop');

        this._applet.connect('pincode-request', Lang.bind(this, this._pinRequest));
        this._applet.connect('confirm-request', Lang.bind(this, this._confirmRequest));
        this._applet.connect('auth-request', Lang.bind(this, this._authRequest));
        this._applet.connect('auth-service-request', Lang.bind(this, this._authServiceRequest));
        this._applet.connect('cancel-request', Lang.bind(this, this._cancelRequest));
    },

    _updateKillswitch: function() {
        let current_state = this._applet.killswitch_state;
        let on = current_state == GnomeBluetooth.KillswitchState.UNBLOCKED;
        let has_adapter = current_state != GnomeBluetooth.KillswitchState.NO_ADAPTER;
        let can_toggle = current_state != GnomeBluetooth.KillswitchState.NO_ADAPTER &&
                         current_state != GnomeBluetooth.KillswitchState.HARD_BLOCKED;

        this._killswitch.setToggleState(on);
        if (can_toggle)
            this._killswitch.setStatus(null);
        else
            /* TRANSLATORS: this means that bluetooth was disabled by hardware rfkill */
            this._killswitch.setStatus(_("hardware disabled"));

        this.actor.visible = has_adapter;

        if (on) {
            this.setIcon('bluetooth-active-symbolic');
        } else {
            this.setIcon('bluetooth-disabled-symbolic');
        }
    },

    _ensureSource: function() {
        if (!this._source) {
            this._source = new MessageTray.Source(_("Bluetooth"), 'bluetooth-active');
            this._source.policy = new NotificationDaemon.NotificationApplicationPolicy('gnome-bluetooth-panel');
            Main.messageTray.add(this._source);
        }
    },

    _authRequest: function(applet, device_path, name, long_name) {
        this._ensureSource();
        this._source.notify(new AuthNotification(this._source, this._applet, device_path, name, long_name));
    },

    _authServiceRequest: function(applet, device_path, name, long_name, uuid) {
        this._ensureSource();
        this._source.notify(new AuthServiceNotification(this._source, this._applet, device_path, name, long_name, uuid));
    },

    _confirmRequest: function(applet, device_path, name, long_name, pin) {
        this._ensureSource();
        this._source.notify(new ConfirmNotification(this._source, this._applet, device_path, name, long_name, pin));
    },

    _pinRequest: function(applet, device_path, name, long_name, numeric) {
        this._ensureSource();
        this._source.notify(new PinNotification(this._source, this._applet, device_path, name, long_name, numeric));
    },

    _cancelRequest: function() {
        this._source.destroy();
    }
});

const AuthNotification = new Lang.Class({
    Name: 'AuthNotification',
    Extends: MessageTray.Notification,

    _init: function(source, applet, device_path, name, long_name) {
        this.parent(source,
                    _("Bluetooth"),
                    _("Authorization request from %s").format(name),
                    { customContent: true });
        this.setResident(true);

        this._applet = applet;
        this._devicePath = device_path;
        this.addBody(_("Device %s wants to pair with this computer").format(long_name));

        this.addButton('allow', _("Allow"));
        this.addButton('deny', _("Deny"));

        this.connect('action-invoked', Lang.bind(this, function(self, action) {
            if (action == 'allow')
                this._applet.agent_reply_confirm(this._devicePath, true);
            else
                this._applet.agent_reply_confirm(this._devicePath, false);
            this.destroy();
        }));
    }
});

const AuthServiceNotification = new Lang.Class({
    Name: 'AuthServiceNotification',
    Extends: MessageTray.Notification,

    _init: function(source, applet, device_path, name, long_name, uuid) {
        this.parent(source,
                    _("Bluetooth"),
                    _("Authorization request from %s").format(name),
                    { customContent: true });
        this.setResident(true);

        this._applet = applet;
        this._devicePath = device_path;
        this.addBody(_("Device %s wants access to the service '%s'").format(long_name, uuid));

        this.addButton('always-grant', _("Always grant access"));
        this.addButton('grant', _("Grant this time only"));
        this.addButton('reject', _("Reject"));

        this.connect('action-invoked', Lang.bind(this, function(self, action) {
            switch (action) {
            case 'always-grant':
                this._applet.agent_reply_auth_service(this._devicePath, true, true);
                break;
            case 'grant':
                this._applet.agent_reply_auth_service(this._devicePath, true, false);
                break;
            case 'reject':
            default:
                this._applet.agent_reply_auth_service(this._devicePath, false, false);
            }
            this.destroy();
        }));
    }
});

const ConfirmNotification = new Lang.Class({
    Name: 'ConfirmNotification',
    Extends: MessageTray.Notification,

    _init: function(source, applet, device_path, name, long_name, pin) {
        this.parent(source,
                    _("Bluetooth"),
                    /* Translators: argument is the device short name */
                    _("Pairing confirmation for %s").format(name),
                    { customContent: true });
        this.setResident(true);

        this._applet = applet;
        this._devicePath = device_path;
        this.addBody(_("Device %s wants to pair with this computer").format(long_name));
        this.addBody(_("Please confirm whether the Passkey '%06d' matches the one on the device.").format(pin));

        /* Translators: this is the verb, not the noun */
        this.addButton('matches', _("Matches"));
        this.addButton('does-not-match', _("Does not match"));

        this.connect('action-invoked', Lang.bind(this, function(self, action) {
            if (action == 'matches')
                this._applet.agent_reply_confirm(this._devicePath, true);
            else
                this._applet.agent_reply_confirm(this._devicePath, false);
            this.destroy();
        }));
    }
});

const PinNotification = new Lang.Class({
    Name: 'PinNotification',
    Extends: MessageTray.Notification,

    _init: function(source, applet, device_path, name, long_name, numeric) {
        this.parent(source,
                    _("Bluetooth"),
                    _("Pairing request for %s").format(name),
                    { customContent: true });
        this.setResident(true);

        this._applet = applet;
        this._devicePath = device_path;
        this._numeric = numeric;
        this.addBody(_("Device %s wants to pair with this computer").format(long_name));
        this.addBody(_("Please enter the PIN mentioned on the device."));

        this._entry = new St.Entry();
        this._entry.connect('key-release-event', Lang.bind(this, function(entry, event) {
            let key = event.get_key_symbol();
            if (key == Clutter.KEY_Return) {
                if (this._canActivateOkButton())
                    this.emit('action-invoked', 'ok');
                return true;
            } else if (key == Clutter.KEY_Escape) {
                this.emit('action-invoked', 'cancel');
                return true;
            }
            return false;
        }));
        this.addActor(this._entry);

        let okButton = this.addButton('ok', _("OK"));
        this.addButton('cancel', _("Cancel"));

        okButton.reactive = this._canActivateOkButton();
        this._entry.clutter_text.connect('text-changed', Lang.bind(this, function() {
            okButton.reactive = this._canActivateOkButton();
        }));

        this.connect('action-invoked', Lang.bind(this, function(self, action) {
            if (action == 'ok') {
                if (this._numeric) {
                    let num = parseInt(this._entry.text, 10);
                    if (isNaN(num)) {
                        // user reply was empty, or was invalid
                        // cancel the operation
                        num = -1;
                    }
                    this._applet.agent_reply_passkey(this._devicePath, num);
                } else
                    this._applet.agent_reply_pincode(this._devicePath, this._entry.text);
            } else {
                if (this._numeric)
                    this._applet.agent_reply_passkey(this._devicePath, -1);
                else
                    this._applet.agent_reply_pincode(this._devicePath, null);
            }
            this.destroy();
        }));
    },

    _canActivateOkButton: function() {
        // PINs have a fixed length of 6
        if (this._numeric)
            return this._entry.clutter_text.text.length == 6;
        else
            return true;
    }
});
