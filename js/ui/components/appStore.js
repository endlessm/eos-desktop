// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;
const ViewSelector = imports.ui.viewSelector;

const APP_STORE_NAME = 'com.endlessm.AppStore';
const APP_STORE_PATH = '/com/endlessm/AppStore';

const AppStoreIface = '<node> \
<interface name="com.endlessm.AppStore"> \
<method name="show"> \
  <arg type="u" direction="in" name="timestamp"/> \
  <arg type="b" direction="in" name="reset"/> \
</method> \
<method name="hide"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<method name="showPage"> \
  <arg type="u" direction="in" name="timestamp"/> \
  <arg type="s" direction="in" name="page"/> \
</method> \
<property name="Visible" type="b" access="read"/> \
</interface> \
</node>';

const AppStore = new Lang.Class({
    Name: 'AppStore',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(AppStoreIface, APP_STORE_NAME, APP_STORE_PATH);
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

    callShow: function(timestamp, reset) {
        this.proxy.showRemote(timestamp, reset);
    },

    callHide: function(timestamp) {
        this.proxy.hideRemote(timestamp);
    },

    showPage: function(timestamp, page) {
        if (!this._visible) {
            this._launchedFromDesktop = Main.overview.visible &&
                                        Main.overview.getActivePage() == ViewSelector.ViewPage.APPS;
        }
        this.proxy.showPageRemote(timestamp, page);
    }
});
const Component = AppStore;
