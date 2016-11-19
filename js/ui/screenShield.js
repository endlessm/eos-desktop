// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const AccountsService = imports.gi.AccountsService;
const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GnomeDesktop = imports.gi.GnomeDesktop;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const GnomeSession = imports.misc.gnomeSession;
const LoginManager = imports.misc.loginManager;
const Lightbox = imports.ui.lightbox;
const Main = imports.ui.main;
const Overview = imports.ui.overview;
const ShellDBus = imports.ui.shellDBus;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;

const SCREENSAVER_SCHEMA = 'org.gnome.desktop.screensaver';
const LOCK_ENABLED_KEY = 'lock-enabled';
const LOCK_DELAY_KEY = 'lock-delay';

const LOCKED_STATE_STR = 'screenShield.locked';

// ScreenShield animation time
// - STANDARD_FADE_TIME is used when the session goes idle
// - MANUAL_FADE_TIME is used when cancelling the dialog
// - INITIAL_FADE_IN_TIME is used for the initial fade in at startup
const STANDARD_FADE_TIME = 10;
const MANUAL_FADE_TIME = 0.3;
const INITIAL_FADE_IN_TIME = 0.25;

/**
 * To test screen shield, make sure to kill gnome-screensaver.
 *
 * If you are setting org.gnome.desktop.session.idle-delay directly in dconf,
 * rather than through System Settings, you also need to set
 * org.gnome.settings-daemon.plugins.power.sleep-display-ac and
 * org.gnome.settings-daemon.plugins.power.sleep-display-battery to the same value.
 * This will ensure that the screen blanks at the right time when it fades out.
 * https://bugzilla.gnome.org/show_bug.cgi?id=668703 explains the dependance.
 */
const ScreenShield = new Lang.Class({
    Name: 'ScreenShield',

    _init: function() {
        this.actor = Main.layoutManager.screenShieldGroup;

        this._lockDialogGroup = new St.Widget({ x_expand: true,
                                                y_expand: true,
                                                opacity: 0,
                                                pivot_point: new Clutter.Point({ x: 0.5, y: 0.5 }),
                                                name: 'lockDialogGroup' });

        Tweener.addTween(this._lockDialogGroup,
                         { opacity: 255,
                           time: INITIAL_FADE_IN_TIME,
                           transition: 'easeInQuad',
                         });

        this.actor.add_actor(this._lockDialogGroup);

        this._presence = new GnomeSession.Presence(Lang.bind(this, function(proxy, error) {
            if (error) {
                logError(error, 'Error while reading gnome-session presence');
                return;
            }

            this._onStatusChanged(proxy.status);
        }));
        this._presence.connectSignal('StatusChanged', Lang.bind(this, function(proxy, senderName, [status]) {
            this._onStatusChanged(status);
        }));

        this._screenSaverDBus = new ShellDBus.ScreenSaverDBus(this);

        this._inhibitor = null;
        this._aboutToSuspend = false;
        this._loginManager = LoginManager.getLoginManager();
        this._loginManager.connect('prepare-for-sleep',
                                   Lang.bind(this, this._prepareForSleep));
        this._inhibitSuspend();

        this._loginManager.getCurrentSessionProxy(Lang.bind(this,
            function(sessionProxy) {
                this._loginSession = sessionProxy;
                this._loginSession.connectSignal('Lock', Lang.bind(this, function() { this.lock(false); }));
                this._loginSession.connectSignal('Unlock', Lang.bind(this, function() { this.deactivate(false); }));
            }));

        this._settings = new Gio.Settings({ schema: SCREENSAVER_SCHEMA });

        this._user = AccountsService.UserManager.get_default().get_user(GLib.get_user_name());

        this._isModal = false;
        this._isGreeter = false;
        this._isLocked = false;
        this._inUnlockAnimation = false;
        this._activationTime = 0;
        this._becameActiveId = 0;
        this._lockTimeoutId = 0;

        this._lightbox = new Lightbox.Lightbox(Main.uiGroup,
                                               { inhibitEvents: true,
                                                 fadeInTime: STANDARD_FADE_TIME,
                                                 fadeFactor: 1 });
        this._lightbox.connect('shown', Lang.bind(this, this._onLightboxShown));

        this.idleMonitor = Meta.IdleMonitor.get_core();
        this._cursorTracker = Meta.CursorTracker.get_for_screen(global.screen);
    },

    _becomeModal: function() {
        if (this._isModal)
            return true;

        this._isModal = Main.pushModal(this.actor, { keybindingMode: Shell.KeyBindingMode.LOCK_SCREEN });
        if (this._isModal)
            return true;

        // We failed to get a pointer grab, it means that
        // something else has it. Try with a keyboard grab only
        this._isModal = Main.pushModal(this.actor, { options: Meta.ModalOptions.POINTER_ALREADY_GRABBED,
                                                     keybindingMode: Shell.KeyBindingMode.LOCK_SCREEN });
        return this._isModal;
    },

    _inhibitSuspend: function() {
        this._loginManager.inhibit(_("GNOME needs to lock the screen"),
                                   Lang.bind(this, function(inhibitor) {
                                       this._inhibitor = inhibitor;
                                   }));
    },

    _uninhibitSuspend: function() {
        if (this._inhibitor)
            this._inhibitor.close(null);
        this._inhibitor = null;
    },

    _prepareForSleep: function(loginManager, aboutToSuspend) {
        this._aboutToSuspend = aboutToSuspend;

        if (aboutToSuspend) {
            if (!this._settings.get_boolean(LOCK_ENABLED_KEY)) {
                this._uninhibitSuspend();
                return;
            }
            this.lock(true);
        } else {
            this._inhibitSuspend();
        }
    },

    _onStatusChanged: function(status) {
        if (status != GnomeSession.PresenceStatus.IDLE)
            return;

        if (!this._becomeModal()) {
            // We could not become modal, so we can't activate the
            // screenshield. The user is probably very upset at this
            // point, but any application using global grabs is broken
            // Just tell him to stop using this app
            // 
            // XXX: another option is to kick the user into the gdm login
            // screen, where we're not affected by grabs
            Main.notifyError(_("Unable to lock"),
                             _("Lock was blocked by an application"));
            return;
        }

        if (this._lightbox.actor.visible ||
            this._isLocked) {
            // We're either shown and active, or in the process of
            // showing.
            // The latter is a very unlikely condition (it requires
            // idle-delay < 20), but in any case we have nothing
            // to do at this point: either isLocked is true, or
            // it will soon be.
            // isLocked can also be true if the lightbox is hidden,
            // in case the shield is down and the user hasn't unlocked yet
            return;
        }

        this._lightbox.show();
        this._lightbox.actor.raise_top();

        if (this._activationTime == 0)
            this._activationTime = GLib.get_monotonic_time();

        this._becameActiveId = this.idleMonitor.add_user_active_watch(Lang.bind(this, this._onUserBecameActive));

        let shouldLock = this._settings.get_boolean(LOCK_ENABLED_KEY) && !this._isLocked && !this._user.get_automatic_login();

        if (shouldLock) {
            let lockTimeout = Math.max(STANDARD_FADE_TIME, this._settings.get_uint(LOCK_DELAY_KEY));
            this._lockTimeoutId = Mainloop.timeout_add(lockTimeout * 1000,
                                                       Lang.bind(this, function() {
                                                           this._lockTimeoutId = 0;
                                                           this.lock(true);
                                                           return false;
                                                       }));
        }
    },

    _onUserBecameActive: function() {
        // This function gets called here when the user becomes active again
        // after gnome-session changed the status to IDLE
        this.idleMonitor.remove_watch(this._becameActiveId);
        this._becameActiveId = 0;

        this._lightbox.hide();

        if (this._isLocked) {
            // Go back to the lock screen
            this.actor.raise_top();
        } else {
            // Return to the unlocked desktop. Calling deactivate ensures we
            // reset activationTime and also the lock timeout, so the shell
            // doesn't lock itself down the road.
            this.deactivate(false);
        }
    },

    _onLightboxShown: function() {
        this.emit('active-changed');
    },

    showDialog: function() {
        // Ensure that the stage window is mapped, before taking a grab
        // otherwise X errors out
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
            if (!this._becomeModal()) {
                // In the login screen, this is a hard error. Fail-whale
                log('Could not acquire modal grab for the login screen. Aborting login process.');
                Meta.quit(Meta.ExitCode.ERROR);
            }

            return false;
        }));

        this.actor.show();
        this._isGreeter = Main.sessionMode.isGreeter;
        this._isLocked = true;
        this._ensureUnlockDialog(true, true);
    },

    _ensureUnlockDialog: function(onPrimary, allowCancel) {
        if (!this._dialog) {
            let constructor = Main.sessionMode.unlockDialog;
            if (!constructor) {
                // This session mode has no locking capabilities
                this.deactivate(true);
                return;
            }

            this._dialog = new constructor(this._lockDialogGroup);

            let time = global.get_current_time();
            if (!this._dialog.open(time, onPrimary)) {
                // This is kind of an impossible error: we're already modal
                // by the time we reach this...
                log('Could not open login dialog: failed to acquire grab');
                this.deactivate(true);
            }

            this._dialog.connect('failed', Lang.bind(this, this._onUnlockFailed));
            this._dialog.connect('cancelled', Lang.bind(this, this._onUnlockCancelled));
            this._dialog.connect('unlocked', Lang.bind(this, this._onUnlockSucceded));
        }

        this._dialog.allowCancel = allowCancel;
    },

    _onUnlockCancelled: function() {
        this._resetLockScreen(false);
        this.emit('active-resumed');
    },

    _onUnlockFailed: function() {
        this._resetLockScreen(false);
    },

    _onUnlockSucceded: function() {
        this.deactivate(true);
    },

    _resetLockScreen: function(animateLockDialog) {
        this._lockDialogGroup.scale_x = 1;
        this._lockDialogGroup.scale_y = 1;

        if (animateLockDialog) {
            this._lockDialogGroup.opacity = 0;
            Tweener.removeTweens(this._lockDialogGroup);
            Tweener.addTween(this._lockDialogGroup,
                             { opacity: 255,
                               time: MANUAL_FADE_TIME,
                               transition: 'easeOutQuad' });
        } else {
            this._lockDialogGroup.opacity = 255;
        }

        if (this._aboutToSuspend)
            this._uninhibitSuspend();

        if (this._dialog) {
            this._dialog.cancel();
            if (!this._isGreeter) {
                this._dialog = null;
            }
        }

        this._ensureUnlockDialog(true, true);
    },

    get locked() {
        return this._isLocked;
    },

    get active() {
        // See the comment on the activate method.
        return this._lightbox.shown || this._isLocked;
    },

    get activationTime() {
        return this._activationTime;
    },

    deactivate: function(animate) {
        if (Main.sessionMode.currentMode == 'unlock-dialog')
            Main.sessionMode.popMode('unlock-dialog');

        Tweener.addTween(this._lockDialogGroup, {
            scale_x: 0,
            scale_y: 0,
            time: animate ? Overview.ANIMATION_TIME : 0,
            transition: 'easeOutQuad',
            onComplete: Lang.bind(this, this._completeDeactivate),
            onCompleteScope: this
        });
    },

    _completeDeactivate: function() {
        if (this._dialog && !this._isGreeter) {
            this._dialog.destroy();
            this._dialog = null;
        }

        this._lightbox.hide();

        if (this._isModal) {
            Main.popModal(this.actor);
            this._isModal = false;
        }

        this.actor.hide();

        if (this._becameActiveId != 0) {
            this.idleMonitor.remove_watch(this._becameActiveId);
            this._becameActiveId = 0;
        }

        if (this._lockTimeoutId != 0) {
            Mainloop.source_remove(this._lockTimeoutId);
            this._lockTimeoutId = 0;
        }

        this._activationTime = 0;
        this._isLocked = false;
        this.emit('active-changed');
        this.emit('locked-changed');
        global.set_runtime_state(LOCKED_STATE_STR, null);
    },

    activate: function(animate) {
        // In upstream GNOME, the screen shield may be activated but not locked,
        // i.e. the shield may be lifted straight to the desktop, bypassing the
        // lock screen. In Endless, we only have a lock screen, so the activated
        // state is identical to the locked state. We keep both states simply to
        // minimize our delta with upstream.
        this.lock(animate);
        global.set_runtime_state(LOCKED_STATE_STR, GLib.Variant.new('b', true));
    },

    lock: function(animate) {
        // Warn the user if we can't become modal
        if (!this._becomeModal()) {
            Main.notifyError(_("Unable to lock"),
                             _("Lock was blocked by an application"));
            return;
        }

        if (this._activationTime == 0)
            this._activationTime = GLib.get_monotonic_time();

        this._isLocked = true;
        this.actor.show();

        if (Main.sessionMode.currentMode != 'unlock-dialog') {
            this._isGreeter = Main.sessionMode.isGreeter;
            if (!this._isGreeter)
                Main.sessionMode.pushMode('unlock-dialog');
        }

        if (!this._isGreeter)
            this._resetLockScreen(animate);

        this.emit('locked-changed');
        this.emit('active-changed');
    },

    // If the previous shell crashed, and gnome-session restarted us, then re-lock
    lockIfWasLocked: function() {
        let wasLocked = global.get_runtime_state('b', LOCKED_STATE_STR);
        if (wasLocked === null)
            return;
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() {
            this.lock(false);
        }));
    }
});
Signals.addSignalMethods(ScreenShield.prototype);
