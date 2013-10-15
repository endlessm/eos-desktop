// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;

const SocialBarIface =
    <interface name="com.endlessm.SocialBar">
    <method name="toggle">
    <arg type="u" direction="in" name="timestamp"/>
    </method>
    <property name="Visible" type="b" access="read"/>
    </interface>;
const SOCIAL_BAR_NAME = 'com.endlessm.SocialBar';
const SOCIAL_BAR_PATH = '/com/endlessm/SocialBar';
const SocialBarProxy = Gio.DBusProxy.makeProxyWrapper(SocialBarIface);

const SocialBar = new Lang.Class({
    Name: 'SocialBar',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(SocialBarProxy, SOCIAL_BAR_NAME, SOCIAL_BAR_PATH);
    },

    callToggle: function(timestamp) {
        this.proxy.toggleRemote(timestamp);
    }
});
