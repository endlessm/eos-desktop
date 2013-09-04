// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const BoxPointer = imports.ui.boxpointer;
const ButtonConstants = imports.ui.buttonConstants;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

const ADD_APP_LAUNCHER = 'eos-app-store.desktop';
const ADD_LINK_LAUNCHER = 'eos-app-store.desktop';
const ADD_FOLDER_LAUNCHER = 'eos-app-store.desktop';

const BackgroundMenu = new Lang.Class({
    Name: 'BackgroundMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(source) {
        this.parent(source, 0, St.Side.TOP);

        this.addSettingsAction(_("Change Background…"), 'gnome-background-panel.desktop');

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.addSettingsAction(_("Add Application"), ADD_APP_LAUNCHER);
        this.addSettingsAction(_("Add Website Link"), ADD_LINK_LAUNCHER);
        this.addSettingsAction(_("Add Folder"), ADD_FOLDER_LAUNCHER);

        this.actor.add_style_class_name('background-menu');

        Main.uiGroup.add_actor(this.actor);
        this.actor.hide();
    }
});

function addBackgroundMenu(actor) {
    let clickAction = new Clutter.ClickAction();
    let cursor = new St.Bin({ opacity: 0 });

    Main.uiGroup.add_actor(cursor);

    actor.reactive = true;
    actor._backgroundMenu = new BackgroundMenu(cursor);
    actor._backgroundManager = new PopupMenu.PopupMenuManager({ actor: actor });
    actor._backgroundManager.addMenu(actor._backgroundMenu);

    function openMenu() {
        let [x, y] = global.get_pointer();
        cursor.set_position(x, y);
        actor._backgroundMenu.open(BoxPointer.PopupAnimation.NONE);
    }

    clickAction.connect('long-press', function(action, actor, state) {
        if (state == Clutter.LongPressState.QUERY)
            return action.get_button() == 1 && !actor._backgroundMenu.isOpen;
        if (state == Clutter.LongPressState.ACTIVATE)
            openMenu();
        return true;
    });
    clickAction.connect('clicked', function(action) {
        let button = action.get_button();
        if (button == ButtonConstants.RIGHT_MOUSE_BUTTON) {
            openMenu();
        }
    });

    actor.add_action(clickAction);
}
