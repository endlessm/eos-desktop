// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;

const APP_STORE_NAME = 'com.endlessm.AppStore';
const APP_STORE_PATH = '/com/endlessm/AppStore';
const APP_STORE_IFACE = 'com.endlessm.AppStore';

const AppStoreIface = <interface name={APP_STORE_NAME}>
  <method name="Toggle">
    <arg type="b" direction="in" name="reset"/>
    <arg type="u" direction="in" name="timestamp"/>
  </method>
  <method name="ShowPage">
    <arg type="s" direction="in" name="page"/>
    <arg type="u" direction="in" name="timestamp"/>
  </method>
  <property name="Visible" type="b" access="read"/>
</interface>;

const AppStoreProxy = Gio.DBusProxy.makeProxyWrapper(AppStoreIface);

const AppStore = new Lang.Class({
    Name: 'AppStore',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(AppStoreProxy, APP_STORE_NAME, APP_STORE_PATH);
    },

    enable: function() {
        this.parent();
        Main.appStore = this;
    },

    disable: function() {
        this.parent();
        Main.appStore = null;
    },

    toggle: function(reset) {
        reset = !!reset;
        this.parent(reset);
    },

    showPage: function(page) {
        this.activateAfterHide(Lang.bind(this, function(timestamp) { this._doShowPage(page, timestamp); }));
    },

    callToggle: function(timestamp, reset) {
        this.proxy.ToggleRemote(reset, timestamp);
    },

    _doShowPage: function(page, timestamp) {
        this.removeHiddenId();
        this.visible = true;
        this.proxy.ShowPageRemote(page, timestamp);
    }
});
const Component = AppStore;
