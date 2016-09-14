// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
const Lang = imports.lang;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

/* Combined indicator option */
const MissionGameIndicator = new Lang.Class({
    Name: 'MissionGameIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-drag-accept-symbolic', _('Mission'));
    },

    // overrides default implementation from PanelMenu.Button
    _onButtonPress: function(actor, event) {
        try {
            // pressing the button when the overview is being shown always displays the side bar
            if (Main.overview.visible) {
                Main.missionChatbox.show(event.get_time());
            } else {
                Main.missionChatbox.toggle(event.get_time());
            }
        } catch(e) {
            log('Unable to toggle mission chatbox visibility: ' + e.message + ' ' + e.stack);
        }
    },
});
