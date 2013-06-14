// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;

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

    _init: function() {
        this.proxy = new SocialBarProxy(Gio.DBus.session,
            SOCIAL_BAR_NAME, SOCIAL_BAR_PATH, Lang.bind(this, this._onProxyConstructed));
        this.proxy.connect('g-properties-changed', Lang.bind(this, this._onPropertiesChanged));

        Main.overview.connect('showing', Lang.bind(this, this._onOverviewShowing));
    },

    _onProxyConstructed: function() {
        // nothing to do
    },

    _onPropertiesChanged: function(proxy, changedProps, invalidatedProps) {
        let propsDict = changedProps.deep_unpack();
        if (propsDict.hasOwnProperty('Visible')) {
            this._onVisibilityChanged();
        }
    },

    _onVisibilityChanged: function() {
        let visible = this.proxy.Visible;

        if (!visible) {
            let visibleWindows = Main.workspaceMonitor.visibleWindows;
            if (visibleWindows == 0) {
                Main.overview.showApps();
            }
        }
    },

    _onOverviewShowing: function() {
        let visible = this.proxy.Visible;

        if (visible) {
            this.proxy.toggleRemote(global.get_current_time());
        }
    },
});
