// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Showmehow = imports.gi.Showmehow;
const Signals = imports.signals;

const BoxPointer = imports.ui.boxpointer;
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

/**
 * createSubMenuMenuItemWithFauxParent
 *
 * PopupSubMenuMenuItem makes assumptions about its parent
 * container. Thankfully the surface area of that assumption
 * is quite small, so monkey-patch _getTopMenu to just return
 * the parent and hope for the best.
 */
function createSubMenuMenuItemWithFauxParent(name, parent) {
    let item = new PopupMenu.PopupSubMenuMenuItem(name);
    item.menu._getTopMenu = Lang.bind(item, function() {
        return parent;
    });
    return item;
}


/**
 * addSubMenuItemToBox
 *
 * Simulates what happens in addMenuItem.
 */
function addSubMenuItemToBox(subMenuItem, packingBox, menu) {
    packingBox.add(subMenuItem.actor);
    packingBox.add(subMenuItem.menu.actor);

    menu._connectSubMenuSignals(subMenuItem, subMenuItem.menu);
    menu._connectItemSignals(subMenuItem);
    subMenuItem._closingId = menu.connect('open-state-changed', function(self, open) {
        if (!open)
            subMenuItem.menu.close(BoxPointer.PopupAnimation.FADE);
    });
}

const Indicator = new Lang.Class({
    Name: 'MissionGameIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-drag-accept-symbolic', _("Mission"));
        this.setIcon('folder-drag-accept-symbolic');

        this._adventures = createSubMenuMenuItemWithFauxParent(_("Adventures"), this.menu);
        this._spells = createSubMenuMenuItemWithFauxParent(_("Spells"), this.menu);

        const missionSwitch = new PopupMenu.PopupSwitchMenuItem(_("Mission"), false);
        const switchesBox = new St.BoxLayout({vertical: true});
        const hbox = new St.BoxLayout({name: 'switchesArea'});

        this.menu.addActor(hbox);
        hbox.add(switchesBox);
        switchesBox.add(missionSwitch.actor);
        addSubMenuItemToBox(this._adventures, switchesBox, this.menu);
        addSubMenuItemToBox(this._spells, switchesBox, this.menu);

        const separator = new St.DrawingArea({ style_class: 'calendar-vertical-separator',
                                               pseudo_class: 'highlighted' });
        separator.connect('repaint', Lang.bind(this, function(area) {
            let cr = area.get_context();
            let themeNode = area.get_theme_node();
            let [width, height] = area.get_surface_size();
            let stippleColor = themeNode.get_color('-stipple-color');
            let stippleWidth = themeNode.get_length('-stipple-width');
            let x = Math.floor(width/2) + 0.5;
            cr.moveTo(x, 0);
            cr.lineTo(x, height);
            Clutter.cairo_set_source_color(cr, stippleColor);
            cr.setDash([1, 3], 1); // Hard-code for now
            cr.setLineWidth(stippleWidth);
            cr.stroke();
            cr.$dispose();
        }));
        hbox.add(separator);

        const chatboxBox = new St.BoxLayout({ name: 'chatboxArea', vertical: true });
        hbox.add(chatboxBox);

        const chatboxCheckbox = new PopupMenu.PopupSwitchMenuItem(_("Chatbox"), false);
        chatboxBox.add(chatboxCheckbox.actor);

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
                } else {
                    log("Warning: Call to showmehow get_unlocked_lessons failed");
                }
            }));

            this._service.call_get_known_spells(null, Lang.bind(this, function(source, result) {
                [success, lessons] = this._service.call_get_known_spells_finish(result);
                lessons = lessons.deep_unpack();

                if (success) {
                    lessons.forEach(Lang.bind(this, function(lesson_spec) {
                        this._spells.menu.addAction(lesson_spec[1],
                                                    launchLessonAction(lesson_spec[0]));
                    }));
                } else {
                    log("Warning: Call to showmehow get_known_spells failed");
                }
            }));
        }));
    },
});
