// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Signals = imports.signals;
const Atk = imports.gi.Atk;


const Animation = imports.ui.animation;
const BoxPointer = imports.ui.boxpointer;
const Config = imports.misc.config;
const CtrlAltTab = imports.ui.ctrlAltTab;
const DND = imports.ui.dnd;
const Overview = imports.ui.overview;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const RemoteMenu = imports.ui.remoteMenu;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

const PANEL_ICON_SIZE = 24;

const BUTTON_DND_ACTIVATION_TIMEOUT = 250;

const SPINNER_ANIMATION_TIME = 0.2;

const TextShadower = new Lang.Class({
    Name: 'TextShadower',

    _init: function() {
        this.actor = new Shell.GenericContainer();
        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));

        this._label = new St.Label();
        this.actor.add_actor(this._label);
        for (let i = 0; i < 4; i++) {
            let actor = new St.Label({ style_class: 'label-shadow' });
            actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this.actor.add_actor(actor);
        }
        this._label.raise_top();
    },

    setText: function(text) {
        let children = this.actor.get_children();
        for (let i = 0; i < children.length; i++)
            children[i].set_text(text);
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        let [minWidth, natWidth] = this._label.get_preferred_width(forHeight);
        alloc.min_size = minWidth + 2;
        alloc.natural_size = natWidth + 2;
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        let [minHeight, natHeight] = this._label.get_preferred_height(forWidth);
        alloc.min_size = minHeight + 2;
        alloc.natural_size = natHeight + 2;
    },

    _allocate: function(actor, box, flags) {
        let children = this.actor.get_children();

        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        let [minChildWidth, minChildHeight, natChildWidth, natChildHeight] =
            this._label.get_preferred_size();

        let childWidth = Math.min(natChildWidth, availWidth - 2);
        let childHeight = Math.min(natChildHeight, availHeight - 2);

        for (let i = 0; i < children.length; i++) {
            let child = children[i];
            let childBox = new Clutter.ActorBox();
            // The order of the labels here is arbitrary, except
            // we know the "real" label is at the end because Clutter.Actor
            // sorts by Z order
            switch (i) {
                case 0: // top
                    childBox.x1 = 1;
                    childBox.y1 = 0;
                    break;
                case 1: // right
                    childBox.x1 = 2;
                    childBox.y1 = 1;
                    break;
                case 2: // bottom
                    childBox.x1 = 1;
                    childBox.y1 = 2;
                    break;
                case 3: // left
                    childBox.x1 = 0;
                    childBox.y1 = 1;
                    break;
                case 4: // center
                    childBox.x1 = 1;
                    childBox.y1 = 1;
                    break;
            }
            childBox.x2 = childBox.x1 + childWidth;
            childBox.y2 = childBox.y1 + childHeight;
            child.allocate(childBox, flags);
        }
    }
});

const AggregateMenu = new Lang.Class({
    Name: 'AggregateMenu',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, _("Settings"), false);
        this.menu.actor.add_style_class_name('aggregate-menu');

        this._indicators = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this.actor.add_child(this._indicators);

        this._network = new imports.ui.status.network.NMApplet();
        if (Config.HAVE_BLUETOOTH) {
            this._bluetooth = new imports.ui.status.bluetooth.Indicator();
        } else {
            this._bluetooth = null;
        }

        this._power = new imports.ui.status.power.Indicator();
        this._rfkill = new imports.ui.status.rfkill.Indicator();
        this._volume = new imports.ui.status.volume.Indicator();
        this._brightness = new imports.ui.status.brightness.Indicator();
        this._system = new imports.ui.status.system.Indicator();
        this._screencast = new imports.ui.status.screencast.Indicator();

        this._indicators.add_child(this._screencast.indicators);
        this._indicators.add_child(this._network.indicators);
        if (this._bluetooth) {
            this._indicators.add_child(this._bluetooth.indicators);
        }
        this._indicators.add_child(this._rfkill.indicators);
        this._indicators.add_child(this._volume.indicators);
        this._indicators.add_child(this._power.indicators);
        this._indicators.add_child(PopupMenu.unicodeArrow(St.Side.BOTTOM));

        this.menu.addMenuItem(this._volume.menu);
        this.menu.addMenuItem(this._brightness.menu);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._network.menu);
        if (this._bluetooth) {
            this.menu.addMenuItem(this._bluetooth.menu);
        }
        this.menu.addMenuItem(this._rfkill.menu);
        this.menu.addMenuItem(this._power.menu);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._system.menu);
    },
});

const PANEL_ITEM_IMPLEMENTATIONS = {
    'appIcons': imports.ui.appIconBar.AppIconBar,
    'aggregateMenu': AggregateMenu,
    'dateMenu': imports.ui.dateMenu.DateMenuButton,
    'a11y': imports.ui.status.accessibility.ATIndicator,
    'a11yGreeter': imports.ui.status.accessibility.ATGreeterIndicator,
    'keyboard': imports.ui.status.keyboard.InputSourceIndicator,
    'chatButton': imports.ui.status.chat.ChatButton,
    'socialBar': imports.ui.status.social.SocialBarButton,
    'panelSeparator': imports.ui.panelSeparator.PanelSeparator
};

const Panel = new Lang.Class({
    Name: 'Panel',

    _init : function() {
        this.actor = new Shell.GenericContainer({ name: 'panel',
                                                  reactive: true });
        this.actor._delegate = this;

        this._sessionStyle = null;

        this.statusArea = {};

        this.menuManager = new PopupMenu.PopupMenuManager(this, { keybindingMode: Shell.KeyBindingMode.TOPBAR_POPUP });

        this._leftBox = new St.BoxLayout({ name: 'panelLeft', x_expand: true });
        this.actor.add_actor(this._leftBox);
        this._rightBox = new St.BoxLayout({ name: 'panelRight' });
        this.actor.add_actor(this._rightBox);

        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));
        this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));

        Main.overview.connect('showing', Lang.bind(this, function () {
            this.actor.add_style_pseudo_class('overview');
        }));
        Main.overview.connect('hiding', Lang.bind(this, function () {
            this.actor.remove_style_pseudo_class('overview');
        }));

        Main.layoutManager.panelBox.add(this.actor);
        Main.ctrlAltTabManager.addGroup(this.actor, _("Top Bar"), 'emblem-system-symbolic',
                                        { sortGroup: CtrlAltTab.SortGroup.TOP });

        Main.sessionMode.connect('updated', Lang.bind(this, this._updatePanel));

        global.window_manager.connect('unmaximize', Lang.bind(this, this._updateBackground));
        global.window_manager.connect('map', Lang.bind(this, this._updateBackground));
        global.window_manager.connect('maximize', Lang.bind(this, function() {
            this.actor.remove_style_pseudo_class('unmaximized');
        }));

        let windowTracker = Shell.WindowTracker.get_default();
        windowTracker.connect('tracked-windows-changed', Lang.bind(this, this._updateBackground));

        this._updatePanel();
        this._updateBackground();
    },

    closeActiveMenu: function() {
        let activeMenu = this.menuManager.activeMenu;

        if (activeMenu) {
            activeMenu.close(BoxPointer.PopupAnimation.FADE);
        }
    },

    _updateBackground: function() {
        let windows = global.get_window_actors().filter(function(window) {
            return window.meta_window.get_window_type() == Meta.WindowType.NORMAL;
        });

        /* Check if all windows are unmaximized */
        let allNotMaximized = windows.every(function(window) {
            let isMaximized = (window.meta_window.maximized_horizontally &&
                               window.meta_window.maximized_vertically);
            return !isMaximized;
        });
        if (allNotMaximized) {
            this.actor.add_style_pseudo_class('unmaximized');
        } else {
            this.actor.remove_style_pseudo_class('unmaximized');
        }
    },

    _getPreferredWidth: function(actor, forHeight, alloc) {
        alloc.min_size = -1;
        alloc.natural_size = 0;
        if (Main.layoutManager.primaryMonitor) {
            alloc.natural_size = Main.layoutManager.primaryMonitor.width;
        }
    },

    _getPreferredHeight: function(actor, forWidth, alloc) {
        // We don't need to implement this; it's forced by the CSS
        alloc.min_size = -1;
        alloc.natural_size = -1;
    },

    _allocate: function(actor, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let [rightMinWidth, rightNaturalWidth] = this._rightBox.get_preferred_width(-1);

        let childBox = new Clutter.ActorBox();

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBox.x1 = rightNaturalWidth;
            childBox.x2 = allocWidth;
        } else {
            childBox.x1 = 0;
            childBox.x2 = Math.max(0, allocWidth - rightNaturalWidth);
        }
        this._leftBox.allocate(childBox, flags);

        childBox.y1 = 0;
        childBox.y2 = allocHeight;
        if (this.actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBox.x1 = 0;
            childBox.x2 = rightNaturalWidth;
        } else {
            childBox.x1 = allocWidth - rightNaturalWidth;
            childBox.x2 = allocWidth;
        }
        this._rightBox.allocate(childBox, flags);
    },

    _onButtonPress: function(actor, event) {
        if (Main.modalCount > 0)
            return false;

        if (event.get_source() != actor)
            return false;

        let button = event.get_button();
        if (button != 1)
            return false;

        let focusWindow = global.display.focus_window;
        if (!focusWindow)
            return false;

        let dragWindow = focusWindow.is_attached_dialog() ? focusWindow.get_transient_for()
                                                          : focusWindow;
        if (!dragWindow)
            return false;

        let rect = dragWindow.get_outer_rect();
        let [stageX, stageY] = event.get_coords();

        let allowDrag = dragWindow.maximized_vertically &&
                        stageX > rect.x && stageX < rect.x + rect.width;

        if (!allowDrag)
            return false;

        global.display.begin_grab_op(global.screen,
                                     dragWindow,
                                     Meta.GrabOp.MOVING,
                                     false, /* pointer grab */
                                     true, /* frame action */
                                     button,
                                     event.get_state(),
                                     event.get_time(),
                                     stageX, stageY);

        return true;
    },

    set boxOpacity(value) {
        let isReactive = value > 0;

        this._leftBox.opacity = value;
        this._leftBox.reactive = isReactive;
        this._rightBox.opacity = value;
        this._rightBox.reactive = isReactive;
    },

    get boxOpacity() {
        return this._leftBox.opacity;
    },

    _updatePanel: function() {
        let panel = Main.sessionMode.panel;
        this._hideIndicators();
        this._updateBox(panel.left, this._leftBox);
        this._updateBox(panel.right, this._rightBox);

        if (this._sessionStyle)
            this._removeStyleClassName(this._sessionStyle);

        this._sessionStyle = Main.sessionMode.panelStyle;
        if (this._sessionStyle)
            this._addStyleClassName(this._sessionStyle);
    },

    _hideIndicators: function() {
        for (let role in PANEL_ITEM_IMPLEMENTATIONS) {
            let indicator = this.statusArea[role];
            if (!indicator)
                continue;
            if (indicator.menu)
                indicator.menu.close();
            indicator.container.hide();
        }
    },

    _ensureIndicator: function(role) {
        let indicator = this.statusArea[role];
        if (!indicator) {
            let constructor = PANEL_ITEM_IMPLEMENTATIONS[role];
            if (!constructor) {
                // This icon is not implemented (this is a bug)
                return null;
            }
            indicator = new constructor(this);
            this.statusArea[role] = indicator;
        }
        return indicator;
    },

    _updateBox: function(elements, box) {
        let nChildren = box.get_n_children();

        for (let i = 0; i < elements.length; i++) {
            let role = elements[i];
            let indicator = this._ensureIndicator(role);
            if (indicator == null)
                continue;

            this._addToPanelBox(role, indicator, i + nChildren, box);
        }
    },

    _addToPanelBox: function(role, indicator, position, box) {
        let container = indicator.container;
        container.show();

        let parent = container.get_parent();
        if (parent)
            parent.remove_actor(container);

        box.insert_child_at_index(container, position);
        if (indicator.menu)
            this.menuManager.addMenu(indicator.menu);
        this.statusArea[role] = indicator;
        let destroyId = indicator.connect('destroy', Lang.bind(this, function(emitter) {
            delete this.statusArea[role];
            emitter.disconnect(destroyId);
            container.destroy();
        }));
    },

    addToStatusArea: function(role, indicator, position, box) {
        if (this.statusArea[role])
            throw new Error('Extension point conflict: there is already a status indicator for role ' + role);

        if (!(indicator instanceof PanelMenu.Button))
            throw new TypeError('Status indicator must be an instance of PanelMenu.Button');

        position = position || 0;
        let boxes = {
            left: this._leftBox,
            right: this._rightBox
        };
        let boxContainer = boxes[box] || this._rightBox;
        this.statusArea[role] = indicator;
        this._addToPanelBox(role, indicator, position, boxContainer);
        return indicator;
    },

    _addStyleClassName: function(className) {
        this.actor.add_style_class_name(className);
    },

    _removeStyleClassName: function(className) {
        this.actor.remove_style_class_name(className);
    }
});
