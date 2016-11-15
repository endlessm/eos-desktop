// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Flatpak = imports.gi.Flatpak;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const EndlessShellFX = imports.gi.EndlessShellFX;
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
const Util = imports.misc.util;
const ViewSelector = imports.ui.viewSelector;
const WindowMenu = imports.ui.windowMenu;

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

const SylvesterServiceIface = '<node> \
  <interface name="com.endlessm.Sylvester.Service"> \
    <method name="DownloadSourcesForPID"> \
      <arg name="pid" direction="in" type="i"/> \
    </method> \
    <signal name="RotateBetweenPidWindows"> \
      <arg name="src" type="i"/> \
      <arg name="dest" type="i"/> \
    </signal> \
  </interface> \
</node>';

const SylvesterService = Gio.DBusProxy.makeProxyWrapper(SylvesterServiceIface);

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

const EOSShellWobbly = new Lang.Class({
    Name: 'EOSShellWobbly',
    Extends: EndlessShellFX.Wobbly,

    _init: function(params) {
        this.parent(params);

        const binder = Lang.bind(this, function(key, prop) {
            global.settings.bind(key, this, prop, Gio.SettingsBindFlags.GET);
        });

        // Bind to effect properties
        binder('wobbly-spring-k', 'spring-k');
        binder('wobbly-spring-friction', 'friction');
        binder('wobbly-slowdown-factor', 'slowdown-factor');
        binder('wobbly-object-movement-range', 'object-movement-range');
    },

    grabbedByMouse: function() {
        let position = global.get_pointer();
        let actor = this.get_actor();
        this.grab(position[0], position[1]);

        this._lastPosition = actor.get_position();
        this._positionChangedId =
            actor.connect('notify::position', Lang.bind(this, function (actor) {
                let position = actor.get_position();
                let dx = position[0] - this._lastPosition[0];
                let dy = position[1] - this._lastPosition[1];

                this.move_by(dx, dy);
                this._lastPosition = position;
            }));
    },

    ungrabbedByMouse: function() {
        // Only continue if we have an active grab and change notification
        // on movement
        if (!this._positionChangedId) {
            return;
        }

        let actor = this.get_actor();
        this.ungrab();

        actor.disconnect(this._positionChangedId);
        this._positionChangedId = undefined;
    }
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

const TilePreview = new Lang.Class({
    Name: 'TilePreview',

    _init: function() {
        this.actor = new St.Widget();
        global.window_group.add_actor(this.actor);

        this._reset();
        this._showing = false;
    },

    show: function(window, tileRect, monitorIndex) {
        let windowActor = window.get_compositor_private();
        if (!windowActor)
            return;

        global.window_group.set_child_below_sibling(this.actor, windowActor);

        if (this._rect && this._rect.equal(tileRect))
            return;

        let changeMonitor = (this._monitorIndex == -1 ||
                             this._monitorIndex != monitorIndex);

        this._monitorIndex = monitorIndex;
        this._rect = tileRect;

        let monitor = Main.layoutManager.monitors[monitorIndex];

        this._updateStyle(monitor);

        if (!this._showing || changeMonitor) {
            let monitorRect = new Meta.Rectangle({ x: monitor.x,
                                                   y: monitor.y,
                                                   width: monitor.width,
                                                   height: monitor.height });
            let [, rect] = window.get_frame_rect().intersect(monitorRect);
            this.actor.set_size(rect.width, rect.height);
            this.actor.set_position(rect.x, rect.y);
            this.actor.opacity = 0;
        }

        this._showing = true;
        this.actor.show();
        Tweener.addTween(this.actor,
                         { x: tileRect.x,
                           y: tileRect.y,
                           width: tileRect.width,
                           height: tileRect.height,
                           opacity: 255,
                           time: WINDOW_ANIMATION_TIME,
                           transition: 'easeOutQuad'
                         });
    },

    hide: function() {
        if (!this._showing)
            return;

        this._showing = false;
        Tweener.addTween(this.actor,
                         { opacity: 0,
                           time: WINDOW_ANIMATION_TIME,
                           transition: 'easeOutQuad',
                           onComplete: Lang.bind(this, this._reset)
                         });
    },

    _reset: function() {
        this.actor.hide();
        this._rect = null;
        this._monitorIndex = -1;
    },

    _updateStyle: function(monitor) {
        let styles = ['tile-preview'];
        if (this._monitorIndex == Main.layoutManager.primaryIndex)
            styles.push('on-primary');
        if (this._rect.x == monitor.x)
            styles.push('tile-preview-left');
        if (this._rect.x + this._rect.width == monitor.x + monitor.width)
            styles.push('tile-preview-right');

        this.actor.style_class = styles.join(' ');
    }
});

const WindowManager = new Lang.Class({
    Name: 'WindowManager',

    _init : function() {
        this._shellwm =  global.window_manager;

        this._minimizing = [];
        this._unminimizing = [];
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
            Main.layoutManager.prepareForOverview();
            this._slideSideComponentOut(this._shellwm,
                                        this._desktopOverlay.overlayActor,
                                        function () { Main.layoutManager.emit('background-clicked'); },
                                        function () { Main.layoutManager.emit('background-clicked'); });
        }));

        this._codingManager = new CodingManager();

        this._switchData = null;
        this._shellwm.connect('kill-switch-workspace', Lang.bind(this, this._switchWorkspaceDone));
        this._shellwm.connect('kill-window-effects', Lang.bind(this, function (shellwm, actor) {
            this._minimizeWindowDone(shellwm, actor);
            this._unminimizeWindowDone(shellwm, actor);
            this._mapWindowDone(shellwm, actor);
            this._destroyWindowDone(shellwm, actor);
            this._rotateInCompleted(actor);
            this._rotateOutCompleted(actor);
            this._codingManager.rotateInCompleted(actor);
            this._codingManager.rotateOutCompleted(actor);

            if (actor._firstFrameConnection) {
                actor.disconnect(actor._firstFrameConnection);
                this._firstFrameConnections = this._firstFrameConnections.filter(function(conn) {
                    return conn !== actor._firstFrameConnection;
                });
            }

            actor._firstFrameConnection = null;
        }));

        this._shellwm.connect('switch-workspace', Lang.bind(this, this._switchWorkspace));
        this._shellwm.connect('show-tile-preview', Lang.bind(this, this._showTilePreview));
        this._shellwm.connect('hide-tile-preview', Lang.bind(this, this._hideTilePreview));
        this._shellwm.connect('show-window-menu', Lang.bind(this, this._showWindowMenu));
        this._shellwm.connect('minimize', Lang.bind(this, this._minimizeWindow));
        this._shellwm.connect('unminimize', Lang.bind(this, this._unminimizeWindow));
        this._shellwm.connect('size-change', Lang.bind(this, this._sizeChangeWindow));
        this._shellwm.connect('map', Lang.bind(this, this._mapWindow));
        this._shellwm.connect_after('destroy', Lang.bind(this, this._destroyWindow));
        this._shellwm.connect('filter-keybinding', Lang.bind(this, this._filterKeybinding));
        this._shellwm.connect('confirm-display-change', Lang.bind(this, this._confirmDisplayChange));

        this._workspaceSwitcherPopup = null;
        this._tilePreview = null;

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

        global.display.connect('grab-op-begin', Lang.bind(this, this._windowGrabbed));
        global.display.connect('grab-op-end', Lang.bind(this, this._windowUngrabbed));

        this._windowMenuManager = new WindowMenu.WindowMenuManager();

        this._sylvesterListener = new SylvesterService(Gio.DBus.session,
                                                       'com.endlessm.Sylvester.Service',
                                                       '/com/endlessm/Sylvester/Service');
        this._sylvesterListener.connectSignal('RotateBetweenPidWindows',
                                              Lang.bind(this, this._handleRotateBetweenPidWindows));
        this._pendingRotateAnimations = [];
        this._rotateOutActors = [];
        this._rotateInActors = [];
        this._firstFrameConnections = [];
    },

    _handleRotateBetweenPidWindows: function(proxy, sender, [src, dst]) {
        /**
         * For a given process id, determine the corresponding window
         * (if any) and its size.
         */
        function pidToActorInfo(pid) {
            let windowActors = global.get_window_actors().filter(function(windowActor) {
                return windowActor.get_meta_window().get_pid() == pid;
            });

            return {
                window: windowActors.length ? windowActors[0] : null,
                rect: (windowActors.length ?
                       windowActors[0].get_meta_window().get_frame_rect() : null),
                pid: pid,
            };
        }

        let srcActorInfo = pidToActorInfo(src);
        this._pendingRotateAnimations.push({
            src: srcActorInfo,
            dst: pidToActorInfo(dst)
        });
        this._updateReadyRotateAnimationsWith(srcActorInfo.window);
    },

    _updateReadyRotateAnimationsWith: function(window) {
        /* A new window was added. Get its pid and look for any
         * unsatisfied entries in _pendingRotateAnimations */
        let pid = window ? window.get_meta_window().get_pid() : null;
        let lastPendingRotateAnimationsLength = this._pendingRotateAnimations.length;
        this._pendingRotateAnimations = this._pendingRotateAnimations.filter(Lang.bind(this, function(animationSpec) {
            let unsatisfiedPids = 0;
            Object.keys(animationSpec).forEach(function(key) {
                if (animationSpec[key].window == null) {
                    if (animationSpec[key].pid == pid) {
                        animationSpec[key].window = window;
                    } else {
                        unsatisfiedPids++;
                    }
                }
            });

            if (unsatisfiedPids != 0) {
                /* There are still unsatisfied process ID's, keep this metadata around. */
                return true;
            }

            animationSpec.dst.window.rotation_angle_y = -180;
            animationSpec.dst.window.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });
            animationSpec.src.window.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });

            /* We set backface culling to be enabled here so that we can
             * smootly animate between the two windows. Without expensive
             * vector projections, there's no way to determine whether a
             * window's front-face is completely invisible to the user
             * (this cannot be done just by looking at the angle of the
             * window because the same angle may show a different visible
             * face depending on its position in the view frustum).
             *
             * What we do here is enable backface culling and rotate both
             * windows by 180degrees. The effect of this is that the front
             * and back window will be at opposite rotations at each point
             * in time and so the exact point at which the first window
             * becomes invisible is the same point at which the second
             * window becomes visible. Because no back faces are drawn
             * there are no visible artifacts in the animation */
            animationSpec.src.window.set_cull_back_face(true);
            animationSpec.dst.window.set_cull_back_face(true);
            animationSpec.dst.window.opacity = 0;
            let dst_geometry = animationSpec.src.rect;
            animationSpec.dst.window.get_meta_window().move_resize_frame(false,
                                                                         dst_geometry.x,
                                                                         dst_geometry.y,
                                                                         dst_geometry.width,
                                                                         dst_geometry.height);

            this._rotateInActors.push(animationSpec.dst.window);
            this._rotateOutActors.push(animationSpec.src.window);

            /* We wait until the first frame of the window has been drawn
             * and damage updated in the compositor before we start rotating.
             *
             * This way we don't get ugly artifacts when rotating if
             * a window is slow to draw.
             */
            let firstFrameConnection = animationSpec.dst.window.connect('first-frame', Lang.bind(this, function() {
                /* Tween both windows in a rotation animation at the same time
                 * with backface culling enabled on both. This will allow for
                 * a smooth transition. */
                Tweener.addTween(animationSpec.src.window, {
                    rotation_angle_y: 180,
                    time: WINDOW_ANIMATION_TIME * 4,
                    transition: 'easeOutQuad',
                    onComplete: Lang.bind(this, function() {
                        this._rotateOutCompleted(animationSpec.src.window);
                    })
                });
                Tweener.addTween(animationSpec.dst.window, {
                    rotation_angle_y: 0,
                    time: WINDOW_ANIMATION_TIME * 4,
                    transition: 'easeOutQuad',
                    onComplete: Lang.bind(this, function() {
                        this._rotateInCompleted(animationSpec.dst.window);
                    })
                });

                /* Gently fade the window in, this will paper over
                 * any artifacts from shadows and the like */
                Tweener.addTween(animationSpec.dst.window, {
                    opacity: 255,
                    time: WINDOW_ANIMATION_TIME,
                    transition: 'linear'
                });

                this._firstFrameConnections = this._firstFrameConnections.filter(function(conn) {
                    return conn != animationSpec.dst.window._firstFrameConnection;
                });
                animationSpec.dst.window.disconnect(animationSpec.dst.window._firstFrameConnection);
                animationSpec.dst.window._firstFrameConnection = null;

                return false;
            }));

            /* Save the connection's id on the destination window and in a list too so we can
             * get rid of it on kill-window-effects later */
            animationSpec.dst.window._firstFrameConnection = firstFrameConnection;
            this._firstFrameConnections.push(firstFrameConnection);

            /* This will remove us from pending rotations */
            return false;
        }));

        return this._pendingRotateAnimations.length != lastPendingRotateAnimationsLength;
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
        return !(Main.overview.visible || !Main.sessionMode.hasWindows ||
                 this._animationBlockCount > 0);
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

    _sizeChangeWindow : function(shellwm, actor, whichChange, oldFrameRect, oldBufferRect) {
        shellwm.completed_size_change(actor);
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
        let window = actor.meta_window;

        actor._windowType = window.get_window_type();
        actor._notifyWindowTypeSignalId = window.connect('notify::window-type', Lang.bind(this, function () {
            let type = window.get_window_type();
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

        let isSplashWindow = Shell.WindowTracker.is_speedwagon_window(window);

        if (!isSplashWindow) {
            // If we have an active splash window for the app, don't animate it.
            // The _showingSplash state here is a bit dirty -- it's set by appActivation.js
            let tracker = Shell.WindowTracker.get_default();
            let app = tracker.get_window_app(window);
            let hasSplashWindow = (app && app.get_windows().some(function(window) {
                return Shell.WindowTracker.is_speedwagon_window(window);
            }));
            if (hasSplashWindow) {
                shellwm.completed_map(actor);
                return;
            }
        }

        if (this._codingAddBuilderWindow(actor)) {
            shellwm.completed_map(actor);
            return;
        }

        if (this._updateReadyRotateAnimationsWith(actor)) {
            shellwm.completed_map(actor);
            return;
        }

        // for side components, we will hide the overview and then animate
        if (!this._shouldAnimateActor(actor) && !(SideComponent.isSideComponentWindow(window) && Main.overview.visible)) {
            shellwm.completed_map(actor);
            return;
        }

        if (window.is_attached_dialog()) {
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
        } else if (SideComponent.isSideComponentWindow(window)) {
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
        } else if (isSplashWindow) {
            // This is a Speedwagon splash screen. Slide it up from the bottom.
            let workArea = Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
            actor.translation_y = workArea.height;
            actor.show();
            this._mapping.push(actor);

            Tweener.addTween(actor,
                             { translation_y: 0,
                               time: WINDOW_ANIMATION_TIME,
                               transition: 'linear',
                               onComplete: this._mapWindowDone,
                               onCompleteScope: this,
                               onCompleteParams: [shellwm, actor],
                               onOverwrite: this._mapWindowOverwrite,
                               onOverwriteScope: this,
                               onOverwriteParams: [shellwm, actor]
                             });
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

        this._codingAddAppWindow(actor);
    },

    _codingAddAppWindow : function(actor) {
        let window = actor.meta_window;
        if (!this._codingManager.isCodingApp(window.get_flatpak_id()))
            return;

        this._codingManager.addSwitcherToBuilder(actor);
    },

    _codingAddBuilderWindow : function(actor) {
        let window = actor.meta_window;
        if (window.get_flatpak_id() !== 'org.gnome.Builder')
            return false;

        let tracker = Shell.WindowTracker.get_default();
        let windowApp = tracker.get_app_from_builder(window);
        if (!windowApp)
            return false;

        this._codingManager.addSwitcherToApp(actor, windowApp);
        return true;
    },

    _codingRemoveAppWindow : function(actor) {
        let window = actor.meta_window;
        if (!this._codingManager.isCodingApp(window.get_flatpak_id()))
            return;

        this._codingManager.removeSwitcherToBuilder(actor);
    },

    _codingRemoveBuilderWindow : function(actor) {
        let window = actor.meta_window;
        if (window.get_flatpak_id() !== 'org.gnome.Builder')
            return;

        this._codingManager.removeSwitcherToApp(actor);
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

    _rotateInCompleted: function(actor) {
        if (this._removeEffect(this._rotateInActors, actor)) {
            Tweener.removeTweens(actor);
            actor.opacity = 255;
            actor.rotation_angle_y = 0;
            actor.set_cull_back_face(false);
        }
    },

    _rotateOutCompleted: function(actor) {
        if (this._removeEffect(this._rotateOutActors, actor)) {
            Tweener.removeTweens(actor);
            actor.hide();
            actor.rotation_angle_y = 0;
            actor.set_cull_back_face(false);
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

        this._codingRemoveAppWindow(actor);
        this._codingRemoveBuilderWindow(actor);

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
            } else if (this._showDesktopOnDestroyDone) {
                Main.layoutManager.prepareForOverview();
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

    _showTilePreview: function(shellwm, window, tileRect, monitorIndex) {
        if (!this._tilePreview)
            this._tilePreview = new TilePreview();
        this._tilePreview.show(window, tileRect, monitorIndex);
    },

    _hideTilePreview: function(shellwm) {
        if (!this._tilePreview)
            return;
        this._tilePreview.hide();
    },

    _showWindowMenu: function(shellwm, window, menu, rect) {
        this._windowMenuManager.showWindowMenuForWindow(window, menu, rect);
    },

    _startAppSwitcher : function(display, screen, window, binding) {
        /* prevent a corner case where both popups show up at once */
        if (this._workspaceSwitcherPopup != null)
            this._workspaceSwitcherPopup.destroy();

        let tabPopup = new AltTab.AppSwitcherPopup();

        if (!tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask()))
            tabPopup.destroy();
    },

    _startWindowSwitcher : function(display, screen, window, binding) {
        /* prevent a corner case where both popups show up at once */
        if (this._workspaceSwitcherPopup != null)
            this._workspaceSwitcherPopup.destroy();

        let tabPopup = new AltTab.WindowSwitcherPopup();

        if (!tabPopup.show(binding.is_reversed(), binding.get_name(), binding.get_mask()))
            tabPopup.destroy();
    },

    _startA11ySwitcher : function(display, screen, window, binding) {
        Main.ctrlAltTabManager.popup(binding.is_reversed(), binding.get_name(), binding.get_mask());
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

    _windowCanWobble: function(window, op) {
        if (window.is_override_redirect() ||
            op != Meta.GrabOp.MOVING ||
            !global.settings.get_boolean('wobbly-effect'))
            return false;

        return true;
    },

    _windowGrabbed: function(display, screen, window, op) {
        // Occassionally, window can be null, in cases where grab-op-begin
        // was emitted on a window from shell-toolkit. Ignore these grabs.
        if (!window)
            return;

        if (!this._windowCanWobble(window, op))
            return;

        let actor = window.get_compositor_private();

        let effect = actor.get_effect('endless-wobbly');
        if (!effect) {
            effect = new EOSShellWobbly();
            actor.add_effect_with_name('endless-wobbly', effect);
        }

        effect.grabbedByMouse();
    },

    _windowUngrabbed: function(display, op, window) {
        // Occassionally, window can be null, in cases where grab-op-end
        // was emitted on a window from shell-toolkit. Ignore these grabs.
        if (!window)
            return;

        let actor = window.get_compositor_private();
        let effect = actor.get_effect('endless-wobbly');

        // Lots of different grab ops can end here, so we just let
        // EOSShellWobbly.ungrabbedByMouse figure out what to do based on its
        // own state
        if (effect) {
            effect.ungrabbedByMouse();
        }
    },
});

const ICON_BOUNCE_MAX_SCALE = 0.4;
const ICON_BOUNCE_ANIMATION_TIME = 1.0;
const ICON_BOUNCE_ANIMATION_TYPE_1 = 'easeOutSine';
const ICON_BOUNCE_ANIMATION_TYPE_2 = 'easeOutBounce';

const BUTTON_OFFSET_X = 50;
const BUTTON_OFFSET_Y = 50;

function animateBounce(actor) {
    Tweener.removeTweens(actor);
    if (Tweener.isTweening(actor))
        return;

    Tweener.addTween(actor, {
        scale_y: 1 + ICON_BOUNCE_MAX_SCALE,
        scale_x: 1 + ICON_BOUNCE_MAX_SCALE,
        translation_y: actor.height * ICON_BOUNCE_MAX_SCALE,
        translation_x: actor.width * ICON_BOUNCE_MAX_SCALE / 2,
        time: ICON_BOUNCE_ANIMATION_TIME * 0.25,
        delay: 0.3,
        transition: ICON_BOUNCE_ANIMATION_TYPE_1
    });
    Tweener.addTween(actor, {
        scale_y: 1,
        scale_x: 1,
        translation_y: 0,
        translation_x: 0,
        time: ICON_BOUNCE_ANIMATION_TIME * 0.35,
        transition: ICON_BOUNCE_ANIMATION_TYPE_2,
        delay: ICON_BOUNCE_ANIMATION_TIME * 0.25 + 0.3,
        onComplete: function() {animateBounce(actor);}
    });
}

const CodingManager = new Lang.Class({
    Name: 'CodingManager',

    _init: function(actor) {
        this._sessions = [];
        this._rotateInActors = [];
        this._rotateOutActors = [];
        this._firstFrameConnections = [];
        this._previousFocusedWindow = null;
        this._codingApps = ['org.gnome.gedit', 'org.gnome.Weather'];
    },

    /**
     * isCodingApp:
     * @flatpakID: flatpak id of the app to verify
     *
     * Checks if the app is in the whitelist of applications
     * for which the endless coding feature is enabled.
     */
    isCodingApp: function(flatpakID) {
        return this._codingApps.indexOf(flatpakID) != -1;
    },

    addSwitcherToBuilder: function(actorApp) {
        let window = actorApp.meta_window;

        let button = new St.Button({ style_class: 'view-source' });
        let rect = window.get_frame_rect();
        button.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        Main.layoutManager.addChrome(button);

        this._sessions.push({buttonApp: button,
                             actorApp: actorApp,
                             previousFocusedWindow: null});

        let session = this._getSession(actorApp);

        button.connect('clicked', Lang.bind(this, this._switchToBuilder, session));
        session.positionChangedIdApp = window.connect('position-changed', Lang.bind(this, this._windowAppPositionChanged, session));
        session.sizeChangedIdApp = window.connect('size-changed', Lang.bind(this, this._windowAppSizeChanged, session));
        session.windowsRestackedId = Main.overview.connect('windows-restacked', Lang.bind(this, this._windowAppRestacked, session));
        session.windowMinimizedId = global.window_manager.connect('minimize', Lang.bind(this, this._windowMinimized, session));
        session.windowUnminimizedId = global.window_manager.connect('unminimize', Lang.bind(this, this._windowUnminimized, session));
    },

    addSwitcherToApp: function(actorBuilder, windowApp) {
        let session = this._getSession(windowApp.get_compositor_private());
        if (!session)
            return;

        session.actorBuilder = actorBuilder;

        this._animateToBuilder(session);
    },

    removeSwitcherToBuilder : function(actorApp) {
        let session = this._getSession(actorApp);
        if (!session)
            return;

        if (session.positionChangedIdApp !== 0) {
            session.actorApp.meta_window.disconnect(session.positionChangedIdApp);
            session.positionChangedIdApp = 0;
        }
        if (session.sizeChangedIdApp !== 0) {
            session.actorApp.meta_window.disconnect(session.sizeChangedIdApp);
            session.sizeChangedIdApp = 0;
        }
        if (session.windowsRestackedId !== 0) {
            Main.overview.disconnect(session.windowsRestackedId);
            session.windowsRestackedId = 0;
        }
        if (session.windowMinimizedId !== 0) {
            global.window_manager.disconnect(session.windowMinimizedId);
            session.windowMinimizedId = 0;
        }
        if (session.windowUnminimizedId !== 0) {
            global.window_manager.disconnect(session.windowUnminimizedId);
            session.windowUnminimizedId = 0;
        }

        Main.layoutManager.removeChrome(session.buttonApp);
        session.buttonApp.destroy();
        session.actorApp = null;

        // Builder window still open, keep it open
        // but remove the coding session specific parts
        if (session.actorBuilder) {
            this._clearBuilderSession(session);

            session.actorBuilder.meta_window.activate(global.get_current_time());
            session.actorBuilder.show();
        } else {
            this._removeSession(session);
        }
    },

    _clearBuilderSession: function(session) {
        let tracker = Shell.WindowTracker.get_default();
        tracker.untrack_coding_app_window(session.actorBuilder.meta_window);

        if (session.positionChangedIdBuilder !== 0) {
            session.actorBuilder.meta_window.disconnect(session.positionChangedIdBuilder);
            session.positionChangedIdBuilder = 0;
        }
        if (session.sizeChangedIdBuilder !== 0) {
            session.actorBuilder.meta_window.disconnect(session.sizeChangedIdBuilder);
            session.sizeChangedIdBuilder = 0;
        }
        if (session.buttonBuilder) {
            Main.layoutManager.removeChrome(session.buttonBuilder);
            session.buttonBuilder.destroy();
            session.buttonBuilder = null;
        }
    },

    removeSwitcherToApp : function(actorBuilder) {
        let session = this._getSession(actorBuilder);
        if (!session)
            return;

        this._clearBuilderSession(session);
        session.actorBuilder = null;

        if (session.actorApp) {
            session.actorApp.meta_window.activate(global.get_current_time());
            session.actorApp.show();
            session.buttonApp.show();
        } else {
            this._removeSession(session);
        }
    },

    _switchToBuilder : function(actor, event, session) {
        if (!session.actorBuilder) {
            let tracker = Shell.WindowTracker.get_default();
            tracker.track_coding_app_window(session.actorApp.meta_window);
            // Pass the manifest path to Builder
            // this._getManifestPath(session.actorApp.meta_window.get_flatpak_id()));
            Util.trySpawn(['flatpak', 'run', 'org.gnome.Builder', '-s']);
            animateBounce(session.buttonApp);
        } else {
            session.actorBuilder.meta_window.activate(global.get_current_time());
            this._prepareAnimate(session.actorApp,
                                 session.actorBuilder,
                                 Gtk.DirectionType.LEFT);
            this._animate(session.actorApp,
                          session.actorBuilder,
                          Gtk.DirectionType.LEFT);
            session.buttonApp.hide();
            session.buttonBuilder.show();
        }
    },

    _switchToApp : function(actor, event, session) {
        if (!session.actorApp)
            return;
        session.actorApp.meta_window.activate(global.get_current_time());
        this._prepareAnimate(session.actorBuilder,
                             session.actorApp,
                             Gtk.DirectionType.RIGHT);
        this._animate(session.actorBuilder,
                      session.actorApp,
                      Gtk.DirectionType.RIGHT);
        session.buttonBuilder.hide();
        session.buttonApp.show();
    },

    _getSession: function(actor) {
        let currentSession = this._sessions.filter(function(session) {
            return (session.actorApp === actor || session.actorBuilder === actor);
        });
        if (currentSession.length === 0)
            return null;
        return currentSession[0];
    },

    _addButton: function(session) {
        let window = session.actorBuilder.meta_window;
        let button = new St.Button({ style_class: 'view-source' });
        let rect = window.get_frame_rect();
        button.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        Main.layoutManager.addChrome(button);
        button.connect('clicked', Lang.bind(this, this._switchToApp, session));

        session.positionChangedIdBuilder = window.connect('position-changed', Lang.bind(this, this._windowBuilderPositionChanged, session));
        session.sizeChangedIdBuilder = window.connect('size-changed', Lang.bind(this, this._windowBuilderSizeChanged, session));

        session.buttonBuilder = button;
    },

    _animateToBuilder: function(session) {
        /* We wait until the first frame of the window has been drawn
         * and damage updated in the compositor before we start rotating.
         *
         * This way we don't get ugly artifacts when rotating if
         * a window is slow to draw. */
        let firstFrameConnection = session.actorBuilder.connect('first-frame', Lang.bind(this, function() {
            // reset the bouncing animation that was showed while Builder was loading
            Tweener.removeTweens(session.buttonApp);
            session.buttonApp.scale_y = 1;
            session.buttonApp.scale_x = 1;
            session.buttonApp.translation_y = 0;
            session.buttonApp.translation_x = 0;

            this._animate(session.actorApp, session.actorBuilder, Gtk.DirectionType.LEFT);

            this._firstFrameConnections = this._firstFrameConnections.filter(function(conn) {
                return conn != session.firstFrameConnection;
            });
            session.actorBuilder.disconnect(session.firstFrameConnection);
            session.firstFrameConnection = null;

            this._addButton(session);
            session.buttonBuilder.show();
            session.buttonApp.hide();

            return false;
        }));

        this._prepareAnimate(session.actorApp, session.actorBuilder, Gtk.DirectionType.LEFT);
        /* Save the connection's id in the session and in a list too so we can
         * get rid of it on kill-window-effects later */
        session.firstFrameConnection = firstFrameConnection;
        this._firstFrameConnections.push(firstFrameConnection);
    },

    _windowAppPositionChanged: function(window, session) {
        let rect = session.actorApp.meta_window.get_frame_rect();
        session.buttonApp.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        if (!session.actorBuilder)
            return;
        session.actorBuilder.meta_window.move_resize_frame(false,
                                                           rect.x,
                                                           rect.y,
                                                           rect.width,
                                                           rect.height);
    },

    _windowAppSizeChanged: function(window, session) {
        let rect = session.actorApp.meta_window.get_frame_rect();
        session.buttonApp.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        if (!session.actorBuilder)
            return;
        session.actorBuilder.meta_window.move_resize_frame(false,
                                                           rect.x,
                                                           rect.y,
                                                           rect.width,
                                                           rect.height);
    },

    _windowBuilderPositionChanged: function(window, session) {
        let rect = session.actorBuilder.meta_window.get_frame_rect();
        session.buttonBuilder.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        if (!session.actorApp)
            return;
        session.actorApp.meta_window.move_resize_frame(false,
                                                       rect.x,
                                                       rect.y,
                                                       rect.width,
                                                       rect.height);
    },

    _windowBuilderSizeChanged: function(window, session) {
        let rect = session.actorBuilder.meta_window.get_frame_rect();
        session.buttonBuilder.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        if (!session.actorApp)
            return;
        session.actorApp.meta_window.move_resize_frame(false,
                                                       rect.x,
                                                       rect.y,
                                                       rect.width,
                                                       rect.height);
    },

    _windowMinimized: function(shellwm, actor, session) {
        // take the actor that we minimized and emit a minimized
        // signal for it, though setting a flag internally so that
        // we don't re-enter this signal handler.
        if (this._processingWindowMinimized === actor) {
            this._processingWindowMinimized = null;
            return;
        }

        if (actor === session.actorApp && session.actorBuilder) {
            this._processingWindowMinimized = session.actorBuilder;
            session.actorBuilder.meta_window.minimize();
        } else if (actor === session.actorBuilder && session.actorApp) {
            this._processingWindowMinimized = session.actorApp;
            session.actorApp.meta_window.minimize();
        }
    },

    _windowUnminimized: function(shellwm, actor, session) {
        // take the actor that we minimized and emit a minimized
        // signal for it, though setting a flag internally so that
        // we don't re-enter this signal handler.
        if (this._processingWindowUnminimized === actor) {
            this._processingWindowUnminimized = null;
            return;
        }

        if (actor === session.actorApp && session.actorBuilder) {
            this._processingWindowUnminimized = session.actorBuilder;
            session.actorBuilder.meta_window.unminimize();
        } else if (actor === session.actorBuilder && session.actorApp) {
            this._processingWindowUnminimized = session.actorApp;
            session.actorApp.meta_window.unminimize();
        }
    },

    _windowAppRestacked : function(overview, stackIndices, session) {
        let focusedWindow = global.display.get_focus_window();
        if (!focusedWindow)
            return;

        // we get the signal for the same window switch twice
        if (focusedWindow === session.previousFocusedWindow){
            return;
        }
        // keep track of the previous focused window so
        // that we can show the animation accordingly
        let previousFocused = session.previousFocusedWindow;
        session.previousFocusedWindow = focusedWindow;

        // make sure we hide the button in any other case as on
        // top of the App and Builder window
        session.buttonApp.hide();
        if (session.buttonBuilder)
            session.buttonBuilder.hide();

        if (focusedWindow === session.actorApp.meta_window) {
            if (session.actorBuilder && session.actorBuilder.meta_window === previousFocused) {
                // make sure we do not rotate when a rotation is running
                if (this._rotateInActors.length || this._rotateOutActors.length) {
                    session.buttonApp.show();
                    return;
                }
                this._prepareAnimate(session.actorBuilder,
                                     session.actorApp,
                                     Gtk.DirectionType.RIGHT);
                this._animate(session.actorBuilder,
                              session.actorApp,
                              Gtk.DirectionType.RIGHT);
                session.buttonApp.show();
                return;
            }
            session.actorApp.show();
            session.buttonApp.show();
            // hide the underlying window to prevent glitches when resizing
            // the one on top, we do this for the animated switch case already
            if (session.actorBuilder)
                session.actorBuilder.hide();
            return;
        }

        if (!session.actorBuilder)
            return;
        if (focusedWindow === session.actorBuilder.meta_window) {
            if (session.actorApp.meta_window === previousFocused) {
                // make sure we do not rotate when a rotation is running
                if (this._rotateInActors.length || this._rotateOutActors.length) {
                    if (session.buttonBuilder)
                        session.buttonBuilder.show();
                    return;
                }
                this._prepareAnimate(session.actorApp,
                                     session.actorBuilder,
                                     Gtk.DirectionType.LEFT);
                this._animate(session.actorApp,
                              session.actorBuilder,
                              Gtk.DirectionType.LEFT);
                session.buttonBuilder.show();
            } else {
                session.actorBuilder.show();
                session.buttonBuilder.show();
                // hide the underlying window to prevent glitches when resizing
                // the one on top, we do this for the animated switch case already
                session.actorApp.hide();
            }
        }
    },

    _prepareAnimate : function(src, dst, direction) {
        this._rotateInActors.push(dst);
        this._rotateOutActors.push(src);

        /* We set backface culling to be enabled here so that we can
         * smootly animate between the two windows. Without expensive
         * vector projections, there's no way to determine whether a
         * window's front-face is completely invisible to the user
         * (this cannot be done just by looking at the angle of the
         * window because the same angle may show a different visible
         * face depending on its position in the view frustum).
         *
         * What we do here is enable backface culling and rotate both
         * windows by 180degrees. The effect of this is that the front
         * and back window will be at opposite rotations at each point
         * in time and so the exact point at which the first window
         * becomes invisible is the same point at which the second
         * window becomes visible. Because no back faces are drawn
         * there are no visible artifacts in the animation */
        src.set_cull_back_face(true);
        dst.set_cull_back_face(true);

        src.show();
        dst.show();
        dst.opacity = 0;

        let srcGeometry = src.meta_window.get_frame_rect();
        let dstGeometry = dst.meta_window.get_frame_rect();

        let srcIsMaximized = (src.meta_window.maximized_horizontally &&
                              src.meta_window.maximized_vertically);
        let dstIsMaximized = (dst.meta_window.maximized_horizontally &&
                              dst.meta_window.maximized_vertically);

        if (!srcIsMaximized && dstIsMaximized)
            dst.meta_window.unmaximize(Meta.MaximizeFlags.BOTH);

        if (srcIsMaximized && !dstIsMaximized)
            dst.meta_window.maximize(Meta.MaximizeFlags.BOTH);

        // we have to set those after unmaximize/maximized otherwise they are lost
        dst.rotation_angle_y = direction == Gtk.DirectionType.RIGHT ? -180 : 180;
        src.rotation_angle_y = 0;
        dst.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });
        src.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });

         if (srcGeometry.equal(dstGeometry))
            return;

        dst.meta_window.move_resize_frame(false,
                                          srcGeometry.x,
                                          srcGeometry.y,
                                          srcGeometry.width,
                                          srcGeometry.height);
    },

    _animate : function(src, dst, direction) {
        /* Tween both windows in a rotation animation at the same time
         * with backface culling enabled on both. This will allow for
         * a smooth transition. */
        Tweener.addTween(src, {
            rotation_angle_y: direction == Gtk.DirectionType.RIGHT ? 180 : -180,
            time: WINDOW_ANIMATION_TIME * 4,
            transition: 'easeOutQuad',
            onComplete: Lang.bind(this, this.rotateOutCompleted, src)
        });
        Tweener.addTween(dst, {
            rotation_angle_y: 0,
            time: WINDOW_ANIMATION_TIME * 4,
            transition: 'easeOutQuad',
            onComplete: Lang.bind(this, this.rotateInCompleted, dst)
        });

        /* Gently fade the window in, this will paper over
         * any artifacts from shadows and the like
         *
         * Note: The animation time is reduced here - this
         * is intention. It is just to prevent initial
         * "double shadows" when rotating between windows.
         */
        Tweener.addTween(dst, {
            opacity: 255,
            time: WINDOW_ANIMATION_TIME,
            transition: 'linear'
        });
    },

    _removeEffect : function(list, actor) {
        let idx = list.indexOf(actor);
        if (idx != -1) {
            list.splice(idx, 1);
            return true;
        }
        return false;
    },

    _removeSession : function(session) {
        let idx = this._sessions.indexOf(session);
        if (idx != -1) {
            this._sessions.splice(idx, 1);
            return true;
        }
        return false;
    },

    rotateInCompleted: function(actor) {
        if (this._removeEffect(this._rotateInActors, actor)) {
            Tweener.removeTweens(actor);
            actor.opacity = 255;
            actor.rotation_angle_y = 0;
            actor.set_cull_back_face(false);
        }
    },

    rotateOutCompleted: function(actor) {
        if (this._removeEffect(this._rotateOutActors, actor)) {
            Tweener.removeTweens(actor);
            actor.hide();
            actor.rotation_angle_y = 0;
            actor.set_cull_back_face(false);
        }
    },

    _getBuildManifestsAt: function(location) {
        function generateArrayFromFunction(func) {
	        let arr = [];
	        let result;

	        while ((result = func.apply(this, arguments)) !== null) {
		        arr.push(result);
	        }

	        return arr;
	    }

        function listDirectory(directory) {
	        let file = Gio.File.new_for_path(directory);
	        let enumerator = file.enumerate_children('standard::name', 0, null);
	        let directoryInfoList = generateArrayFromFunction(() => enumerator.next_file(null));
	        return directoryInfoList.map(function(info) {
	            return {
	                name: info.get_name(),
	                type: info.get_file_type()
	            };
	        });
	    }

        location = location + '/app/';
        let manifests = [];
        let apps = listDirectory(location);
        return manifests = apps.map(function(app) {
            return location + app.name + '/current/active/files/manifest.json';
        });
    },

    /**
     * _getManifestPath:
     * @flatpakID: flatpak id of the app to get the manifest path for
     *
     * Looks for the manifest of the app in the user and
     * system installation path for flatpaks.
     */
    _getManifestPath: function(flatpakID) {
        function readFileContents(path) {
            let cmdlineFile = Gio.File.new_for_path(path);
            let [ok, contents, etag] = cmdlineFile.load_contents(null);
            return contents;
        }

        let flatpakUserPath = Flatpak.Installation.new_user(null).get_path().get_path();
        let flatpakSystemPath = Flatpak.Installation.new_system(null).get_path().get_path();
        let manifests = this._getBuildManifestsAt(flatpakUserPath).concat(this._getBuildManifestsAt(flatpakSystemPath));

        for (let j = 0; j < manifests.length; j++) {
            let manifest;
            try {
                manifest = JSON.parse(readFileContents(manifests[j]));
            } catch(err) {
                logError(err, ' No build manifest found at ' + manifests[j]);
                continue;
            }
            if (manifest.id === flatpakID)
                return manifests[j];
        }
        return null;
    }
});
