// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const St = imports.gi.St;

const PanelMenu = imports.ui.panelMenu;

const PanelSeparator = new Lang.Class({
    Name: 'PanelSeparator',
    Extends: St.Bin,

    _init: function() {
        this.parent({ style_class: 'panel-separator' });

        // Needed otherwise automatic adding of this button fails
        this.container = this;

        let iconFileSeparator = Gio.File.new_for_path(global.datadir + '/theme/separator.png');
        let giconSeparator = new Gio.FileIcon({ file: iconFileSeparator });
        this._separator = new St.Icon({ gicon: giconSeparator ,
                                        style_class: 'panel-separator-icon' });

        this.add_actor(this._separator);
    }
});
