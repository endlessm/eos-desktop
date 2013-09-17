// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Signals = imports.signals;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const SCHEMA_KEY = "icon-grid-layout";

const IconGridLayout = new Lang.Class({
    Name: 'IconGridLayout',

    _init: function(params) {
        this._updateIconTree();

        global.settings.connect('changed::' + SCHEMA_KEY, Lang.bind(this, function() {
            this._updateIconTree();
            this.emit('changed');
        }));
    },

    _updateIconTree: function() {
        this._iconTree = {};
        this._folderCategories = [];

        let allIcons = global.settings.get_value(SCHEMA_KEY);

        for (let i = 0; i < allIcons.n_children(); i++) {
            let context = allIcons.get_child_value(i);

            let [folder] = context.get_child_value(0).get_string();

            if (folder) {
                this._folderCategories.push(folder);
            }

            this._iconTree[folder] = context.get_child_value(1).get_strv();
        }
    },

    hasIcon: function(id) {
        let toplevelIds = this._iconTree[''];
        if (toplevelIds.indexOf(id) != -1) {
            return true;
        }

        for (let idx in this._folderCategories) {
            let folder = this._folderCategories[idx];
            let folderIds = this._iconTree[folder];

            if (folderIds.indexOf(id) != -1) {
                return true;
            }
        }

        return false;
    },

    getIcons: function(folder) {
        folder = folder || "";

        if (this._iconTree[folder]) {
            return this._iconTree[folder];
        } else {
            return null;
        }
    },

    iconIsFolder: function(id) {
        return id && this._iconTree[id];
    },

    appendIcon: function(id, folderId) {
        this.repositionIcon(id, null, folderId);
    },

    removeIcon: function(id) {
        this.repositionIcon(id, null, null);
    },

    repositionIcon: function(id, insertId, newFolder) {
        let icons;
        let existing = false;
        let isFolder = id.indexOf('.directory') != -1;

        for (let i in this._iconTree) {
            icons = this._iconTree[i];
            let oldPos = icons.indexOf(id);
            if (oldPos != -1) {
                icons.splice(oldPos, 1);
                existing = true;
                break;
            }
        }

        if (newFolder != null) {
            // We're adding or repositioning an icon
            icons = this._iconTree[newFolder];
            if (!icons) {
                // Invalid destination folder
                return;
            }
            this._insertIcon(icons, id, insertId);

            if (isFolder && !existing) {
                // We're adding a folder, need to initialize an
                // array for its contents
                this._iconTree[id] = [];
            }
        } else {
            // We're removing an entry
            if (isFolder && existing) {
                // We're removing a folder, need to delete the array
                // for its contents as well
                delete this._iconTree[id];
            }
        }

        // Recreate GVariant from iconTree
        let newLayout = GLib.Variant.new("a{sas}", this._iconTree);

        // Store gsetting
        global.settings.set_value(SCHEMA_KEY, newLayout);
    },

    // We use the insert Id instead of the index here since gsettings
    // includes the full application list that the desktop may have.
    // Relying on the position leads to faulty behaviour if some
    // apps are not present on the system
    _insertIcon: function(icons, id, insertId) {
        let insertIdx = -1;

        if (insertId != null) {
            insertIdx = icons.indexOf(insertId);
        }

        // We were dropped to the left of the trashcan,
        // or we were asked to append
        if (insertIdx == -1) {
            insertIdx = icons.length;
        }

        icons.splice(insertIdx, 0, id);
    }
});
Signals.addSignalMethods(IconGridLayout.prototype);

// to be used as singleton
const layout = new IconGridLayout();
