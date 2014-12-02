// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const AltTab = imports.ui.altTab;
const ForceAppExitDialog = imports.ui.forceAppExitDialog;
const WorkspaceSwitcherPopup = imports.ui.workspaceSwitcherPopup;
const Layout = imports.ui.layout;
const Main = imports.ui.main;
const SideComponent = imports.ui.sideComponent;
const BackgroundMenu = imports.ui.backgroundMenu;
const ModalDialog = imports.ui.modalDialog;
const Tweener = imports.ui.tweener;
const ViewSelector = imports.ui.viewSelector;

const SHELL_KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';
const KEYBINDING_FORCE_APP_EXIT = 'show-force-app-exit-dialog';
const NO_DEFAULT_MAXIMIZE_KEY = 'no-default-maximize';
const WINDOW_ANIMATION_TIME = 0.25;
const DIM_BRIGHTNESS = -0.3;
const DIM_TIME = 0.500;
const UNDIM_TIME = 0.250;
const SKYPE_WINDOW_CLOSE_TIMEOUT_MS = 1000;

const DISPLAY_REVERT_TIMEOUT = 30; // in seconds - keep in sync with mutter
const ONE_SECOND = 1000; // in ms

const DisplayChangeDialog = new Lang.Class({
    Name: 'DisplayChangeDialog',
    Extends: ModalDialog.ModalDialog,

    _init: function(wm) {
        this.parent({ styleClass: 'prompt-dialog' });

        this._wm = wm;

        let mainContentBox = new St.BoxLayout({ style_class: 'prompt-dialog-main-layout',
                                                vertical: false });
        this.contentLayout.add(mainContentBox,
                               { x_fill: true,
                                 y_fill: true });

        let icon = new St.Icon({ icon_name: 'preferences-desktop-display-symbolic' });
        mainContentBox.add(icon,
                           { x_fill:  true,
                             y_fill:  false,
                             x_align: St.Align.END,
                             y_align: St.Align.START });

        let messageBox = new St.BoxLayout({ style_class: 'prompt-dialog-message-layout',
                                            vertical: true });
        mainContentBox.add(messageBox,
                           { expand: true, y_align: St.Align.START });

        let subjectLabel = new St.Label({ style_class: 'prompt-dialog-headline',
                                            text: _("Do you want to keep these display settings?") });
        messageBox.add(subjectLabel,
                       { y_fill:  false,
                         y_align: St.Align.START });

        this._countDown = DISPLAY_REVERT_TIMEOUT;
        let message = this._formatCountDown();
        this._descriptionLabel = new St.Label({ style_class: 'prompt-dialog-description',
                                                text: this._formatCountDown() });
        this._descriptionLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._descriptionLabel.clutter_text.line_wrap = true;

        messageBox.add(this._descriptionLabel,
                       { y_fill:  true,
                         y_align: St.Align.START });

        /* Translators: this and the following message should be limited in lenght,
           to avoid ellipsizing the labels.
        */
        this._cancelButton = this.addButton({ label: _("Revert Settings"),
                                              action: Lang.bind(this, this._onFailure),
                                              key: Clutter.Escape },
                                            { expand: true, x_fill: false, x_align: St.Align.START });
        this._okButton = this.addButton({ label:  _("Keep Changes"),
                                          action: Lang.bind(this, this._onSuccess),
                                          default: true },
                                        { expand: false, x_fill: false, x_align: St.Align.END });

        this._timeoutId = Mainloop.timeout_add(ONE_SECOND, Lang.bind(this, this._tick));
    },

    close: function(timestamp) {
        if (this._timeoutId > 0) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this.parent(timestamp);
    },

    _formatCountDown: function() {
        let fmt = ngettext("Settings changes will revert in %d second",
                           "Settings changes will revert in %d seconds");
        return fmt.format(this._countDown);
    },

    _tick: function() {
        this._countDown--;

        if (this._countDown == 0) {
            /* mutter already takes care of failing at timeout */
            this._timeoutId = 0;
            this.close();
            return false;
        }

        this._descriptionLabel.text = this._formatCountDown();
        return true;
    },

    _onFailure: function() {
        this._wm.complete_display_change(false);
        this.close();
    },

    _onSuccess: function() {
        this._wm.complete_display_change(true);
        this.close();
    },
});

const WindowDimmer = new Lang.Class({
    Name: 'WindowDimmer',

    _init: function(actor) {
        this._brightnessEffect = new Clutter.BrightnessContrastEffect();
        actor.add_effect(this._brightnessEffect);
        this.actor = actor;
        this._enabled = true;
        this._dimFactor = 0.0;
        this._syncEnabled();
    },

    _syncEnabled: function() {
        this._brightnessEffect.enabled = (this._enabled && this._dimFactor > 0);
    },

    setEnabled: function(enabled) {
        this._enabled = enabled;
        this._syncEnabled();
    },

    set dimFactor(factor) {
        this._dimFactor = factor;
        this._brightnessEffect.set_brightness(factor * DIM_BRIGHTNESS);
        this._syncEnabled();
    },

    get dimFactor() {
        return this._dimFactor;
    }
});

function getWindowDimmer(actor) {
    let enabled = Meta.prefs_get_attach_modal_dialogs();
    if (actor._windowDimmer)
        actor._windowDimmer.setEnabled(enabled);

    if (enabled) {
        if (!actor._windowDimmer)
            actor._windowDimmer = new WindowDimmer(actor);
        return actor._windowDimmer;
    } else {
        return null;
    }
}

const DesktopOverlay = new Lang.Class({
    Name: 'DesktopOverlay',
    Extends: St.Widget,

    _init: function() {
        this.parent({ reactive: true });

        this._shellwm = global.window_manager;

        this._actorDestroyId = 0;
        this._allocationId = 0;
        this._destroyId = 0;
        this._mapId = 0;
        this._visibleId = 0;
        this._showing = false;

        this._overlayActor = null;
        this._transientActors = [];

        let action = new Clutter.ClickAction();
        action.connect('clicked', Lang.bind(this, function(action) {
            if (action.get_button() != Gdk.BUTTON_PRIMARY) {
                return;
            }

            if (this._showing && this._overlayActor) {
                this.emit('clicked');
            }
        }));
        this.add_action(action);
        BackgroundMenu.addBackgroundMenu(action, Main.layoutManager);

        Main.overview.connect('showing', Lang.bind(this, function() {
            // hide the overlay so it doesn't conflict with the desktop
            if (this._showing) {
                this.hide();
            }
        }));
        Main.overview.connect('hiding', Lang.bind(this, function() {
            // show the overlay if needed
            if (this._showing) {
                this.show();
            }
        }));

        Main.uiGroup.add_actor(this);
        if (Main.uiGroup.contains(global.top_window_group))
            Main.uiGroup.set_child_below_sibling(this, global.top_window_group);
    },

    _rebuildRegion: function() {
        if (!this._overlayActor.get_paint_visibility()) {
            Main.layoutManager.setOverlayRegion(null);
            return;
        }

        let overlayWindow = this._overlayActor.meta_window;
        let monitorIdx = overlayWindow.get_monitor();
        let monitor = Main.layoutManager.monitors[monitorIdx];
        if (!monitor) {
            return;
        }

        let workArea = Main.layoutManager.getWorkAreaForMonitor(overlayWindow.get_monitor());
        let region = new Cairo.Region();
        region.unionRectangle(workArea);

        let [x, y] = this._overlayActor.get_transformed_position();
        let [width, height] = this._overlayActor.get_transformed_size();
        let rect = { x: Math.round(x), y: Math.round(y),
                     width: Math.round(width), height: Math.round(height) };

        region.subtractRectangle(rect);

        this._transientActors.forEach(Lang.bind(this, function(actorData) {
            let transientActor = actorData.actor;

            let [x, y] = transientActor.get_transformed_position();
            let [width, height] = transientActor.get_transformed_size();
            let rect = { x: Math.round(x), y: Math.round(y),
                         width: Math.round(width), height: Math.round(height) };

            region.subtractRectangle(rect);
        }));

        Main.layoutManager.setOverlayRegion(region);
    },

    _findTransientActor: function(actor) {
        for (let i = 0; i < this._transientActors.length; i++) {
            let actorData = this._transientActors[i];
            if (actorData.actor == actor)
                return i;
        }
        return -1;
    },

    _untrackTransientActor: function(actor) {
        let idx = this._findTransientActor(actor);
        if (idx == -1) {
            log('Trying to untrack a non-tracked transient actor!');
            return;
        }

        let actorData = this._transientActors[idx];
        this._transientActors.splice(idx, 1);

        actor.disconnect(actorData.visibleId);
        actor.disconnect(actorData.allocationId);
        actor.disconnect(actorData.destroyId);

        this._rebuildRegion();
    },

    _trackTransientActor: function(actor) {
        if (this._findTransientActor(actor) != -1) {
            log('Trying to track twice the same transient actor!');
            return;
        }

        let actorData = {};
        actorData.actor = actor;
        actorData.visibleId = actor.connect('notify::visible',
                                            Lang.bind(this, this._rebuildRegion));
        actorData.allocationId = actor.connect('notify::allocation',
                                               Lang.bind(this, this._rebuildRegion));
        actorData.destroyId = actor.connect('destroy',
                                            Lang.bind(this, this._untrackTransientActor));

        this._transientActors.push(actorData);
        this._rebuildRegion();
    },

    _untrackActor: function() {
        this._transientActors.forEach(Lang.bind(this, function(actorData) {
            this._untrackTransientActor(actorData.actor);
        }));
        this._transientActors = [];

        if (this._visibleId > 0) {
            this._overlayActor.disconnect(this._visibleId);
            this._visibleId = 0;
        }

        if (this._allocationId > 0) {
            this._overlayActor.disconnect(this._allocationId);
            this._allocationId = 0;
        }

        if (this._actorDestroyId > 0) {
            this._overlayActor.disconnect(this._actorDestroyId);
            this._actorDestroyId = 0;
        }

        if (this._destroyId > 0) {
            this._shellwm.disconnect(this._destroyId);
            this._destroyId = 0;
        }

        if (this._mapId > 0) {
            this._shellwm.disconnect(this._mapId);
            this._mapId = 0;
        }

        Main.layoutManager.setOverlayRegion(null);
    },

    _trackActor: function() {
        let overlayWindow = this._overlayActor.meta_window;
        let monitorIdx = overlayWindow.get_monitor();
        let monitor = Main.layoutManager.monitors[monitorIdx];
        if (!monitor) {
            return;
        }

        // cover other windows with an invisible overlay at the side of the SideComponent
        let workArea = Main.layoutManager.getWorkAreaForMonitor(monitorIdx);
        this.width = monitor.width - this._overlayActor.width;
        this.height = workArea.height;
        this.y = this._overlayActor.y;

        if (this._overlayActor.x <= monitor.x) {
            this.x = monitor.x + monitor.width - this.width;
        } else {
            this.x = monitor.x;
        }

        this._visibleId = this._overlayActor.connect('notify::visible',
                                                     Lang.bind(this, this._rebuildRegion));
        this._allocationId = this._overlayActor.connect('notify::allocation',
                                                        Lang.bind(this, this._rebuildRegion));
        this._actorDestroyId = this._overlayActor.connect('destroy',
                                                          Lang.bind(this, this._untrackActor));

        this._mapId = this._shellwm.connect('map', Lang.bind(this, function(shellwm, actor) {
            let newWindow = actor.meta_window;
            if (overlayWindow.is_ancestor_of_transient(newWindow)) {
                this._trackTransientActor(actor);
            }
        }));
        this._destroyId = this._shellwm.connect('destroy', Lang.bind(this, function(shellwm, actor) {
            let destroyedWindow = actor.meta_window;
            if (overlayWindow.is_ancestor_of_transient(destroyedWindow)) {
                this._untrackTransientActor(actor);
            }
        }));

        // seed the transient actors
        overlayWindow.foreach_transient(Lang.bind(this, function(transientWindow) {
            let transientActor = overlayWindow.get_compositor_private();
            if (transientActor != null) {
                this._trackTransientActor(transientActor);
            }
        }));

        this._rebuildRegion();
    },

    _setOverlayActor: function(actor) {
        if (actor == this._overlayActor) {
            return;
        }

        this._untrackActor();
        this._overlayActor = actor;

        if (this._overlayActor) {
            this._trackActor();
        }
    },

    get overlayActor() {
        return this._overlayActor;
    },

    showOverlay: function(actor) {
        this._setOverlayActor(actor);

        this._showing = true;
        this.show();
    },

    hideOverlay: function() {
        this._setOverlayActor(null);

        this._showing = false;
        this.hide();
    }
});
Signals.addSignalMethods(DesktopOverlay.prototype);

const WindowManager = new Lang.Class({
    Name: 'WindowManager',

    _init : function() {
        this._shellwm =  global.window_manager;

        this._minimizing = [];
        this._unminimizing = [];
        this._maximizing = [];
        this._unmaximizing = [];
        this._mapping = [];
        this._destroying = [];
        this._movingWindow = null;

        this._dimmedWindows = [];

        this._animationBlockCount = 0;

        this._allowedKeybindings = {};

        this._desktopOverlay = new DesktopOverlay();
        this._showDesktopOnDestroyDone = false;

        // The desktop overlay needs to replicate the background's functionality;
        // when clicked, we animate the side component out before emitting "background-clicked".
        this._desktopOverlay.connect('clicked', Lang.bind(this, function() {
            this._slideSideComponentOut(this._shellwm,
                                        this._desktopOverlay.overlayActor,
                                        function () { Main.layoutManager.emit('background-clicked'); },
                                        function () { Main.layoutManager.emit('background-clicked'); });
        }));

        this._switchData = null;
        this._shellwm.connect('kill-switch-workspace', Lang.bind(this, this._switchWorkspaceDone));
        this._shellwm.connect('kill-window-effects', Lang.bind(this, function (shellwm, actor) {
            this._minimizeWindowDone(shellwm, actor);
            this._unminimizeWindowDone(shellwm, actor);
            this._maximizeWindowDone(shellwm, actor);
            this._unmaximizeWindowDone(shellwm, actor);
            this._mapWindowDone(shellwm, actor);
            this._destroyWindowDone(shellwm, actor);
        }));

        this._shellwm.connect('switch-workspace', Lang.bind(this, this._switchWorkspace));
        this._shellwm.connect('minimize', Lang.bind(this, this._minimizeWindow));
        this._shellwm.connect('unminimize', Lang.bind(this, this._unminimizeWindow));
        this._shellwm.connect('maximize', Lang.bind(this, this._maximizeWindow));
        this._shellwm.connect('unmaximize', Lang.bind(this, this._unmaximizeWindow));
        this._shellwm.connect('map', Lang.bind(this, this._mapWindow));
        this._shellwm.connect_after('destroy', Lang.bind(this, this._destroyWindow));
        this._shellwm.connect('filter-keybinding', Lang.bind(this, this._filterKeybinding));
        this._shellwm.connect('confirm-display-change', Lang.bind(this, this._confirmDisplayChange));

        this._workspaceSwitcherPopup = null;
        this.setCustomKeybindingHandler('switch-to-workspace-left',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('switch-to-workspace-right',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('switch-to-workspace-up',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('switch-to-workspace-down',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('move-to-workspace-left',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('move-to-workspace-right',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('move-to-workspace-up',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('move-to-workspace-down',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._showWorkspaceSwitcher));
        this.setCustomKeybindingHandler('switch-applications',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._startAppSwitcher));
        this.setCustomKeybindingHandler('switch-group',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._startAppSwitcher));
        this.setCustomKeybindingHandler('switch-applications-backward',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._startAppSwitcher));
        this.setCustomKeybindingHandler('switch-group-backward',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._startAppSwitcher));
        this.setCustomKeybindingHandler('switch-windows',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._startWindowSwitcher));
        this.setCustomKeybindingHandler('switch-windows-backward',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW,
                                        Lang.bind(this, this._startWindowSwitcher));
        this.setCustomKeybindingHandler('switch-panels',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW |
                                        Shell.KeyBindingMode.LOCK_SCREEN |
                                        Shell.KeyBindingMode.UNLOCK_SCREEN |
                                        Shell.KeyBindingMode.LOGIN_SCREEN,
                                        Lang.bind(this, this._startA11ySwitcher));
        this.setCustomKeybindingHandler('switch-panels-backward',
                                        Shell.KeyBindingMode.NORMAL |
                                        Shell.KeyBindingMode.OVERVIEW |
                                        Shell.KeyBindingMode.LOCK_SCREEN |
                                        Shell.KeyBindingMode.UNLOCK_SCREEN |
                                        Shell.KeyBindingMode.LOGIN_SCREEN,
                                        Lang.bind(this, this._startA11ySwitcher));

        this.addKeybinding(KEYBINDING_FORCE_APP_EXIT,
                           new Gio.Settings({ schema_id: SHELL_KEYBINDINGS_SCHEMA }),
                           Meta.KeyBindingFlags.NONE,
                           Shell.KeyBindingMode.NORMAL |
                           Shell.KeyBindingMode.OVERVIEW |
                           Shell.KeyBindingMode.SPLASH_SCREEN,
                           Lang.bind(this, this._showForceAppExitDialog));

        Main.overview.connect('showing', Lang.bind(this, function() {
            for (let i = 0; i < this._dimmedWindows.length; i++) {
                this._undimWindow(this._dimmedWindows[i]);
            }
        }));
        Main.overview.connect('hiding', Lang.bind(this, function() {
            for (let i = 0; i < this._dimmedWindows.length; i++) {
                this._dimWindow(this._dimmedWindows[i]);
            }
        }));
    },

    setCustomKeybindingHandler: function(name, modes, handler) {
        if (Meta.keybindings_set_custom_handler(name, handler))
            this.allowKeybinding(name, modes);
    },

    addKeybinding: function(name, settings, flags, modes, handler) {
        let action = global.display.add_keybinding(name, settings, flags, handler);
        if (action != Meta.KeyBindingAction.NONE)
            this.allowKeybinding(name, modes);
        return action;
    },

    removeKeybinding: function(name) {
        if (global.display.remove_keybinding(name))
            this.allowKeybinding(name, Shell.KeyBindingMode.NONE);
    },

    allowKeybinding: function(name, modes) {
        this._allowedKeybindings[name] = modes;
    },

    blockAnimations: function() {
        this._animationBlockCount++;
    },

    unblockAnimations: function() {
        this._animationBlockCount = Math.max(0, this._animationBlockCount - 1);
    },

    _shouldAnimate: function() {
        return !(Main.overview.visible || this._animationBlockCount > 0);
    },

    _shouldAnimateActor: function(actor) {
        if (!this._shouldAnimate())
            return false;
        let windowType = actor.meta_window.get_window_type();
        return windowType == Meta.WindowType.NORMAL ||
               windowType == Meta.WindowType.MODAL_DIALOG ||
               SideComponent.isSideComponentWindow(actor.meta_window);
    },

    _removeEffect : function(list, actor) {
        let idx = list.indexOf(actor);
        if (idx != -1) {
            list.splice(idx, 1);
            return true;
        }
        return false;
    },

    _slideWindowIn : function(shellwm, actor, onComplete, onOverwrite) {
        let monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (!monitor) {
            onComplete.apply(this, [shellwm, actor]);
            return;
        }

        let origY = actor.y;
        let startY = monitor.y + monitor.height;
        actor.set_position(actor.x, startY);

        Tweener.addTween(actor,
                         { y: origY,
                           time: WINDOW_ANIMATION_TIME,
                           transition: 'easeOutQuad',
                           onComplete: onComplete,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm, actor],
                           onOverwrite: onOverwrite,
                           onOverwriteScope: this,
                           onOverwriteParams: [shellwm, actor]
                         });
    },

    _slideWindowOut : function(shellwm, actor, onComplete, onOverwrite) {
        let monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (!monitor) {
            onComplete.apply(this, [shellwm, actor]);
            return;
        }

        let yDest = monitor.y + monitor.height;
        Tweener.addTween(actor,
                         { y: yDest,
                           time: WINDOW_ANIMATION_TIME,
                           transition: 'easeOutQuad',
                           onComplete: onComplete,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm, actor],
                           onOverwrite: onOverwrite,
                           onOverwriteScope: this,
                           onOverwriteParams: [shellwm, actor]
                         });
    },

    _slideSideComponentOut : function(shellwm, actor, onComplete, onOverwrite) {
        let monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (!monitor) {
            onComplete.apply(this, [shellwm, actor]);
            return;
        }

        let endX;
        if (actor.x <= monitor.x) {
            endX = monitor.x - actor.width;
        } else {
            endX = monitor.x + monitor.width;
        }

        actor.opacity = 255;
        actor.show();

        Tweener.addTween(actor,
                         { x: endX,
                           time: WINDOW_ANIMATION_TIME,
                           transition: "easeOutQuad",
                           onComplete: onComplete,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm, actor],
                           onOverwrite: onOverwrite,
                           onOverwriteScope: this,
                           onOverwriteParams: [shellwm, actor]
                         });
    },

    _minimizeWindow : function(shellwm, actor) {
        let window = actor.meta_window;

        if (!this._shouldAnimateActor(actor)) {
            shellwm.completed_minimize(actor);
            return;
        }

        actor.set_scale(1.0, 1.0);

        this._minimizing.push(actor);

        this._slideWindowOut(shellwm, actor, this._minimizeWindowDone,
                             this._minimizeWindowOverwritten);
    },

    _minimizeWindowDone : function(shellwm, actor) {
        if (this._removeEffect(this._minimizing, actor)) {
            Tweener.removeTweens(actor);
            actor.set_scale(1.0, 1.0);
            actor.set_opacity(255);
            actor.move_anchor_point_from_gravity(Clutter.Gravity.NORTH_WEST);

            shellwm.completed_minimize(actor);
        }
    },

    _minimizeWindowOverwritten : function(shellwm, actor) {
        if (this._removeEffect(this._minimizing, actor)) {
            shellwm.completed_minimize(actor);
        }
    },

    _unminimizeWindow : function(shellwm, actor) {
        // if the overview is visible, we will handle the animation here
        if (!this._shouldAnimateActor(actor) && !Main.overview.visible) {
            shellwm.completed_unminimize(actor);
            return;
        }

        // the window picker has its own animation when selecting a minimized window
        if (Main.overview.visible && Main.overview.getActivePage() == ViewSelector.ViewPage.WINDOWS) {
            shellwm.completed_unminimize(actor);
            return;
        }

        this._unminimizing.push(actor);
        actor.show();

        if (Main.overview.visible) {
            let overviewHiddenId = Main.overview.connect('hidden', Lang.bind(this, function() {
                Main.overview.disconnect(overviewHiddenId);
                this._slideWindowIn(shellwm, actor, this._unminimizeWindowDone,
                                    this._unminimizeWindowOverwritten);
            }));
            Main.overview.hide();
        } else {
            this._slideWindowIn(shellwm, actor, this._unminimizeWindowDone,
                                this._unminimizeWindowOverwritten);
        }
    },

    _unminimizeWindowDone : function(shellwm, actor) {
        if (this._removeEffect(this._unminimizing, actor)) {
            Tweener.removeTweens(actor);
            actor.set_scale(1.0, 1.0);

            shellwm.completed_unminimize(actor);
        }
    },

    _unminimizeWindowOverwritten : function(shellwm, actor) {
        if (this._removeEffect(this._unminimizing, actor)) {
            shellwm.completed_unminimize(actor);
        }
    },

    _maximizeWindow : function(shellwm, actor, targetX, targetY, targetWidth, targetHeight) {
        shellwm.completed_maximize(actor);
    },

    _maximizeWindowDone : function(shellwm, actor) {
    },

    _maximizeWindowOverwrite : function(shellwm, actor) {
    },

    _unmaximizeWindow : function(shellwm, actor, targetX, targetY, targetWidth, targetHeight) {
        shellwm.completed_unmaximize(actor);
    },

    _unmaximizeWindowDone : function(shellwm, actor) {
    },

    _hasAttachedDialogs: function(window, ignoreWindow) {
        var count = 0;
        window.foreach_transient(function(win) {
            if (win != ignoreWindow && win.is_attached_dialog())
                count++;
            return false;
        });
        return count != 0;
    },

    _checkDimming: function(window, ignoreWindow) {
        let shouldDim = this._hasAttachedDialogs(window, ignoreWindow);

        if (shouldDim && !window._dimmed) {
            window._dimmed = true;
            this._dimmedWindows.push(window);
            if (!Main.overview.visible)
                this._dimWindow(window);
        } else if (!shouldDim && window._dimmed) {
            window._dimmed = false;
            this._dimmedWindows = this._dimmedWindows.filter(function(win) {
                                                                 return win != window;
                                                             });
            if (!Main.overview.visible)
                this._undimWindow(window);
        }
    },

    _dimWindow: function(window) {
        let actor = window.get_compositor_private();
        if (!actor)
            return;
        let dimmer = getWindowDimmer(actor);
        if (!dimmer)
            return;
        Tweener.addTween(dimmer,
                         { dimFactor: 1.0,
                           time: DIM_TIME,
                           transition: 'linear'
                         });
    },

    _undimWindow: function(window) {
        let actor = window.get_compositor_private();
        if (!actor)
            return;
        let dimmer = getWindowDimmer(actor);
        if (!dimmer)
            return;
        Tweener.addTween(dimmer,
                         { dimFactor: 0.0,
                           time: UNDIM_TIME,
                           transition: 'linear' });
    },

    _hideOtherWindows: function(actor, animate) {
        let winActors = global.get_window_actors();
        for (let i = 0; i < winActors.length; i++) {
            if (!winActors[i].get_meta_window().showing_on_its_workspace()) {
                continue;
            }

            if (SideComponent.isSideComponentWindow(winActors[i].meta_window)) {
                continue;
            }

            if (animate) {
                Tweener.addTween(winActors[i],
                                 { opacity: 0,
                                   time: WINDOW_ANIMATION_TIME,
                                   transition: 'easeOutQuad',
                                   onComplete: function(winActor) { winActor.hide(); },
                                   onCompleteParams: [winActors[i]],
                                   onOverwrite: function(winActor) { winActor.hide(); },
                                   onOverwriteParams: [winActors[i]]
                                 });
            } else {
                winActors[i].opacity = 0;
                winActors[i].hide();
            }
        }

        this._desktopOverlay.showOverlay(actor);
    },

    _showOtherWindows: function(actor, animate) {
        let winActors = global.get_window_actors();
        for (let i = 0; i < winActors.length; i++) {
            if (!winActors[i].get_meta_window().showing_on_its_workspace()) {
                continue;
            }

            if (SideComponent.isSideComponentWindow(winActors[i].meta_window)) {
                continue;
            }

            if (animate && winActors[i].opacity != 255) {
                winActors[i].show();
                Tweener.addTween(winActors[i],
                                 { opacity: 255,
                                   time: WINDOW_ANIMATION_TIME,
                                   transition: 'easeOutQuad',
                                   onOverwrite: function(winActor) { winActor.opacity = 255; },
                                   onOverwriteParams: [winActors[i]]
                                 });
            } else {
                winActors[i].opacity = 255;
                winActors[i].show();
            }
        }

        this._desktopOverlay.hideOverlay();
    },

    _mapSideComponent : function (shellwm, actor, animateFade) {
        let monitor = Main.layoutManager.monitors[actor.meta_window.get_monitor()];
        if (!monitor) {
            this._mapWindowDone(shellwm, actor);
            return;
        }

        let origX = actor.x;
        if (origX == monitor.x) {
            // the side bar will appear from the left side
            actor.set_position(monitor.x - actor.width, actor.y);
        } else {
            // ... from the right side
            actor.set_position(monitor.x + monitor.width, actor.y);
        }

        actor.opacity = 255;
        actor.show();

        Tweener.addTween(actor,
                         { x: origX,
                           time: WINDOW_ANIMATION_TIME,
                           transition: "easeOutQuad",
                           onComplete: this._mapWindowDone,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm, actor],
                           onOverwrite: this._mapWindowOverwrite,
                           onOverwriteScope: this,
                           onOverwriteParams: [shellwm, actor]
                         });

        if (SideComponent.shouldHideOtherWindows(actor.meta_window)) {
            this._hideOtherWindows(actor, animateFade);
        }
    },

    _mapWindow : function(shellwm, actor) {
        actor._windowType = actor.meta_window.get_window_type();
        actor._notifyWindowTypeSignalId = actor.meta_window.connect('notify::window-type', Lang.bind(this, function () {
            let type = actor.meta_window.get_window_type();
            if (type == actor._windowType)
                return;
            if (type == Meta.WindowType.MODAL_DIALOG ||
                actor._windowType == Meta.WindowType.MODAL_DIALOG) {
                let parent = actor.get_meta_window().get_transient_for();
                if (parent)
                    this._checkDimming(parent);
            }

            actor._windowType = type;
        }));

        // for side components, we will hide the overview and then animate
        if (!this._shouldAnimateActor(actor) && !(SideComponent.isSideComponentWindow(actor.meta_window) && Main.overview.visible)) {
            shellwm.completed_map(actor);
            return;
        }

        if (actor.meta_window.is_attached_dialog()) {
            /* Scale the window from the center of the parent */
            this._checkDimming(actor.get_meta_window().get_transient_for());
            actor.set_scale(1.0, 0.0);
            actor.scale_gravity = Clutter.Gravity.CENTER;
            actor.show();
            this._mapping.push(actor);

            Tweener.addTween(actor,
                             { scale_y: 1,
                               time: WINDOW_ANIMATION_TIME,
                               transition: "easeOutQuad",
                               onComplete: this._mapWindowDone,
                               onCompleteScope: this,
                               onCompleteParams: [shellwm, actor],
                               onOverwrite: this._mapWindowOverwrite,
                               onOverwriteScope: this,
                               onOverwriteParams: [shellwm, actor]
                             });
        } else if (SideComponent.isSideComponentWindow(actor.meta_window)) {
            this._mapping.push(actor);

            if (Main.overview.visible) {
                let overviewHiddenId = Main.overview.connect('hidden', Lang.bind(this, function() {
                    Main.overview.disconnect(overviewHiddenId);
                    this._mapSideComponent(shellwm, actor, false);
                }));
                Main.overview.hide();
            } else {
                this._mapSideComponent(shellwm, actor, true);
            }
        } else {
            /* Fade window in */
            actor.opacity = 0;
            actor.scale_x = 0;
            actor.scale_y = 0;
            actor.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });
            actor.show();
            this._mapping.push(actor);

            Tweener.addTween(actor,
                             { scale_x: 1,
                               scale_y: 1,
                               time: WINDOW_ANIMATION_TIME * 2, // Entire animation takes twice the normal time,
                                                                // but it appears to take about the same duration
                               transition: function(t, b, c, d) {
                                   // Easing function similar to easeOutElastic, but less aggressive.
                                   t /= d;
                                   let p = 0.5;
                                   return b + c * (Math.pow(2, -11 * t) * Math.sin(2 * Math.PI * (t - p / 4) / p) + 1);
                               }
                             });
            Tweener.addTween(actor,
                             { opacity: 255,
                               time: WINDOW_ANIMATION_TIME * 2,
                               transition: 'easeOutCubic',
                               onComplete: this._mapWindowDone,
                               onCompleteScope: this,
                               onCompleteParams: [shellwm, actor],
                               onOverwrite: this._mapWindowOverwrite,
                               onOverwriteScope: this,
                               onOverwriteParams: [shellwm, actor]
                             });
        }
    },

    _mapWindowDone : function(shellwm, actor) {
        if (this._removeEffect(this._mapping, actor)) {
            Tweener.removeTweens(actor);
            actor.opacity = 255;
            actor.scale_x = 1;
            actor.scale_y = 1;
            shellwm.completed_map(actor);
        }
    },

    _mapWindowOverwrite : function(shellwm, actor) {
        if (this._removeEffect(this._mapping, actor)) {
            shellwm.completed_map(actor);
        }
    },

    _killAppIfNoWindow : function(app, pid) {
        let windows = app.get_windows();
        if (windows.length == 0) {
            GLib.spawn_command_line_async('kill ' + pid);
        }
    },

    _destroyWindow : function(shellwm, actor) {
        let window = actor.meta_window;

        // Completely exit Skype when the user closes the window,
        // rather than remain running iconified in the system tray.
        if (window.get_wm_class() == 'Skype') {
            let tracker = Shell.WindowTracker.get_default();
            let app = tracker.get_window_app(window);
            if (app) {
                // Wait some amount of time, and if no Skype windows
                // remain open, exit the application.
                // We need to get the PID now, as it is not available
                // from the app once there are no windows remaining.
                let pid = app.get_pids()[0];
                Mainloop.timeout_add(
                    SKYPE_WINDOW_CLOSE_TIMEOUT_MS,
                    Lang.bind(this, this._killAppIfNoWindow, app, pid));
            }
        }

        if (actor._notifyWindowTypeSignalId) {
            window.disconnect(actor._notifyWindowTypeSignalId);
            actor._notifyWindowTypeSignalId = 0;
        }
        if (window._dimmed) {
            this._dimmedWindows = this._dimmedWindows.filter(function(win) {
                                                                 return win != window;
                                                             });
        }

        if (!this._shouldAnimateActor(actor)) {
            shellwm.completed_destroy(actor);

            if (SideComponent.shouldHideOtherWindows(actor.meta_window)) {
                this._showOtherWindows(actor, false);
            }
            return;
        }

        this._destroying.push(actor);

        if (window.is_attached_dialog()) {
            let parent = window.get_transient_for();
            this._checkDimming(parent, window);

            actor.set_scale(1.0, 1.0);
            actor.scale_gravity = Clutter.Gravity.CENTER;
            actor.show();

            actor._parentDestroyId = parent.connect('unmanaged', Lang.bind(this, function () {
                Tweener.removeTweens(actor);
                this._destroyWindowDone(shellwm, actor);
            }));

            Tweener.addTween(actor,
                             { scale_y: 0,
                               time: WINDOW_ANIMATION_TIME,
                               transition: "easeOutQuad",
                               onComplete: this._destroyWindowDone,
                               onCompleteScope: this,
                               onCompleteParams: [shellwm, actor],
                               onOverwrite: this._destroyWindowDone,
                               onOverwriteScope: this,
                               onOverwriteParams: [shellwm, actor]
                             });
        } else if (SideComponent.isSideComponentWindow(actor.meta_window)) {
            this._slideSideComponentOut(shellwm, actor,
                                        this._destroyWindowDone, this._destroyWindowDone);

            // if the side component does not have the focus at this point,
            // that means that it is closing because another window has gotten it
            // and therefore we should not try to show the desktop
            this._showDesktopOnDestroyDone = actor.meta_window.has_focus() &&
                                             SideComponent.launchedFromDesktop(actor.meta_window);

            if (!this._showDesktopOnDestroyDone && SideComponent.shouldHideOtherWindows(actor.meta_window)) {
                // reveal other windows while we slide out the side component
                this._showOtherWindows(actor, true);
            }
        } else {
            Tweener.addTween(actor,
                             { opacity: 0,
                               time: WINDOW_ANIMATION_TIME,
                               transition: "easeOutQuad",
                               onComplete: this._destroyWindowDone,
                               onCompleteScope: this,
                               onCompleteParams: [shellwm, actor],
                               onOverwrite: this._destroyWindowDone,
                               onOverwriteScope: this,
                               onOverwriteParams: [shellwm, actor]
                             });
        }
    },

    _destroyWindowDone : function(shellwm, actor) {
        if (this._removeEffect(this._destroying, actor)) {
            let parent = actor.get_meta_window().get_transient_for();
            if (parent && actor._parentDestroyId) {
                parent.disconnect(actor._parentDestroyId);
                actor._parentDestroyId = 0;
            }

            if (SideComponent.isSideComponentWindow(actor.meta_window) && this._showDesktopOnDestroyDone) {
                if (!Main.appStore.appLaunched) {
                    Main.overview.showApps();
                }

                Main.appStore.appLaunched = false;

                if (SideComponent.shouldHideOtherWindows(actor.meta_window)) {
                    this._showOtherWindows(actor, false);
                }
            }
            shellwm.completed_destroy(actor);
        }
    },

    _filterKeybinding: function(shellwm, binding) {
        if (Main.keybindingMode == Shell.KeyBindingMode.NONE)
            return true;

        // There's little sense in implementing a keybinding in mutter and
        // not having it work in NORMAL mode; handle this case generically
        // so we don't have to explicitly allow all builtin keybindings in
        // NORMAL mode.
        if (Main.keybindingMode == Shell.KeyBindingMode.NORMAL &&
            binding.is_builtin())
            return false;

        return !(this._allowedKeybindings[binding.get_name()] & Main.keybindingMode);
    },

    _switchWorkspace : function(shellwm, from, to, direction) {
        if (!this._shouldAnimate()) {
            shellwm.completed_switch_workspace();
            return;
        }

        let windows = global.get_window_actors();

        /* @direction is the direction that the "camera" moves, so the
         * screen contents have to move one screen's worth in the
         * opposite direction.
         */
        let xDest = 0, yDest = 0;

        if (direction == Meta.MotionDirection.UP ||
            direction == Meta.MotionDirection.UP_LEFT ||
            direction == Meta.MotionDirection.UP_RIGHT)
                yDest = global.screen_height - Main.panel.actor.height;
        else if (direction == Meta.MotionDirection.DOWN ||
            direction == Meta.MotionDirection.DOWN_LEFT ||
            direction == Meta.MotionDirection.DOWN_RIGHT)
                yDest = -global.screen_height + Main.panel.actor.height;

        if (direction == Meta.MotionDirection.LEFT ||
            direction == Meta.MotionDirection.UP_LEFT ||
            direction == Meta.MotionDirection.DOWN_LEFT)
                xDest = global.screen_width;
        else if (direction == Meta.MotionDirection.RIGHT ||
                 direction == Meta.MotionDirection.UP_RIGHT ||
                 direction == Meta.MotionDirection.DOWN_RIGHT)
                xDest = -global.screen_width;

        let switchData = {};
        this._switchData = switchData;
        switchData.inGroup = new Clutter.Actor();
        switchData.outGroup = new Clutter.Actor();
        switchData.movingWindowBin = new Clutter.Actor();
        switchData.windows = [];

        let wgroup = global.window_group;
        wgroup.add_actor(switchData.inGroup);
        wgroup.add_actor(switchData.outGroup);
        wgroup.add_actor(switchData.movingWindowBin);

        for (let i = 0; i < windows.length; i++) {
            let window = windows[i];

            if (!window.meta_window.showing_on_its_workspace())
                continue;

            if (this._movingWindow && window.meta_window == this._movingWindow) {
                switchData.movingWindow = { window: window,
                                            parent: window.get_parent() };
                switchData.windows.push(switchData.movingWindow);
                window.reparent(switchData.movingWindowBin);
            } else if (window.get_workspace() == from) {
                switchData.windows.push({ window: window,
                                          parent: window.get_parent() });
                window.reparent(switchData.outGroup);
            } else if (window.get_workspace() == to) {
                switchData.windows.push({ window: window,
                                          parent: window.get_parent() });
                window.reparent(switchData.inGroup);
                window.show();
            }
        }

        switchData.inGroup.set_position(-xDest, -yDest);
        switchData.inGroup.raise_top();

        switchData.movingWindowBin.raise_top();

        Tweener.addTween(switchData.outGroup,
                         { x: xDest,
                           y: yDest,
                           time: WINDOW_ANIMATION_TIME,
                           transition: 'easeOutQuad',
                           onComplete: this._switchWorkspaceDone,
                           onCompleteScope: this,
                           onCompleteParams: [shellwm]
                         });
        Tweener.addTween(switchData.inGroup,
                         { x: 0,
                           y: 0,
                           time: WINDOW_ANIMATION_TIME,
                           transition: 'easeOutQuad'
                         });
    },

    _switchWorkspaceDone : function(shellwm) {
        let switchData = this._switchData;
        if (!switchData)
            return;
        this._switchData = null;

        for (let i = 0; i < switchData.windows.length; i++) {
                let w = switchData.windows[i];
                if (w.window.is_destroyed()) // Window gone
                    continue;
                if (w.window.get_parent() == switchData.outGroup) {
                    w.window.reparent(w.parent);
                    w.window.hide();
                } else
                    w.window.reparent(w.parent);
        }
        Tweener.removeTweens(switchData.inGroup);
        Tweener.removeTweens(switchData.outGroup);
        switchData.inGroup.destroy();
        switchData.outGroup.destroy();
        switchData.movingWindowBin.destroy();

        if (this._movingWindow)
            this._movingWindow = null;

        shellwm.completed_switch_workspace();
    },

    _startAppSwitcher : function(display, screen, window, binding) {
        /* prevent a corner case where both popups show up at once */
        if (this._workspaceSwitcherPopup != null)
            this._workspaceSwitcherPopup.destroy();

        let tabPopup = new AltTab.AppSwitcherPopup();

        let modifiers = binding.get_modifiers();
        let backwards = modifiers & Meta.VirtualModifier.SHIFT_MASK;
        if (!tabPopup.show(backwards, binding.get_name(), binding.get_mask()))
            tabPopup.destroy();
    },

    _startWindowSwitcher : function(display, screen, window, binding) {
        /* prevent a corner case where both popups show up at once */
        if (this._workspaceSwitcherPopup != null)
            this._workspaceSwitcherPopup.destroy();

        let tabPopup = new AltTab.WindowSwitcherPopup();

        let modifiers = binding.get_modifiers();
        let backwards = modifiers & Meta.VirtualModifier.SHIFT_MASK;
        if (!tabPopup.show(backwards, binding.get_name(), binding.get_mask()))
            tabPopup.destroy();
    },

    _startA11ySwitcher : function(display, screen, window, binding) {
        let modifiers = binding.get_modifiers();
        let backwards = modifiers & Meta.VirtualModifier.SHIFT_MASK;
        Main.ctrlAltTabManager.popup(backwards, binding.get_name(), binding.get_mask());
    },

    _showForceAppExitDialog: function() {
        if (!Main.sessionMode.hasOverview) {
            return;
        }

        let dialog = new ForceAppExitDialog.ForceAppExitDialog();
        dialog.open();
    },

    _showWorkspaceSwitcher : function(display, screen, window, binding) {
        if (screen.n_workspaces == 1)
            return;

        let [action,,,direction] = binding.get_name().split('-');
        let direction = Meta.MotionDirection[direction.toUpperCase()];
        let newWs;


        if (direction != Meta.MotionDirection.UP &&
            direction != Meta.MotionDirection.DOWN)
            return;

        if (action == 'switch')
            newWs = this.actionMoveWorkspace(direction);
        else
            newWs = this.actionMoveWindow(window, direction);

        if (!Main.overview.visible) {
            if (this._workspaceSwitcherPopup == null) {
                this._workspaceSwitcherPopup = new WorkspaceSwitcherPopup.WorkspaceSwitcherPopup();
                this._workspaceSwitcherPopup.connect('destroy', Lang.bind(this, function() {
                    this._workspaceSwitcherPopup = null;
                }));
            }
            this._workspaceSwitcherPopup.display(direction, newWs.index());
        }
    },

    actionMoveWorkspace: function(direction) {
        let activeWorkspace = global.screen.get_active_workspace();
        let toActivate = activeWorkspace.get_neighbor(direction);

        if (activeWorkspace != toActivate)
            toActivate.activate(global.get_current_time());

        return toActivate;
    },

    actionMoveWindow: function(window, direction) {
        let activeWorkspace = global.screen.get_active_workspace();
        let toActivate = activeWorkspace.get_neighbor(direction);

        if (activeWorkspace != toActivate) {
            // This won't have any effect for "always sticky" windows
            // (like desktop windows or docks)

            this._movingWindow = window;
            window.change_workspace(toActivate);

            global.display.clear_mouse_mode();
            toActivate.activate_with_focus (window, global.get_current_time());
        }

        return toActivate;
    },

    _confirmDisplayChange: function() {
        let dialog = new DisplayChangeDialog(this._shellwm);
        dialog.open();
    },
});
