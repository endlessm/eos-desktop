// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const St = imports.gi.St;
const Signals = imports.signals;
const Tweener = imports.ui.tweener;

const BoxPointer = imports.ui.boxpointer;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const MissionGameService = imports.misc.missionGameService;

function launchLessonAction(lesson) {
    return function() {
        /* XXX: This needs to spawn a wrapper script that goes through each lesson
         * individually as opposed to just running showmehow. */
        const argv = ["/usr/bin/gnome-terminal", "-e", "showmehow " + lesson];
        const flags = GLib.SpawnFlags.DO_NOT_REAP_CHILD;
        const [ok, pid] = GLib.spawn_async(null, argv, null, flags, null);

        if (!ok) {
            log("Warning: Failed to call " + argv.join(" "));
        }

        return pid;
    };
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
 *
 * We need to do this instead of using the line-wrap property on
 * ClutterText since that messes with the text's allocation
 * and causes the text to be tightly packed, instead of
 * overflowing like we want it to.
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
            if (lineCounter + append.length > constant) {
                lines.push(prefix);
                lineIndex++;
                lineCounter = prefix.length;

                /* Strip leading and trailing whitespace and newlines
                 * and remove any leading newlines as well. */
                lines[lineIndex] = lines[lineIndex] + append.trim().replace(/\n/g, "");
            } else {
                /* Just replace newlines, but don't touch whitespace. */
                lines[lineIndex] = lines[lineIndex] + append.replace(/\n/g, "");
            }

            /* If we encountered a '\n', we also need to
             * break lines, though this will just
             * involve inserting a new line. */
            if (text[textCounter] === '\n') {
                lines.push(prefix);
                lineIndex++;
                lineCounter = prefix.length;
            }

            lineCounter += append.length;
            lastSpace = textCounter;
        }
    }

    return lines;
}

const ScrolledLabel = new Lang.Class({
    Name: 'ScrolledLabel',
    Extends: GLib.Object,

    _init: function(params, settings) {
        this.parent(params);
        this.view = new St.BoxLayout({ x_expand: true });
        this.bubble = new St.BoxLayout({ x_expand: true });
        this._label = new St.Label({ x_expand: true });
        this._text = wrapTextWith(settings.text, WRAP_CONSTANT, '').join('\n');
        this._textIndex = 0;
        this._scrollTimer = 0;
        this._waitCount = 0;
        this.complete = false;

        this.bubble.style_class = 'chatbox-bubble-text-container chatbox-bordered-bubble-container';
        this.view.style_class = 'chatbox-character-bubble-offset';
        this._label.style_class = 'chatbox-character-text';
        this._label.clutter_text.set_x_expand(true);
        this.bubble.add(this._label, { x_fill: true, expand: true });
        this.view.add(this.bubble, { x_fill: true, expand: true });
    },
    start: function(scrollView) {
        /* Immediately display the first character so that
         * scrolling to the bottom will work */
        this._textIndex = 0;
        this._textIndex++;
        this._label.set_text(this._text.slice(0, this._textIndex));

        /* Add a timeout to gradually display all this text */
        this._startScrollAnimation(scrollView);
    },
    _startScrollAnimation: function(done) {
        if (!this._scrollTimer) {
            this._waitCount = 0;
            this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, Lang.bind(this, function() {
                if (this._waitCount > 0) {
                    this._waitCount--;
                    return true;
                }

                if (this._textIndex === this._text.length) {
                    this.complete = true;
                    this.emit('finished-scrolled');
                    this._scrollTimer = 0;
                    return false;
                }

                this._textIndex++;
                this._label.set_text(this._text.slice(0, this._textIndex));

                /* Stop on punctuation */
                if ("!?.".indexOf(this._text[this._textIndex - 1]) !== -1) {
                    this._waitCount = 100;
                    return true;
                }

                /* Running this on a timer every time is not
                 * ideal, but I haven't found a better way
                 * ensure the view is reliably always
                 * scrolled */
                if (done) {
                    done();
                }

                return true;
            }));
        }

        return this._scrollTimer;
    },
    fastForward: function() {
        this._textIndex = this._text.length - 1;
    },
    acceptAdditionalContent: function(content) {
        if (content.text && content.text.length && content.type === 'scrolled') {
            this._text = wrapTextWith(this._text + '\n' + content.text, WRAP_CONSTANT, '').join('\n');
            this._startScrollAnimation();
            return true;
        }

        return false;
    }
});
Signals.addSignalMethods(ScrolledLabel.prototype);

const WrappedLabel = new Lang.Class({
    Name: 'WrappedLabel',
    Extends: ScrolledLabel,
    _init: function(params) {
        this.parent(params);
        this._text = wrapTextWith(this._text, WRAP_CONSTANT, "> ").join("\n");
        this.fastForward();
    },
    acceptAdditionalContent: function(content) {
        if (content.text && content.text.length && content.type === 'wrapped') {
            this._text = wrapTextWith(this._text + content.text, WRAP_CONSTANT, "> ").join("\n");
            this._label.set_text(this.text);
        }
    }
});

const TextResponseAreaBase = new Lang.Class({
    Name: 'TextResponseAreaBase',
    Extends: GLib.Object,
    _init: function(params, prefix) {
        this.parent(params);
        this._entry = new St.Entry({ can_focus: true });
        this._prefixLabel = new St.Label({ text: prefix });
        this._hbox = new St.BoxLayout({ name: 'textResponseHbox' });
        this._hbox.add(this._prefixLabel);
        this._hbox.add(this._entry, { expand: true });
        this.bubble = new St.BoxLayout();
        this.view = new St.BoxLayout();

        this.bubble.style_class = 'chatbox-bubble-text-container chatbox-bordered-bubble-container';
        this.view.style_class = 'chatbox-user-bubble-offset';

        this.bubble.add(this._hbox, { expand: true, x_fill: true});
        this.view.add(this.bubble, { expand: true, x_fill: true });
        this._entry.clutter_text.connect('activate', Lang.bind(this, function() {
            let text = this._entry.get_text();

            if (text !== '') {
                this._entry.set_can_focus(false);
                this.emit('response', this._entry.get_text());
                this._hbox.remove_actor(this._prefixLabel);
                this.emit('finished-scrolled');
                this.complete = true;
            }
        }));
    },
    fastForward: function() {
    },
    start: function(scrollView) {
        this._entry.grab_key_focus();
        scrollView();
    },
    acceptAdditionalContent: function() {
        return false;
    }
});
Signals.addSignalMethods(TextResponseAreaBase.prototype);

const TextResponseArea = new Lang.Class({
    Name: 'TextResponseArea',
    Extends: TextResponseAreaBase,
    _init: function(params) {
        this.parent(params, '> ');
    }
});
Signals.addSignalMethods(TextResponseArea.prototype);

const ConsoleResponseArea = new Lang.Class({
    Name: 'ConsoleResponseArea',
    Extends: TextResponseAreaBase,
    _init: function(params) {
        this.parent(params, '$ ');
    }
});
Signals.addSignalMethods(ConsoleResponseArea.prototype);

const ChoiceResponseArea = new Lang.Class({
    Name: 'ChoiceResponseArea',
    Extends: GLib.Object,
    _init: function(params, settings) {
        this.parent(params);
        this.bubble = new St.BoxLayout({ vertical: true });
        this.view = new St.BoxLayout();

        this.view.style_class = 'chatbox-user-bubble-offset';

        Object.keys(settings).forEach(Lang.bind(this, function(key) {
            let buttonContainer = new St.BoxLayout();
            buttonContainer.style_class = 'chatbox-button-container';
            let button = new St.Button({
                label: settings[key].text
            });
            button.style_class = 'chatbox-button';
            button.connect('clicked', Lang.bind(this, function() {
                this.emit('response', key);
                this.emit('finished-scrolling');
                this.complete = true;
            }));
            buttonContainer.add(button, { expand: true, x_fill: true });
            this.bubble.add(buttonContainer, { x_fill: true });
        }));

        this.view.add(this.bubble, { expand: true, x_fill: true });
    },
    fastForward: function() {
    },
    start: function(scrollView) {
        scrollView();
    },
    acceptAdditionalContent: function() {
        return false;
    }
});
Signals.addSignalMethods(ChoiceResponseArea.prototype);

const ExternalEventsResponseArea = new Lang.Class({
    Name: 'ExternalEventsResponseArea',
    Extends: GLib.Object,
    _init: function(params, settings, service, lesson, task) {
        this.parent(params);
        this._connection = service.connect('lesson-events-satisfied-input-fired', Lang.bind(this, function(satisfiedLesson, satisfiedTask) {
            log('Received lesson-events-satisfied-input-fired');
            this.emit('finished-scrolling');
            this.complete = true;
            service.disconnect(this._connection);
        }));
    },
    fastForward: function() {
    },
    start: function() {
    },
    acceptAdditionalContent: function() {
        return false;
    }
});
Signals.addSignalMethods(ExternalEventsResponseArea.prototype);

/**
 * _addLabelToChatboxArea
 *
 * Helper function to add a ScrollableLabel to a chatbox results area.
 */
function _addLabelToChatboxArea(label, chatboxResultsArea) {
    if (label.view) {
        chatboxResultsArea.add(label.view);
    }

    /* Start scrolling the label */
    label.start(function() {
        chatboxResultsArea.vadjustment.set_value(Number.MAX_VALUE);
    });
}

const WRAP_CONSTANT = 38;

const MissionChatbox = new Lang.Class({
    Name: 'MissionChatbox',
    Extends: St.BoxLayout,
    _init: function(params, service) {
        params.name = params.name || 'chatboxArea';
        params.vertical = true;
        this.parent(params);

        /* Retain service, which evaluates text entry */
        this._service = service;

        /* Setup layout and style */
        const margin = 10;
        ["top", "bottom", "left", "right"].forEach(Lang.bind(this, function(d) {
            this["margin-" + d] = margin;
        }));

        this.set_size(400, 450);
        this.style_class = 'chatbox-text-container';

        /* Start setting up chatbox labels and add a scroll view
         * to contain all the messages */
        this._chatboxLabels = [];
        this._chatboxResultsScrollView = new St.ScrollView({ overlay_scrollbars: true });
        this._chatboxResultsArea = new St.BoxLayout({ name: 'chatboxResultsArea', vertical: true });
        this._chatboxResultsArea.style_class = 'chatbox-bubble-container-area';

        this._chatboxResultsScrollView.add_actor(this._chatboxResultsArea);

        /* Add the results view to the layout */
        this.add(this._chatboxResultsScrollView, { expand: true });

        /* When the service sends us back a chat message, we should display
         * it in a different style and add it to the chatbox */
        this._service.connect("chat-message", Lang.bind(this, function(chat, message) {
            /* First try and append it to the last label. If so, no work to do */
            if (this._appendToLastLabelInChatboxResultsArea(message)) {
                return;
            }

            /* Create a new bubble */
            const classes = {
                "scrolled": ScrolledLabel,
                "scroll_wait": ScrolledLabel,
                "wrapped": WrappedLabel
            };

            if (Object.keys(classes).indexOf(message.kind) === -1) {
                log("Cannot display chat message, no such label type " +
                    message.kind);
                return;
            }

            const labelCls = classes[message.kind];
            const label = new labelCls({}, {
                text: message.text
            });

            if (message.mode === "immediate") {
                label.fastForward();
            }

            this._pushLabelToChatboxResultsArea(label);
        }));
        this._service.connect("user-input-bubble", Lang.bind(this, function(service, bubbleConfig, lesson, task) {
            let classes = {
                "text": TextResponseArea,
                "console": ConsoleResponseArea,
                "choice": ChoiceResponseArea,
                "external_events": ExternalEventsResponseArea
            };

            if (Object.keys(classes).indexOf(bubbleConfig.type) === -1) {
                log("Cannot display user input, no such bubble type " + bubbleConfig.type);
                return;
            }

            let bubbleCls = classes[bubbleConfig.type];
            let bubble = new bubbleCls({}, bubbleConfig.settings, service, lesson, task);

            bubble.connect('response', Lang.bind(this, function(bubble, response) {
                this._service.evaluate(response);
            }));

            this._pushLabelToChatboxResultsArea(bubble);
        }));
    },
    _appendToLastLabelInChatboxResultsArea: function(content) {
        /* See if the last label in the chatbox results area will
         * accept some additional content, and if so, add this
         * content to it, returning true.
         *
         * Otherwise return false. */
        let lastLabel = this._chatboxLabels.length === 0 ? null : this._chatboxLabels[this._chatboxLabels.length - 1];
        if (lastLabel && lastLabel.acceptAdditionalContent({ type: content.kind, text: content.text })) {
            return true;
        }

        return false;
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
            lastLabel.connect('finished-scrolled', Lang.bind(this, function() {
                _addLabelToChatboxArea(label, this._chatboxResultsArea);
            }));
        }
    }
});

const MissionToolbox = new Lang.Class({
    Name: 'MissionToolbox',
    Extends: St.BoxLayout,
    _init: function(params, parentMenu, service) {
        this._service = service;

        params.vertical = true;
        params.name = 'missionToolbox';

        this.parent(params);

        /* Game mode switch */
        const missionSwitch = new PopupMenu.PopupSwitchMenuItem(_("Mission"), false);

        /* Adventures and spells toolbox */
        this._adventures = createSubMenuMenuItemWithFauxParent(_("Adventures"), parentMenu);
        this._spells = createSubMenuMenuItemWithFauxParent(_("Spells"), parentMenu);
        this._inventory = createSubMenuMenuItemWithFauxParent(_("Inventory"), parentMenu);

        /* Add switches and toolbox items to hbox */
        this.add(missionSwitch.actor);
        addSubMenuItemToBox(this._adventures, this, parentMenu);
        addSubMenuItemToBox(this._spells, this, parentMenu);
        addSubMenuItemToBox(this._inventory, this, parentMenu);

        /* When we get some new adventures or spells, add the menu items to the list again */
        this._service.connect("discover-new-adventures", Lang.bind(this, function(chat, adventures) {
            this._adventures.menu.removeAll();
            adventures.forEach(Lang.bind(this, function(adventure) {
                this._adventures.menu.addAction(adventure.desc, launchLessonAction(adventure.name));
            }));
        }));
        this._service.connect("discover-new-spells", Lang.bind(this, function(chat, spells) {
            this._spells.menu.removeAll();
            spells.forEach(Lang.bind(this, function(spell) {
                this._spells.menu.addAction(spell.desc, launchLessonAction(spell.name));
            }));
        }));
        this._service.connect("discover-new-inventory-items", Lang.bind(this, function(chat, items) {
            this._inventory.menu.removeAll();
            items.forEach(Lang.bind(this, function(item) {
                this._inventory.menu.addAction(item.name, function() {
                });
            }));
        }));
    }
});

function createSeparator() {
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

    return separator;
}

/* Separate indicators option */
const MissionGameToolboxIndicator = new Lang.Class({
    Name: 'MissionGameToolboxIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('starred-symbolic', _("Mission"));
        this.setIcon('starred-symbolic');

        this._service = MissionGameService.getService();

        /* Create layout for indicator menu */
        const hbox = new St.BoxLayout({name: 'menuArea'});

        /* Add toolbox, separator, chatbox */
        hbox.add(new MissionToolbox({}, this.menu, this._service));

        this.menu.addActor(hbox);
    }
});


const MissionGameChatboxIndicator = new Lang.Class({
    Name: 'MissionGameChatboxIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-drag-accept-symbolic', _("Mission"));
        this.setIcon('folder-drag-accept-symbolic');

        this._service = MissionGameService.getService();

        /* Create layout for indicator menu */
        const hbox = new St.BoxLayout({name: 'menuArea'});

        /* Add toolbox, separator, chatbox */
        hbox.add(new MissionChatbox({}, this._service));
        this.menu.addActor(hbox);

        /* Tell the service to commence the intro lesson, though this will only do
         * so if the service is in a state where the intro lesson has not yet been
         * commenced. */
        this.menu.connect('open-state-changed', Lang.bind(this, function(menu, state) {
            if (state) {
                this._service.ready();
            }
        }));
    }
});


/* Combined indicator option */
const MissionGameIndicator = new Lang.Class({
    Name: 'MissionGameIndicator',
    Extends: PanelMenu.SystemStatusButton,

    _init: function() {
        this.parent('folder-drag-accept-symbolic', _("Mission"));
        this.setIcon('folder-drag-accept-symbolic');

        this._service = MissionGameService.getService();

        /* Create layout for indicator menu */
        const hbox = new St.BoxLayout({name: 'menuArea'});

        /* Add toolbox, separator, chatbox */
        hbox.add(new MissionToolbox({}, this.menu, this._service));
        hbox.add(createSeparator());
        hbox.add(new MissionChatbox({}, this._service));

        this.menu.addActor(hbox);

        /* Tell the service to commence the intro lesson, though this will only do
         * so if the service is in a state where the intro lesson has not yet been
         * commenced. */
        this.menu.connect('open-state-changed', Lang.bind(this, function(menu, state) {
            if (state) {
                this._service.ready();
            }
        }));
    }
});
