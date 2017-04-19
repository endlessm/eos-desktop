// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;

const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;

const DISCOVERY_FEED_NAME = 'com.endlessm.DiscoveryFeed';
const DISCOVERY_FEED_PATH = '/com/endlessm/DiscoveryFeed';

const DiscoveryFeedIface = '<node> \
<interface name="' + DISCOVERY_FEED_NAME + '"> \
<method name="show"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<method name="hide"> \
  <arg type="u" direction="in" name="timestamp"/> \
</method> \
<property name="Visible" type="b" access="read"/> \
</interface> \
</node>';

const DiscoveryFeed = new Lang.Class({
    Name: 'DiscoveryFeed',
    Extends: SideComponent.SideComponent,

    _init: function() {
        this.parent(DiscoveryFeedIface, DISCOVERY_FEED_NAME, DISCOVERY_FEED_PATH);
    },

    enable: function() {
        this.parent();
        Main.discoveryFeed = this;
    },

    disable: function() {
        this.parent();
        Main.discoveryFeed = null;
    },

    callShow: function(timestamp) {
        this.proxy.showRemote(timestamp);
    },

    callHide: function(timestamp) {
        this.proxy.hideRemote(timestamp);
    }
});
const Component = DiscoveryFeed;
