// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const St = imports.gi.St;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const HOT_CORNER_ENABLED_KEY = 'hot-corner-enabled';

const HotCornerIndicator = new Lang.Class({
    Name: 'HotCornerIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent(null, '');
        this.actor.add_style_class_name('hot-corner-indicator');

        let iconFileNormal;
        if (this.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            iconFileNormal = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/hot-corner-indicator-rtl-symbolic.svg');
        } else {
            iconFileNormal = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/hot-corner-indicator-symbolic.svg');
        }
        this._giconNormal = new Gio.FileIcon({ file: iconFileNormal });

        this.setGIcon(this._giconNormal);

        this.mainIcon.add_style_class_name('system-status-hot-corner-icon');
        this.container.set_fill(false, false);
        this.container.set_alignment(St.Align.END, St.Align.END);

        this._hotCorner = Main.layoutManager.hotCorners[Main.layoutManager.primaryIndex];
        this._hotCorner.connect('hover-changed', Lang.bind(this, this._syncHover));
        this._syncHover();

        this._enableMenuItem = this.menu.addAction(_("Enable Hot Corner"), Lang.bind(this, function() {
            global.settings.set_boolean(HOT_CORNER_ENABLED_KEY, true);
        }));

        this._disableMenuItem = this.menu.addAction(_("Disable Hot Corner"), Lang.bind(this, function() {
            global.settings.set_boolean(HOT_CORNER_ENABLED_KEY, false);
        }));

        if (global.settings.get_boolean(HOT_CORNER_ENABLED_KEY))
            this._enableMenuItem.actor.visible = false;
        else
            this._disableMenuItem.actor.visible = false;

        this.menu.connect('close-animation-completed', Lang.bind(this, function() {
            let isEnabled = global.settings.get_boolean(HOT_CORNER_ENABLED_KEY);
            this._enableMenuItem.actor.visible = !isEnabled;
            this._disableMenuItem.actor.visible = isEnabled;
        }));
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        let button = event.get_button();
        if (button == Gdk.BUTTON_PRIMARY && Main.overview.shouldToggleByCornerOrButton()) {
            Main.overview.toggleWindows();
        } else if (button == Gdk.BUTTON_SECONDARY) {
            this.menu.toggle();
        }
    },

    _syncHover: function() {
        if (this._hotCorner.hover) {
            this.actor.add_style_pseudo_class('hover');
        } else {
            this.actor.remove_style_pseudo_class('hover');
        }
    }
});
