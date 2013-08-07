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

        let iconFileNormal = Gio.File.new_for_path(global.datadir + '/theme/social-bar-normal.png');
        this._giconNormal = new Gio.FileIcon({ file: iconFileNormal });

        let iconFileHover = Gio.File.new_for_path(global.datadir + '/theme/social-bar-hover.png');
        this._giconHover = new Gio.FileIcon({ file: iconFileHover });

        let iconFilePressed = Gio.File.new_for_path(global.datadir + '/theme/social-bar-pressed.png');
        this._giconPressed = new Gio.FileIcon({ file: iconFilePressed });

        this.setGIcon(this._giconNormal);

        this.mainIcon.add_style_class_name('system-status-social-icon');

        this.actor.connect('notify::hover', Lang.bind(this, this._onHoverChanged));

        this.actor.connect('button-release-event', Lang.bind(this, this._onHoverChanged));

        // Remove menu entirely to prevent social bar button from closing other menus
        this.setMenu(null);
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        try {
            this.setGIcon(this._giconPressed);
            Main.overview.hide();
            Main.socialBar.proxy.toggleRemote(global.get_current_time());
        } catch(e) {
            log('Unable to toggle social bar visibility: ' + e.message);
        }
    },

    _onHoverChanged: function(actor) {
        if (actor.get_hover()) {
            this.setGIcon(this._giconHover);
        } else {
            this.setGIcon(this._giconNormal);
        }
    }
});
