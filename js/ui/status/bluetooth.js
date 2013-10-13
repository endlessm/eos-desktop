// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GnomeBluetooth = imports.gi.GnomeBluetooth;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const BUS_NAME = 'org.gnome.SettingsDaemon.Rfkill';
const OBJECT_PATH = '/org/gnome/SettingsDaemon/Rfkill';

const RfkillManagerInterface = '<node> \
<interface name="org.gnome.SettingsDaemon.Rfkill"> \
<property name="BluetoothAirplaneMode" type="b" access="readwrite" /> \
<property name="BluetoothHardwareAirplaneMode" type="b" access="read" /> \
</interface> \
</node>';

const RfkillManagerProxy = Gio.DBusProxy.makeProxyWrapper(RfkillManagerInterface);

const Indicator = new Lang.Class({
    Name: 'BTIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('bluetooth-disabled-symbolic', _("Bluetooth"));

        this._proxy = new RfkillManagerProxy(Gio.DBus.session, BUS_NAME, OBJECT_PATH,
                                             Lang.bind(this, function(proxy, error) {
                                                 if (error) {
                                                     log(error.message);
                                                     return;
                                                 }
                                             }));
        this._proxy.connect('g-properties-changed', Lang.bind(this, this._sync));

        this._killswitch = new PopupMenu.PopupSwitchMenuItem(_("Bluetooth"), false);
        this._killswitch.connect('toggled', Lang.bind(this, function() {
            this._proxy.BluetoothAirplaneMode = !this._killswitch.state;
        }));

        this.menu.addMenuItem(this._killswitch);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addSettingsAction(_("Bluetooth Settings"), 'gnome-bluetooth-panel.desktop');

        this._client = new GnomeBluetooth.Client();
        this._model = this._client.get_model();
        this._model.connect('row-changed', Lang.bind(this, this._sync));
        this._model.connect('row-deleted', Lang.bind(this, this._sync));
        this._model.connect('row-inserted', Lang.bind(this, this._sync));
        this._sync();
    },

    _getDefaultAdapter: function() {
        let [ret, iter] = this._model.get_iter_first();
        while (ret) {
            let isDefault = this._model.get_value(iter,
                                                  GnomeBluetooth.Column.DEFAULT);
            if (isDefault)
                return iter;
            ret = this._model.iter_next(iter);
        }
        return null;
    },

    _sync: function() {
        let defaultAdapter = this._getDefaultAdapter();
        let on = !this._proxy.BluetoothAirplaneMode;

        this.actor.visible = (defaultAdapter != null);
        this._killswitch.setToggleState(on);

        if (this._proxy.BluetoothHardwareAirplaneMode)
            /* TRANSLATORS: this means that bluetooth was disabled by hardware rfkill */
            this._killswitch.setStatus(_("hardware disabled"));
        else
            this._killswitch.setStatus(null);

        if (on)
            this.setIcon('bluetooth-active-symbolic');
        else
            this.setIcon('bluetooth-disabled-symbolic');
    },
});
