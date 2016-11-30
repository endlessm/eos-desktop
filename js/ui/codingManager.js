// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Flatpak = imports.gi.Flatpak;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;

const WINDOW_ANIMATION_TIME = 0.25;
const WATCHDOG_TIME = 30000; // ms

const ICON_BOUNCE_MAX_SCALE = 0.4;
const ICON_BOUNCE_ANIMATION_TIME = 1.0;
const ICON_BOUNCE_ANIMATION_TYPE_1 = 'easeOutSine';
const ICON_BOUNCE_ANIMATION_TYPE_2 = 'easeOutBounce';

const BUTTON_OFFSET_X = 50;
const BUTTON_OFFSET_Y = 50;

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
        onComplete: function() {animateBounce(actor);}
    });
}

const CodingManager = new Lang.Class({
    Name: 'CodingManager',

    _init: function() {
        this._sessions = [];
        this._rotateInActors = [];
        this._rotateOutActors = [];
        this._firstFrameConnections = [];
        this._watchdogId = 0;
        this._codingApps = ['org.gnome.gedit', 'org.gnome.Weather'];
    },

    _isCodingApp: function(flatpakID) {
        return this._codingApps.indexOf(flatpakID) != -1;
    },

    _isBuilder: function(flatpakID) {
        return flatpakID === 'org.gnome.Builder';
    },

    addAppWindow: function(actor) {
        let window = actor.meta_window;
        if (!this._isCodingApp(window.get_flatpak_id()))
            return;

        this._addSwitcherToBuilder(actor);
    },

    addBuilderWindow: function(actor) {
        let window = actor.meta_window;
        if (!this._isBuilder(window.get_flatpak_id()))
            return false;

        this._cancelWatchdog();

        let session = this._sessions[this._sessions.length-1];
        if (session.actorBuilder)
            return false;
        let tracker = Shell.WindowTracker.get_default();
        tracker.untrack_coding_app_window();

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

        let button = new St.Button({ style_class: 'view-source' });
        let rect = window.get_frame_rect();
        button.set_position(rect.x + rect.width - BUTTON_OFFSET_X, rect.y + rect.height - BUTTON_OFFSET_Y);
        Main.layoutManager.addChrome(button);

        let idx = this._sessions.push({buttonApp: button,
                                       actorApp: actorApp,
                                       previousFocusedWindow: null});

        let session = this._sessions[idx-1];

        button.connect('clicked', Lang.bind(this, this._switchToBuilder, session));
        session.positionChangedIdApp = window.connect('position-changed', Lang.bind(this, this._updateAppSizeAndPosition, session));
        session.sizeChangedIdApp = window.connect('size-changed', Lang.bind(this, this._updateAppSizeAndPosition, session));
        session.windowsRestackedId = Main.overview.connect('windows-restacked', Lang.bind(this, this._windowAppRestacked, session));
        session.windowMinimizedId = global.window_manager.connect('minimize', Lang.bind(this, this._windowMinimized, session));
        session.windowUnminimizedId = global.window_manager.connect('unminimize', Lang.bind(this, this._windowUnminimized, session));
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

    _switchToBuilder: function(actor, event, session) {
        if (!session.actorBuilder) {
            let tracker = Shell.WindowTracker.get_default();
            tracker.track_coding_app_window(session.actorApp.meta_window);
            this._watchdogId = Mainloop.timeout_add(WATCHDOG_TIME,
                                                    Lang.bind(this, this._watchdogTimeout));
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

        session.positionChangedIdBuilder = window.connect('position-changed', Lang.bind(this, this._updateBuilderSizeAndPosition, session));
        session.sizeChangedIdBuilder = window.connect('size-changed', Lang.bind(this, this._updateBuilderSizeAndPosition, session));

        session.buttonBuilder = button;
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
        // Save the connection's id in the session and in a list too so we can
        // get rid of it on kill-window-effects later */
        session.firstFrameConnection = firstFrameConnection;
        this._firstFrameConnections.push(firstFrameConnection);
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

    _windowAppRestacked: function(overview, stackIndices, session) {
        let focusedWindow = global.display.get_focus_window();
        if (!focusedWindow)
            return;

        // we get the signal for the same window switch twice
        if (focusedWindow === session.previousFocusedWindow)
            return;

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

    _prepareAnimate: function(src, dst, direction) {
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

    _getManifestPath: function(flatpakID) {
        // Looks for the manifest of the app in the user and
        // system installation path for flatpaks.
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
