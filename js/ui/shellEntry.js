// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const St = imports.gi.St;

const BoxPointer = imports.ui.boxpointer;
const Main = imports.ui.main;
const Params = imports.misc.params;
const PopupMenu = imports.ui.popupMenu;

const EntryMenu = new Lang.Class({
    Name: 'ShellEntryMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(actor, entry) {
        this.parent(actor, 0, St.Side.TOP);

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

const EntrySearchMenu = new Lang.Class({
    Name: 'ShellEntrySearchMenu',
    Extends: EntryMenu,

    _init: function(actor, entry) {
        this.parent(actor, entry);

        this._state = EntrySearchMenuState.GOOGLE;

        // Populate menu
        let item;
        item = new PopupMenu.PopupMenuItem(_("Google"));
        item.connect('activate', Lang.bind(this, this._onGoogleActivated));
        this.addMenuItem(item);
        this._googleItem = item;

        item = new PopupMenu.PopupMenuItem(_("Wikipedia"));
        item.connect('activate', Lang.bind(this, this._onWikipediaActivated));
        this.addMenuItem(item);
        this._wikipediaItem = item;

        item = new PopupMenu.PopupMenuItem(_("Local"));
        item.connect('activate', Lang.bind(this, this._onLocalActivated));
        this.addMenuItem(item);
        this._localItem = item;

        this._syncState();
    },

    _syncState: function() {
        this._googleItem.setShowDot(this._state == EntrySearchMenuState.GOOGLE);
        this._wikipediaItem.setShowDot(this._state == EntrySearchMenuState.WIKIPEDIA);
        this._localItem.setShowDot(this._state == EntrySearchMenuState.LOCAL);
    },

    _onGoogleActivated: function() {
        this._state = EntrySearchMenuState.GOOGLE;
        this._syncState();
    },

    _onWikipediaActivated: function() {
        this._state = EntrySearchMenuState.WIKIPEDIA;
        this._syncState();
    },

    _onLocalActivated: function() {
        this._state = EntrySearchMenuState.LOCAL;
        this._syncState();
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

function _popupSearchEntryMenu(entry) {
    if (entry.searchMenu.isOpen) {
        entry.searchMenu.close(BoxPointer.PopupAnimation.FULL);
    } else {
        entry.searchMenu.open(BoxPointer.PopupAnimation.FULL);
    }
}

function addSearchMenu(entry) {
    if (entry.searchMenu) {
        return;
    }

    entry.searchMenu = new EntrySearchMenu(entry.primary_icon, entry);
    entry._searchMenuManager = new PopupMenu.PopupMenuManager({ actor: entry.primary_icon });
    entry._searchMenuManager.addMenu(entry.searchMenu);

    entry.connect('primary-icon-clicked', _popupSearchEntryMenu);
}
