// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
const Lang = imports.lang;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const CodingGameIndicator = new Lang.Class({
    Name: 'CodingGameIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-drag-accept-symbolic', _('Coding'));
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        // pressing the button when the overview is being shown always displays the side bar
        if (Main.overview.visible) {
            Main.codingManager.show(event.get_time());
        } else {
            Main.codingManager.toggle(event.get_time());
        }
    },
});
