// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const Background = imports.ui.background;
const Main = imports.ui.main;
const Overview = imports.ui.overview;
const Panel = imports.ui.panel;
const Tweener = imports.ui.tweener;
const WindowManager = imports.ui.windowManager;

const SPLASH_CIRCLE_INITIAL_TIMEOUT = 100;
const SPLASH_SCREEN_TIMEOUT = 700;
const SPLASH_SCREEN_FADE_OUT = 0.2;
const SPLASH_SCREEN_COMPLETE_TIME = 250;

// Don't show the flash frame until the final spinner cycle
const SPLASH_CIRCLE_SKIP_END_FRAMES = 1;

const SPLASH_SCREEN_DESKTOP_KEY = 'X-Endless-Splash-Screen';
const SPLASH_SCREEN_LAUNCH_BACKGROUND_KEY = 'X-Endless-launch-background';

const AppActivationContext = new Lang.Class({
    Name: 'AppActivationContext',

    _init: function(app) {
        this._app = app;
        this._abort = false;
        this._cancelled = false;

        this._cover = null;
        this._splash = null;

        this._appStateId = 0;
        this._splashId = 0;
    },

    activate: function() {
        try {
            this._app.activate();
        } catch (e) {
            logError(e, 'error while activating: ' + this._app.get_id());
            return;
        }

        // Don't show splash screen if the splash screen key is false
        let info = this._app.get_app_info();

        if (info && info.has_key(SPLASH_SCREEN_DESKTOP_KEY) && !info.get_boolean(SPLASH_SCREEN_DESKTOP_KEY)) {
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
    },

    _getCoverPage: function() {
        let bgGroup = new Meta.BackgroundGroup();
        let bgManager = new Background.BackgroundManager({
                container: bgGroup,
                monitorIndex: Main.layoutManager.primaryIndex });

        bgGroup._bgManager = bgManager;
        return bgGroup;
    },

    _animateSplash: function() {
        this._cancelled = false;
        this._cover = this._getCoverPage();
        Main.uiGroup.insert_child_below(this._cover, Main.layoutManager.panelBox);

        this._splash = new AppSplashPage(this._app);

        // Make sure that our events are captured
        Main.pushModal(this._splash);

        Main.uiGroup.add_actor(this._splash);
        this._splash.connect('close-clicked', Lang.bind(this, function() {
            /* If application doesn't quit very likely is because it
             * didn't reach running state yet; so wait for it to
             * finish */
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
        if (this._cover) {
            this._cover._bgManager.destroy();
            this._cover.destroy();
            this._cover = null;
        }

        if (this._splash) {
            this._splash.completeInTime(SPLASH_SCREEN_COMPLETE_TIME, Lang.bind(this,
                function() {
                    Tweener.addTween(this._splash, { opacity: 0,
                                                     time: SPLASH_SCREEN_FADE_OUT,
                                                     transition: 'linear',
                                                     onComplete: Lang.bind(this,
                                                         function() {
                                                             // Release keybinding to overview again
                                                             Main.popModal(this._splash);

                                                             this._splash.destroy();
                                                             this._splash = null;

                                                             if (this._cancelled) {
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

    _onAppStateChanged: function(appSystem, app) {
        if (app.state != Shell.AppState.RUNNING) {
            return;
        }

        appSystem.disconnect(this._appStateId);
        this._appStateId = 0;

        if (this._abort) {
            this._abort = false;
            app.request_quit();
            return;
        }

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
        this._spinner = null;

        this.background = new St.Widget({ style_class: 'app-splash-page-background',
                                          layout_manager: new Clutter.BinLayout(),
                                          x_expand: true,
                                          y_expand: true });

        let info = app.get_app_info();
        if (info !== undefined && info.has_key(SPLASH_SCREEN_LAUNCH_BACKGROUND_KEY)) {
            this.background.connect('allocation-changed', Lang.bind(this, function(actor, box, flags) {
                let bg_path = info.get_string(SPLASH_SCREEN_LAUNCH_BACKGROUND_KEY);
                this.background.style_class = 'app-splash-page-custom-background';
                this.background.style = 'background-image: url("%s");background-size: %dpx %dpx'.format(bg_path, box.x2 - box.x1, box.y2 - box.y1);
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
        if (this._spinner) {
            this._spinner.actor.destroy();
            this._spinner = null;
        }

        let themeNode = this.get_theme_node();
        let iconSize = themeNode.get_length('icon-size');

        let appIcon = this._app.create_icon_texture(iconSize);
        if (appIcon) {
            appIcon.x_align = Clutter.ActorAlign.CENTER;
            appIcon.y_align = Clutter.ActorAlign.CENTER;
            appIcon.set_x_expand(true);
            appIcon.set_y_expand(true);
            this.background.add_child(appIcon);
        }

        let animationSize = themeNode.get_length('-animation-size');
        this._spinner = new Panel.VariableSpeedAnimation('splash-circle-animation.png',
                                                         animationSize,
                                                         SPLASH_CIRCLE_INITIAL_TIMEOUT,
                                                         SPLASH_CIRCLE_SKIP_END_FRAMES);
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

        let desktopId = GLib.path_get_basename(desktopIdPath.toString());
        this._lastDesktopApp = Shell.AppSystem.get_default().lookup_app(desktopId);
    },

    _popLaunchedApp: function() {
        let retval = this._lastDesktopApp;
        this._lastDesktopApp = null;
        return retval;
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
        let lastApp = this._popLaunchedApp();
        if (app != lastApp) {
            return;
        }

        if (tracker.is_window_interesting(metaWindow) && metaWindow.resizeable) {
            metaWindow.maximize(Meta.MaximizeFlags.HORIZONTAL |
                                Meta.MaximizeFlags.VERTICAL);
        }
    }
});
