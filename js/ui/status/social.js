// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const SocialBarButton = new Lang.Class({
    Name: 'SocialBarButton',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent(null, _("Social Bar"));

        let iconFile = Gio.File.new_for_path(global.datadir + '/theme/social-bar-symbolic.svg');
        let gicon = new Gio.FileIcon({ file: iconFile });
        this.setGIcon(gicon);
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        try {
            Main.socialBarService.socialBarProxy.toggleRemote();
        } catch(e) {
            log('Unable to toggle social bar visibility: ' + e.message);
        }
    }
});
