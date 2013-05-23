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

    repositionIcon: function(folder, id, insertId, newFolder) {
        folder = folder || "";

        let icons = this._iconTree[folder];
        if (icons) {
            let oldPos = icons.indexOf(id);
            if (oldPos != -1) {
                icons.splice(oldPos, 0);
            }
        }

        if (newFolder != null) {
            icons = this._iconTree[newFolder];
            if (! icons) {
                // invalid destination folder
                return;
            }
        }

        // If the icon was over the trashcan, remove it
        if (insertId == 0) {
            icons.splice(icons.indexOf(id), 1);
        } else {
            // Otherwise insert it into the new position
            this._insertIcon(icons, id, insertId);
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
        let insertIdx;

        if (insertId != null) {
            insertIdx = icons.indexOf(insertId);
        } else {
            // We were dropped to the left of the trashcan
            insertIdx = icons.length;
        }

        icons.splice(insertIdx, 0, id);
    }
});
Signals.addSignalMethods(IconGridLayout.prototype);

// to be used as singleton
const layout = new IconGridLayout();
