// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;
const Lang = imports.lang;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const ChatButton = new Lang.Class({
    Name: 'ChatButton',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        let appSystem = Shell.AppSystem.get_default();
        this.app = appSystem.lookup_app('empathy.desktop');
        if (!this.app) {
            log('Unable to find empathy');
            return;
        }

        this.parent(null, _("Chat"));

        this.actor.add_style_class_name('chat-button');

        let iconFileNormal = Gio.File.new_for_path(global.datadir + '/theme/chat-button-normal.png');
        this._giconNormal = new Gio.FileIcon({ file: iconFileNormal });

        let blueDotFile = Gio.File.new_for_path(global.datadir + '/theme/notification-blue_dot.png');
        this._blueDotIcon = new Gio.FileIcon({ file: blueDotFile });

        this.setGIcon(this._giconNormal);

        this.mainIcon.add_style_class_name('system-status-chat-icon');

        // Remove menu entirely to prevent social bar button from closing other menus
        this.setMenu(null);
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        if (this.app.state == Shell.AppState.RUNNING) {
            this.app.open_new_window(Clutter.get_current_event());
        }
        else {
            let activationContext = new AppActivation.AppActivationContext(this.app);
            activationContext.activate();
        }

        Main.overview.hide();
    },

});
