// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Flatpak = imports.gi.Flatpak;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AppActivation = imports.ui.appActivation;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;

const WINDOW_ANIMATION_TIME = 0.25;
const WATCHDOG_TIME = 30000; // ms

const ICON_BOUNCE_MAX_SCALE = 0.4;
const ICON_BOUNCE_ANIMATION_TIME = 1.0;
const ICON_BOUNCE_ANIMATION_TYPE_1 = 'easeOutSine';
const ICON_BOUNCE_ANIMATION_TYPE_2 = 'easeOutBounce';

const BUTTON_OFFSET_X = 33;
const BUTTON_OFFSET_Y = 40;

function animateBounce(actor) {
    Tweener.removeTweens(actor);

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
        onComplete: function() { animateBounce(actor); }
    });
}

const CodingManager = new Lang.Class({
    Name: 'CodingManager',

    _init: function() {
        this._sessions = [];
        this._rotateInActors = [];
        this._rotateOutActors = [];
        this._watchdogId = 0;
        this._codingApps = ['com.endlessm.Helloworld', 'org.gnome.Weather.Application'];
    },

    _isCodingApp: function(flatpakID) {
        return this._codingApps.indexOf(flatpakID) != -1;
    },

    _isBuilder: function(flatpakID) {
        return flatpakID === 'org.gnome.Builder';
    },

    addAppWindow: function(actor) {
        if (!global.settings.get_boolean('enable-behind-the-screen'))
            return;

        let window = actor.meta_window;
        if (!this._isCodingApp(window.get_flatpak_id()))
            return;

        this._addSwitcherToBuilder(actor);
    },

    addBuilderWindow: function(actor) {
        let tracker = Shell.WindowTracker.get_default();
        let correspondingApp = tracker.get_window_app(actor.meta_window);
        let isSpeedwagonForBuilder = (
            Shell.WindowTracker.is_speedwagon_window(actor.meta_window) &&
            (correspondingApp ? correspondingApp.get_id() === 'org.gnome.Builder.desktop' : false)
        );

        if (!global.settings.get_boolean('enable-behind-the-screen'))
            return false;

        let window = actor.meta_window;
        if (!this._isBuilder(window.get_flatpak_id()) &&
            !isSpeedwagonForBuilder)
            return false;

        this._cancelWatchdog();

        let session = this._sessions[this._sessions.length - 1];
        if (!session)
            return false;

        if (session.actorBuilder) {
            // If the currently bound actor is speedwagon window, then we'll
            // want to remove that window from the association and track
            // the builder window instead
            if (Shell.WindowTracker.is_speedwagon_window(session.actorBuilder.meta_window)) {
                session.actorBuilder = actor;
                this._connectButtonPositioningSignalsToBuilder(session,
                                                               session.actorBuilder.meta_window);
                this._synchroniseWindows(session.actorApp,
                                         session.actorBuilder);
                return true;
            }
            return false;
        }

        // If we are animating to a speedwagon window, we'll want to
        // remove the 'above' attribute - we don't want the splash to
        // appear over everything else.
        if (isSpeedwagonForBuilder) {
            actor.meta_window.unmake_above();
        } else {
            // We only want to untrack the coding app window at this
            // point and not at the point we show the speedwagon. This
            // will ensure that the shell window tracker is still
            // watching for the builder window to appear.
            tracker.untrack_coding_app_window();
        }

        this._addSwitcherToApp(actor, session);
        return true;
    },

    removeAppWindow: function(actor) {
        let window = actor.meta_window;
        if (!this._isCodingApp(window.get_flatpak_id()))
            return;

        this._removeSwitcherToBuilder(actor);
    },

    removeBuilderWindow: function(actor) {
        let window = actor.meta_window;
        if (!this._isBuilder(window.get_flatpak_id()))
            return;

        this._removeSwitcherToApp(actor);
    },

    _addSwitcherToBuilder: function(actorApp) {
        let window = actorApp.meta_window;

        let button = this._addButton(window);

        let session = { buttonApp: button,
                        actorApp: actorApp,
                        previousFocusedWindow: null };
        this._sessions.push(session);

        button.connect('button-press-event', Lang.bind(this, this._switchToBuilder, session));
        session.positionChangedIdApp = window.connect('position-changed', Lang.bind(this, this._updateAppSizeAndPosition, session));
        session.sizeChangedIdApp = window.connect('size-changed', Lang.bind(this, this._updateAppSizeAndPosition, session));

        session.windowsRestackedId = Main.overview.connect('windows-restacked', Lang.bind(this, this._windowRestacked, session));
        session.overviewHidingId = Main.overview.connect('hiding', Lang.bind(this, this._overviewHiding, session));
        session.overviewShowingId = Main.overview.connect('showing', Lang.bind(this, this._overviewShowing, session));
        session.windowMinimizedId = global.window_manager.connect('minimize', Lang.bind(this, this._windowMinimized, session));
        session.windowUnminimizedId = global.window_manager.connect('unminimize', Lang.bind(this, this._windowUnminimized, session));
    },

    _addButton: function(window) {
        let button = new St.Bin({ style_class: 'view-source',
                                  reactive: true,
                                  can_focus: true,
                                  x_fill: true,
                                  y_fill: false,
                                  track_hover: true });
        let iconFile = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/rotate.svg');
        let gicon = new Gio.FileIcon({ file: iconFile });
        let icon = new St.Icon({ style_class: 'view-source-icon',
                                 gicon: gicon });
        button.set_child(icon);
        let rect = window.get_frame_rect();
        button.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        Main.layoutManager.addChrome(button);
        return button;
    },

    _addSwitcherToApp: function(actorBuilder, session) {
        session.actorBuilder = actorBuilder;

        this._animateToBuilder(session);
    },

    _removeSwitcherToBuilder: function(actorApp) {
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
        if (session.overviewHidingId !== 0) {
            Main.overview.disconnect(session.overviewHidingId);
            session.overviewHidingId = 0;
        }
        if (session.overviewShowingId !== 0) {
            Main.overview.disconnect(session.overviewShowingId);
            session.overviewShowingId = 0;
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

    _disconnectButtonPositioningBuilderSignals: function(session) {
        if (session.positionChangedIdBuilder !== 0) {
            session.actorBuilder.meta_window.disconnect(session.positionChangedIdBuilder);
            session.positionChangedIdBuilder = 0;
        }
        if (session.sizeChangedIdBuilder !== 0) {
            session.actorBuilder.meta_window.disconnect(session.sizeChangedIdBuilder);
            session.sizeChangedIdBuilder = 0;
        }
    },

    _clearBuilderSession: function(session) {
        this._disconnectButtonPositioningBuilderSignals(session);
        if (session.buttonBuilder) {
            Main.layoutManager.removeChrome(session.buttonBuilder);
            session.buttonBuilder.destroy();
            session.buttonBuilder = null;
        }
    },

    _removeSwitcherToApp: function(actorBuilder) {
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

    _startBuilderForFlatpak: function(loadFlatpakValue) {
        let params = new GLib.Variant('(sava{sv})', ['load-flatpak', [new GLib.Variant('s', loadFlatpakValue)], {}]);
        Gio.DBus.session.call('org.gnome.Builder',
                              '/org/gnome/Builder',
                              'org.gtk.Actions',
                              'Activate',
                              params,
                              null,
                              Gio.DBusCallFlags.NONE,
                              GLib.MAXINT32,
                              null,
                              function (conn, result) {
                                  try {
                                      conn.call_finish(result);
                                  } catch (e) {
                                      logError(e, 'Failed to start gnome-builder');
                                  }
                              });
    },

    _switchToBuilder: function(actor, event, session) {
        function constructLoadFlatpakValue(appManifest) {
            // add an app_id_override to the manifest to load
            return appManifest.get_path() + '+' + session.actorApp.meta_window.get_flatpak_id() + '.Coding';
        }

        if (!session.actorBuilder) {
            // get the manifest of the application
            // return early before we setup anything
            let appManifest = this._getAppManifest(session.actorApp.meta_window.get_flatpak_id());
            if (!appManifest) {
                log('Error, coding: No manifest could be found for the app: ' + session.actorApp.meta_window.get_flatpak_id());
                return;
            }

            let tracker = Shell.WindowTracker.get_default();
            tracker.track_coding_app_window(session.actorApp.meta_window);
            this._watchdogId = Mainloop.timeout_add(WATCHDOG_TIME,
                                                    Lang.bind(this, this._watchdogTimeout));

            // Since builder will be opened from the shell, we will want
            // to show a speedwagon window for it. However, we don't want to
            // show a speedwagon window in the case that builder is already
            // open, because AppActivationContext will have no way of knowing
            // that the app state changed. In that case, we just need to wait
            // around until a builder window appears (though it should be much
            // quicker because it is already in memory by that point).
            let builderShellApp = Shell.AppSystem.get_default().lookup_app('org.gnome.Builder.desktop');
            if (!builderShellApp.get_windows().length) {
                let activationContext = new AppActivation.AppActivationContext(builderShellApp);
                activationContext.showSplash(AppActivation.LaunchReason.CODING_BUILDER);
            }

            this._startBuilderForFlatpak(constructLoadFlatpakValue(appManifest));
            animateBounce(session.buttonApp);
        } else {
            session.actorBuilder.meta_window.activate(global.get_current_time());
            this._prepareAnimate(session.actorApp,
                                 session.actorBuilder,
                                 Gtk.DirectionType.LEFT);
            this._animate(session.actorApp,
                          session.actorBuilder,
                          Gtk.DirectionType.LEFT);
            this._animateButtons(session.buttonApp, session.buttonBuilder);
        }
    },

    _watchdogTimeout: function() {
        let tracker = Shell.WindowTracker.get_default();
        tracker.untrack_coding_app_window();
        this._watchdogId = 0;

        return false;
    },

    _cancelWatchdog: function() {
        if (this._watchdogId !== 0) {
            Mainloop.source_remove(this._watchdogId);
            this._watchdogId = 0;
        }
    },

    _switchToApp: function(actor, event, session) {
        if (!session.actorApp)
            return;
        session.actorApp.meta_window.activate(global.get_current_time());
        this._prepareAnimate(session.actorBuilder,
                             session.actorApp,
                             Gtk.DirectionType.RIGHT);
        this._animate(session.actorBuilder,
                      session.actorApp,
                      Gtk.DirectionType.RIGHT);
        this._animateButtons(session.buttonBuilder, session.buttonApp);
    },

    _getSession: function(actor) {
        for (let i = 0; i < this._sessions.length; i++) {
            let session = this._sessions[i];
            if (session.actorApp === actor || session.actorBuilder === actor)
                return session;
        }

        return null;
    },

    _connectButtonPositioningSignalsToBuilder: function(session, builderWindow) {
        session.positionChangedIdBuilder = builderWindow.connect('position-changed', Lang.bind(this, this._updateBuilderSizeAndPosition, session));
        session.sizeChangedIdBuilder = builderWindow.connect('size-changed', Lang.bind(this, this._updateBuilderSizeAndPosition, session));
    },

    _addBuilderButton: function(session) {
        let window = session.actorBuilder.meta_window;

        let button = this._addButton(window);
        session.buttonBuilder = button;
        button.connect('button-press-event', Lang.bind(this, this._switchToApp, session));
    },

    _animateToBuilder: function(session) {
        // We wait until the first frame of the window has been drawn
        // and damage updated in the compositor before we start rotating.
        //
        // This way we don't get ugly artifacts when rotating if
        // a window is slow to draw.
        let firstFrameConnection = session.actorBuilder.connect('first-frame', Lang.bind(this, function() {
            // reset the bouncing animation that was showed while Builder was loading
            Tweener.removeTweens(session.buttonApp);
            session.buttonApp.scale_y = 1;
            session.buttonApp.scale_x = 1;
            session.buttonApp.translation_y = 0;
            session.buttonApp.translation_x = 0;

            this._animate(session.actorApp, session.actorBuilder, Gtk.DirectionType.LEFT);

            session.actorBuilder.disconnect(firstFrameConnection);

            this._addBuilderButton(session);
            this._animateButtons(session.buttonApp, session.buttonBuilder);

            return false;
        }));

        this._prepareAnimate(session.actorApp, session.actorBuilder, Gtk.DirectionType.LEFT);
    },

    _updateAppSizeAndPosition: function(window, session) {
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

    _updateBuilderSizeAndPosition: function(window, session) {
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
        if (actor === session.actorApp && session.actorBuilder) {
            session.actorBuilder.meta_window.minimize();
            session.buttonBuilder.hide();
        } else if (actor === session.actorBuilder && session.actorApp) {
            session.actorApp.meta_window.minimize();
            session.buttonApp.hide();
        }
    },

    _windowUnminimized: function(shellwm, actor, session) {
        if (actor === session.actorApp && session.actorBuilder)
            session.actorBuilder.meta_window.unminimize();
        else if (actor === session.actorBuilder && session.actorApp)
            session.actorApp.meta_window.unminimize();
    },

    _windowRestacked: function(overview, stackIndices, session) {
        let focusedWindow = global.display.get_focus_window();
        if (!focusedWindow)
            return;

        // we get the signal for the same window switch twice
        let previousFocused = session.previousFocusedWindow;
        if (focusedWindow === previousFocused)
            return;

        // keep track of the previous focused window so
        // that we can show the animation accordingly
        session.previousFocusedWindow = focusedWindow;

        let appWindow = session.actorApp.meta_window;
        let builderWindow = null;
        if (session.actorBuilder)
            builderWindow = session.actorBuilder.meta_window;

        if (appWindow === focusedWindow) {
            if (builderWindow && builderWindow === previousFocused) {
                // make sure we do not rotate when a rotation is running
                if (this._rotateInActors.length || this._rotateOutActors.length)
                    return;

                this._prepareAnimate(session.actorBuilder,
                                     session.actorApp,
                                     Gtk.DirectionType.RIGHT);
                this._animate(session.actorBuilder,
                              session.actorApp,
                              Gtk.DirectionType.RIGHT);
                this._animateButtons(session.buttonBuilder, session.buttonApp);
                return;
            }
            session.buttonApp.show();
            session.actorApp.show();
            // hide the underlying window to prevent glitches when resizing
            // the one on top, we do this for the animated switch case already
            if (session.actorBuilder)
                session.actorBuilder.hide();
            return;
        } else if (appWindow === previousFocused) {
            session.buttonApp.hide();
        }

        if (!session.actorBuilder)
            return;

        if (builderWindow === focusedWindow) {
            if (appWindow === previousFocused) {
                // make sure we do not rotate when a rotation is running
                if (this._rotateInActors.length || this._rotateOutActors.length)
                    return;

                this._prepareAnimate(session.actorApp,
                                     session.actorBuilder,
                                     Gtk.DirectionType.LEFT);
                this._animate(session.actorApp,
                              session.actorBuilder,
                              Gtk.DirectionType.LEFT);
                this._animateButtons(session.buttonApp, session.buttonBuilder);
            } else {
                if (session.buttonBuilder)
                    session.buttonBuilder.show();
                session.actorBuilder.show();
                // hide the underlying window to prevent glitches when resizing
                // the one on top, we do this for the animated switch case already
                session.actorApp.hide();
            }
        } else if (builderWindow === previousFocused) {
            session.buttonBuilder.hide();
        }
    },

    _overviewHiding: function(overview, session) {
        let focusedWindow = global.display.get_focus_window();
        if (!focusedWindow)
            return;

        // we only need to verify a Builder window exist
        if (session.actorBuilder && session.actorBuilder.meta_window === focusedWindow)
            session.buttonBuilder.show();
        else if (session.actorApp.meta_window === focusedWindow)
            session.buttonApp.show();
    },

    _overviewShowing: function(overview, session) {
        session.buttonApp.hide();
        if (session.buttonBuilder)
            session.buttonBuilder.hide();
    },

    _synchroniseWindows: function(src, dst) {
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

        if (srcGeometry.equal(dstGeometry))
            return;

        dst.meta_window.move_resize_frame(false,
                                          srcGeometry.x,
                                          srcGeometry.y,
                                          srcGeometry.width,
                                          srcGeometry.height);
    },

    _prepareAnimate: function(src, dst, direction) {
        // We want to do this _first_ before setting up any animations.
        // Synchronising windows could cause kill-window-effects to
        // be emitted, which would undo some of the preparation
        // that we would have done such as setting backface culling
        // or rotation angles.
        this._synchroniseWindows(src, dst);

        this._rotateInActors.push(dst);
        this._rotateOutActors.push(src);

        // We set backface culling to be enabled here so that we can
        // smootly animate between the two windows. Without expensive
        // vector projections, there's no way to determine whether a
        // window's front-face is completely invisible to the user
        // (this cannot be done just by looking at the angle of the
        // window because the same angle may show a different visible
        // face depending on its position in the view frustum).
        //
        // What we do here is enable backface culling and rotate both
        // windows by 180degrees. The effect of this is that the front
        // and back window will be at opposite rotations at each point
        // in time and so the exact point at which the first window
        // becomes invisible is the same point at which the second
        // window becomes visible. Because no back faces are drawn
        // there are no visible artifacts in the animation */
        src.set_cull_back_face(true);
        dst.set_cull_back_face(true);

        src.show();
        dst.show();
        dst.opacity = 0;

        // we have to set those after unmaximize/maximized otherwise they are lost
        dst.rotation_angle_y = direction == Gtk.DirectionType.RIGHT ? -180 : 180;
        src.rotation_angle_y = 0;
        dst.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });
        src.pivot_point = new Clutter.Point({ x: 0.5, y: 0.5 });
    },

    _animate: function(src, dst, direction) {
        // Tween both windows in a rotation animation at the same time
        // with backface culling enabled on both. This will allow for
        // a smooth transition.
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

        // Gently fade the window in, this will paper over
        // any artifacts from shadows and the like
        //
        // Note: The animation time is reduced here - this
        // is intention. It is just to prevent initial
        // "double shadows" when rotating between windows.
        Tweener.addTween(dst, {
            opacity: 255,
            time: WINDOW_ANIMATION_TIME,
            transition: 'linear'
        });
    },

    _animateButtons: function(src, dst) {
        src.show();
        dst.show();
        dst.opacity = 0;
        src.opacity = 255;
        Tweener.addTween(src, {
            opacity: 0,
            time: WINDOW_ANIMATION_TIME,
            transition: 'linear',
            onComplete: function(button) { button.hide();
                                           button.opacity = 255; },
            onCompleteParams: [src]
        });

        Tweener.addTween(dst, {
            opacity: 255,
            delay: WINDOW_ANIMATION_TIME * 4,
            time: WINDOW_ANIMATION_TIME * 4,
            transition: 'linear'
        });
    },

    _removeEffect: function(list, actor) {
        let idx = list.indexOf(actor);
        if (idx != -1) {
            list.splice(idx, 1);
            return true;
        }
        return false;
    },

    _removeSession: function(session) {
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

    _getAppManifest: function(flatpakID) {
        function getAppManifestAt(location, flatpakID) {
            let manifestFile = Gio.File.new_for_path(GLib.build_filenamev([location, 'app', flatpakID, 'current',
                                                                           'active', 'files', 'manifest.json']));
            if (!manifestFile.query_exists(null))
                return null;
            return manifestFile;
        }

        let manifestFile = getAppManifestAt(Flatpak.Installation.new_user(null).get_path().get_path(), flatpakID);
        if (manifestFile)
	    return manifestFile;

        manifestFile = getAppManifestAt(Flatpak.Installation.new_system(null).get_path().get_path(), flatpakID);
        if (manifestFile)
	    return manifestFile;

        return null;
    }
});
