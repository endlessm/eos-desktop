// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;

const APP_STORE_NAME = 'com.endlessm.AppStore';
const APP_STORE_PATH = '/com/endlessm/AppStore';
const APP_STORE_IFACE = 'com.endlessm.AppStore';

const AppStoreIface = <interface name={APP_STORE_NAME}>
  <method name="toggle">
    <arg type="u" direction="in" name="timestamp"/>
  </method>
  <method name="ShowPage">
    <arg type="s" direction="in" name="page"/>
  </method>
  <property name="Visible" type="b" access="read"/>
</interface>;

const AppStoreProxy = Gio.DBusProxy.makeProxyWrapper(AppStoreIface);

const AppStore = new Lang.Class({
    Name: 'AppStore',

    _init: function() {
        this.proxy = new AppStoreProxy(Gio.DBus.session,
            APP_STORE_NAME, APP_STORE_PATH, Lang.bind(this, this._onProxyConstructed));

        Main.overview.connect('showing', Lang.bind(this, this._onOverviewShowing));
    },

    _onProxyConstructed: function() {
        // nothing to do
    },

    _onOverviewShowing: function() {
        // Make the AppStore close (slide in) when the overview is shown
        if (this.proxy.Visible) {
            this.toggle();
        }
    },

    toggle: function() {
        this.proxy.toggleRemote(global.get_current_time());
    },

    showPage: function(page) {
        this.proxy.ShowPageRemote(page);
    }
});
