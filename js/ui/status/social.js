// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const SocialBarIface =
    <interface name="com.endlessm.SocialBar">
    <method name="toggle"/>
    <property name="Visible" type="b" access="read"/>
    </interface>;
const SOCIAL_BAR_NAME = 'com.endlessm.SocialBar';
const SOCIAL_BAR_PATH = '/com/endlessm/SocialBar';
const SocialBarProxy = Gio.DBusProxy.makeProxyWrapper(SocialBarIface);

const SocialBarButton = new Lang.Class({
    Name: 'SocialBarButton',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent(null, _("Social Bar"));

        let iconFile = Gio.File.new_for_path(global.datadir + '/theme/social-bar-symbolic.svg');
        let gicon = new Gio.FileIcon({ file: iconFile });
        this.setGIcon(gicon);

        this._socialBarProxy = new SocialBarProxy(Gio.DBus.session,
            SOCIAL_BAR_NAME, SOCIAL_BAR_PATH, Lang.bind(this, this._onProxyConstructed));
        this._socialBarProxy.connect('g-properties-changed', Lang.bind(this, this._onPropertiesChanged));

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
        let visible = this._socialBarProxy.Visible;

        if (!visible) {
            let visibleWindows = Main.workspaceMonitor.visibleWindows;
            if (visibleWindows == 0) {
                Main.overview.showApps();
            }
        }
    },

    _onOverviewShowing: function() {
        let visible = this._socialBarProxy.Visible;

        if (visible) {
            this._socialBarProxy.toggleRemote();
        }
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        try {
            Main.overview.hide();
            this._socialBarProxy.toggleRemote();
        } catch(e) {
            log('Unable to toggle social bar visibility: ' + e.message);
        }
    }
});
