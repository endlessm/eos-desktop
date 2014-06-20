// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const HotCornerIndicator = new Lang.Class({
    Name: 'HotCornerIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent(null, _("Hot Corner Indicator"));
        this.actor.add_style_class_name('hot-corner-indicator');

        let iconFileNormal = Gio.File.new_for_path(global.datadir + '/theme/hot-corner-indicator-symbolic.svg');
        this._giconNormal = new Gio.FileIcon({ file: iconFileNormal });

        this.setGIcon(this._giconNormal);

        this.mainIcon.add_style_class_name('system-status-hot-corner-icon');
        this.container.set_fill(false, false);
        this.container.set_alignment(St.Align.END, St.Align.END);

        // Remove menu entirely to prevent clicks here to close other menus
        this.setMenu(null);
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
	if (Main.overview.shouldToggleByCornerOrButton()) {
	    Main.overview.toggle();
	}
    }
});
