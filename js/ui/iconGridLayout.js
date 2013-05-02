// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const EOS_SHELL_SCHEMA = "org.gnome.shell";
const SCHEMA_KEY = "icon-grid-layout";

const IconGridLayout = new Lang.Class({
    Name: 'IconGridLayout',

    _init: function(params) {
        this._layoutById = {};
        this._layoutByPosition = [];

        this._settings = new Gio.Settings({schema: EOS_SHELL_SCHEMA});
        this._layout = this._settings.get_value(SCHEMA_KEY);

        for (let i=0; i<this._layout.n_children(); i++) {
            let [id] = this._layout.get_child_value(i).get_string();
            this._layoutById[id] = i;
            this._layoutByPosition.push(id);
        }
    },

    getPositionById: function(id) {
        return this._layoutById[id] !== undefined ? this._layoutById[id] : -1;
    },

    setPositionById: function(id, position) {
        if (this._layoutById[id] !== undefined) {
            let oldPos = this._layoutById[id];
            this._layoutByPosition.splice(oldPos, 1);
        }

        this._layoutByPosition.splice(position, 0, id);

        // recreate layoutById from layoutByPosition
        for (let i=0; i<this._layoutByPosition.length; i++) {
            let id = this._layoutByPosition[i];
            this._layoutById[id] = i;
        }

        // recreate GVariant from layoutByPosition
        let newLayout = GLib.Variant.new ("as", this._layoutByPosition);

        // store gsetting
        this._settings.set_value(SCHEMA_KEY, newLayout);
    }
});

// to be used as singleton
const layout = new IconGridLayout();
