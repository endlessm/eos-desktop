// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Signals = imports.signals;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const SCHEMA_KEY = "icon-grid-layout";

const IconGridLayout = new Lang.Class({
    Name: 'IconGridLayout',

    _init: function(params) {
        this._layoutById = {};
        this._layoutByPosition = [];

        let allIcons = global.settings.get_value(SCHEMA_KEY);
        this._iconTree = {};
        this._folderCategories = [];

        for (let i = 0; i < allIcons.n_children(); i++) {
            let context = allIcons.get_child_value(i);

            let [folder] = context.get_child_value(0).get_string();

            if (folder) {
                this._folderCategories.push(folder);
            }

            this._iconTree[folder] = context.get_child_value(1).get_strv();
        }

        global.settings.connect('changed::' + SCHEMA_KEY, Lang.bind(this, function() {
            this.emit('changed');
        }));
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

    repositionIcon: function(folder, id, position, newFolder) {
        folder = folder || "";
        newFolder = newFolder || "";

        let icons = this._iconTree[folder];
        if (icons) {
            let oldPos = icons.indexOf(id);
            if (oldPos != -1) {
                icons.splice(oldPos, 1);
            }
        }

        icons = this._iconTree[newFolder];
        if (! icons) {
            // invalid destination folder
            return;
        }

        icons.splice(position, 0, id);

        // recreate GVariant from iconTree
        let newLayout = GLib.Variant.new("a{sas}", this._iconTree);

        // store gsetting
        global.settings.set_value(SCHEMA_KEY, newLayout);

        this.emit('changed');
    }
});
Signals.addSignalMethods(IconGridLayout.prototype);

// to be used as singleton
const layout = new IconGridLayout();
