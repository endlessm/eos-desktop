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
        this.mainIcon.add_style_class_name('system-status-social-icon');
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        try {
            Main.overview.hide();
            Main.socialBar.proxy.toggleRemote(global.get_current_time());
        } catch(e) {
            log('Unable to toggle social bar visibility: ' + e.message);
        }
    }
});
