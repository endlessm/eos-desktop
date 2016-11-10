// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

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


const AppDisplay = imports.ui.appDisplay;
const BoxPointer = imports.ui.boxpointer;
const Config = imports.misc.config;
const CtrlAltTab = imports.ui.ctrlAltTab;
const DND = imports.ui.dnd;
const Overview = imports.ui.overview;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

const PANEL_ICON_SIZE = 32;

const BUTTON_DND_ACTIVATION_TIMEOUT = 250;

const ANIMATED_ICON_UPDATE_TIMEOUT = 100;
const SPINNER_ANIMATION_TIME = 0.2;

const PANEL_ANIMATION_TIME = 0.5;

const SHARED_ACCOUNT_MESSAGE = _("Remember that shared accounts are not protected by a password, so make sure to delete any files that you want to keep private.");

const ICON_ENTER_ANIMATION_DELTA = PANEL_ICON_SIZE * 0.25;
const ICON_ENTER_ANIMATION_SPEED = ICON_ENTER_ANIMATION_DELTA * 0.0012;
const ICON_ENTER_ANIMATION_DELAY = ICON_ENTER_ANIMATION_SPEED * ICON_ENTER_ANIMATION_DELTA * 0.5 + PANEL_ANIMATION_TIME;

function animateIconIn (icon, index) {
    if (!Main.layoutManager.startingUp) {
        return;
    }

    icon.hide();
    Main.layoutManager.connect('startup-complete', function () {
        let panelAnimationDelay;
        if (Main.sessionMode.isGreeter)
            panelAnimationDelay = 0.0;
        else
            panelAnimationDelay = AppDisplay.ICON_ANIMATION_DELAY +
                AppDisplay.ICON_ANIMATION_TIME;

        let delta = PANEL_ICON_SIZE + ICON_ENTER_ANIMATION_DELTA * index;
        icon.translation_y = delta;
        icon.show();
        Tweener.addTween(icon, {
            translation_y: 0,
            time: ICON_ENTER_ANIMATION_SPEED * delta,
            transition: 'easeOutBack',
            delay: ICON_ENTER_ANIMATION_DELAY + panelAnimationDelay
        });
    });
}

const Animation = new Lang.Class({
    Name: 'Animation',

    _init: function(file, width, height, speed, skipEndFrames) {
        this.actor = new St.Bin({ width: width, height: height });
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._speed = speed;
        this._skipEndFrames = skipEndFrames;

        this._isLoaded = false;
        this._isPlaying = false;
        this._timeoutId = 0;
        this._frame = 0;
        this._frames = null;

        St.TextureCache.get_default().load_sliced_image_async(file, width, height,
                                                              Lang.bind(this, this._animationsLoaded));
    },

    play: function() {
        if (this._isLoaded && this._timeoutId == 0) {
            if (this._frame == 0)
                this._showFrame(0);

            this._setTimeoutSource();
        }

        this._isPlaying = true;
    },

    stop: function() {
        this._clearTimeoutSource();
        this._isPlaying = false;
    },

    _clearTimeoutSource: function() {
        if (this._timeoutId > 0) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    },

    _setTimeoutSource: function() {
        this._timeoutId = Mainloop.timeout_add(this._speed * St.get_slow_down_factor(),
                                               Lang.bind(this, this._update));
    },

    _showFrame: function(frame) {
        this._frame = (frame % this._frames.length);
        let newFrame = this._frames[this._frame];
        this.actor.set_content(newFrame);
    },

    _update: function() {
        let showFrameNum = this._frame + 1;

        // Skip a number of frames at the end of the sequence if desired
        if (showFrameNum == this._frames.length - this._skipEndFrames) {
            showFrameNum = this._frames.length;
        }

        this._showFrame(showFrameNum);
        return true;
    },

    _animationsLoaded: function(cache, res) {
        try {
            this._frames = cache.load_sliced_image_finish(res);
        } catch (e) {
            logError(e, ' Unable to load sliced image for animation');
            return;
        }

        this._isLoaded = true;

        if (this._isPlaying)
            this.play();
    },

    _onDestroy: function() {
        this.stop();
    }
});

const VariableSpeedAnimation = new Lang.Class({
    Name: 'VariableSpeedAnimation',
    Extends: Animation,

    _init: function(name, size, initialTimeout, skipEndFrames) {
        this.parent(Gio.File.new_for_uri('resource:///org/gnome/shell/theme/' + name), size, size,
                    initialTimeout, skipEndFrames);
    },

    _updateSpeed: function(newSpeed) {
        if (newSpeed == this._speed) {
            return;
        }

        this._clearTimeoutSource();
        this._speed = newSpeed;
        this._setTimeoutSource();
    },

    completeInTime: function(time, callback) {
        // Note: the skipEndFrames does not apply to the final steps
        // in the sequence once this method is called
        let frameTime = Math.floor(time / (this._frames.length - this._frame));
        this._updateSpeed(frameTime);

        this._completeCallback = callback;
        this._completeTimeGoal = time;
        this._completeStartTime = GLib.get_monotonic_time();
        this._completeStartFrame = this._frame;
    },

    _update: function() {
        if (!this._completeCallback) {
            return this.parent();
        }

        if (this._frame == (this._frames.length - 1)) {
            // we finished
            this.stop();

            this._completeCallback();
            this._completeCallback = null;

            return false;
        }
        
        let elapsedTime = (GLib.get_monotonic_time() - this._completeStartTime) / 1000;
        let percentage =  Math.min(1, elapsedTime / this._completeTimeGoal);
        let frameNum = this._completeStartFrame +
            Math.floor((this._frames.length - this._completeStartFrame) * percentage);

        if (frameNum == this._frames.length) {
            frameNum--;
        }

        this._showFrame(frameNum);

        return true;
    }
});

const AnimatedIcon = new Lang.Class({
    Name: 'AnimatedIcon',
    Extends: Animation,

    _init: function(name, size) {
        this.parent(Gio.File.new_for_uri('resource:///org/gnome/shell/theme/' + name), size, size, ANIMATED_ICON_UPDATE_TIMEOUT, 0);
    }
});

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

const AggregateLayout = new Lang.Class({
    Name: 'AggregateLayout',
    Extends: Clutter.BoxLayout,

    _init: function(params) {
        if (!params)
            params = {};
        params['orientation'] = Clutter.Orientation.VERTICAL;
        this.parent(params);

        this._sizeChildren = [];
    },

    addSizeChild: function(actor) {
        this._sizeChildren.push(actor);
        this.layout_changed();
    },

    vfunc_get_preferred_width: function(container, forHeight) {
        let themeNode = container.get_theme_node();
        let minWidth = themeNode.get_min_width();
        let natWidth = minWidth;

        for (let i = 0; i < this._sizeChildren.length; i++) {
            let child = this._sizeChildren[i];
            let [childMin, childNat] = child.get_preferred_width(forHeight);
            minWidth = Math.max(minWidth, childMin);
            natWidth = Math.max(minWidth, childNat);
        }
        return [minWidth, natWidth];
    }
});

const AggregateMenu = new Lang.Class({
    Name: 'AggregateMenu',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, C_("System menu in the top bar", "System Menu"), false);
        this.menu.actor.add_style_class_name('aggregate-menu');

        let menuLayout = new AggregateLayout();
        this.menu.box.set_layout_manager(menuLayout);

        this._indicators = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this.actor.add_child(this._indicators);

        if (Config.HAVE_NETWORKMANAGER) {
            this._network = new imports.ui.status.network.NMApplet();
        } else {
            this._network = null;
        }
        if (Config.HAVE_BLUETOOTH) {
            this._bluetooth = new imports.ui.status.bluetooth.Indicator();
        } else {
            this._bluetooth = null;
        }

        this._power = new imports.ui.status.power.Indicator();
        this._rfkill = new imports.ui.status.rfkill.Indicator();
        this._volume = new imports.ui.status.volume.Indicator();
        this._brightness = new imports.ui.status.brightness.Indicator();
        // this._system = new imports.ui.status.system.Indicator();
        // this._screencast = new imports.ui.status.screencast.Indicator();
        // this._location = new imports.ui.status.location.Indicator();

        // this._indicators.add_child(this._screencast.indicators);
        // this._indicators.add_child(this._location.indicators);
        if (this._network) {
            this._indicators.add_child(this._network.indicators);
        }
        if (this._bluetooth) {
            this._indicators.add_child(this._bluetooth.indicators);
        }
        this._indicators.add_child(this._rfkill.indicators);
        this._indicators.add_child(this._volume.indicators);
        this._indicators.add_child(this._power.indicators);
        this._indicators.add_child(PopupMenu.arrowIcon(St.Side.TOP));

        this.menu.addMenuItem(this._volume.menu);
        this.menu.addMenuItem(this._brightness.menu);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        if (this._network) {
            this.menu.addMenuItem(this._network.menu);
        }
        if (this._bluetooth) {
            this.menu.addMenuItem(this._bluetooth.menu);
        }
        // this.menu.addMenuItem(this._location.menu);
        this.menu.addMenuItem(this._rfkill.menu);
        this.menu.addMenuItem(this._power.menu);
        // this.menu.addMenuItem(this._system.menu);

        // menuLayout.addSizeChild(this._location.menu.actor);
        menuLayout.addSizeChild(this._rfkill.menu.actor);
        menuLayout.addSizeChild(this._power.menu.actor);
        // menuLayout.addSizeChild(this._system.menu.actor);
    },
});

const ShowAppsButton = new Lang.Class({
    Name: 'ShowAppsButton',
    Extends: PanelMenu.Button,

    _init: function(panel) {
        this.parent('', _("User Menu"), false);
        this.menu.actor.add_style_class_name('aggregate-menu');

        let menuLayout = new AggregateLayout();
        this.menu.box.set_layout_manager(menuLayout);

        this.actor.add_style_class_name('user-menu-icon');

        let box = new St.BoxLayout({ name: 'panelUserMenu' });
        this.actor.add_actor(box);

        this._panel = panel;

        this._icon = new St.Icon({ style_class: 'settings-menu-icon' });

        box.add(this._icon);

        let iconFile = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/endless-symbolic.svg');
        this._giconNormal = new Gio.FileIcon({ file: iconFile });

        this._icon.gicon = this._giconNormal;

        this._system = new imports.ui.status.system.Indicator();
        this.menu.addMenuItem(this._system.menu);
        menuLayout.addSizeChild(this._system.menu.actor);
    }
});


const PANEL_ITEM_IMPLEMENTATIONS = {
    'appIcons': imports.ui.appIconBar.AppIconBar,
    'aggregateMenu': AggregateMenu,
    'dateMenu': imports.ui.dateMenu.DateMenuButton,
    'a11y': imports.ui.status.accessibility.ATIndicator,
    'a11yGreeter': imports.ui.status.accessibility.ATGreeterIndicator,
    'volume': imports.ui.status.volume.Indicator,
    'battery': imports.ui.status.power.Indicator,
    'lockScreen': imports.ui.status.lockScreenMenu.Indicator,
    'logo': imports.gdm.loginDialog.LogoMenuButton,
    'keyboard': imports.ui.status.keyboard.InputSourceIndicator,
    'powerMenu': imports.gdm.powerMenu.PowerMenuButton,
    'showApps': ShowAppsButton,
    'showWindows': imports.ui.panelMenu.ShowWindowsButton,
    'system': imports.ui.status.system.Indicator,
    'socialBar': imports.ui.status.social.SocialBarButton,
    'panelSeparator': imports.ui.panelSeparator.PanelSeparator,
    'panelSeparator2': imports.ui.panelSeparator.PanelSeparator2,
    'hotCornerIndicator': imports.ui.status.hotCornerIndicator.HotCornerIndicator,
    'codingGame': imports.ui.status.codingGame.CodingGameIndicator
};

if (Config.HAVE_BLUETOOTH)
    PANEL_ITEM_IMPLEMENTATIONS['bluetooth'] =
        imports.ui.status.bluetooth.Indicator;

try {
    PANEL_ITEM_IMPLEMENTATIONS['network'] =
        imports.ui.status.network.NMApplet;
} catch(e) {
    log('NMApplet is not supported. It is possible that your NetworkManager version is too old');
}

const Panel = new Lang.Class({
    Name: 'Panel',

    _init : function() {
        this.actor = new Shell.GenericContainer({ name: 'panel',
                                                  reactive: true });
        this.actor._delegate = this;
        if (Main.layoutManager.startingUp)
            this.actor.hide();

        if (Main.sessionMode.isGreeter)
            this._panelAnimationDelay = 0.0;
        else
            this._panelAnimationDelay = AppDisplay.ICON_ANIMATION_DELAY +
                                        AppDisplay.ICON_ANIMATION_TIME;

        this._sessionStyle = null;

        this.statusArea = {};

        this.menuManager = new PopupMenu.PopupMenuManager(this);

        this._leftBox = new St.BoxLayout({ name: 'panelLeft', x_expand: true });
        this.actor.add_actor(this._leftBox);
        this._rightBox = new St.BoxLayout({ name: 'panelRight' });
        this.actor.add_actor(this._rightBox);

        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));

        Main.overview.connect('showing', Lang.bind(this, function () {
            this.actor.add_style_pseudo_class('overview');
        }));
        Main.overview.connect('hiding', Lang.bind(this, function () {
            this.actor.remove_style_pseudo_class('overview');
        }));

        Main.layoutManager.panelBox.add(this.actor);
        Main.ctrlAltTabManager.addGroup(this.actor, _("Taskbar"), 'emblem-system-symbolic',
                                        { sortGroup: CtrlAltTab.SortGroup.TOP });

        Main.sessionMode.connect('updated', Lang.bind(this, this._updatePanel));

        global.window_manager.connect('map', Lang.bind(this, this._updateBackground));
        global.window_manager.connect('size-change', Lang.bind(this, function(wm, actor, whichChange) {
            if (whichChange == Meta.SizeChange.MAXIMIZE)
                this.actor.remove_style_pseudo_class('unmaximized');
            else if (whichChange == Meta.SizeChange.UNMAXIMIZE)
                this._updateBackground();
        }));

        let windowTracker = Shell.WindowTracker.get_default();
        windowTracker.connect('tracked-windows-changed', Lang.bind(this, this._updateBackground));

        this._updatePanel();
        this._updateBackground();

        Main.layoutManager.connect('startup-complete',
            Lang.bind(this, function() {
                this.actor.opacity = 0;
                this.actor.translation_y = this.actor.height;
                this.actor.show();
                Tweener.addTween(this.actor, {
                    opacity: 255,
                    time: PANEL_ANIMATION_TIME,
                    transition: 'easeOutCubic',
                    delay: this._panelAnimationDelay,
                    onComplete: this._panelAnimationComplete,
                    onCompleteScope: this
                });
                Tweener.addTween(this.actor, {
                    translation_y: 0,
                    time: PANEL_ANIMATION_TIME,
                    transition: 'easeOutQuint',
                    delay: this._panelAnimationDelay
                });
            })
        );
    },

    _panelAnimationComplete: function() {
        /* Show Shared Account warning */
        let username = GLib.get_user_name();
        if (username == "shared") {
            Main.overview.setMessage(SHARED_ACCOUNT_MESSAGE,
                                     { forFeedback: true,
                                       isTransient: false });
        }
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

            this._addToPanelBox(role, indicator, i + nChildren, box, elements.length);
        }
    },

    _addToPanelBox: function(role, indicator, position, box, nElements) {
        let container = indicator.container;
        container.show();

        let parent = container.get_parent();
        if (parent)
            parent.remove_actor(container);

        if (!nElements) {
            box.insert_child_at_index(container, position);
        } else {
            let index = position;
            if (box === this._rightBox)
                index = nElements - index;

            animateIconIn(container, index);
            box.insert_child_at_index(container, position);
        }

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
