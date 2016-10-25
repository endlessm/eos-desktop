// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;

const CodingManagerIface = '<node> \
<interface name="com.endlessm.Coding.Manager"> \
<method name="show"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<method name="hide"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<property name="Visible" type="b" access="read"/> \
</interface> \
</node>';

const CODING_MANAGER_NAME = 'com.endlessm.Coding.Manager';
const CODING_MANAGER_PATH = '/com/endlessm/Coding/Manager';

const CodingManager = new Lang.Class({
    Name: 'CodingManager',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(CodingManagerIface, CODING_MANAGER_NAME, CODING_MANAGER_PATH);
    },

    enable: function() {
        this.parent();
        Main.codingManager = this;
    },

    disable: function() {
        this.parent();
        Main.codingManager = null;
    },

    callShow: function(timestamp) {
        this.proxy.showRemote(timestamp);
    },

    callHide: function(timestamp) {
        this.proxy.hideRemote(timestamp);
    }
});
const Component = CodingManager;
