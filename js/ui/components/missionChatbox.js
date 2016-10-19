// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;

const MissionChatboxBarIface = '<node> \
<interface name="com.endlessm.Mission.Chatbox"> \
<method name="show"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<method name="hide"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<property name="Visible" type="b" access="read"/> \
</interface> \
</node>';

const MISSION_CHATBOX_NAME = 'com.endlessm.Mission.Chatbox';
const MISSION_CHATBOX_PATH = '/com/endlessm/Mission/Chatbox';

const MissionChatbox = new Lang.Class({
    Name: 'MissionChatbox',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(MissionChatboxBarIface,
                    MISSION_CHATBOX_NAME,
                    MISSION_CHATBOX_PATH);
    },

    enable: function() {
        this.parent();
        Main.missionChatbox = this;
    },

    disable: function() {
        this.parent();
        Main.missionChatbox = null;
    },

    callShow: function(timestamp) {
        this.proxy.showRemote(timestamp);
    },

    callHide: function(timestamp) {
        this.proxy.hideRemote(timestamp);
    }
});
const Component = MissionChatbox;
