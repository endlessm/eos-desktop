// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;

const MissionManagerIface = '<node> \
<interface name="com.endlessm.Mission.Manager"> \
<method name="show"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<method name="hide"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<property name="Visible" type="b" access="read"/> \
</interface> \
</node>';

const MISSION_MANAGER_NAME = 'com.endlessm.Mission.Manager';
const MISSION_MANAGER_PATH = '/com/endlessm/Mission/Manager';

const MissionManager = new Lang.Class({
    Name: 'MissionManager',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(MissionManagerIface, MISSION_MANAGER_NAME, MISSION_MANAGER_PATH);
    },

    enable: function() {
        this.parent();
        Main.missionManager = this;
    },

    disable: function() {
        this.parent();
        Main.missionManager = null;
    },

    callShow: function(timestamp) {
        this.proxy.showRemote(timestamp);
    },

    callHide: function(timestamp) {
        this.proxy.hideRemote(timestamp);
    }
});
const Component = MissionManager;
