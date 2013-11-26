// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GnomeBluetoothApplet = imports.gi.GnomeBluetoothApplet;
const GnomeBluetooth = imports.gi.GnomeBluetooth;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const NotificationDaemon = imports.ui.notificationDaemon;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const BUS_NAME = 'org.gnome.SettingsDaemon.Rfkill';
const OBJECT_PATH = '/org/gnome/SettingsDaemon/Rfkill';

const RfkillManagerInterface = '<node> \
<interface name="org.gnome.SettingsDaemon.Rfkill"> \
<property name="BluetoothAirplaneMode" type="b" access="readwrite" /> \
</interface> \
</node>';

const RfkillManagerProxy = Gio.DBusProxy.makeProxyWrapper(RfkillManagerInterface);

const Indicator = new Lang.Class({
    Name: 'BTIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('bluetooth-disabled-symbolic', _("Bluetooth"));

        this._applet = new GnomeBluetoothApplet.Applet();
        this._proxy = new RfkillManagerProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH,
                                             Lang.bind(this, function(proxy, error) {
                                                 if (error) {
                                                     log(error.message);
                                                     return;
                                                 }
                                             }));

        this._killswitch = new PopupMenu.PopupSwitchMenuItem(_("Bluetooth"), false);
        this._applet.connect('notify::killswitch-state', Lang.bind(this, this._updateKillswitch));
        this._killswitch.connect('toggled', Lang.bind(this, function() {
            this._proxy.BluetoothAirplaneMode = !this._killswitch.state;
        }));

        this._updateKillswitch();
        this.menu.addMenuItem(this._killswitch);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addSettingsAction(_("Bluetooth Settings"), 'gnome-bluetooth-panel.desktop');
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
});
