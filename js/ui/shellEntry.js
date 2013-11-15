// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const St = imports.gi.St;

const BoxPointer = imports.ui.boxpointer;
const Main = imports.ui.main;
const Panel = imports.ui.panel;
const Params = imports.misc.params;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const SPINNER_ICON_SIZE = 24;
const SPINNER_MIN_DURATION = 1000;

const EntryMenu = new Lang.Class({
    Name: 'ShellEntryMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(actor, entry) {
        this.parent(actor, 0.025, St.Side.TOP);

        this._entry = entry;
        this.actor.add_style_class_name('entry-context-menu');

        Main.uiGroup.add_actor(this.actor);
        this.actor.hide();
    },

    open: function(animate) {
        this.parent(animate);
        this._entry.add_style_pseudo_class('focus');

        let direction = Gtk.DirectionType.TAB_FORWARD;
        if (!this.actor.navigate_focus(null, direction, false))
            this.actor.grab_key_focus();
    },

    close: function(animate) {
        this._entry.grab_key_focus();
        this.parent(animate);
    }
});

const EntrySearchMenuState = {
    GOOGLE: 1,
    WIKIPEDIA: 2,
    LOCAL: 3
};

const EntrySearchMenuItem = new Lang.Class({
    Name: 'EntrySearchMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (iconFilename, text) {
        this.parent();
        this._checked = false;

        let gfile = Gio.File.new_for_path(global.datadir + '/theme/' + iconFilename);
        let gicon = new Gio.FileIcon({ file: gfile });
        this.icon = new St.Icon({ gicon: gicon, style_class: 'source-icon' });

        this.label = new St.Label({ text: text });

        this.addActor(this.icon);
        this.addActor(this.label);
        this.actor.label_actor = this.label;
        this.actor.connect('style-changed', function(widget) {
            let themeNode = widget.get_theme_node();
            let opacity = themeNode.get_double('-opacity');
            widget.set_opacity(255*opacity);
        });
    },

    setChecked: function(value) {
        if (this._checked == value) {
            return;
        }
        this._checked = value;
        if (this._checked) {
            this.actor.add_style_pseudo_class('checked');
        } else {
            this.actor.remove_style_pseudo_class('checked');
        }
    },

    getChecked: function() {
        return this._checked;
    },
});

const EntrySearchMenu = new Lang.Class({
    Name: 'ShellEntrySearchMenu',
    Extends: EntryMenu,

    _init: function(actor, entry) {
        this.parent(actor, entry);

        this.actor.add_style_class_name('entry-search-menu');

        // Populate menu
        let item;
        item = new EntrySearchMenuItem('list-icon_google.png', _("Google"));
        item.connect('activate', Lang.bind(this, this._onGoogleActivated));
        this.addMenuItem(item);
        this._googleItem = item;

        if (Util.getWikipediaApp()) {
            item = new EntrySearchMenuItem('list-icon_wikipedia.png', _("Wikipedia"));
            item.connect('activate', Lang.bind(this, this._onWikipediaActivated));
            this.addMenuItem(item);
            this._wikipediaItem = item;
        }

        item = new EntrySearchMenuItem('list-icon_my-computer.png', _("My Computer"));
        item.connect('activate', Lang.bind(this, this._onLocalActivated));
        this.addMenuItem(item);
        this._localItem = item;

        this._setState(EntrySearchMenuState.GOOGLE);
    },

    _setState: function(state) {
        if (state == this._state) {
            return;
        }
        this._state = state;

        this._googleItem.setChecked(this._state == EntrySearchMenuState.GOOGLE);
        this._localItem.setChecked(this._state == EntrySearchMenuState.LOCAL);

        if (this._wikipediaItem) {
            this._wikipediaItem.setChecked(this._state == EntrySearchMenuState.WIKIPEDIA);
        }

        this.emit('search-state-changed');
    },

    _onGoogleActivated: function() {
        this._setState(EntrySearchMenuState.GOOGLE);
    },

    _onWikipediaActivated: function() {
        this._setState(EntrySearchMenuState.WIKIPEDIA);
    },

    _onLocalActivated: function() {
        this._setState(EntrySearchMenuState.LOCAL);
    },

    get state() {
        return this._state;
    }
});

const EntryEditMenu = new Lang.Class({
    Name: 'ShellEntryEditMenu',
    Extends: EntryMenu,

    _init: function(entry, params) {
        params = Params.parse (params, { isPassword: false });

        this.parent(entry, entry);

        this._clipboard = St.Clipboard.get_default();

        // Populate menu
        let item;
        item = new PopupMenu.PopupMenuItem(_("Copy"));
        item.connect('activate', Lang.bind(this, this._onCopyActivated));
        this.addMenuItem(item);
        this._copyItem = item;

        item = new PopupMenu.PopupMenuItem(_("Paste"));
        item.connect('activate', Lang.bind(this, this._onPasteActivated));
        this.addMenuItem(item);
        this._pasteItem = item;

        this._passwordItem = null;
        if (params.isPassword)
	    this._makePasswordItem();
    },

    _makePasswordItem: function() {
        let item = new PopupMenu.PopupMenuItem('');
        item.connect('activate', Lang.bind(this,
                                           this._onPasswordActivated));
        this.addMenuItem(item);
        this._passwordItem = item;
    },

    get isPassword() {
	return this._passwordItem != null;
    },

    set isPassword(v) {
	if (v == this.isPassword)
	    return;

	if (v)
	    this._makePasswordItem();
	else {
	    this._passwordItem.destroy();
	    this._passwordItem = null;
	}
    },

    open: function(animate) {
        this._updatePasteItem();
        this._updateCopyItem();
        if (this._passwordItem)
            this._updatePasswordItem();

        this.parent(animate);
    },

    _updateCopyItem: function() {
        let selection = this._entry.clutter_text.get_selection();
        this._copyItem.setSensitive(!this._entry.clutter_text.password_char &&
                                    selection && selection != '');
    },

    _updatePasteItem: function() {
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, Lang.bind(this,
            function(clipboard, text) {
                this._pasteItem.setSensitive(text && text != '');
            }));
    },

    _updatePasswordItem: function() {
        let textHidden = (this._entry.clutter_text.password_char);
        if (textHidden)
            this._passwordItem.label.set_text(_("Show Text"));
        else
            this._passwordItem.label.set_text(_("Hide Text"));
    },

    _onCopyActivated: function() {
        let selection = this._entry.clutter_text.get_selection();
        this._clipboard.set_text(St.ClipboardType.CLIPBOARD, selection);
    },

    _onPasteActivated: function() {
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, Lang.bind(this,
            function(clipboard, text) {
                if (!text)
                    return;
                this._entry.clutter_text.delete_selection();
                let pos = this._entry.clutter_text.get_cursor_position();
                this._entry.clutter_text.insert_text(text, pos);
            }));
    },

    _onPasswordActivated: function() {
        let visible = !!(this._entry.clutter_text.password_char);
        this._entry.clutter_text.set_password_char(visible ? '' : '\u25cf');
    }
});

const ENTRY_HINT_ASSET_WIDTH = 57;
const ENTRY_HINT_ASSET_HEIGHT = 21;

const EntryHint = new Lang.Class({
    Name: 'EntryHint',
    Extends: St.Bin,

    _init: function(styleClass, assetName) {
        this.parent({ style_class: styleClass });

        let hintFile = Gio.File.new_for_path(global.datadir + '/theme/' + assetName);
        this._gicon = new Gio.FileIcon({ file: hintFile });

        this._updateIcon();
    },

    vfunc_style_changed: function(params) {
        this.parent(params);
        this._updateIcon();
    },

    _updateIcon: function() {
        let themeNode = this.peek_theme_node();
        if (!themeNode) {
            return;
        }

        let textureCache = St.TextureCache.get_default();
        let actor = textureCache.load_gicon_full(themeNode, this._gicon,
                                                 ENTRY_HINT_ASSET_WIDTH,
                                                 ENTRY_HINT_ASSET_HEIGHT,
                                                 Lang.bind(this, function() {
                                                     this.set_child(actor);
                                                 }));
    }
});

const OverviewEntry = new Lang.Class({
    Name: 'OverviewEntry',
    Extends: St.Entry,
    Signals: {
        'search-activated': { },
        'search-active-changed': { },
        'search-navigate-focus': { param_types: [GObject.TYPE_INT] },
        'search-state-changed': { },
        'search-terms-changed': { }
    },

    _init: function() {
        this._active = false;
        this._ongoing = false;

        this._capturedEventId = 0;

        let primaryIcon = new St.Button({ style_class: 'search-entry-source',
                                        track_hover: true,
                                        toggle_mode: true });

        this._goIcon = new St.Button({ style_class: 'search-entry-button',
                                       track_hover: true });
        this._spinnerAnimation = new Panel.AnimatedIcon('process-working.svg', SPINNER_ICON_SIZE);
        this._spinnerAnimationTimeoutId = 0;

        this.parent({ name: 'searchEntry',
                      track_hover: true,
                      reactive: true,
                      can_focus: true,
                      hint_text: '',
                      primary_icon: primaryIcon,
                      x_align: Clutter.ActorAlign.CENTER,
                      y_align: Clutter.ActorAlign.CENTER });

        addContextMenu(this);

        this._searchMenu = new EntrySearchMenu(this.primary_icon, this);
        this._searchMenuManager = new PopupMenu.PopupMenuManager({ actor: this.primary_icon });
        this._searchMenuManager.addMenu(this._searchMenu);

        this._googleHint = new St.Label({ text: _("Google"),
                                          style_class: 'search-entry-text-hint' });
        this._wikipediaHint = new St.Label({ text: _("Wikipedia"),
                                             style_class: 'search-entry-text-hint' });
        this._localHint = new St.Label({ text: _("My computer"),
                                         style_class: 'search-entry-text-hint' });

        this.connect('primary-icon-clicked', Lang.bind(this, this._popupSearchEntryMenu));
        this.connect('secondary-icon-clicked', Lang.bind(this, this._activateSearch));
        this._searchMenu.connect('search-state-changed', Lang.bind(this, this._onSearchStateChanged));
        this._searchMenu.connect('open-state-changed', Lang.bind(this, function(menu, state) {
                                     this.get_primary_icon().set_checked(state);
                                 }));
        this._onSearchStateChanged();

        this.connect('notify::mapped', Lang.bind(this, this._onMapped));
        this.clutter_text.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        this.clutter_text.connect('text-changed', Lang.bind(this, this._onTextChanged));
        global.stage.connect('notify::key-focus', Lang.bind(this, this._onStageKeyFocusChanged));
    },

    _popupSearchEntryMenu: function() {
        if (this._searchMenu.isOpen) {
            this._searchMenu.close(BoxPointer.PopupAnimation.FULL);
        } else {
            this._searchMenu.open(BoxPointer.PopupAnimation.FULL);
        }
    },

    _onSearchStateChanged: function() {
        this._syncSearchHint();
        this._updateSecondaryIcon();
        this.emit('search-state-changed');
    },

    _syncSearchHint: function() {
        let state = this._searchMenu.state;

        if (state == EntrySearchMenuState.GOOGLE) {
            this.hint_actor = this._googleHint;
        } else if (state == EntrySearchMenuState.WIKIPEDIA) {
            this.hint_actor = this._wikipediaHint;
        } else if (state == EntrySearchMenuState.LOCAL) {
            this.hint_actor = this._localHint;
        }
    },

    // the entry does not show the hint
    _isActivated: function() {
        return this.clutter_text.text == this.get_text();
    },

    _getTermsForSearchString: function(searchString) {
        searchString = searchString.replace(/^\s+/g, '').replace(/\s+$/g, '');
        if (searchString == '')
            return [];

        let terms = searchString.split(/\s+/);
        return terms;
    },

    _onCapturedEvent: function(actor, event) {
        if (event.type() == Clutter.EventType.BUTTON_PRESS) {
            let source = event.get_source();
            if (source != this.clutter_text &&
                !Main.layoutManager.keyboardBox.contains(source)) {
                // If the user clicked outside after activating the entry,
                // drop the focus from the search bar, but avoid resetting
                // the entry state.
                // If no search terms entered were entered, also reset the
                // entry to its initial state.
                if (this.clutter_text.text == '') {
                    this.resetSearch();
                } else {
                    this._stopSearch();
                }
            }
        }

        return false;
    },

    _onKeyPress: function(entry, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Escape) {
            if (this._isActivated()) {
                this.resetSearch();
                return true;
            }
        } else if (this.active) {
            let arrowNext, nextDirection;
            if (entry.get_text_direction() == Clutter.TextDirection.RTL) {
                arrowNext = Clutter.Left;
                nextDirection = Gtk.DirectionType.LEFT;
            } else {
                arrowNext = Clutter.Right;
                nextDirection = Gtk.DirectionType.RIGHT;
            }

            if (symbol == Clutter.Down) {
                nextDirection = Gtk.DirectionType.DOWN;
            }

            if ((symbol == arrowNext && this.clutter_text.position == -1) ||
                (symbol == Clutter.Down)) {
                this.emit('search-navigate-focus', nextDirection);
                return true;
            } else if (symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
                this._activateSearch();
                return true;
            }
        }
        return false;
    },

    _onMapped: function() {
        if (this.mapped) {
            // Enable 'find-as-you-type'
            this._capturedEventId = global.stage.connect('captured-event',
                                 Lang.bind(this, this._onCapturedEvent));

            this.clutter_text.set_cursor_visible(true);
            // Move the cursor at the end of the current text
            let buffer = this.clutter_text.get_buffer();
            let nChars = buffer.get_length();
            this.clutter_text.set_selection(nChars, nChars);
        } else {
            // Disable 'find-as-you-type'
            if (this._capturedEventId > 0) {
                global.stage.disconnect(this._capturedEventId);
                this._capturedEventId = 0;
            }
        }
    },

    _onStageKeyFocusChanged: function() {
        let focus = global.stage.get_key_focus();
        let appearFocused = this.contains(focus);

        this.clutter_text.set_cursor_visible(appearFocused);

        if (appearFocused) {
            this.add_style_pseudo_class('focus');
        } else {
            this.remove_style_pseudo_class('focus');
        }
    },

    _onTextChanged: function (se, prop) {
        let terms = this._getTermsForSearchString(this.get_text());
        this.active = (terms.length > 0);

        if (this.active) {
            this.emit('search-terms-changed');
        }
    },

    _searchCancelled: function() {
        // Leave the entry focused when it doesn't have any text;
        // when replacing a selected search term, Clutter emits
        // two 'text-changed' signals, one for deleting the previous
        // text and one for the new one - the second one is handled
        // incorrectly when we remove focus
        // (https://bugzilla.gnome.org/show_bug.cgi?id=636341) */
        if (this.clutter_text.text != '') {
            this.resetSearch();
        }
    },

    _shouldTriggerSearch: function(symbol) {
        let unicode = Clutter.keysym_to_unicode(symbol);
        if (unicode == 0) {
            return false;
        }

        if (this._getTermsForSearchString(String.fromCharCode(unicode)).length > 0) {
            return true;
        }

        return symbol == Clutter.BackSpace && this.active;
    },

    _activateSearch: function() {
        this.emit('search-activated');
    },

    _stopSearch: function() {
        global.stage.set_key_focus(null);
    },

    _startSearch: function(event) {
        global.stage.set_key_focus(this.clutter_text);
        this.clutter_text.event(event, true);
    },

    resetSearch: function () {
        this._stopSearch();
        this.text = '';

        this.clutter_text.set_cursor_visible(true);
        this.clutter_text.set_selection(0, 0);
    },

    handleStageEvent: function(event) {
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.Escape && this.active) {
            this.resetSearch();
            return true;
        }

        if (this._shouldTriggerSearch(symbol)) {
            this._startSearch(event);
            return true;
        }

        return false;
    },

    _updateSecondaryIcon: function() {
        if (this._spinnerAnimationTimeoutId) {
            // cancel the ongoing timeout to extend the life of the animation
            GLib.source_remove (this._spinnerAnimationTimeoutId);
            this._spinnerAnimationTimeoutId = 0;
        }

        if (this._ongoing) {
            this._ongoing = false;
            if (this.get_secondary_icon() != this._spinnerAnimation.actor) {
                // start showing the spinner, if we were not doing it yet
                this.set_secondary_icon(this._spinnerAnimation.actor);
                this._spinnerAnimation.play();
            }
            // the spinner will appear for a minimum of SPINNER_MIN_DURATION msecs.
            this._spinnerAnimationTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                                                               SPINNER_MIN_DURATION,
                                                               Lang.bind(this, function() {
                                                                   this._spinnerAnimationTimeoutId = 0;
                                                                   this._updateSecondaryIcon();
                                                                   return false;
                                                               }));
        } else {
            this._spinnerAnimation.stop();
            if (this._active && this.getSearchState() != EntrySearchMenuState.LOCAL) {
                this.set_secondary_icon(this._goIcon);
            } else {
                this.set_secondary_icon(null);
            }
        }
    },

    set active(value) {
        if (value == this._active) {
            return;
        }

        this._active = value;
        this._ongoing = false;
        this._updateSecondaryIcon();

        if (!this._active) {
            this._searchCancelled();
        }

        this.emit('search-active-changed');
    },

    get active() {
        return this._active;
    },

    pulseAnimation: function() {
        this._ongoing = true;
        this._updateSecondaryIcon();
    },

    getSearchState: function() {
        return this._searchMenu.state;
    },

    getSearchTerms: function() {
        return this._getTermsForSearchString(this.get_text());
    }
});

function _setMenuAlignment(entry, stageX) {
    let [success, entryX, entryY] = entry.transform_stage_point(stageX, 0);
    if (success)
        entry.menu.setSourceAlignment(entryX / entry.width);
};

function _onButtonPressEvent(actor, event, entry) {
    if (entry.menu.isOpen) {
        entry.menu.close(BoxPointer.PopupAnimation.FULL);
        return true;
    } else if (event.get_button() == 3) {
        let [stageX, stageY] = event.get_coords();
        _setMenuAlignment(entry, stageX);
        entry.menu.open(BoxPointer.PopupAnimation.FULL);
        return true;
    }
    return false;
};

function _onPopup(actor, entry) {
    let [success, textX, textY, lineHeight] = entry.clutter_text.position_to_coords(-1);
    if (success)
        entry.menu.setSourceAlignment(textX / entry.width);
    entry.menu.open(BoxPointer.PopupAnimation.FULL);
};

function addContextMenu(entry, params) {
    if (entry.menu)
        return;

    entry.menu = new EntryEditMenu(entry, params);
    entry._menuManager = new PopupMenu.PopupMenuManager({ actor: entry });
    entry._menuManager.addMenu(entry.menu);

    // Add an event handler to both the entry and its clutter_text; the former
    // so padding is included in the clickable area, the latter because the
    // event processing of ClutterText prevents event-bubbling.
    entry.clutter_text.connect('button-press-event', Lang.bind(null, _onButtonPressEvent, entry));
    entry.connect('button-press-event', Lang.bind(null, _onButtonPressEvent, entry));

    entry.connect('popup-menu', Lang.bind(null, _onPopup, entry));
}
