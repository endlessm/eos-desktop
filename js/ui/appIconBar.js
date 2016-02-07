// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Tweener = imports.ui.tweener;

const AppActivation = imports.ui.appActivation;
const AppFavorites = imports.ui.appFavorites;
const BoxPointer = imports.ui.boxpointer;
const Hash = imports.misc.hash;
const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Util = imports.misc.util;

const MAX_OPACITY = 255;
const MAX_ANGLE = 360;

const ICON_SIZE = 24;
const NAV_BUTTON_SIZE = 15;

const ICON_SCROLL_ANIMATION_TIME = 0.3;
const ICON_SCROLL_ANIMATION_TYPE = 'linear';

const ICON_BOUNCE_MAX_SCALE = 0.4;
const ICON_BOUNCE_ANIMATION_TIME = 0.4;
const ICON_BOUNCE_ANIMATION_TYPE_1 = 'easeOutSine';
const ICON_BOUNCE_ANIMATION_TYPE_2 = 'easeOutBounce';

const PANEL_WINDOW_MENU_THUMBNAIL_SIZE = 128;

function _compareByStableSequence(winA, winB) {
    let seqA = winA.get_stable_sequence();
    let seqB = winB.get_stable_sequence();

    return seqA - seqB;
}

const WindowMenuItem = new Lang.Class({
    Name: 'WindowMenuItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function (window, params) {
        this.parent(params);

        this.window = window;

        this.actor.add_style_class_name('panel-window-menu-item');

        let windowActor = this._findWindowActor();
        let monitor = Main.layoutManager.primaryMonitor;

        // constraint the max size of the clone to the aspect ratio
        // of the primary display, where the panel lives
        let ratio = monitor.width / monitor.height;
        let maxW = (ratio > 1) ?
            PANEL_WINDOW_MENU_THUMBNAIL_SIZE : PANEL_WINDOW_MENU_THUMBNAIL_SIZE * ratio;
        let maxH = (ratio > 1) ?
            PANEL_WINDOW_MENU_THUMBNAIL_SIZE / ratio : PANEL_WINDOW_MENU_THUMBNAIL_SIZE;

        let clone = new Clutter.Clone({ source: windowActor.get_texture() });
        let cloneW = clone.width;
        let cloneH = clone.height;
        let scale = Math.min(maxW / cloneW, maxH / cloneH);
        clone.set_size(Math.round(cloneW * scale), Math.round(cloneH * scale));

        this.cloneBin = new St.Bin({ child: clone,
                                     style_class: 'panel-window-menu-item-clone' });
        this.addActor(this.cloneBin, { align: St.Align.MIDDLE });

        this.label = new St.Label({ text: window.title,
                                    style_class: 'panel-window-menu-item-label' });

        this.addActor(this.label);
        this.actor.label_actor = this.label;
    },

    _findWindowActor: function() {
        let actors = global.get_window_actors();
        let windowActors = actors.filter(Lang.bind(this,
            function(actor) {
                return actor.meta_window == this.window;
            }));

        return windowActors[0];
    }
});

const ScrollMenuItem = new Lang.Class({
    Name: 'ScrollMenuItem',
    Extends: PopupMenu.PopupSubMenuMenuItem,

    _init: function() {
        this.parent('');

        // remove all the stock style classes
        this.actor.remove_style_class_name('popup-submenu-menu-item');
        this.actor.remove_style_class_name('popup-menu-item');

        // remove all the stock actors
        this.removeActor(this.label);
        this.removeActor(this._triangle);
        this.menu.destroy();

        this.label = null;
        this._triangle = null;

        this.menu = new PopupMenu.PopupSubMenu(this.actor, new St.Label({ text: '' }));
        this.menu.actor.remove_style_class_name('popup-sub-menu');
    },

    _onKeyPressEvent: function(actor, event) {
        // no special handling
        return false;
    },

    activate: function(event) {
        // override to do nothing
    },

    _onButtonReleaseEvent: function(actor) {
        // override to do nothing
    }
});

const APP_ICON_MENU_ARROW_XALIGN = 0.5;

const AppIconMenu = new Lang.Class({
    Name: 'AppIconMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(app, parentActor) {
        this.parent(parentActor, APP_ICON_MENU_ARROW_XALIGN, St.Side.BOTTOM);

        this.actor.add_style_class_name('app-icon-menu');

        this._submenuItem = new ScrollMenuItem();
        this.addMenuItem(this._submenuItem);
        this._submenuItem.menu.connect('activate', Lang.bind(this, this._onActivate));

        // We want to popdown the menu when clicked on the source icon itself
        this.shouldSwitchToOnHover = false;

        this._app = app;

        // Chain our visibility and lifecycle to that of the source
        parentActor.connect('notify::mapped', Lang.bind(this, function () {
            if (!parentActor.mapped) {
                this.close();
            }
        }));
        parentActor.connect('destroy', Lang.bind(this, function () { this.actor.destroy(); }));
    },

    _redisplay: function() {
        this._submenuItem.menu.removeAll();

        let activeWorkspace = global.screen.get_active_workspace();

        let windows = this._app.get_windows();
        let workspaceWindows = [];
        let otherWindows = [];

        windows.forEach(function(w) {
            if (!Shell.WindowTracker.is_window_interesting(w)) {
                return;
            }

            if (w.located_on_workspace(activeWorkspace)) {
                workspaceWindows.push(w);
            } else {
                otherWindows.push(w);
            }
        });

        workspaceWindows.sort(Lang.bind(this, _compareByStableSequence));
        otherWindows.sort(Lang.bind(this, _compareByStableSequence));

        let hasWorkspaceWindows = (workspaceWindows.length > 0);
        let hasOtherWindows = (otherWindows.length > 0);

        // Display windows from other workspaces first, if present, since our panel
        // is at the bottom, and it's much more convenient to just move up the pointer
        // to switch windows in the current workspace
        if (hasOtherWindows) {
            this._appendOtherWorkspacesLabel();
        }

        otherWindows.forEach(Lang.bind(this,
            function(w) {
                this._appendMenuItem(w, hasOtherWindows);
            }));

        if (hasOtherWindows && hasWorkspaceWindows) {
            this._appendCurrentWorkspaceSeparator();
        }

        workspaceWindows.forEach(Lang.bind(this,
            function(w) {
                this._appendMenuItem(w, hasOtherWindows);
            }));
    },

    _appendOtherWorkspacesLabel: function () {
        let label = new PopupMenu.PopupMenuItem(_("Other workspaces"));
        label.label.add_style_class_name('panel-window-menu-workspace-label');
        this._submenuItem.menu.addMenuItem(label);
    },

    _appendCurrentWorkspaceSeparator: function () {
        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this._submenuItem.menu.addMenuItem(separator);

        let label = new PopupMenu.PopupMenuItem(_("Current workspace"));
        label.label.add_style_class_name('panel-window-menu-workspace-label');
        this._submenuItem.menu.addMenuItem(label);
    },

    _appendMenuItem: function(window, hasOtherWindows) {
        let item = new WindowMenuItem(window);
        this._submenuItem.menu.addMenuItem(item);

        if (hasOtherWindows) {
            item.cloneBin.add_style_pseudo_class('indented');
        }
    },

    toggle: function(animation) {
        if (this.isOpen) {
            this.close(animation);
        } else {
            this._redisplay();
            this.open(animation);
            this._submenuItem.menu.open(BoxPointer.PopupAnimation.NONE);
        }
    },

    _onActivate: function (actor, item) {
        Main.activateWindow(item.window);
        this.close();
    }
});
Signals.addSignalMethods(AppIconMenu.prototype);

/** AppIconButton:
 *
 * This class handles the application icon
 */
const AppIconButton = new Lang.Class({
    Name: 'AppIconButton',

    _init: function(app, iconSize, menuManager) {
        this._app = app;

        this._iconSize = iconSize;
        let icon = this._createIcon();

        this._menuManager = menuManager;

        this.actor = new St.Button({ style_class: 'app-icon-button',
                                     child: icon,
                                     button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE
                                   });
        this.actor.reactive = true;

        this._label = new St.Label({ text: this._app.get_name(),
                                     style_class: 'app-icon-hover-label' });
        this._label.connect('style-changed', Lang.bind(this, this._updateStyle));

        // Handle the menu-on-press case for multiple windows
        this.actor.connect('button-press-event', Lang.bind(this, this._handleButtonPressEvent));
        this.actor.connect('clicked', Lang.bind(this, this._handleClickEvent));

        Main.layoutManager.connect('startup-complete', Lang.bind(this,
            this._updateIconGeometry));
        this.actor.connect('notify::allocation', Lang.bind(this,
            this._updateIconGeometry));
        this.actor.connect('destroy', Lang.bind(this,
            this._onDestroy));
        this.actor.connect('enter-event', Lang.bind(this, this._showHoverState));
        this.actor.connect('leave-event', Lang.bind(this, this._hideHoverState));

        this._rightClickMenuManager = new PopupMenu.PopupMenuManager(this);

        this._rightClickMenu = new PopupMenu.PopupMenu(this.actor, 0.0, St.Side.TOP, 0);
        this._rightClickMenu.blockSourceEvents = true;

        let favorites = AppFavorites.getAppFavorites();

        this._pinMenuItem = this._rightClickMenu.addAction(_("Pin to Taskbar"), Lang.bind(this, function() {
            favorites.addFavorite(this._app.get_id());
            this._pinMenuItem.actor.visible = false;
            this._unpinMenuItem.actor.visible = true;
        }));

        this._unpinMenuItem = this._rightClickMenu.addAction(_("Unpin from Taskbar"), Lang.bind(this, function() {
            favorites.removeFavorite(this._app.get_id());
            this._pinMenuItem.actor.visible = true;
            this._unpinMenuItem.actor.visible = false;
        }));

        if (favorites.isFavorite(this._app.get_id()))
            this._pinMenuItem.actor.visible = false;
        else
            this._unpinMenuItem.actor.visible = false;

        this._quitMenuItem = this._rightClickMenu.addAction(_("Quit %s").format(this._app.get_name()), Lang.bind(this, function() {
            this._app.request_quit();
        }));
        this._rightClickMenuManager.addMenu(this._rightClickMenu);
        this._rightClickMenu.actor.hide();
        Main.uiGroup.add_actor(this._rightClickMenu.actor);

        this._menu = new AppIconMenu(this._app, this.actor);
        this._menuManager.addMenu(this._menu);
        this._menu.actor.hide();
        Main.uiGroup.add_actor(this._menu.actor);

        this._menu.connect('open-state-changed', Lang.bind(this,
            function(menu, open) {
                // Setting the max-height won't do any good if the minimum height of the
                // menu is higher then the screen; it's useful if part of the menu is
                // scrollable so the minimum height is smaller than the natural height
                let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
                this._menu.actor.style = ('max-height: ' + Math.round(workArea.height) + 'px;');
            }));

        this._appStateUpdatedId = this._app.connect('notify::state', Lang.bind(this, this._syncQuitMenuItemVisible));
        this._syncQuitMenuItemVisible();
    },

    _syncQuitMenuItemVisible: function() {
        let visible = (this._app.get_state() == Shell.AppState.RUNNING);
        this._quitMenuItem.actor.visible = visible;
    },

    _createIcon: function() {
        return this._app.create_icon_texture(this._iconSize);
    },

    _hasOtherMenuOpen: function() {
        let activeIconMenu = this._menuManager.activeMenu;
        return (activeIconMenu &&
                activeIconMenu != this._menu &&
                activeIconMenu.isOpen);
    },

    _closeOtherMenus: function(animation) {
        // close any other open menu
        if (this._hasOtherMenuOpen()) {
            this._menuManager.activeMenu.toggle(animation);
        }
    },

    _handleButtonPressEvent: function(actor, event) {
        let button = event.get_button();
        let clickCount = event.get_click_count();

        if (button == Gdk.BUTTON_PRIMARY &&
            clickCount == 1) {
            this._hideHoverState();
            this.emit('app-icon-pressed');

            let windows = this._app.get_windows();
            windows = windows.filter(function(metaWindow) {
                return Shell.WindowTracker.is_window_interesting(metaWindow);
            });

            if (windows.length > 1) {
                let hasOtherMenu = this._hasOtherMenuOpen();
                let animation = BoxPointer.PopupAnimation.FULL;
                if (hasOtherMenu) {
                    animation = BoxPointer.PopupAnimation.NONE;
                }

                this._closeOtherMenus(animation);
                this._animateBounce();

                this.actor.fake_release();
                this._menu.toggle(animation);
                this._menuManager.ignoreRelease();

                // This will block the clicked signal from being emitted
                return true;
            }
        }

        this.actor.sync_hover();
        return false;
    },

    _handleClickEvent: function() {
        let event = Clutter.get_current_event();
        let button = event.get_button();

        if (button == Gdk.BUTTON_SECONDARY) {
            this._hideHoverState();

            this._closeOtherMenus(BoxPointer.PopupAnimation.FULL);
            if (this._menu.isOpen) {
                this._menu.toggle(BoxPointer.PopupAnimation.FULL);
            }

            this._rightClickMenu.open();
            return;
        }

        let hasOtherMenu = this._hasOtherMenuOpen();
        this._closeOtherMenus(BoxPointer.PopupAnimation.FULL);
        this._animateBounce();

        // The multiple windows case is handled in button-press-event
        let windows = this._app.get_windows();
        windows = windows.filter(function(metaWindow) {
            return Shell.WindowTracker.is_window_interesting(metaWindow);
        });

        if (windows.length == 0) {
            let activationContext = new AppActivation.AppActivationContext(this._app);
            activationContext.activate();
        } else if (windows.length == 1) {
            let win = windows[0];
            if (win.has_focus() && !Main.overview.visible && !hasOtherMenu) {
                // The overview is not visible, and this is the
                // currently focused application; minimize it
                win.minimize();
            } else {
                // Activate window normally
                Main.activateWindow(win);
            }
        }
    },

    _hideHoverState: function() {
        this.actor.fake_release();
        if (this._label.get_parent() != null) {
            Main.uiGroup.remove_actor(this._label);
        }
    },

    _showHoverState: function() {
        // Show label only if it's not already visible
        this.actor.fake_release();
        if (!this._label.get_parent()) {
            Main.uiGroup.add_actor(this._label);
            this._label.raise_top();

            // Calculate location of the label only if we're not tweening as the
            // values will be inaccurate
            if (!Tweener.isTweening(this.actor)) {
                let iconMidpoint = this.actor.get_transformed_position()[0] + this.actor.width / 2;
                this._label.translation_x = Math.floor(iconMidpoint - this._label.width / 2);
                this._label.translation_y = Math.floor(this.actor.get_transformed_position()[1] - this._labelOffsetY);

                // Clip left edge to be the left edge of the screen
                this._label.translation_x = Math.max(this._label.translation_x, 0);
            }
        }
    },

    _animateBounce: function() {
        if (!Tweener.isTweening(this.actor)) {
            Tweener.addTween(this.actor, {
                scale_y: 1 - ICON_BOUNCE_MAX_SCALE,
                scale_x: 1 + ICON_BOUNCE_MAX_SCALE,
                translation_y: this.actor.height * ICON_BOUNCE_MAX_SCALE,
                translation_x: -this.actor.width * ICON_BOUNCE_MAX_SCALE / 2,
                time: ICON_BOUNCE_ANIMATION_TIME * 0.25,
                transition: ICON_BOUNCE_ANIMATION_TYPE_1
            });
            Tweener.addTween(this.actor, {
                scale_y: 1,
                scale_x: 1,
                translation_y: 0,
                translation_x: 0,
                time: ICON_BOUNCE_ANIMATION_TIME * 0.75,
                transition: ICON_BOUNCE_ANIMATION_TYPE_2,
                delay: ICON_BOUNCE_ANIMATION_TIME * 0.25
            });
        }
    },

    setIconSize: function(iconSize) {
        let icon = this._app.create_icon_texture(iconSize);
        this._iconSize = iconSize;

        this.actor.set_child(icon);
    },

    _onDestroy: function() {
        this._label.destroy();
        this._resetIconGeometry();

        if (this._appStateUpdatedId > 0) {
            this._app.disconnect(this._appStateUpdatedId);
            this._appStateUpdatedId = 0;
        }
    },

    _resetIconGeometry: function() {
        let windows = this._app.get_windows();
        windows.forEach(Lang.bind(this,
            function(win) {
                win.set_icon_geometry(null);
            }));
    },

    _updateIconGeometry: function() {
        if (!this.actor.mapped) {
            return;
        }

        let rect = new Meta.Rectangle();
        [rect.x, rect.y] = this.actor.get_transformed_position();
        [rect.width, rect.height] = this.actor.get_transformed_size();

        let windows = this._app.get_windows();
        windows.forEach(Lang.bind(this,
            function(win) {
                win.set_icon_geometry(rect);
            }));
    },

    _updateStyle: function(actor, forHeight, alloc) {
        this._labelOffsetY = this._label.get_theme_node().get_length('-label-offset-y');
    }
});
Signals.addSignalMethods(AppIconButton.prototype);

/** AppIconBarNavButton:
 *
 * This class handles the nav buttons on the app bar
 */
const AppIconBarNavButton = Lang.Class({
    Name: 'AppIconBarNavButton',
    Extends: St.Button,

    _init: function(imagePath, pressHandler) {
        let iconFile = Gio.File.new_for_uri('resource:///org/gnome/shell' + imagePath);
        let gicon = new Gio.FileIcon({ file: iconFile });

        this._icon = new St.Icon({ style_class: 'app-bar-nav-icon',
                                   gicon: gicon
                                 });
        this._icon.connect('style-changed', Lang.bind(this, this._updateStyle));

        this.parent({ style_class: 'app-bar-nav-button',
                      child: this._icon,
                      can_focus: true,
                      reactive: true,
                      track_hover: true,
                      button_mask: St.ButtonMask.ONE
                    });

        this.connect('clicked', pressHandler);
    },

    _updateStyle: function(actor, forHeight, alloc) {
        this._size = this._icon.get_theme_node().get_length('icon-size');
        this._spacing = this._icon.get_theme_node().get_length('spacing');
    },

    getSize: function() {
        return this._size;
    },

    getSpacing: function() {
        return this._spacing;
    }
});


const ScrolledIconList = new Lang.Class({
    Name: 'ScrolledIconList',

    _init: function(excludedApps, menuManager) {
        this.actor = new St.ScrollView({ hscrollbar_policy: Gtk.PolicyType.NEVER,
                                         style_class: 'scrolled-icon-list hfade',
                                         vscrollbar_policy: Gtk.PolicyType.NEVER,
                                         x_fill: true,
                                         y_fill: true });

        this._menuManager = menuManager;

        // Due to the interactions with StScrollView,
        // StBoxLayout clips its painting to the content box, effectively
        // clipping out the side paddings we want to set on the actual icons
        // container. We need to go through some hoops and set the padding
        // on an intermediate spacer child instead
        let scrollChild = new St.BoxLayout();
        this.actor.add_actor(scrollChild);

        let spacerBin = new St.Widget({ style_class: 'scrolled-icon-spacer',
                                        layout_manager: new Clutter.BinLayout() });
        scrollChild.add_actor(spacerBin);

        this._container = new St.BoxLayout({ style_class: 'scrolled-icon-container',
                                             x_expand: true,
                                             y_expand: true });
        spacerBin.add_actor(this._container);

        this._iconSize = ICON_SIZE;
        this._iconSpacing = 0;

        this._iconOffset = 0;
        this._appsPerPage = -1;

        this._container.connect('style-changed', Lang.bind(this, this._updateStyleConstants));

        let appSys = Shell.AppSystem.get_default();
        this._taskbarApps = new Hash.Map();

        this._numExcludedApps = 0;
        // Exclusions are added to the base list
        for (let appIndex in excludedApps) {
            this._runningApps.set(excludedApps[appIndex], null);
            this._numExcludedApps += 1;
        }

        // Update for any apps running before the system started
        // (after a crash or a restart)
        let currentlyRunning = appSys.get_running();
        let appsByPid = new Hash.Map();
        for (let i = 0; i < currentlyRunning.length; i++) {
            let app = currentlyRunning[i];
            // Most apps have a single PID; ignore all but the first
            let pid = app.get_pids()[0];
            appsByPid.set(pid, app);
        }

        let favorites = AppFavorites.getAppFavorites().getFavorites();
        for (let i = 0; i < favorites.length; i++) {
            this._addButtonAnimated(favorites[i], i + 1); // plus one for user menu
        }

        // Sort numerically by PID
        // This preserves the original app order, until the maximum PID
        // value is reached and older PID values are recycled
        let sortedPids = appsByPid.keys().sort(function(a, b) {return a - b;});
        for (let i = 0; i < sortedPids.length; i++) {
            let pid = sortedPids[i];
            let app = appsByPid.get(pid);
            this._addButtonAnimated(app, favorites.length + i + 2); // offset for user menu and browser icon
        }

        appSys.connect('app-state-changed', Lang.bind(this, this._onAppStateChanged));
    },

    setActiveApp: function(app) {
        this._taskbarApps.items().forEach(Lang.bind(this,
            function(item) {
                let [taskbarApp, appButton] = item;
                if (!appButton) {
                    return;
                }

                if (app == taskbarApp) {
                    appButton.actor.add_style_pseudo_class('highlighted');
                } else {
                    appButton.actor.remove_style_pseudo_class('highlighted');
                }
            }));
    },

    getIconSize: function() {
        return this._iconSize;
    },

    getMinWidth: function() {
        return this._iconSize;
    },

    getNaturalWidth: function() {
        let iconArea = 0;
        let nApps = this._taskbarApps.size();
        if (nApps > 0) {
            let iconSpacing = this._iconSpacing * (nApps - 1);
            iconArea = this._iconSize * nApps + iconSpacing;
        }
        return iconArea;
    },

    _updatePage: function() {
        // Clip the values of the iconOffset
        let lastIconOffset = this._taskbarApps.size() - this._numExcludedApps - 1;
        let movableIconsPerPage = this._appsPerPage - 1;
        this._iconOffset = Math.max(0, this._iconOffset);
        this._iconOffset = Math.min(lastIconOffset - movableIconsPerPage, this._iconOffset);

        let relativeAnimationTime = ICON_SCROLL_ANIMATION_TIME;

        let iconFullWidth = this._iconSize + this._iconSpacing;
        let pageSize = this._appsPerPage * iconFullWidth;
        let hadjustment = this.actor.hscroll.adjustment;

        let currentOffset = this.actor.hscroll.adjustment.get_value();
        let targetOffset = Math.min(this._iconOffset * iconFullWidth, hadjustment.upper);

        let distanceToTravel = Math.abs(targetOffset - currentOffset);
        if (distanceToTravel < pageSize) {
            relativeAnimationTime = relativeAnimationTime * distanceToTravel / pageSize;
        }

        Tweener.addTween(hadjustment, { value: targetOffset,
                                        time: relativeAnimationTime,
                                        transition: ICON_SCROLL_ANIMATION_TYPE });
        this.emit('icons-scrolled');
    },

    pageBack: function() {
        this._iconOffset -= this._appsPerPage - 1;
        this._updatePage();
    },

    pageForward: function() {
        this._iconOffset += this._appsPerPage - 1;
        this._updatePage();
    },

    isBackAllowed: function() {
        return this._iconOffset > 0;
    },

    isForwardAllowed: function() {
        return this._iconOffset < this._taskbarApps.size() - this._appsPerPage - this._numExcludedApps;
    },

    calculateNaturalSize: function(forWidth) {
        let [numOfPages, appsPerPage] = this._calculateNumberOfPages(forWidth);

        this._appsPerPage = appsPerPage;
        this._numberOfPages = numOfPages;

        this._updatePage();

        let iconFullSize = this._iconSize + this._iconSpacing;
        return this._appsPerPage * iconFullSize - this._iconSpacing;
    },

    _updateStyleConstants: function() {
        let node = this._container.get_theme_node();

        this._iconSize = node.get_length("-icon-size");
        this._taskbarApps.items().forEach(Lang.bind(this,
            function(app) {
                let appButton = app[1];
                if (appButton != null) {
                    appButton.setIconSize(this._iconSize);
                }
            }));

        this._iconSpacing = node.get_length("spacing");
    },

    _ensureIsVisible: function(app) {
        let itemIndex = this._taskbarApps.keys().indexOf(app);
        if (itemIndex != -1) {
            this._iconOffset = itemIndex - this._numExcludedApps;
        }

        this._updatePage();
    },

    _isAppInteresting: function(app) {
        if (AppFavorites.getAppFavorites().isFavorite(app.get_id()))
            return true;

        if (app.state == Shell.AppState.STARTING)
            return true;

        if (app.state == Shell.AppState.RUNNING) {
            let windows = app.get_windows();
            return windows.some(function(metaWindow) {
                return Shell.WindowTracker.is_window_interesting(metaWindow);
            });
        }

        return false;
    },

    _addButtonAnimated: function(app, index) {
        if (this._taskbarApps.has(app)) {
            return;
        }

        if (!this._isAppInteresting(app)) {
            return;
        }

        let newChild = new AppIconButton(app, this._iconSize, this._menuManager);
        newChild.connect('app-icon-pressed', Lang.bind(this, function() { this.emit('app-icon-pressed'); }));
        this._taskbarApps.set(app, newChild);

        if (index == -1) {
            this._container.add_actor(newChild.actor);
        } else {
            let newActor = newChild.actor;
            Panel.animateIconIn(newActor, index);
            this._container.add_actor(newActor);
        }
    },

    _addButton: function(app) {
        this._addButtonAnimated(app, -1);
    },

    _onAppStateChanged: function(appSys, app) {
        let state = app.state;
        switch(state) {
        case Shell.AppState.STARTING:
            this._addButton(app);
            this._ensureIsVisible(app);
            break;

        case Shell.AppState.RUNNING:
            // The normal sequence of events appears to be
            // STARTING -> STOPPED -> RUNNING -> STOPPED
            // but sometimes it can go STARTING -> RUNNING -> STOPPED
            // So we only want to add an app here if we don't already
            // have an icon for @app
            this._addButton(app);
            this._ensureIsVisible(app);
            break;

        case Shell.AppState.STOPPED:
            if (app == this._browserApp) {
                break;
            }

            let oldChild = this._taskbarApps.get(app);
            if (oldChild) {
                oldChild.actor.destroy();
                this._taskbarApps.delete(app);
            }
            break;
        }

        this._updatePage();
    },

    _calculateNumberOfPages: function(forWidth){
        let minimumIconWidth = this._iconSize + this._iconSpacing;

        // We need to clip the net width since initially may be 0
        forWidth = Math.max(0, forWidth);

        // We need to add one icon space to net width here so that the division
        // takes into account the fact that the last icon does not use iconSpacing
        let iconsPerPage = Math.floor((forWidth + this._iconSpacing) / minimumIconWidth);
        iconsPerPage = Math.max(1, iconsPerPage);

        let pages = Math.ceil((this._taskbarApps.items().length - this._numExcludedApps) / iconsPerPage);

        // If we only have one page, previous calculations will return 0 so
        // we clip the value here
        pages = Math.max(1, pages);

        return [pages, iconsPerPage];
    },

    _getAppsOnPage: function(pageNum, appsPerPage){
        let apps = this._taskbarApps.items();

        let startIndex = appsPerPage * pageNum + this._numExcludedApps;
        let endIndex = Math.min(startIndex + appsPerPage, apps.length);

        let appsOnPage = apps.slice(startIndex, endIndex);

        return [appsOnPage, apps];
    }
});
Signals.addSignalMethods(ScrolledIconList.prototype);

const BrowserButton = new Lang.Class({
    Name: 'BrowserButton',
    Extends: AppIconButton,

    _init: function(app, iconSize, menuManager) {
        this.parent(app, iconSize, menuManager);
        this.actor.add_style_class_name('browser-icon');
    },

    _createIcon: function() {
        let iconFileNormal = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/internet-normal.png');
        let giconNormal = new Gio.FileIcon({ file: iconFileNormal });
        return new St.Icon({ gicon: giconNormal,
                             style_class: 'browser-icon' });
    },

    // overrides default implementation
    setIconSize: function(iconSize) {
        return
    },
});

/** AppIconBar:
 *
 * This class handles positioning all the application icons and listening
 * for app state change signals
 */
const AppIconBar = new Lang.Class({
    Name: 'AppIconBar',
    Extends: PanelMenu.Button,

    _init: function(panel) {
        this.parent(0.0, null, true);
        this.actor.add_style_class_name('app-icon-bar');

        this._panel = panel;

        this._menuManager = new PopupMenu.PopupMenuManager(this);

        let bin = new St.Bin({ name: 'appIconBar',
                               x_fill: true });
        this.actor.connect('style-changed', Lang.bind(this, this._updateStyleConstants));

        this.actor.add_actor(bin);

        this._container = new Shell.GenericContainer();

        bin.set_child(this._container);
        this._container.connect('get-preferred-width', Lang.bind(this, this._getContentPreferredWidth));
        this._container.connect('get-preferred-height', Lang.bind(this, this._getContentPreferredHeight));
        this._container.connect('allocate', Lang.bind(this, this._contentAllocate));

        this._navButtonSize = 0;
        this._navButtonSpacing = 0;

        this._backButton = new AppIconBarNavButton('/theme/app-bar-back-symbolic.svg', Lang.bind(this, this._previousPageSelected));
        this._forwardButton = new AppIconBarNavButton('/theme/app-bar-forward-symbolic.svg', Lang.bind(this, this._nextPageSelected));

        this._container.add_actor(this._backButton);

        this._browserButton = null;
        this._browserApp = Util.getBrowserApp();
        if (this._browserApp) {
            this._browserButton = new BrowserButton(this._browserApp, ICON_SIZE, this._menuManager);
            this._browserButton.connect('app-icon-pressed', Lang.bind(this, this._onAppIconPressed));

            Panel.animateIconIn(this._browserButton.actor, 1);
            this._container.add_actor(this._browserButton.actor);
        }

        this._scrolledIconList = new ScrolledIconList([this._browserApp], this._menuManager);
        this._container.add_actor(this._scrolledIconList.actor);

        this._container.add_actor(this._forwardButton);

        this._scrolledIconList.connect('icons-scrolled', Lang.bind(this, this._updateNavButtonState));
        this._scrolledIconList.connect('app-icon-pressed', Lang.bind(this, this._onAppIconPressed));

        this._windowTracker = Shell.WindowTracker.get_default();
        this._windowTracker.connect('notify::focus-app', Lang.bind(this, this._updateActiveApp));
        Main.overview.connect('showing', Lang.bind(this, this._updateActiveApp));
        Main.overview.connect('hidden', Lang.bind(this, this._updateActiveApp));

        this._updateActiveApp();
    },

    _onAppIconPressed: function() {
        this._panel.closeActiveMenu();
    },

    _updateActiveApp: function() {
        if (Main.overview.visible) {
            this._setActiveApp(null);
            return;
        }

        let focusApp = this._windowTracker.focus_app;
        if (!focusApp) {
            return;
        }
        this._setActiveApp(focusApp);
    },

    _setActiveApp: function(app) {
        if (this._browserButton != null) {
            if (app == this._browserApp) {
                this._browserButton.actor.add_style_pseudo_class('highlighted');
            } else {
                this._browserButton.actor.remove_style_pseudo_class('highlighted');
            }
        }

        this._scrolledIconList.setActiveApp(app);
    },

    _previousPageSelected: function() {
        this._scrolledIconList.pageBack();
        this._updateNavButtonState();
    },

    _nextPageSelected: function() {
        this._scrolledIconList.pageForward();
        this._updateNavButtonState();
    },

    _updateNavButtonState: function() {
        let backButtonOpacity = MAX_OPACITY;
        if (!this._scrolledIconList.isBackAllowed()) {
            backButtonOpacity = 0;
        }

        let forwardButtonOpacity = MAX_OPACITY;
        if (!this._scrolledIconList.isForwardAllowed()) {
            forwardButtonOpacity = 0;
        }

        this._backButton.opacity = backButtonOpacity;
        this._forwardButton.opacity = forwardButtonOpacity;
    },

    _getContentPreferredWidth: function(actor, forHeight, alloc) {
        alloc.min_size = 2 * this._navButtonSize + 3 * this._navButtonSpacing +
                             this._scrolledIconList.getMinWidth() +
                             this._scrolledIconList.getIconSize();
        alloc.natural_size = 2 * this._navButtonSize + 3 * this._navButtonSpacing +
                                 this._scrolledIconList.getNaturalWidth() +
                                 this._scrolledIconList.getIconSize();
    },

    _getContentPreferredHeight: function(actor, forWidth, alloc) {
        alloc.min_size = Math.max(this._scrolledIconList.getIconSize(), this._navButtonSize);

        let scrolledListNaturalHeight = this._scrolledIconList.actor.get_preferred_height(forWidth)[0];
        alloc.natural_size = Math.max(alloc.min_size, scrolledListNaturalHeight);
    },

    _updateStyleConstants: function() {
        this._navButtonSize = this._backButton.getSize();
        this._navButtonSpacing = this._backButton.getSpacing();
    },

    _contentAllocate: function(actor, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let [minWidth, minHeight, naturalWidth, naturalHeight] = this._container.get_preferred_size();
        let yPadding = Math.floor(Math.max(0, allocHeight - naturalHeight) / 2);
        let maxIconSpace = allocWidth - 2 * (this._navButtonSize + this._navButtonSpacing);

        let childBox = new Clutter.ActorBox();
        childBox.y1 = yPadding;
        childBox.y2 = childBox.y1 + Math.min(naturalHeight, allocHeight);

        if (actor.get_text_direction() == Clutter.TextDirection.RTL) {
            childBox.x1 = allocWidth;
            childBox.x2 = allocWidth;

            if (this._scrolledIconList.isBackAllowed()) {
                childBox.x1 = childBox.x2 - this._navButtonSize;
                this._backButton.allocate(childBox, flags);

                childBox.x1 -= this._navButtonSpacing;
            }

            if (this._browserButton) {
                childBox.x2 = childBox.x1;
                childBox.x1 = childBox.x2 - this._scrolledIconList.getIconSize();
                this._browserButton.actor.allocate(childBox, flags);
            }

            childBox.x2 = childBox.x1;
            childBox.x1 = childBox.x2 - this._scrolledIconList.calculateNaturalSize(maxIconSpace) - 2 * this._navButtonSpacing;
            this._scrolledIconList.actor.allocate(childBox, flags);

            childBox.x2 = childBox.x1;
            childBox.x1 = childBox.x2 - this._navButtonSize;
            this._forwardButton.allocate(childBox, flags);
        } else {
            childBox.x1 = 0;
            childBox.x2 = 0;

            if (this._scrolledIconList.isBackAllowed()) {
                childBox.x2 = childBox.x1 + this._navButtonSize;
                this._backButton.allocate(childBox, flags);

                childBox.x2 += this._navButtonSpacing;
            }

            if (this._browserButton) {
                childBox.x1 = childBox.x2;
                childBox.x2 = childBox.x1 + this._scrolledIconList.getIconSize();
                this._browserButton.actor.allocate(childBox, flags);
            }

            childBox.x1 = childBox.x2;
            childBox.x2 = childBox.x1 + this._scrolledIconList.calculateNaturalSize(maxIconSpace) + 2 * this._navButtonSpacing;
            this._scrolledIconList.actor.allocate(childBox, flags);

            childBox.x1 = childBox.x2;
            childBox.x2 = childBox.x1 + this._navButtonSize;
            this._forwardButton.allocate(childBox, flags);
        }

        this._updateNavButtonState();
    }
});
