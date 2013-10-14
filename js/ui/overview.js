// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const AccountsService = imports.gi.AccountsService;
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const Background = imports.ui.background;
const Dash = imports.ui.dash;
const DND = imports.ui.dnd;
const LayoutManager = imports.ui.layout;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const OverviewControls = imports.ui.overviewControls;
const Panel = imports.ui.panel;
const Params = imports.misc.params;
const SideComponent = imports.ui.sideComponent;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const ViewSelector = imports.ui.viewSelector;
const WorkspaceThumbnail = imports.ui.workspaceThumbnail;

// Time for initial animation going into Overview mode
const ANIMATION_TIME = 0.25;

const OVERVIEW_NOTIFICATION_TIMEOUT = 8;

// Must be less than ANIMATION_TIME, since we switch to
// or from the overview completely after ANIMATION_TIME,
// and don't want the shading animation to get cut off
const SHADE_ANIMATION_TIME = .20;

const DND_WINDOW_SWITCH_TIMEOUT = 1250;

const OVERVIEW_ACTIVATION_TIMEOUT = 0.5;

const ShellInfo = new Lang.Class({
    Name: 'ShellInfo',

    _init: function() {
        this._source = null;
        this._undoCallback = null;
        this._destroyCallback = null;
    },

    _onDestroy: function() {
        if (this._destroyCallback) {
            this._destroyCallback();
        }

        this._destroyCallback = null;
    },

    _onUndoClicked: function() {
        if (this._undoCallback)
            this._undoCallback();
        this._undoCallback = null;

        if (this._source)
            this._source.destroy();
    },

    setMessage: function(text, options) {
        options = Params.parse(options, { undoCallback: null,
                                          destroyCallback: null,
                                          forFeedback: false,
                                          isTransient: true
                                        });

        let undoCallback = options.undoCallback;
        let destroyCallback = options.destroyCallback;
        let forFeedback = options.forFeedback;
        let isTransient = options.isTransient;

        if (this._source == null) {
            this._source = new MessageTray.SystemNotificationSource();
            this._source.connect('destroy', Lang.bind(this,
                function() {
                    this._source = null;
                }));
            Main.messageTray.add(this._source);
        }

        this._source.policy.showInLockScreen = false;
        this._source.policy.notificationTimeout = OVERVIEW_NOTIFICATION_TIMEOUT;

        let notification = null;
        if (this._source.notifications.length == 0) {
            notification = new MessageTray.Notification(this._source, text, null);
            notification.setTransient(isTransient);
            notification.setForFeedback(forFeedback);
            notification.ignoreHover = true;
        } else {
            // as we reuse the notification, ensure that the previous _destroyCallback() is called
            if (this._destroyCallback) {
                this._destroyCallback();
            }
            notification = this._source.notifications[0];
            notification.update(text, null, { clear: true });
        }

        this._destroyCallback = destroyCallback;
        notification.connect('destroy', Lang.bind(this, this._onDestroy));

        this._undoCallback = undoCallback;
        if (undoCallback) {
            // if there is an Undo button, we expand the notification to make it visible
            this._source.policy.forceExpanded = true;
            notification.addAction('system-undo', _("Undo"));
            notification.connect('action-invoked', Lang.bind(this, this._onUndoClicked));
        }

        this._source.notify(notification);
    }
});

const Overview = new Lang.Class({
    Name: 'Overview',

    _init: function() {
        this._overviewCreated = false;
        this._initCalled = false;

        Main.sessionMode.connect('updated', Lang.bind(this, this._sessionUpdated));
        this._sessionUpdated();
    },

    _createOverview: function() {
        if (this._overviewCreated)
            return;

        if (this.isDummy)
            return;

        this._overviewCreated = true;

        // The main Background actors are inside global.window_group which are
        // hidden when displaying the overview, so we create a new
        // one. Instances of this class share a single CoglTexture behind the
        // scenes which allows us to show the background with different
        // rendering options without duplicating the texture data.
        let monitor = Main.layoutManager.primaryMonitor;

        // this._allMonitorsGroup is a simple actor that covers all monitors,
        // used to install actions that apply to all monitors
        this._allMonitorsGroup = new Clutter.Actor({ reactive: true });
        this._allMonitorsGroup.add_constraint(
            new Clutter.BindConstraint({ source: Main.layoutManager.overviewGroup,
                                         coordinate: Clutter.BindCoordinate.ALL }));

        // this._overview is a vertical box that holds the main actors, together
        // with a ghost of the bottom panel. It covers the primary monitor only

        /* Translators: This is the main view to select
           activities. See also note for "Activities" string. */
        this._overview = new St.BoxLayout({ name: 'overview',
                                            accessible_name: _("Overview"),
                                            reactive: true,
                                            vertical: true });
        this._overview._delegate = this;
        this._overview.add_constraint(new LayoutManager.MonitorConstraint({ primary: true }));
        this._allMonitorsGroup.add_actor(this._overview);

        // this effect takes care of animating the saturation when entering
        // or leaving the overview
        this._overviewSaturation = new Clutter.DesaturateEffect({ factor: AppDisplay.ACTIVE_GRID_SATURATION,
                                                                  enabled: false });
        this._overview.add_effect(this._overviewSaturation);

        // this._groupStack is a BinLayout that holds the main actor group, and allows
        // overlaying other elements on top of that
        this._groupStack = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                           x_expand: true, y_expand: true,
                                           clip_to_allocation: true });

        // this._group is the horizontal box holding the main overview actors
        this._group = new St.BoxLayout({ reactive: true,
                                         x_expand: true, y_expand: true });
        this._groupStack.add_actor(this._group);

        this._backgroundGroup = new Meta.BackgroundGroup();
        Main.layoutManager.overviewGroup.add_child(this._backgroundGroup);
        this._bgManagers = [];
        this._viewsClone = null;

        this._activationTime = 0;

        this.visible = false;           // animating to overview, in overview, animating out
        this._shown = false;            // show() and not hide()
        this._toggleToHidden = false;   // Whether to hide the overview when either toggle function is called
        this._targetPage = null;        // do we have a target page to animate to?
        this._modal = false;            // have a modal grab
        this.animationInProgress = false;
        this.visibleTarget = false;
        this.opacityPrepared = false;

        // During transitions, we raise this to the top to avoid having the overview
        // area be reactive; it causes too many issues such as double clicks on
        // Dash elements, or mouseover handlers in the workspaces.
        this._coverPane = new Clutter.Actor({ opacity: 0,
                                              reactive: true });
        this._overview.add_actor(this._coverPane);
        this._coverPane.connect('event', Lang.bind(this, function (actor, event) { return true; }));

        Main.layoutManager.overviewGroup.add_child(this._allMonitorsGroup);

        this._coverPane.hide();

        // XDND
        this._dragMonitor = {
            dragMotion: Lang.bind(this, this._onDragMotion)
        };

        Main.xdndHandler.connect('drag-begin', Lang.bind(this, this._onDragBegin));
        Main.xdndHandler.connect('drag-end', Lang.bind(this, this._onDragEnd));

        global.screen.connect('restacked', Lang.bind(this, this._onRestacked));
        this._group.connect('scroll-event', Lang.bind(this, this._onScrollEvent));

        this._windowSwitchTimeoutId = 0;
        this._windowSwitchTimestamp = 0;
        this._lastActiveWorkspaceIndex = -1;
        this._lastHoveredWindow = null;
        this._needsFakePointerEvent = false;

        if (this._initCalled)
            this.init();
    },

    setViewsClone: function(actor) {
        this._viewsClone = actor;
        this._backgroundGroup.add_child(this._viewsClone);
    },

    _unshadeBackgrounds: function() {
        let backgrounds = this._backgroundGroup.get_children();
        for (let i = 0; i < backgrounds.length; i++) {
            let child = backgrounds[i];
            if (child == this._viewsClone) {
                continue;
            }
            Tweener.addTween(child,
                             { brightness: 1.0,
                               time: SHADE_ANIMATION_TIME,
                               transition: 'easeOutQuad' });
        }
    },

    _shadeBackgrounds: function() {
        let backgrounds = this._backgroundGroup.get_children();
        for (let i = 0; i < backgrounds.length; i++) {
            let child = backgrounds[i];
            if (child == this._viewsClone) {
                continue;
            }
            Tweener.addTween(child,
                             { brightness: 0.7,
                               time: SHADE_ANIMATION_TIME,
                               transition: 'easeOutQuad' });
        }
    },

    _updateBackgrounds: function() {
        for (let i = 0; i < this._bgManagers.length; i++)
            this._bgManagers[i].destroy();

        this._bgManagers = [];

        for (let i = 0; i < Main.layoutManager.monitors.length; i++) {
            let bgManager = new Background.BackgroundManager({ container: this._backgroundGroup,
                                                               monitorIndex: i });
            this._bgManagers.push(bgManager);
        }
    },

    _onCurrentUserLanguageChanged: function() {
        Shell.util_set_locale(this._currentUser.get_language());
    },

    _onCurrentUserLoaded: function() {
        if (this._onCurrentUserLoadedId > 0) {
            this._currentUser.disconnect(this._onCurrentUserLoadedId);
            this._currentUserLoadedId = 0;
        }

        this._currentUser.connect('notify::language',
                                  Lang.bind(this, this._onCurrentUserLanguageChanged));

        this._onCurrentUserLanguageChanged();
    },

    _loadCurrentUser: function() {
        this._currentUser = AccountsService.UserManager.get_default().get_user(GLib.get_user_name());
        if (this._currentUser.is_loaded) {
            this._onCurrentUserLoaded();
        } else {
            this._onCurrentUserLoadedId = this._currentUser.connect('notify::is-loaded',
                                                                    Lang.bind(this, this._onCurrentUserLoaded));
        }
    },

    _sessionUpdated: function() {
        if (Main.sessionMode.currentMode == 'initial-setup') {
            this._loadCurrentUser();
        }

        this.isDummy = !Main.sessionMode.hasOverview;
        this._createOverview();
    },

    // The members we construct that are implemented in JS might
    // want to access the overview as Main.overview to connect
    // signal handlers and so forth. So we create them after
    // construction in this init() method.
    init: function() {
        this._initCalled = true;

        if (this.isDummy)
            return;

        this._shellInfo = new ShellInfo();

        this._bottomGhost = new St.Bin({ child: new Clutter.Clone({ source: Main.panel.actor }),
                                         reactive: false,
                                         opacity: 0 });

        // Create controls
        this._dash = new Dash.Dash();
        this._viewSelector = new ViewSelector.ViewSelector(this._dash.showAppsButton);
        this._thumbnailsBox = new WorkspaceThumbnail.ThumbnailsBox();
        this._controls = new OverviewControls.ControlsManager(this._dash,
                                                              this._thumbnailsBox,
                                                              this._viewSelector);

        this._controls.dashActor.x_align =
            this._dash.dashPosition == Dash.DashPosition.END ?
            Clutter.ActorAlign.END : Clutter.ActorAlign.START;
        this._controls.dashActor.y_expand = true;

        // Put the dash in a separate layer to allow content to be centered
        this._groupStack.add_actor(this._controls.dashActor);

        // Pack all the actors into the group
        if (this._dash.dashPosition == Dash.DashPosition.START) {
            this._group.add_actor(this._controls.dashSpacer);
        }
        this._group.add(this._viewSelector.actor, { x_fill: true,
                                                    expand: true });
        this._group.add_actor(this._controls.thumbnailsActor);
        if (this._dash.dashPosition == Dash.DashPosition.END) {
            this._group.add_actor(this._controls.dashSpacer);
        }

        // Add the group to the overview box
        this._overview.add(this._groupStack, { y_fill: true, expand: true });

        // Add the panel ghost to give some spacing
        this._overview.add_actor(this._bottomGhost);

        // TODO - recalculate everything when desktop size changes
        this.dashIconSize = this._dash.iconSize;
        this._dash.connect('icon-size-changed',
                           Lang.bind(this, function() {
                               this.dashIconSize = this._dash.iconSize;
                           }));

        this._viewSelector.connect('page-changed', Lang.bind(this, this._onPageChanged));
        this._viewSelector.connect('views-page-changed', Lang.bind(this, this._onViewsPageChanged));

        // clicking the desktop displays the app grid
        Main.layoutManager.connect('background-clicked', Lang.bind(this, this.showApps));

        Main.layoutManager.connect('startup-prepared', Lang.bind(this, this._onStartupPrepared));
        Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._relayout));
        global.screen.connect('workareas-changed', Lang.bind(this, this._relayoutNoHide));
        this._relayoutNoHide();
    },

    _updateBackgroundShade: function() {
        if (this.visibleTarget &&
            (this._viewSelector.getActivePage() == ViewSelector.ViewPage.WINDOWS ||
             this._viewSelector.getActiveViewsPage() == ViewSelector.ViewsDisplayPage.SEARCH)) {
            this._shadeBackgrounds();
        } else {
            this._unshadeBackgrounds();
        }
    },

    _onPageChanged: function() {
        // We are switching a pages in the overview, so we should toggle to the
        // other page rather than hiding the overview.
        this._toggleToHidden = false;

        this.emit('page-changed');
        this._updateBackgroundShade();
    },

    _onViewsPageChanged: function() {
        this._updateBackgroundShade();
    },

    //
    // options:
    //  - undoCallback (function): the callback to be called if undo support is needed
    //  - forFeedback (boolean): whether the message is for direct feedback of a user action
    //
    setMessage: function(text, options) {
        if (this.isDummy)
            return;

        this._shellInfo.setMessage(text, options);
    },

    _onDragBegin: function() {
        this._inXdndDrag = true;

        DND.addDragMonitor(this._dragMonitor);
        // Remember the workspace we started from
        this._lastActiveWorkspaceIndex = global.screen.get_active_workspace_index();
    },

    _onDragEnd: function(time) {
        this._inXdndDrag = false;

        // In case the drag was canceled while in the overview
        // we have to go back to where we started and hide
        // the overview
        if (this._shown) {
            global.screen.get_workspace_by_index(this._lastActiveWorkspaceIndex).activate(time);
            this.hide();
        }
        this._resetWindowSwitchTimeout();
        this._lastHoveredWindow = null;
        DND.removeDragMonitor(this._dragMonitor);
        this.endItemDrag();
    },

    _resetWindowSwitchTimeout: function() {
        if (this._windowSwitchTimeoutId != 0) {
            Mainloop.source_remove(this._windowSwitchTimeoutId);
            this._windowSwitchTimeoutId = 0;
            this._needsFakePointerEvent = false;
        }
    },

    _fakePointerEvent: function() {
        let display = Gdk.Display.get_default();
        let deviceManager = display.get_device_manager();
        let pointer = deviceManager.get_client_pointer();
        let [screen, pointerX, pointerY] = pointer.get_position();

        pointer.warp(screen, pointerX, pointerY);
    },

    _onDragMotion: function(dragEvent) {
        let targetIsWindow = dragEvent.targetActor &&
                             dragEvent.targetActor._delegate &&
                             dragEvent.targetActor._delegate.metaWindow &&
                             !(dragEvent.targetActor._delegate instanceof WorkspaceThumbnail.WindowClone);

        this._windowSwitchTimestamp = global.get_current_time();

        if (targetIsWindow &&
            dragEvent.targetActor._delegate.metaWindow == this._lastHoveredWindow)
            return DND.DragMotionResult.CONTINUE;

        this._lastHoveredWindow = null;

        this._resetWindowSwitchTimeout();

        if (targetIsWindow) {
            this._lastHoveredWindow = dragEvent.targetActor._delegate.metaWindow;
            this._windowSwitchTimeoutId = Mainloop.timeout_add(DND_WINDOW_SWITCH_TIMEOUT,
                                            Lang.bind(this, function() {
                                                this._windowSwitchTimeoutId = 0;
                                                this._needsFakePointerEvent = true;
                                                Main.activateWindow(dragEvent.targetActor._delegate.metaWindow,
                                                                    this._windowSwitchTimestamp);
                                                this.hide();
                                                this._lastHoveredWindow = null;
                                                return false;
                                            }));
        }

        return DND.DragMotionResult.CONTINUE;
    },

    _onScrollEvent: function(actor, event) {
        this.emit('scroll-event', event);
    },

    addAction: function(action, isPrimary) {
        if (this.isDummy)
            return;

        if (isPrimary) {
            this._overview.add_action(action);
        } else {
            this._allMonitorsGroup.add_action(action);
        }
    },

    _relayout: function () {
        // To avoid updating the position and size of the workspaces
        // we just hide the overview. The positions will be updated
        // when it is next shown.
        this.hide();

        this._relayoutNoHide();
    },

    _relayoutNoHide: function() {
        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);

        this._coverPane.set_position(0, workArea.y);
        this._coverPane.set_size(workArea.width, workArea.height);

        this._updateBackgrounds();
    },

    _onRestacked: function() {
        let stack = global.get_window_actors();
        let stackIndices = {};

        for (let i = 0; i < stack.length; i++) {
            // Use the stable sequence for an integer to use as a hash key
            stackIndices[stack[i].get_meta_window().get_stable_sequence()] = i;
        }

        this.emit('windows-restacked', stackIndices);
    },

    //// Public methods ////

    beginItemDrag: function(source) {
        this.emit('item-drag-begin', source);
    },

    cancelledItemDrag: function(source) {
        this.emit('item-drag-cancelled', source);
    },

    endItemDrag: function(source) {
        this.emit('item-drag-end', source);
    },

    beginWindowDrag: function(source) {
        this.emit('window-drag-begin');
    },

    cancelledWindowDrag: function(source) {
        this.emit('window-drag-cancelled');
    },

    endWindowDrag: function(source) {
        this.emit('window-drag-end');
    },

    // show:
    //
    // Animates the overview visible and grabs mouse and keyboard input
    show: function() {
        if (this.isDummy)
            return;
        if (this._shown)
            return;
        this._shown = true;

        if (!this._syncGrab())
            return;

        Main.layoutManager.showOverview();
        this._animateVisible();
    },

    _showOrSwitchPage: function(page) {
        if (this.visible) {
            this._viewSelector.setActivePage(page);
        } else {
            this._targetPage = page;
            this.show();
        }
    },

    _isInitialSetupRunning: function() {
        let path = GLib.build_filenamev([GLib.get_user_config_dir(),
                                         'gnome-initial-setup-done']);
        return !GLib.file_test(path, GLib.FileTest.EXISTS);
    },

    _onStartupPrepared: function() {
        if (this.isDummy)
            return;

        // do not show overview when FBE is running
        if (this._isInitialSetupRunning()) {
            this._viewSelector.setActivePage(ViewSelector.ViewPage.APPS);
        } else {
            this._showOrSwitchPage(ViewSelector.ViewPage.APPS);
        }
    },

    showApps: function() {
        if (this.isDummy)
            return;

        this._showOrSwitchPage(ViewSelector.ViewPage.APPS);
    },

    showWindows: function() {
        if (this.isDummy)
            return;

        this._showOrSwitchPage(ViewSelector.ViewPage.WINDOWS);
    },

    getActivePage: function() {
        return this._viewSelector.getActivePage();
    },

    focusSearch: function() {
        this.showApps();
        this._viewSelector.focusSearch();
    },

    _animateVisible: function() {
        if (this.visible || this.animationInProgress)
            return;

        this.visible = true;
        this.animationInProgress = true;
        this.visibleTarget = true;
        this._activationTime = Date.now() / 1000;

        this._updateBackgroundShade();

        // All the the actors in the window group are completely obscured,
        // hiding the group holding them while the Overview is displayed greatly
        // increases performance of the Overview especially when there are many
        // windows visible.
        //
        // If we switched to displaying the actors in the Overview rather than
        // clones of them, this would obviously no longer be necessary.
        //
        // Disable unredirection while in the overview
        Meta.disable_unredirect_for_screen(global.screen);

        if (!this._targetPage) {
            this._targetPage = ViewSelector.ViewPage.WINDOWS;
        }

        this._viewSelector.show(this._targetPage);
        this._targetPage = null;

        // Since the overview is just becoming visible, we should toggle back
        // the hidden state
        this._toggleToHidden = true;

        this._coverPane.raise_top();
        this._coverPane.show();
        this.emit('showing');

        if (Main.layoutManager.startingUp || this.opacityPrepared) {
            this._overview.opacity = AppDisplay.ACTIVE_GRID_OPACITY;
            this.opacityPrepared = false;
            this._showDone();
            return;
        }

        let saturationTarget = AppDisplay.INACTIVE_GRID_SATURATION;
        this._overviewSaturation.factor = AppDisplay.INACTIVE_GRID_SATURATION;
        this._overviewSaturation.enabled = true;

        if (this._viewSelector.getActivePage() == ViewSelector.ViewPage.APPS) {
            this._overview.opacity = AppDisplay.INACTIVE_GRID_OPACITY;
            saturationTarget = AppDisplay.ACTIVE_GRID_SATURATION;
        } else {
            this._overview.opacity = 0;
        }

        Tweener.addTween(this._overview,
                         { opacity: AppDisplay.ACTIVE_GRID_OPACITY,
                           transition: 'easeOutQuad',
                           time: ANIMATION_TIME,
                           onComplete: this._showDone,
                           onCompleteScope: this
                         });

        Tweener.addTween(this._overviewSaturation,
                         { factor: saturationTarget,
                           transition: 'easeOutQuad',
                           time: ANIMATION_TIME,
                           onComplete: function() {
                               this._overviewSaturation.enabled = false;
                           },
                           onCompleteScope: this
                         });
    },

    // hide:
    //
    // Reverses the effect of show()
    hide: function() {
        if (this.isDummy)
            return;

        if (!this._shown)
            return;

        this._shown = false;

        this._animateNotVisible();
        this._syncGrab();
    },

    toggleApps: function() {
        if (this.isDummy)
            return;

        if (!this.visible ||
            this._viewSelector.getActivePage() !== ViewSelector.ViewPage.APPS) {
            this.showApps();
            return;
        }

        if (!this._toggleToHidden) {
            this.showWindows();
            return;
        }

        if (!Main.workspaceMonitor.hasVisibleWindows) {
            this._viewSelector.blinkSearch();
            return;
        }

        this.hide();
    },

    toggleWindows: function() {
        if (this.isDummy)
            return;

        if (!this.visible ||
            this._viewSelector.getActivePage() !== ViewSelector.ViewPage.WINDOWS) {
            this.showWindows();
            return;
        }

        if (!this._toggleToHidden) {
            this.showApps();
            return;
        }

        if (!Main.workspaceMonitor.hasVisibleWindows) {
            this.showApps();
            return;
        }

        this.hide();
    },

    // Checks if the Activities button is currently sensitive to
    // clicks. The first call to this function within the
    // OVERVIEW_ACTIVATION_TIMEOUT time of the hot corner being
    // triggered will return false. This avoids opening and closing
    // the overview if the user both triggered the hot corner and
    // clicked the Activities button.
    shouldToggleByCornerOrButton: function() {
        if (this.animationInProgress)
            return false;
        if (this._activationTime == 0 || Date.now() / 1000 - this._activationTime > OVERVIEW_ACTIVATION_TIMEOUT)
            return true;
        return false;
    },

    //// Private methods ////

    _syncGrab: function() {
        // We delay grab changes during animation so that when removing the
        // overview we don't have a problem with the release of a press/release
        // going to an application.
        if (this.animationInProgress)
            return true;

        if (this._shown) {
            let shouldBeModal = !this._inXdndDrag;
            if (shouldBeModal) {
                if (!this._modal) {
                    if (Main.pushModal(this._overview,
                                       { keybindingMode: Shell.KeyBindingMode.OVERVIEW })) {
                        this._modal = true;
                    } else {
                        this.hide();
                        return false;
                    }
                }
            }
        } else {
            if (this._modal) {
                Main.popModal(this._overview);
                this._modal = false;
            }
        }
        return true;
    },

    _animateNotVisible: function() {
        if (!this.visible || this.animationInProgress)
            return;

        this.animationInProgress = true;
        this.visibleTarget = false;
        this.emit('hiding');

        this._updateBackgroundShade();

        let hidingFromApps = (this._viewSelector.getActivePage() == ViewSelector.ViewPage.APPS);
        if (hidingFromApps) {
            this._overview.opacity = AppDisplay.INACTIVE_GRID_OPACITY;
        }

        if (hidingFromApps) {
            // When we're hiding from the apps page, we want to instantaneously
            // switch to the application, so don't fade anything. We'll tween
            // the grid clone in the background separately - see comment in
            // viewSelector.js::ViewsClone.
            this._hideDone();
            return;
        }

        this._viewSelector.zoomFromOverview();

        // Make other elements fade out.
        Tweener.addTween(this._overview,
                         { opacity: 0,
                           transition: 'easeOutQuad',
                           time: ANIMATION_TIME,
                           onComplete: this._hideDone,
                           onCompleteScope: this
                         });

        this._coverPane.raise_top();
        this._coverPane.show();
    },

    _showDone: function() {
        this.animationInProgress = false;
        this._coverPane.hide();

        this.emit('shown');

        // Handle any calls to hide() while we were showing
        if (!this._shown) {
            this._animateNotVisible();
        }

        this._syncGrab();
        global.sync_pointer();
    },

    _hideDone: function() {
        // Re-enable unredirection
        Meta.enable_unredirect_for_screen(global.screen);

        this._viewSelector.hide();
        this._coverPane.hide();

        this.visible = false;
        this.animationInProgress = false;

        this.emit('hidden');

        // Handle any calls to show() while we were hiding
        if (this._shown) {
            this._animateVisible();
        }
        else
            Main.layoutManager.hideOverview();

        this._syncGrab();

        // Fake a pointer event if requested
        if (this._needsFakePointerEvent) {
            this._fakePointerEvent();
            this._needsFakePointerEvent = false;
        }
    }
});
Signals.addSignalMethods(Overview.prototype);
