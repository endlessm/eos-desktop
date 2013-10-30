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
        this._giconNotify = new Gio.EmblemedIcon({ gicon: this._giconNormal });
        this._giconNotify.add_emblem(new Gio.Emblem({ icon: this._blueDotIcon }));

        this.setGIcon(this._giconNormal);

        this.mainIcon.add_style_class_name('system-status-chat-icon');

        this.sourceIds = {};
        Main.messageTray.connect('source-added', Lang.bind(this, this._onSourceAdded));
        Main.messageTray.connect('source-removed', Lang.bind(this, this._onSourceRemoved));
    },

    _onSourceAdded: function(messageTray, source) {
        if (source.isChat) {
            this.sourceIds[source] = source.connect('count-updated',
                                                    Lang.bind(this,
                                                              this._onSourceCountUpdated));
        }
    },

    _onSourceRemoved: function(messageTray, source) {
        if (source.isChat && this.sourceIds[source] != 0) {
            source.disconnect(this.sourceIds[source]);
            this.sourceIds[source] = 0;
        }
    },

    _onSourceCountUpdated: function(source) {
        if (source.indicatorCount > 0) {
            this.setGIcon(this._giconNotify);
        }
        else {
            this.setGIcon(this._giconNormal);
        }
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
