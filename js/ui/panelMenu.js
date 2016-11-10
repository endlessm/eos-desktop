// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;
const Atk = imports.gi.Atk;

const Main = imports.ui.main;
const Params = imports.misc.params;
const PopupMenu = imports.ui.popupMenu;

const ButtonBox = new Lang.Class({
    Name: 'ButtonBox',

    _init: function(params) {
        params = Params.parse(params, { style_class: 'panel-button' }, true);
        this.actor = new Shell.GenericContainer(params);
        this.actor._delegate = this;

        this.container = new St.Bin({ y_fill: true,
                                      x_fill: true,
                                      child: this.actor });

        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));

        this.actor.connect('style-changed', Lang.bind(this, this._onStyleChanged));
        this._minHPadding = this._natHPadding = 0.0;
    },

    _onStyleChanged: function(actor) {
        let themeNode = actor.get_theme_node();

        this._minHPadding = themeNode.get_length('-minimum-hpadding');
        this._natHPadding = themeNode.get_length('-natural-hpadding');
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        let child = actor.get_first_child();

        if (child) {
            [alloc.min_size, alloc.natural_size] = child.get_preferred_width(-1);
        } else {
            alloc.min_size = alloc.natural_size = 0;
        }

        alloc.min_size += 2 * this._minHPadding;
        alloc.natural_size += 2 * this._natHPadding;
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        let child = actor.get_first_child();

        if (child) {
            [alloc.min_size, alloc.natural_size] = child.get_preferred_height(-1);
        } else {
            alloc.min_size = alloc.natural_size = 0;
        }
    },

    _allocate: function(actor, box, flags) {
        let child = actor.get_first_child();
        if (!child)
            return;

        let [minWidth, natWidth] = child.get_preferred_width(-1);

        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        let childBox = new Clutter.ActorBox();
        if (natWidth + 2 * this._natHPadding <= availWidth) {
            childBox.x1 = this._natHPadding;
            childBox.x2 = availWidth - this._natHPadding;
        } else {
            childBox.x1 = this._minHPadding;
            childBox.x2 = availWidth - this._minHPadding;
        }

        childBox.y1 = 0;
        childBox.y2 = availHeight;

        child.allocate(childBox, flags);
    },
});

const Button = new Lang.Class({
    Name: 'PanelMenuButton',
    Extends: ButtonBox,

    _init: function(menuAlignment, nameText, dontCreateMenu) {
        this.parent({ reactive: true,
                      can_focus: true,
                      track_hover: true,
                      accessible_name: nameText ? nameText : "",
                      accessible_role: Atk.Role.MENU });

        this.actor.connect('event', Lang.bind(this, this._onEvent));
        this.actor.connect('notify::visible', Lang.bind(this, this._onVisibilityChanged));

        this.label = new St.Label({ text: nameText,
                                    style_class: 'app-icon-hover-label' });
        this._labelOffsetY = 0;
        this.label.connect('style-changed', Lang.bind(this, this._updateStyle));
        this.actor.connect('enter-event', Lang.bind(this, this._showHoverState));
        this.actor.connect('leave-event', Lang.bind(this, this._hideHoverState));

        if (dontCreateMenu)
            this.menu = new PopupMenu.PopupDummyMenu(this.actor);
        else
            this.setMenu(new PopupMenu.PopupMenu(this.actor, menuAlignment, St.Side.TOP, 0));
    },

    _updateStyle: function(actor, forHeight, alloc) {
        this._labelOffsetY = this.label.get_theme_node().get_length('-label-offset-y');
    },

    _hideHoverState: function() {
        if (this.label.get_parent() != null) {
            Main.uiGroup.remove_actor(this.label);
        }
    },

    _showHoverState: function() {
        // Show label only if it's not already visible
        if (this.label.get_parent())
            return;
        if (this.label.text.length == 0)
            return;
        if (this.menu.isOpen)
            return;

        Main.uiGroup.add_actor(this.label);
        this.label.raise_top();

        let iconMidpoint = this.actor.get_transformed_position()[0] + this.actor.width / 2;
        this.label.translation_x = Math.floor(iconMidpoint - this.label.width / 2);
        this.label.translation_y = Math.floor(this.actor.get_transformed_position()[1] - this._labelOffsetY);

        // Clip left edge to be the left edge of the screen
        this.label.translation_x = Math.max(this.label.translation_x, 0);
        this.label.translation_x = Math.min(this.label.translation_x, global.stage.width - this.label.width);
    },

    setSensitive: function(sensitive) {
        this.actor.reactive = sensitive;
        this.actor.can_focus = sensitive;
        this.actor.track_hover = sensitive;
    },

    setMenu: function(menu) {
        if (this.menu)
            this.menu.destroy();

        this.menu = menu;
        if (this.menu) {
            this.menu.actor.add_style_class_name('panel-menu');
            this.menu.connect('open-state-changed', Lang.bind(this, this._onOpenStateChanged));
            this.menu.actor.connect('key-press-event', Lang.bind(this, this._onMenuKeyPress));

            Main.uiGroup.add_actor(this.menu.actor);
            this.menu.actor.hide();
        }
        this.emit('menu-set');
    },

    _onEvent: function(actor, event) {
        if (this.menu &&
            (event.type() == Clutter.EventType.TOUCH_BEGIN ||
             event.type() == Clutter.EventType.BUTTON_PRESS))
            this.menu.toggle();

        return Clutter.EVENT_PROPAGATE;
    },

    _onVisibilityChanged: function() {
        if (!this.menu)
            return;

        if (!this.actor.visible)
            this.menu.close();
    },

    _onMenuKeyPress: function(actor, event) {
        if (global.focus_manager.navigate_from_event(event))
            return Clutter.EVENT_STOP;

        let symbol = event.get_key_symbol();
        if (symbol == Clutter.KEY_Left || symbol == Clutter.KEY_Right) {
            let group = global.focus_manager.get_group(this.actor);
            if (group) {
                let direction = (symbol == Clutter.KEY_Left) ? Gtk.DirectionType.LEFT : Gtk.DirectionType.RIGHT;
                group.navigate_focus(this.actor, direction, false);
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    },

    _onOpenStateChanged: function(menu, open) {
        if (open) {
            this.actor.add_style_pseudo_class('active');
            this._hideHoverState();
        } else
            this.actor.remove_style_pseudo_class('active');

        // Setting the max-height won't do any good if the minimum height of the
        // menu is higher then the screen; it's useful if part of the menu is
        // scrollable so the minimum height is smaller than the natural height
        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        let verticalMargins = this.menu.actor.margin_top + this.menu.actor.margin_bottom;
        this.menu.actor.style = ('max-height: ' + Math.round(workArea.height - verticalMargins) + 'px;');
    },

    destroy: function() {
        this.actor._delegate = null;

        if (this.menu)
            this.menu.destroy();
        this.actor.destroy();

        this.emit('destroy');
    }
});
Signals.addSignalMethods(Button.prototype);

/* SystemIndicator:
 *
 * This class manages one system indicator, which are the icons
 * that you see at the top right. A system indicator is composed
 * of an icon and a menu section, which will be composed into the
 * aggregate menu.
 */
const SystemIndicator = new Lang.Class({
    Name: 'SystemIndicator',

    _init: function() {
        this.indicators = new St.BoxLayout({ style_class: 'panel-status-indicators-box',
                                             reactive: true });
        this.indicators.hide();
        this.menu = new PopupMenu.PopupMenuSection();
    },

    _syncIndicatorsVisible: function() {
        this.indicators.visible = this.indicators.get_children().some(function(actor) {
            return actor.visible;
        });
    },

    _addIndicator: function() {
        let icon = new St.Icon({ style_class: 'system-status-icon' });
        this.indicators.add_actor(icon);
        icon.connect('notify::visible', Lang.bind(this, this._syncIndicatorsVisible));
        this._syncIndicatorsVisible();
        return icon;
    }
});
Signals.addSignalMethods(SystemIndicator.prototype);

/* SystemStatusButton:
 *
 * This class manages one System Status indicator (network, keyboard,
 * volume, bluetooth...), which is just a PanelMenuButton with an
 * icon.
 */
const SystemStatusButton = new Lang.Class({
    Name: 'SystemStatusButton',
    Extends: Button,

    _init: function(iconName, nameText, dontCreateMenu=false) {
        this.parent(0.0, nameText, dontCreateMenu);
        this.actor.add_style_class_name('panel-status-button');

        this._box = new St.BoxLayout({ style_class: 'panel-status-button-box' });
        this.actor.add_actor(this._box);

        if (iconName)
            this.setIcon(iconName);
    },

    get icons() {
        return this._box.get_children();
    },

    addIcon: function(gicon) {
        let icon = new St.Icon({ gicon: gicon,
                                 style_class: 'system-status-icon' });
        this._box.add_actor(icon);

        this.emit('icons-changed');

        return icon;
    },

    setIcon: function(iconName) {
        if (!this.mainIcon)
            this.mainIcon = this.addIcon(null);
        this.mainIcon.icon_name = iconName;
    },

    setGIcon: function(gicon) {
        if (this.mainIcon)
            this.mainIcon.gicon = gicon;
        else
            this.mainIcon = this.addIcon(gicon);
    }
});

const ShowWindowsButton = new Lang.Class({
    Name: 'ShowWindowsButton',
    Extends: Button,

    _init: function(panel) {
        this.parent('', _("Show Windows"), true);

        this.actor.add_style_class_name('show-windows-button');

        let box = new St.BoxLayout({ name: 'show-windows-layout' });
        this.actor.add_actor(box);

        this._panel = panel;

        this._icon = new St.Icon({ style_class: 'show-windows-icon' });

        box.add(this._icon);

        let iconFile = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/show-windows-symbolic.svg');
        this._giconNormal = new Gio.FileIcon({ file: iconFile });

        this._icon.gicon = this._giconNormal;

        this.actor.connect('button-release-event', Lang.bind(this, this._onButtonRelease));
        this.actor.connect('key-press-event', Lang.bind(this, this._onKeyPress));
    },

    _onButtonRelease: function(actor, event) {
        this._panel.closeActiveMenu();
        Main.overview.toggleWindows();
    },

    _onKeyPress: function(actor, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.KEY_space || symbol == Clutter.KEY_Return) {
            this._panel.closeActiveMenu();
            Main.overview.toggleWindows();
            return true;
        } else
            return false;
    }
});
