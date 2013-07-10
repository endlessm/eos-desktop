// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;
const Gio = imports.gi.Gio;

const BoxPointer = imports.ui.boxpointer;
const ButtonConstants = imports.ui.buttonConstants;
const Hash = imports.misc.hash;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ICON_SIZE = 26;
const NAV_BUTTON_SIZE = 15;

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

        this._submenuItem = new ScrollMenuItem();
        this.addMenuItem(this._submenuItem);
        this._submenuItem.menu.connect('activate', Lang.bind(this, this._onActivate));

        // We want to popdown the menu when clicked on the source icon itself
        this.blockSourceEvents = true;

        this._app = app;

        // Chain our visibility and lifecycle to that of the source
        parentActor.connect('notify::mapped', Lang.bind(this, function () {
            if (!parentActor.mapped) {
                this.close();
            }
        }));
        parentActor.connect('destroy', Lang.bind(this, function () { this.actor.destroy(); }));

        Main.uiGroup.add_actor(this.actor);
    },

    _redisplay: function() {
        this._submenuItem.menu.removeAll();

        let tracker = Shell.WindowTracker.get_default();
        let activeWorkspace = global.screen.get_active_workspace();

        let windows = this._app.get_windows();
        let workspaceWindows = [];
        let otherWindows = [];

        windows.forEach(function(w) {
            if (!tracker.is_window_interesting(w)) {
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

    popup: function() {
        this._redisplay();
        this.open();
        this._submenuItem.menu.open(BoxPointer.PopupAnimation.NONE);
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

    _init: function(app, iconSize) {
        this._app = app;

        let icon = app.create_icon_texture(iconSize);

        this.actor = new St.Button({ style_class: 'app-icon-button',
                                     child: icon,
                                     button_mask: St.ButtonMask.ONE
                                   });
        this.actor.reactive = true;

        // Handle the menu-on-press case for multiple windows
        this.actor.connect('button-press-event', Lang.bind(this,
            function(actor, event) {
                let button = event.get_button();

                if (button == ButtonConstants.LEFT_MOUSE_BUTTON) {
                    let windows = app.get_windows();
                    if (windows.length > 1) {
                        this._ensureMenu();
                        this._menu.popup();
                        this._menuManager.ignoreRelease();

                        // This will block the clicked signal from being emitted
                        return true;
                    }
                }

                this.actor.sync_hover();
                return false;
            }));

        this.actor.connect('clicked', Lang.bind(this,
            function() {
                // The multiple windows case is handled in button-press-event
                let windows = app.get_windows();
                if (windows.length == 1) {
                    if (windows[0].has_focus() && !Main.overview.visible) {
                        windows[0].minimize();
                    } else {
                        Main.activateWindow(windows[0]);
                    }
                }
            }));

        Main.layoutManager.connect('startup-complete', Lang.bind(this,
            this._updateIconGeometry));
        this.actor.connect('notify::allocation', Lang.bind(this,
            this._updateIconGeometry));
        this.actor.connect('destroy', Lang.bind(this,
            this._resetIconGeometry));
    },

    setIconSize: function(iconSize) {
        let icon = this._app.create_icon_texture(iconSize);

        this.actor.set_child(icon);
    },

    _resetIconGeometry: function() {
        let windows = this._app.get_windows();
        windows.forEach(Lang.bind(this,
            function(win) {
                win.set_icon_geometry(null);
            }));
    },

    _updateIconGeometry: function() {
        let rect = new Meta.Rectangle();
        [rect.x, rect.y] = this.actor.get_transformed_position();
        [rect.width, rect.height] = this.actor.get_transformed_size();

        let windows = this._app.get_windows();
        windows.forEach(Lang.bind(this,
            function(win) {
                win.set_icon_geometry(rect);
            }));
    },

    _ensureMenu: function() {
        this.actor.fake_release();

        if (this._menu) {
            return;
        }

        this._menuManager = new PopupMenu.PopupMenuManager(this);

        this._menu = new AppIconMenu(this._app, this.actor);
        this._menuManager.addMenu(this._menu);

        this._menu.connect('open-state-changed', Lang.bind(this,
            function(menu, open) {
                // Setting the max-height won't do any good if the minimum height of the
                // menu is higher then the screen; it's useful if part of the menu is
                // scrollable so the minimum height is smaller than the natural height
                let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
                this._menu.actor.style = ('max-height: ' + Math.round(workArea.height) + 'px;');
            }));
    }
});

/** AppIconBarNavButton:
 *
 * This class handles the nav buttons on the app bar
 */
const AppIconBarNavButton = Lang.Class({
    Name: 'AppIconBarNavButton',
    Extends: St.Button,

    _init: function(imagePath, pressHandler) {
        let iconFile = Gio.File.new_for_path(global.datadir + imagePath);
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

    getSize: function(actor, forHeight, alloc) {
        return this._size;
    },

    getSpacing: function() {
        return this._spacing;
    }
});

/** AppIconBar:
 *
 * This class handles positioning all the application icons and listening
 * for app state change signals
 */
const AppIconBar = new Lang.Class({
    Name: 'AppIconBar',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, null, true);
        this.actor.add_style_class_name('app-icon-bar');

        let bin = new St.Bin({ name: 'appIconBar',
                               x_fill: true });
        this.actor.connect('style-changed', Lang.bind(this, this._updateStyleConstants));

        this.actor.add_actor(bin);

        this._container = new Shell.GenericContainer();

        bin.set_child(this._container);
        this._container.connect('get-preferred-width', Lang.bind(this, this._getContentPreferredWidth));
        this._container.connect('get-preferred-height', Lang.bind(this, this._getContentPreferredHeight));
        this._container.connect('allocate', Lang.bind(this, this._contentAllocate));

        this._numberOfApps = 0;
        this._currentPage = 0;
        this._appsPerPage = -1;
        this._runningApps = new Hash.Map();

        this._iconSize = ICON_SIZE;
        this._iconSpacing = 0;
        this._navButtonSize = 0;
        this._navButtonSpacing = 0;

        let appSys = Shell.AppSystem.get_default();

        this._backButton = new AppIconBarNavButton('/theme/app-bar-back-symbolic.svg', Lang.bind(this, this._previousPageSelected));
        this._forwardButton = new AppIconBarNavButton('/theme/app-bar-forward-symbolic.svg', Lang.bind(this, this._nextPageSelected));

        this._container.add_actor(this._backButton);

        // Update for any apps running before the system started
        // (after a crash or a restart)
        let currentlyRunning = appSys.get_running();
        for (let i = 0; i < currentlyRunning.length; i++) {
            let app = currentlyRunning[i];

            let newChild = new AppIconButton(app, this._iconSize);
            this._runningApps.set(app, newChild);
            this._numberOfApps++;
            this._container.add_actor(newChild.actor);
        }

        this._container.add_actor(this._forwardButton);

        appSys.connect('app-state-changed', Lang.bind(this, this._onAppStateChanged));
    },

    _previousPageSelected: function() {
        this._currentPage = this._currentPage - 1;
        this._updateCurrentAppPage();
    },

    _nextPageSelected: function() {
        this._currentPage = this._currentPage + 1;
        this._updateCurrentAppPage();
    },

    _updateCurrentAppPage: function() {
        let [visibleApps, runningApps] = this._getAppsOnPage(this._currentPage, this._appsPerPage);

        for (app in runningApps) {
            let isAppHidden = visibleApps.indexOf(runningApps[app]) == -1;
            let [key, child] = runningApps[app];

            this._container.set_skip_paint(child.actor, isAppHidden);
        }

        this._container.set_skip_paint(this._backButton, this._currentPage == 0);
        this._container.set_skip_paint(this._forwardButton, this._currentPage == this._numberOfPages - 1);
    },

    _getContentPreferredWidth: function(actor, forHeight, alloc) {
        alloc.min_size = 2 * this._navButtonSize + 2 * this._navButtonSpacing + this._iconSize;

        let iconArea = 0;
        if (this._numberOfApps > 0) {
            let iconSpacing = this._iconSpacing * (this._numberOfApps - 1);
            iconArea = (this._iconSize  * (this._numberOfApps - 1)) + iconSpacing;
        }

        alloc.natural_size = alloc.min_size + iconArea;
    },

    _getContentPreferredHeight: function(actor, forWidth, alloc) {
        alloc.min_size = Math.max(this._iconSize, this._navButtonSize);
        alloc.natural_size = alloc.min_size;
    },

    _updateStyleConstants: function() {
        let node = this.actor.get_theme_node();

        this._iconSize = node.get_length("-icon-size");
        this._runningApps.items().forEach( Lang.bind(this,
            function(app) {
                app[1].setIconSize(this._iconSize);
            }));

        this._iconSpacing = node.get_length("-icon-spacing");
        this._navButtonSize = this._backButton.getSize();
        this._navButtonSpacing = this._backButton.getSpacing();
    },

    _contentAllocate: function(actor, box, flags) {
        let allocWidth = box.x2 - box.x1;
        let allocHeight = box.y2 - box.y1;

        let [minWidth, minHeight, naturalWidth, naturalHeight] = this._container.get_preferred_size();
        let yPadding = Math.floor(Math.max(0, allocHeight - naturalHeight) / 2);

        let childBox = new Clutter.ActorBox();
        childBox.y1 = yPadding;
        childBox.y2 = childBox.y1 + Math.min(naturalHeight, allocHeight);

        let [numOfPages, appsPerPage] = this._calculateNumberOfPages(allocWidth);

        this._appsPerPage = appsPerPage;
        this._numberOfPages = numOfPages;

        // If we are on a page that is out of bounds when the resolution changes
        // we need to clip its value
        this._currentPage = Math.min(this._currentPage, this._numberOfPages - 1);
        this._updateCurrentAppPage();

        let [visibleApps, runningApps] = this._getAppsOnPage(this._currentPage, this._appsPerPage);
        childBox.x1 = 0;
        childBox.x2 = childBox.x1 + this._navButtonSize;
        this._backButton.allocate(childBox, flags);

        let iconListStart = childBox.x2 + this._navButtonSpacing;

        for (index in visibleApps) {
            let [key, child] = visibleApps[index];
            childBox.x1 = iconListStart + index * (this._iconSize + this._iconSpacing);
            childBox.x2 = childBox.x1 + this._iconSize;

            child.actor.allocate(childBox, flags);
        }

        childBox.x1 = childBox.x2 + this._navButtonSpacing;
        childBox.x2 = childBox.x1 + this._navButtonSize;
        this._forwardButton.allocate(childBox, flags);
    },

    _calculateNumberOfPages: function(width){
        let netWidth = width - (2 * this._navButtonSize) - (2 * this._navButtonSpacing);
        let minimumIconWidth = this._iconSize + this._iconSpacing;

        // We need to clip the net width since initially may be 0
        netWidth = Math.max(0, netWidth);

        // We need to add one icon space to net width here so that the division
        // takes into account the fact that the last icon does not use iconSpacing
        let iconsPerPage = Math.floor((netWidth + this._iconSpacing) / minimumIconWidth);
        iconsPerPage = Math.max(1, iconsPerPage);

        let pages = Math.ceil(this._runningApps.items().length / iconsPerPage);

        // If we only have one page, previous calculations will return 0 so
        // we clip the value here
        pages = Math.max(1, pages);

        return [pages, iconsPerPage];
    },

    _getAppsOnPage: function(pageNum, appsPerPage){
        let apps = this._runningApps.items();

        let startIndex = appsPerPage * pageNum;
        let endIndex = Math.min(startIndex + appsPerPage, apps.length);

        let appsOnPage = apps.slice(startIndex, endIndex);

        return [appsOnPage, apps];
    },

    _onAppStateChanged: function(appSys, app) {
        let state = app.state;

        switch(state) {
        case Shell.AppState.STARTING:
            let newChild = new AppIconButton(app, this._iconSize);
            this._runningApps.set(app, newChild);
            this._numberOfApps++;
            this._container.add_actor(newChild.actor);
            break;

        case Shell.AppState.RUNNING:
            // The normal sequence of events appears to be
            // STARTING -> STOPPED -> RUNNING -> STOPPED
            // but sometimes it can go STARTING -> RUNNING -> STOPPED
            // So we only want to add an app here if we don't already
            // have an icon for @app
            if (!this._runningApps.has(app)) {
                let newChild = new AppIconButton(app, this._iconSize);
                this._runningApps.set(app, newChild);
                this._numberOfApps++;
                this._container.add_actor(newChild.actor);
            }
            break;

        case Shell.AppState.STOPPED:
            let oldChild = this._runningApps.get(app);
            if (oldChild) {
                this._container.remove_actor(oldChild.actor);
                this._runningApps.delete(app);
                this._numberOfApps--;
            }
            break;
        }

        // Make sure that our app list is updated
        this._updateCurrentAppPage();
    }
});
