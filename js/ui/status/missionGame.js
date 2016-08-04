// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Showmehow = imports.gi.Showmehow;
const Signals = imports.signals;

const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

function launchLessonAction(lesson) {
    return function(event) {
        /* XXX: This needs to spawn a wrapper script that goes through each lesson
         * individually as opposed to just running showmehow. */
        const argv = ["/usr/bin/gnome-terminal", "-e", "showmehow " + lesson];
        const flags = GLib.SpawnFlags.DO_NOT_REAP_CHILD;
        const [ok, pid] = GLib.spawn_async(null, argv, null, flags, null);

        if (!ok) {
            log("Warning: Failed to call " + argv.join(" "));
        }
    }
}


const Indicator = new Lang.Class({
    Name: 'MissionGameIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-drag-accept-symbolic', _("Mission"));
        this.setIcon('folder-drag-accept-symbolic');

        this._adventures = new PopupMenu.PopupSubMenuMenuItem(_("Adventures"));
        this._spells = new PopupMenu.PopupSubMenuMenuItem(_("Spells"));

        this.menu.addMenuItem(new PopupMenu.PopupSwitchMenuItem(_("Mission"), false));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._adventures);
        this.menu.addMenuItem(this._spells);

        let name = "com.endlessm.Showmehow.Service";
        let path = "/com/endlessm/Showmehow/Service";

        Showmehow.ServiceProxy.new_for_bus(Gio.BusType.SESSION, 0, name, path, null,
                                           Lang.bind(this, function(source, result) {
            this._service = Showmehow.ServiceProxy.new_for_bus_finish(result);
            this._service.call_get_unlocked_lessons(null, Lang.bind(this, function(source, result) {
                [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);
                lessons = lessons.deep_unpack();

                if (success) {
                    lessons.forEach(Lang.bind(this, function(lesson_spec) {
                        this._adventures.menu.addAction(lesson_spec[1],
                                                        launchLessonAction(lesson_spec[0]));
                    }));

                    lessons.forEach(Lang.bind(this, function(lesson_spec) {
                        this._spells.menu.addAction(lesson_spec[1],
                                                    launchLessonAction(lesson_spec[0]));
                    }));
                } else {
                    log("Warning: Call to showmehow get_unlocked_lessons failed");
                }
            }));
        }));
    },
});
