// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const Background = imports.ui.background;
const GrabHelper = imports.ui.grabHelper;
const Main = imports.ui.main;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;

const SPLASH_CIRCLE_PERIOD = 2;
const SPLASH_SCREEN_TIMEOUT = 700; // ms
const SPLASH_SCREEN_FADE_OUT = 0.2;
const SPLASH_SCREEN_COMPLETE_TIME = 0.2;

// By default, maximized windows are 75% of the workarea
// of the monitor they're on when unmaximized.
const DEFAULT_MAXIMIZED_WINDOW_SIZE = 0.75;

const LAUNCH_MAXIMIZED_DESKTOP_KEY = 'X-Endless-LaunchMaximized';
const SPLASH_BACKGROUND_DESKTOP_KEY = 'X-Endless-SplashBackground';
const DEFAULT_SPLASH_SCREEN_BACKGROUND = global.datadir + '/theme/splash-background-default.jpg';
const SPINNER_IMAGES_DIR = global.datadir + '/theme/';

const AppActivationContext = new Lang.Class({
    Name: 'AppActivationContext',

    _init: function(app) {
        this._app = app;
        this._abort = false;
        this._cancelled = false;

        this._splash = null;

        this._appStateId = 0;
        this._appActivationTime = 0;
        this._splashId = 0;
    },

    activate: function() {
        try {
            this._app.activate();
        } catch (e) {
            logError(e, 'error while activating: ' + this._app.get_id());
            return;
        }

        this.showSplash();
    },

    showSplash: function() {
        // Don't show splash screen if the launch maximized key is false
        let info = this._app.get_app_info();

        if (info && info.has_key(LAUNCH_MAXIMIZED_DESKTOP_KEY) && !info.get_boolean(LAUNCH_MAXIMIZED_DESKTOP_KEY)) {
            return;
        }

        // Don't show splash screen if default maximize is disabled
        if (global.settings.get_boolean(WindowManager.NO_DEFAULT_MAXIMIZE_KEY)) {
            return;
        }

        this._animateSplash();

        // We can't fully trust windows-changed to be emitted with the
        // same ShellApp we called activate() on, as WMClass matching might
        // fail. For this reason, just pick to the first application that
        // will flip its state to running
        let appSystem = Shell.AppSystem.get_default();
        this._appStateId = appSystem.connect('app-state-changed',
            Lang.bind(this, this._onAppStateChanged));
        this._appActivationTime = GLib.get_monotonic_time();
    },

    _animateSplash: function() {
        this._cancelled = false;

        this._splash = new AppSplashPage(this._app);
        Main.uiGroup.add_actor(this._splash);

        let decorator = Main.layoutManager.screenDecorators[Main.layoutManager.primaryIndex];
        Main.uiGroup.set_child_below_sibling(this._splash, decorator);

        // Make sure that our events are captured
        this._grabHelper = new GrabHelper.GrabHelper(this._splash);
        this._grabHelper.addActor(this._splash);
        this._grabHelper.grab({ actor: this._splash,
                                focus: this._splash });

        this._splash.connect('close-clicked', Lang.bind(this, function() {
            // If application doesn't quit very likely is because it
            // didn't reach running state yet; so wait for it to
            // finish
            this._cancelled = true;
            this._clearSplash();
            if (!this._app.request_quit()) {
                this._abort = true;
            }
        }));

        this._splash.translation_y = this._splash.height;
        Tweener.addTween(this._splash, { translation_y: 0,
                                         time: Overview.ANIMATION_TIME,
                                         transition: 'linear',
                                         onComplete: Lang.bind(this, function() {
                                             this._splash.spin();
                                             this._splashId = Mainloop.timeout_add(SPLASH_SCREEN_TIMEOUT,
                                                 Lang.bind(this, this._checkSplash));
                                         })
                                       });
    },

    _clearSplash: function() {
        if (this._splash) {
            this._splash.completeInTime(SPLASH_SCREEN_COMPLETE_TIME, Lang.bind(this,
                function() {
                    Tweener.addTween(this._splash, { opacity: 0,
                                                     time: SPLASH_SCREEN_FADE_OUT,
                                                     transition: 'linear',
                                                     onComplete: Lang.bind(this,
                                                         function() {
                                                             // Release keybinding to overview again
                                                             this._grabHelper.ungrab({ actor: this._splash });

                                                             this._splash.destroy();
                                                             this._splash = null;

                                                             if (this._cancelled && Main.workspaceMonitor.visibleWindows == 0) {
                                                                Main.overview.showApps();
                                                             }
                                                         })
                                                   });
                }));
        }
    },

    _checkSplash: function() {
        this._splashId = 0;

        // FIXME: we can't rely on windows-changed being emited on the same
        // desktop file, as web apps right now all open tabs in the default browser
        let isLink = (this._app.get_id().indexOf('eos-link-') != -1);

        // (appStateId == 0) => window already created
        if (this._appStateId == 0 || isLink) {
            this._clearSplash();
        }

        return false;
    },

    _recordLaunchTime: function() {
        let activationTime = this._appActivationTime;
        this._appActivationTime = 0;

        if (activationTime == 0) {
            return;
        }

        if (!GLib.getenv('SHELL_DEBUG_LAUNCH_TIME')) {
            return;
        }

        let currentTime = GLib.get_monotonic_time();
        let elapsedTime = currentTime - activationTime;

        log('Application ' + this._app.get_name() +
            ' took ' + elapsedTime / 1000000 +
            ' seconds to launch');
    },

    _isBogusWindow: function(app) {
        let launchedAppId = this._app.get_id();
        let appId = app.get_id();

        // When the application IDs match, the window is not bogus
        if (appId == launchedAppId) {
            return false;
        }

        // Special case for Libreoffice splash screen; we will get a non-matching
        // app with 'Soffice' as its name when the recovery screen comes up,
        // so special case that too
        if (launchedAppId.indexOf('eos-app-libreoffice') != -1 &&
            app.get_name() != 'Soffice') {
            return true;
        }

        return false;
    },

    _onAppStateChanged: function(appSystem, app) {
        if (app.state != Shell.AppState.RUNNING) {
            return;
        }

        if (this._isBogusWindow(app)) {
            return;
        }

        appSystem.disconnect(this._appStateId);
        this._appStateId = 0;

        if (this._abort) {
            this._abort = false;
            this._app.request_quit();
            return;
        }

        this._recordLaunchTime();

        // (splashId == 0) => the window took more than the stock
        // splash timeout to display
        if (this._splashId == 0) {
            this._clearSplash();
        }
    }
});

const AppSplashPage = new Lang.Class({
    Name: 'AppSplashPage',
    Extends: St.Widget,

    _init: function(app) {
        this.layout = new St.BoxLayout({ vertical: true,
                                         x_expand: true,
                                         y_expand: true });

        let workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
        this.parent({ x: workArea.x,
                      y: workArea.y,
                      width: workArea.width,
                      height: workArea.height,
                      layout_manager: new Clutter.BinLayout(),
                      style_class: 'app-splash-page' });

        this.add_child(this.layout);

        this._app = app;
        this._appIcon = null;
        this._spinner = null;
        this._iconSize = -1;
        this._animationSize = -1;

        this.background = new St.Widget({ style_class: 'app-splash-page-background',
                                          layout_manager: new Clutter.BinLayout(),
                                          clip_to_allocation: true,
                                          x_expand: true,
                                          y_expand: true });

        let info = app.get_app_info();

        if (info !== undefined) {
            let bg_path;
            if (info.has_key(SPLASH_BACKGROUND_DESKTOP_KEY)) {
                bg_path = info.get_string(SPLASH_BACKGROUND_DESKTOP_KEY);
            } else {
                bg_path = DEFAULT_SPLASH_SCREEN_BACKGROUND;
            }

            this.background.connect('allocation-changed', Lang.bind(this, function(actor, box, flags) {
                this.background.style_class = 'app-splash-page-custom-background';
                this.background.style =
                    'background-image: url("%s");background-size: cover;background-position: center center;'.format(bg_path);
            }));
        }

        let title = new St.Widget({ style_class: 'app-splash-page-title',
                                    layout_manager: new Clutter.BinLayout(),
                                    x_expand: true,
                                    y_expand: false });

        title.add_child(this._createCloseButton());

        this.layout.add(title);
        this.layout.add(this.background, { expand: true,
                                           x_fill: true,
                                           y_fill: true });
    },

    _createCloseButton: function() {
        let closeButton = new St.Button({ style_class: 'splash-close'});
        closeButton.set_x_align(Clutter.ActorAlign.END);
        closeButton.set_y_align(Clutter.ActorAlign.START);

        // XXX Clutter 2.0 workaround: ClutterBinLayout needs expand
        // to respect the alignments.
        closeButton.set_x_expand(true);
        closeButton.set_y_expand(true);

        closeButton.connect('clicked', Lang.bind(this, function() { this.emit('close-clicked'); }));

        return closeButton;
    },

    vfunc_style_changed: function() {
        let themeNode = this.get_theme_node();
        let iconSize = themeNode.get_length('icon-size');
        let animationSize = themeNode.get_length('-animation-size');

        if (this._iconSize == iconSize &&
            this._animationSize == animationSize) {
            return;
        }

        this._iconSize = iconSize;
        this._animationSize = animationSize;

        if (this._spinner) {
            this._spinner.actor.destroy();
            this._spinner = null;
        }

        if (this._appIcon) {
            this._appIcon.destroy();
            this._appIcon = null;
        }

        let appIcon = this._app.create_icon_texture(iconSize);
        if (appIcon) {
            appIcon.x_align = Clutter.ActorAlign.CENTER;
            appIcon.y_align = Clutter.ActorAlign.CENTER;
            appIcon.set_x_expand(true);
            appIcon.set_y_expand(true);
            this.background.add_child(appIcon);
            this._appIcon = appIcon;
        }

        this._spinner = new SplashSpinner(animationSize, SPLASH_CIRCLE_PERIOD);
        this._spinner.actor.x_align = Clutter.ActorAlign.CENTER;
        this._spinner.actor.y_align = Clutter.ActorAlign.CENTER;
        this.background.add_child(this._spinner.actor);
    },

    spin: function() {
        this._spinner.play();
    },

    completeInTime: function(time, callback) {
        this._spinner.completeInTime(time, callback);
    }
});
Signals.addSignalMethods(AppSplashPage.prototype);

const SplashSpinner = new Lang.Class({
    Name: 'SplashSpinner',
    _init: function(size, rotationTime) {
        this.actor = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                     x_expand: true,
                                     y_expand: true });

        this.actor.add_child(this._loadImage('splash-spinner-channel.png',
                                             size));

        this._spinner = new St.Widget({ layout_manager: new Clutter.BinLayout(),
                                        x_expand: true,
                                        y_expand: true });
        this.actor.add_child(this._spinner);

        this._spinner.add_child(this._loadImage('splash-spinner.png', size));

        // Start loading glow images now, but they won't be added until
        // completeInTime is called
        this._channelGlow = this._loadImage('splash-spinner-channel-glow.png',
                                            size);
        this._spinnerGlow = this._loadImage('splash-spinner-glow.png', size);
        this._channelGlow.bind_property('opacity', this._spinnerGlow,
                                        'opacity',
                                        GObject.BindingFlags.SYNC_CREATE);

        this.rotationTime = rotationTime;
        this._completeCallback = null;
    },

    _loadImage: function(name, size) {
        let textureCache = St.TextureCache.get_default();
        let path = GLib.build_filenamev([SPINNER_IMAGES_DIR, name]);
        let uri = GLib.filename_to_uri(path, null, null);

        return textureCache.load_uri_async(uri, size, size);
    },

    play: function() {
        this._spinner.set_z_rotation_from_gravity(0, Clutter.Gravity.CENTER);
        Tweener.addTween(this._spinner, { rotation_angle_z: 360,
                                          time: this.rotationTime,
                                          transition: 'linear',
                                          onComplete: Lang.bind(this, this.play)
                                        });        
    },

    completeInTime: function(time, callback) {
        if (this._completeCallback === null) {
            this._channelGlow.set_opacity(0);
            this.actor.add_child(this._channelGlow);
            this._spinner.add_child(this._spinnerGlow);
        }

        this._completeCallback = callback;

        Tweener.addTween(this._channelGlow, { opacity: 255,
                                              time: time,
                                              transition: 'linear',
                                              onComplete: this._completeCallback
                                            });
    }
});

const DesktopAppClient = new Lang.Class({
    Name: 'DesktopAppClient',
    _init: function() {
        this._lastDesktopApp = null;
        this._subscription =
            Gio.DBus.session.signal_subscribe(null,
                                             'org.gtk.gio.DesktopAppInfo',
                                             'Launched',
                                             '/org/gtk/gio/DesktopAppInfo',
                                             null, 0,
                                             Lang.bind(this, this._onLaunched));

        global.display.connect('window-created', Lang.bind(this, this._windowCreated));
    },

    _onLaunched: function(connection, sender_name, object_path,
                          interface_name, signal_name,
                         parameters) {
        let [desktopIdPath, display, pid, uris, extras] = parameters.deep_unpack();

        let launchedByShell = (sender_name == Gio.DBus.session.get_unique_name());
        let desktopId = GLib.path_get_basename(desktopIdPath.toString());
        this._lastDesktopApp = Shell.AppSystem.get_default().lookup_heuristic_basename(desktopId);

        // Show the splash page if we didn't launch this ourselves, since in that case
        // we already explicitly control when the splash screen should be used
        let showSplash =
            (this._lastDesktopApp != null) &&
            (this._lastDesktopApp.state != Shell.AppState.RUNNING) &&
            (this._lastDesktopApp.get_app_info().should_show()) &&
            !launchedByShell;

        if (showSplash) {
            let context = new AppActivationContext(this._lastDesktopApp);
            context.showSplash();
        }
    },

    _windowCreated: function(metaDisplay, metaWindow) {
        // Don't maximize if key to disable default maximize is set
        if (global.settings.get_boolean(WindowManager.NO_DEFAULT_MAXIMIZE_KEY)) {
            return;
        }

        if (!Main.sessionMode.hasOverview) {
            return;
        }

        let tracker = Shell.WindowTracker.get_default();
        let app = tracker.get_window_app(metaWindow);
        if (!app) {
            return;
        }

        // Don't maximize if the launch maximized key is false
        let info = app.get_app_info();

        if (info && info.has_key(LAUNCH_MAXIMIZED_DESKTOP_KEY) && !info.get_boolean(LAUNCH_MAXIMIZED_DESKTOP_KEY)) {
            return;
        }

        // Skip if the window does not belong to the launched app
        if (app != this._lastDesktopApp) {
            return;
        }

        this._lastDesktopApp = null;

        if (tracker.is_window_interesting(metaWindow) && metaWindow.resizeable) {
            // Position the window so it's at where we want it to be if the user
            // unmaximizes the window.
            let workArea = Main.layoutManager.getWorkAreaForMonitor(metaWindow.get_monitor());
            let width = workArea.width * DEFAULT_MAXIMIZED_WINDOW_SIZE;
            let height = workArea.height * DEFAULT_MAXIMIZED_WINDOW_SIZE;
            let x = workArea.x + (workArea.width - width) / 2;
            let y = workArea.y + (workArea.height - height) / 2;
            metaWindow.move_resize_frame(false, x, y, width, height);

            metaWindow.maximize(Meta.MaximizeFlags.HORIZONTAL |
                                Meta.MaximizeFlags.VERTICAL);
        }
    }
});
