// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;

const Shell = imports.gi.Shell;
const AppDisplay = imports.ui.appDisplay;
const IconGrid = imports.ui.iconGrid;
const St = imports.gi.St;

const FolderIcon = new Lang.Class({
    Name: 'AppStoreIcon',

    _init: function() {
        this._dir = dir;
        this._parentView = parentView;

        this.actor = new St.Button({ style_class: 'app-well-app app-store',
                                     button_mask: St.ButtonMask.ONE,
                                     toggle_mode: true,
                                     can_focus: true,
                                     x_fill: true,
                                     y_fill: true });
        this.actor._delegate = this;

        let label = this._dir.get_name();
        this.icon = new IconGrid.BaseIcon(label,
                                          { createIcon: Lang.bind(this, this._createIcon) });
        this.actor.set_child(this.icon.actor);
        this.actor.label_actor = this.icon.label;

        this.view = new AppDisplay.FolderView();
        this.view.actor.reactive = false;
        _loadCategory(dir, this.view);
        this.view.loadGrid();

        this.actor.connect('clicked', Lang.bind(this,
            function() {
                this._ensurePopup();
                this._popup.toggle();
            }));
        this.actor.connect('notify::mapped', Lang.bind(this,
            function() {
                if (!this.actor.mapped && this._popup)
                    this._popup.popdown();
            }));
    },

    _createIcon: function(size) {
        return this.view.createFolderIcon(size);
    },

    _ensurePopup: function() {
        if (this._popup)
            return;

        let spaceTop = this.actor.y;
        let spaceBottom = this._parentView.actor.height - (this.actor.y + this.actor.height);
        let side = spaceTop > spaceBottom ? St.Side.BOTTOM : St.Side.TOP;

        this._popup = new AppFolderPopup(this, side);
        this._parentView.addFolderPopup(this._popup);

        // Position the popup above or below the source icon
        if (side == St.Side.BOTTOM) {
            this._popup.actor.show();
            this._popup.actor.y = this.actor.y - this._popup.actor.height;
            this._popup.actor.hide();
        } else {
            this._popup.actor.y = this.actor.y + this.actor.height;
        }

        this._popup.connect('open-state-changed', Lang.bind(this,
            function(popup, isOpen) {
                if (!isOpen)
                    this.actor.checked = false;
            }));
    },
});
