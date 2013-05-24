// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const PanelMenu = imports.ui.panelMenu;

const SocialBarIface =
    <interface name="com.endlessm.SocialBar">
    <method name="toggle"/>
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
    },

    _onProxyConstructed: function() {
        // nothing to do
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        try {
            this._socialBarProxy.toggleRemote();
        } catch(e) {
            log('Unable to toggle social bar visibility: ' + e.message);
        }
    }
});
