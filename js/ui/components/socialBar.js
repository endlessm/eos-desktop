// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;

const SocialBarIface = '<node> \
<interface name="com.endlessm.SocialBar"> \
<method name="show"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<method name="hide"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<property name="Visible" type="b" access="read"/> \
</interface> \
</node>';

const SOCIAL_BAR_NAME = 'com.endlessm.SocialBar';
const SOCIAL_BAR_PATH = '/com/endlessm/SocialBar';

const SocialBar = new Lang.Class({
    Name: 'SocialBar',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(SocialBarIface, SOCIAL_BAR_NAME, SOCIAL_BAR_PATH);
    },

    enable: function() {
        this.parent();
        Main.socialBar = this;
    },

    disable: function() {
        this.parent();
        Main.socialBar = null;
    },

    callShow: function(timestamp) {
        this.proxy.showRemote(timestamp);
    },

    callHide: function(timestamp) {
        this.proxy.hideRemote(timestamp);
    }
});
const Component = SocialBar;
