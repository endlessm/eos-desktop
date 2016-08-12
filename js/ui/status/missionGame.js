// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Showmehow = imports.gi.Showmehow;
const Signals = imports.signals;

const BoxPointer = imports.ui.boxpointer;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const InterfaceSettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });

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

/**
 * wrapTextWith
 *
 * Naturally wrap lines at constant, appending prefix to each line,
 * returning an array with the wrapped lines.
 */
function wrapTextWith(text, constant, prefix) {
    let lines = [prefix];
    let lineIndex = 0;
    let lineCounter = prefix.length;
    let textCounter = 0;
    let lastSpace = 0;

    while (textCounter < text.length) {
        textCounter++;

        /* Break a line when we either hit a space,
         * hit a newline, when the line (without spaces)
         * is too long or when we're at the end of the text */
        const breakCondition = (text[textCounter] == ' ' ||
                                text[textCounter] == '\n' ||
                                textCounter == text.length ||
                                textCounter - lastSpace >= constant);
        if (breakCondition) {
            /* Hit a space, see if we can append this
             * word, otherwise start a new line */
            let append = text.slice(lastSpace, textCounter);
            if (lineCounter + append.length > constant ||
                text[textCounter] == '\n') {
                lines.push(prefix);
                lineIndex++;
                lineCounter = prefix.length;

                /* Strip leading whitespace in the case of
                 * new lines */
                append = append.replace(/^\s+/g, '');
                lines[lineIndex] = lines[lineIndex] + append;
            } else {
                lines[lineIndex] = lines[lineIndex] + append;
            }

            lineCounter += append.length;
            lastSpace = textCounter;
        }
    }

    return lines;
}

function copyObject(src) {
    let dst = {};
    Lang.copyProperties(src, dst);
    return dst;
}

const ScrollingLabel = new Lang.Class({
    Name: 'ScrollingLabel',
    Extends: St.Label,

    _init: function(params) {
        let parentParams = copyObject(params);
        parentParams.text = '';

        this.parent(parentParams);
        this._text = params.text;
        this._textIndex = 0;
        this._scrollTimer = 0;
        this.complete = false;
    },
    start: function(scrollView) {
        /* Avoid double-start */
        if (this._scrollTimer) {
            return;
        }

        /* Immediately display the first character so that
         * scrolling to the bottom will work */
        this._textIndex++;
        this.set_text(this._text.slice(0, this._textIndex));

        /* Add a timeout to gradually display all this text */
        if (this._textIndex < this._text.length) {
            this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, Lang.bind(this, function() {
                this._textIndex++;
                this.set_text(this._text.slice(0, this._textIndex));

                const incomplete = this._textIndex < this._text.length;
                if (!incomplete) {
                    this.complete = true;
                    this.emit('finished-scrolling');
                }

                /* Running this on a timer every time is not
                 * ideal, but I haven't found a better way
                 * ensure the view is reliably always
                 * scrolled */
                scrollView();

                return incomplete;
            }));
        }
    },
    fastForward: function() {
        this._textIndex = this._text.length - 1;
    }
});
Signals.addSignalMethods(ScrollingLabel.prototype);


/**
 * _addLabelToChatboxArea
 *
 * Helper function to add a ScrollableLabel to a chatbox results area.
 */
function _addLabelToChatboxArea(label, chatboxResultsArea) {
    chatboxResultsArea.add(label);

    /* Start scrolling the label */
    label.start(function() {
        chatboxResultsArea.vadjustment.set_value(Number.MAX_VALUE);
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

        this._chatboxLabels = [];
        this._chatboxResultsScrollView = new St.ScrollView({ overlay_scrollbars: true });
        this._chatboxResultsArea = new St.BoxLayout({ name: 'chatboxResultsArea', vertical: true });
        const chatboxEntryArea = new St.BoxLayout({ name: 'chatboxEntryArea' });

        this._chatboxResultsScrollView.add_actor(this._chatboxResultsArea);

        chatboxBox.add(this._chatboxResultsScrollView, { expand: true });
        chatboxBox.add(chatboxEntryArea);

        chatboxEntryArea.add(new St.Label({ text: '> ' }));

        this._chatboxEntry = new St.Entry({ can_focus: true });
        chatboxEntryArea.add(this._chatboxEntry, { expand: true });

        chatboxBox.set_size(400, 450);

        const fontName = InterfaceSettings.get_string('monospace-font-name');
        const fontDesc = Pango.FontDescription.from_string(fontName);
        chatboxBox.style =
            'font-size: ' + fontDesc.get_size() / 1024. +
            (fontDesc.get_size_is_absolute() ? 'px' : 'pt') + ';'
            + 'font-family: "' + fontDesc.get_family() + '";';

        let name = "com.endlessm.Showmehow.Service";
        let path = "/com/endlessm/Showmehow/Service";

        /* Null-initialise service for now, but we'll set it later */
        this._service = null;

        Showmehow.ServiceProxy.new_for_bus(Gio.BusType.SESSION, 0, name, path, null,
                                           Lang.bind(this, function(source, result) {
            this._service = Showmehow.ServiceProxy.new_for_bus_finish(result);
            this._service.call_get_unlocked_lessons("console", null, Lang.bind(this, function(source, result) {
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

            this._service.call_get_known_spells("console", null, Lang.bind(this, function(source, result) {
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

        this._chatboxEntry.clutter_text.connect('activate', Lang.bind(this, function(entry, event) {
            const text = entry.get_text()
            if (text === '') {
                return true;
            }

            this._evaluate(text);
            entry.set_text('');
            return true;
        }));
    },
    _evaluate: function(text) {
        let wrappedText = text;
        wrappedText.replace('\n', ' ');
        wrappedText.replace(/^\s+/g, '').replace(/\s+$/g, '');

        const wrapConstant = 42;

        wrapTextWith(wrappedText, wrapConstant, '> ').forEach(Lang.bind(this, function(line) {
            this._pushLabelToChatboxResultsArea(new ScrollingLabel({
                text: line
            }));
        }));
    },
    _pushLabelToChatboxResultsArea: function(label) {
        /* Push immediately if we're the first or if the last one
         * has finished scrolling */
        const lastLabel = this._chatboxLabels.length === 0 ? null : this._chatboxLabels[this._chatboxLabels.length - 1];
        const immediate = !lastLabel || lastLabel.complete;

        /* Immediately put the label in this._chatboxLabels, however
         * this does not mean it will be immediately added to the
         * area. */
        this._chatboxLabels.push(label);

        if (immediate) {
            _addLabelToChatboxArea(label, this._chatboxResultsArea);
        } else {
            lastLabel.connect('finished-scrolling', Lang.bind(this, function() {
               _addLabelToChatboxArea(label, this._chatboxResultsArea);
            }));
        }
    }
});
