// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const AccountsService = imports.gi.AccountsService;
const Gdm = imports.gi.Gdm;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Atk = imports.gi.Atk;
const Clutter = imports.gi.Clutter;

const BoxPointer = imports.ui.boxpointer;
const GnomeSession = imports.misc.gnomeSession;
const LoginManager = imports.misc.loginManager;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Params = imports.misc.params;
const Util = imports.misc.util;

const LOCKDOWN_SCHEMA = 'org.gnome.desktop.lockdown';
const SCREENSAVER_SCHEMA = 'org.gnome.desktop.screensaver';
const PRIVACY_SCHEMA = 'org.gnome.desktop.privacy'
const DISABLE_USER_SWITCH_KEY = 'disable-user-switching';
const DISABLE_LOCK_SCREEN_KEY = 'disable-lock-screen';
const DISABLE_LOG_OUT_KEY = 'disable-log-out';
const ALWAYS_SHOW_LOG_OUT_KEY = 'always-show-log-out';
const SHOW_FULL_NAME_IN_TOP_BAR_KEY = 'show-full-name-in-top-bar';
const SEPARATE_POWER_OFF_LOG_OUT_KEY = 'separate-power-off-log-out';

const POWER_OFF_TEXT = _("Power Off").toUpperCase();
const SUSPEND_TEXT = _("Suspend").toUpperCase();
const LOG_OUT_TEXT = _("Log Out").toUpperCase();
const LOCK_TEXT = _("Lock").toUpperCase();
const EXIT_TEXT = _("Exit").toUpperCase();

const TUTORIAL_TEXT = _("Tutorial");
const SETTINGS_TEXT = _("Settings");
const FEEDBACK_TEXT = _("Give us Feedback");

const FEEDBACK_LAUNCHER = "eos-app-feedback.desktop";
const TUTORIAL_LAUNCHER = "eos-app-tutorial.desktop";

const DIALOG_ICON_SIZE = 64;

const MAX_USERS_IN_SESSION_DIALOG = 5;

const SystemdLoginSessionIface = <interface name='org.freedesktop.login1.Session'>
    <property name="Id" type="s" access="read"/>
    <property name="Remote" type="b" access="read"/>
    <property name="Class" type="s" access="read"/>
    <property name="Type" type="s" access="read"/>
    <property name="State" type="s" access="read"/>
</interface>;

const SystemdLoginSession = Gio.DBusProxy.makeProxyWrapper(SystemdLoginSessionIface);

// Adapted from gdm/gui/user-switch-applet/applet.c
//
// Copyright (C) 2004-2005 James M. Cape <jcape@ignore-your.tv>.
// Copyright (C) 2008,2009 Red Hat, Inc.

const UserAvatarWidget = new Lang.Class({
    Name: 'UserAvatarWidget',

    _init: function(user, params) {
        this._user = user;
        params = Params.parse(params, { reactive: false,
                                        iconSize: DIALOG_ICON_SIZE,
                                        styleClass: 'status-chooser-user-icon' });
        this._iconSize = params.iconSize;

        this.actor = new St.Bin({ style_class: params.styleClass,
                                  track_hover: params.reactive,
                                  reactive: params.reactive });
    },

    setSensitive: function(sensitive) {
        this.actor.can_focus = sensitive;
        this.actor.reactive = sensitive;
    },

    update: function() {
        let iconFile = this._user.get_icon_file();
        if (iconFile && !GLib.file_test(iconFile, GLib.FileTest.EXISTS))
            iconFile = null;

        if (iconFile) {
            let file = Gio.File.new_for_path(iconFile);
            this.actor.child = null;
            this.actor.style = 'background-image: url("%s");'.format(iconFile);
        } else {
            this.actor.style = null;
            this.actor.child = new St.Icon({ icon_name: 'avatar-default-symbolic' });
        }
    }
});

const IMUserNameItem = new Lang.Class({
    Name: 'IMUserNameItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function() {
        this.parent({ reactive: false,
                      can_focus: false,
                      style_class: 'status-chooser-user-name' });

        this._wrapper = new Shell.GenericContainer();
        this._wrapper.connect('get-preferred-width',
                              Lang.bind(this, this._wrapperGetPreferredWidth));
        this._wrapper.connect('get-preferred-height',
                              Lang.bind(this, this._wrapperGetPreferredHeight));
        this._wrapper.connect('allocate',
                              Lang.bind(this, this._wrapperAllocate));
        this.addActor(this._wrapper, { expand: true, span: -1 });

        this.label = new St.Label();
        this.label.clutter_text.set_line_wrap(true);
        this.label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        this._wrapper.add_actor(this.label);
    },

    _wrapperGetPreferredWidth: function(actor, forHeight, alloc) {
        alloc.min_size = 1;
        alloc.natural_size = 1;
    },

    _wrapperGetPreferredHeight: function(actor, forWidth, alloc) {
        [alloc.min_size, alloc.natural_size] = this.label.get_preferred_height(forWidth);
    },

    _wrapperAllocate: function(actor, box, flags) {
        this.label.allocate(box, flags);
    }
});

const IMStatusChooserItem = new Lang.Class({
    Name: 'IMStatusChooserItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function() {
        this.parent({ reactive: false,
                      can_focus: false,
                      style_class: 'status-chooser' });

        this._userManager = AccountsService.UserManager.get_default();
        this._user = this._userManager.get_user(GLib.get_user_name());

        this._avatar = new UserAvatarWidget(this._user, { reactive: true });
        this._iconBin = new St.Button({ child: this._avatar.actor });
        this.addActor(this._iconBin);

        this._iconBin.connect('clicked', Lang.bind(this,
            function() {
                this.activate();
            }));

        this._section = new PopupMenu.PopupMenuSection();
        this.addActor(this._section.actor);

        this._name = new IMUserNameItem();
        this._section.addMenuItem(this._name);

        this._userLoadedId = this._user.connect('notify::is-loaded',
                                                Lang.bind(this,
                                                          this._updateUser));
        this._userChangedId = this._user.connect('changed',
                                                 Lang.bind(this,
                                                           this._updateUser));
        this.actor.connect('notify::mapped', Lang.bind(this, function() {
            if (this.actor.mapped)
                this._updateUser();
        }));

        this.connect('sensitive-changed', function(sensitive) {
            this._avatar.setSensitive(sensitive);
        });
    },

    destroy: function() {
        // clean up signal handlers
        if (this._userLoadedId != 0) {
            this._user.disconnect(this._userLoadedId);
            this._userLoadedId = 0;
        }

        if (this._userChangedId != 0) {
            this._user.disconnect(this._userChangedId);
            this._userChangedId = 0;
        }

        this.parent();
    },

    // Override getColumnWidths()/setColumnWidths() to make the item
    // independent from the overall column layout of the menu
    getColumnWidths: function() {
        return [];
    },

    setColumnWidths: function(widths) {
    },

    _updateUser: function() {
        if (this._user.is_loaded)
            this._name.label.set_text(this._user.get_real_name());
        else
            this._name.label.set_text("");

        this._avatar.update();
    }
});


const UserMenuButton = new Lang.Class({
    Name: 'UserMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0);

        this.actor.add_style_class_name('user-menu-icon');

        this.actor.accessible_role = Atk.Role.MENU;

        let box = new St.BoxLayout({ name: 'panelUserMenu' });
        this.actor.add_actor(box);

        this._lockdownSettings = new Gio.Settings({ schema: LOCKDOWN_SCHEMA });

        this._userManager = AccountsService.UserManager.get_default();

        this._user = this._userManager.get_user(GLib.get_user_name());
        this._session = new GnomeSession.SessionManager();
        this._haveShutdown = true;
        this._haveSuspend = true;

        this._loginManager = LoginManager.getLoginManager();
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._iconBox = new St.Bin();
        box.add(this._iconBox, { y_align: St.Align.MIDDLE, y_fill: false });

        let iconFileNormal = Gio.File.new_for_path(global.datadir + '/theme/settings-normal.png');
        let giconNormal = new Gio.FileIcon({ file: iconFileNormal });
        this._settingsIconNormal = new St.Icon({ gicon: giconNormal,
                                                 style_class: 'settings-menu-icon' });

        let iconFileHover = Gio.File.new_for_path(global.datadir + '/theme/settings-hover.png');
        let giconHover = new Gio.FileIcon({ file: iconFileHover });
        this._settingsIconHover = new St.Icon({ gicon: giconHover,
                                                style_class: 'settings-menu-icon' });

        this._iconBox.child = this._settingsIconNormal;
        this.actor.connect('notify::hover', Lang.bind(this, this._onHoverChanged));

        this._createSubMenu();

        this._userManager.connect('notify::is-loaded',
                                  Lang.bind(this, this._updateMultiUser));
        this._userManager.connect('notify::has-multiple-users',
                                  Lang.bind(this, this._updateMultiUser));
        this._userManager.connect('user-added',
                                  Lang.bind(this, this._updateMultiUser));
        this._userManager.connect('user-removed',
                                  Lang.bind(this, this._updateMultiUser));
        this._lockdownSettings.connect('changed::' + DISABLE_USER_SWITCH_KEY,
                                       Lang.bind(this, this._updateSwitchUser));
        this._lockdownSettings.connect('changed::' + DISABLE_LOG_OUT_KEY,
                                       Lang.bind(this, this._updateLogout));
        this._lockdownSettings.connect('changed::' + DISABLE_LOCK_SCREEN_KEY,
                                       Lang.bind(this, this._updateLockScreen));
        global.settings.connect('changed::' + ALWAYS_SHOW_LOG_OUT_KEY,
                                Lang.bind(this, this._updateLogout));
        global.settings.connect('changed::' + SEPARATE_POWER_OFF_LOG_OUT_KEY,
                                Lang.bind(this, this._updateLogout));
        global.settings.connect('changed::' + SEPARATE_POWER_OFF_LOG_OUT_KEY,
                                Lang.bind(this, this._updateSuspendOrPowerOff));
        this._updateSwitchUser();
        this._updateLogout();
        this._updateLockScreen();

        // Whether shutdown is available or not depends on both lockdown
        // settings (disable-log-out) and Polkit policy - the latter doesn't
        // notify, so we update the menu item each time the menu opens or
        // the lockdown setting changes, which should be close enough.
        this.menu.connect('open-state-changed', Lang.bind(this,
            function(menu, open) {
                if (!open)
                    return;

                this._updateHaveShutdown();
                this._updateHaveSuspend();
            }));
        this._lockdownSettings.connect('changed::' + DISABLE_LOG_OUT_KEY,
                                       Lang.bind(this, this._updateHaveShutdown));

        Main.sessionMode.connect('updated', Lang.bind(this, this._sessionUpdated));
        if (Main.screenShield)
            Main.screenShield.connect('locked-changed', Lang.bind(this, this._updateButtonIcon));
        this._sessionUpdated();
    },

    _sessionUpdated: function() {
        this.actor.visible = !Main.sessionMode.isGreeter;

        let allowSettings = Main.sessionMode.allowSettings;
        this._statusChooser.setSensitive(allowSettings);
        this._systemSettings.visible = allowSettings;

        this.setSensitive(!Main.sessionMode.isLocked);
        this._updateButtonIcon();
    },

    _onDestroy: function() {
        this._user.disconnect(this._userLoadedId);
        this._user.disconnect(this._userChangedId);
    },

    _updateMultiUser: function() {
        this._updateSwitchUser();
        this._updateLogout();
    },

    _updateSwitchUser: function() {
        let allowSwitch = !this._lockdownSettings.get_boolean(DISABLE_USER_SWITCH_KEY);
        let multiUser = this._userManager.can_switch() && this._userManager.has_multiple_users;

        this._loginScreenItem.actor.visible = allowSwitch && multiUser;
    },

    _updateLogout: function() {
        let separateFromPowerOff =
            global.settings.get_boolean(SEPARATE_POWER_OFF_LOG_OUT_KEY);
        let allowLogout = !this._lockdownSettings.get_boolean(DISABLE_LOG_OUT_KEY);
        let alwaysShow = global.settings.get_boolean(ALWAYS_SHOW_LOG_OUT_KEY);
        let systemAccount = this._user.system_account;
        let localAccount = this._user.local_account;
        let multiUser = this._userManager.has_multiple_users;
        let multiSession = Gdm.get_session_ids().length > 1;

        this._logoutOption.visible = separateFromPowerOff && allowLogout &&
            (alwaysShow || multiUser || multiSession || systemAccount || !localAccount);
    },

    _updateLockScreen: function() {
        let allowLockScreen = !this._lockdownSettings.get_boolean(DISABLE_LOCK_SCREEN_KEY);
        this._lockOption.visible = allowLockScreen && LoginManager.canLock();
    },

    _updateHaveShutdown: function() {
        this._session.CanShutdownRemote(Lang.bind(this,
            function(result, error) {
                if (!error) {
                    this._haveShutdown = result[0];
                    this._updateSuspendOrPowerOff();
                }
            }));
    },

    _updateHaveSuspend: function() {
        this._loginManager.canSuspend(Lang.bind(this,
            function(result) {
                this._haveSuspend = result;
                this._updateSuspendOrPowerOff();
        }));
    },

    _updateSuspendOrPowerOff: function() {
        if (!this._suspendOrPowerOffOption)
            return;

        this._suspendOrPowerOffOption.visible = this._haveShutdown || this._haveSuspend;

        // If the power off and log out functionalities are combined,
        // show a single exit button
        if (!global.settings.get_boolean(SEPARATE_POWER_OFF_LOG_OUT_KEY)) {
            this._suspendOrPowerOffOption.updateText(EXIT_TEXT, null);

        // If we can't power off show Suspend instead
        // and disable the alt key
        } else if (!this._haveShutdown) {
            this._suspendOrPowerOffOption.updateText(SUSPEND_TEXT, null);
        } else if (!this._haveSuspend) {
            this._suspendOrPowerOffOption.updateText(POWER_OFF_TEXT, null);
        } else {
            this._suspendOrPowerOffOption.updateText(POWER_OFF_TEXT, SUSPEND_TEXT);
        }
    },

    _updateButtonIcon: function() {
        // We only use the simple settings icon,
        // so no need to change the icon here based on the presence

        if (Main.sessionMode.isLocked)
            this._iconBox.visible = Main.screenShield.locked;
        else
            this._iconBox.visible = true;
    },

    _createSubMenu: function() {
        let item;

        item = new IMStatusChooserItem();
        item.connect('activate', Lang.bind(this, this._onMyAccountActivate));
        this.menu.addMenuItem(item);
        this._statusChooser = item;

        item = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(item);

        if (this._haveLauncher(TUTORIAL_LAUNCHER)) {
            item = new PopupMenu.PopupUserMenuItem(TUTORIAL_TEXT,
                                                   { imagePath: '/theme/tutorial-symbolic.svg' });
            item.connect('activate', Lang.bind(this, this._onTutorialActivate));
            this.menu.addMenuItem(item);
        }

        this._systemSettings = new PopupMenu.PopupUserMenuItem(SETTINGS_TEXT,
                                                               { imagePath: '/theme/settings-symbolic.svg' });
        this._systemSettings.connect('activate', Lang.bind(this, this._onPreferencesActivate));
        this.menu.addMenuItem(this._systemSettings);

        if (this._haveLauncher(FEEDBACK_LAUNCHER)) {
            item = new PopupMenu.PopupUserMenuItem(FEEDBACK_TEXT);
            item.connect('activate', Lang.bind(this, this._onFeedbackActivate));
            this.menu.addMenuItem(item);
        }

        item = new PopupMenu.PopupUserMenuItem(_("Switch User"));
        item.connect('activate', Lang.bind(this, this._onLoginScreenActivate));
        this.menu.addMenuItem(item);
        this._loginScreenItem = item;

        item = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(item);

        this._suspendOrPowerOffOption = new PopupMenu.MenuItemOption(POWER_OFF_TEXT, SUSPEND_TEXT);
        this._suspendOrPowerOffOption.connect('clicked', Lang.bind(this, this._onSystemActionActivate));

        this._lockOption = new PopupMenu.MenuItemOption(LOCK_TEXT, null);
        this._lockOption.connect('clicked', Lang.bind(this, this._onLockScreenActivate));

        this._logoutOption = new PopupMenu.MenuItemOption(LOG_OUT_TEXT, null);
        this._logoutOption.connect('clicked', Lang.bind(this, this._onQuitSessionActivate));

        item = new PopupMenu.PopupOptionsMenuItem([this._suspendOrPowerOffOption,
                                                   this._lockOption,
                                                   this._logoutOption]);
        this.menu.addMenuItem(item);
    },

    _haveLauncher: function(launcher) {
        let app = Shell.AppSystem.get_default().lookup_app(launcher);
        return app != null;
    },

    _onTutorialActivate: function() {
        Main.overview.hide();
        let app = Shell.AppSystem.get_default().lookup_app(TUTORIAL_LAUNCHER);
        app.activate();
    },

    _onFeedbackActivate: function() {
        Main.overview.hide();
        let app = Shell.AppSystem.get_default().lookup_app(FEEDBACK_LAUNCHER);
        app.activate();
    },

    _onMyAccountActivate: function() {
        Main.overview.hide();
        let app = Shell.AppSystem.get_default().lookup_app('gnome-user-accounts-panel.desktop');
        app.activate();
    },

    _onPreferencesActivate: function() {
        Main.overview.hide();
        let app = Shell.AppSystem.get_default().lookup_app('gnome-control-center.desktop');
        app.activate();
    },

    _onLockScreenActivate: function() {
        this.menu.close(BoxPointer.PopupAnimation.NONE);
        Main.screenShield.lock(true);
    },

    _onLoginScreenActivate: function() {
        this.menu.close(BoxPointer.PopupAnimation.NONE);
        Main.overview.hide();
        if (Main.screenShield)
            Main.screenShield.lock(false);
        Gdm.goto_login_session_sync(null);
    },

    _onQuitSessionActivate: function() {
        this.menu.close(BoxPointer.PopupAnimation.NONE);
        this._session.LogoutRemote(0);
    },

    _openSessionWarnDialog: function(sessions) {
        let dialog = new ModalDialog.ModalDialog();
        let subjectLabel = new St.Label({ style_class: 'end-session-dialog-subject',
                                          text: _("Other users are logged in.") });
        dialog.contentLayout.add(subjectLabel, { y_fill: true,
                                                 y_align: St.Align.START });

        let descriptionLabel = new St.Label({ style_class: 'end-session-dialog-description'});
        descriptionLabel.set_text(_("Shutting down might cause them to lose unsaved work."));
        descriptionLabel.clutter_text.line_wrap = true;
        dialog.contentLayout.add(descriptionLabel, { x_fill: true,
                                                     y_fill: true,
                                                     y_align: St.Align.START });

        let scrollView = new St.ScrollView({ style_class: 'end-session-dialog-app-list' });
        scrollView.add_style_class_name('vfade');
        scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        dialog.contentLayout.add(scrollView, { x_fill: true, y_fill: true });

        let userList = new St.BoxLayout({ vertical: true });
        scrollView.add_actor(userList);

        for (let i = 0; i < sessions.length; i++) {
            let session = sessions[i];
            let userEntry = new St.BoxLayout({ style_class: 'login-dialog-user-list-item',
                                               vertical: false });
            let avatar = new UserAvatarWidget(session.user);
            avatar.update();
            userEntry.add(avatar.actor);

            let userLabelText = "";;
            let userName = session.user.get_real_name() ?
                           session.user.get_real_name() : session.username;

            if (session.info.remote)
                /* Translators: Remote here refers to a remote session, like a ssh login */
                userLabelText = _("%s (remote)").format(userName);
            else if (session.info.type == "tty")
                /* Translators: Console here refers to a tty like a VT console */
                userLabelText = _("%s (console)").format(userName);
            else
                userLabelText = userName;

            let textLayout = new St.BoxLayout({ style_class: 'login-dialog-user-list-item-text-box',
                                                vertical: true });
            textLayout.add(new St.Label({ text: userLabelText }),
                           { y_fill: false,
                             y_align: St.Align.MIDDLE,
                             expand: true });
            userEntry.add(textLayout, { expand: true });
            userList.add(userEntry, { x_fill: true });
        }

        let cancelButton = { label: _("Cancel"),
                             action: function() { dialog.close(); },
                             key: Clutter.Escape };

        let powerOffButton = { label: POWER_OFF_TEXT,  action: Lang.bind(this, function() {
            dialog.close();
            this._session.ShutdownRemote();
        }), default: true };

        dialog.setButtons([cancelButton, powerOffButton]);

        dialog.open();
    },

    _onSystemActionActivate: function() {
        if (this._haveShutdown &&
            this._suspendOrPowerOffOption.state == PopupMenu.PopupAlternatingMenuItemState.DEFAULT) {
            this.menu.close(BoxPointer.PopupAnimation.NONE);

            this._loginManager.listSessions(Lang.bind(this,
                function(result) {
                    let sessions = [];
                    let n = 0;
                    for (let i = 0; i < result.length; i++) {
                        let[id, uid, userName, seat, sessionPath] = result[i];
                        let proxy = new SystemdLoginSession(Gio.DBus.system,
                                                            'org.freedesktop.login1',
                                                            sessionPath);

                        if (proxy.Class != 'user')
                            continue;

                        if (proxy.State == 'closing')
                            continue;

                        if (proxy.Id == GLib.getenv('XDG_SESSION_ID'))
                            continue;

                        sessions.push({ user: this._userManager.get_user(userName),
                                        username: userName,
                                        info: { type: proxy.Type,
                                                remote: proxy.Remote }
                        });

                        // limit the number of entries
                        n++;
                        if (n == MAX_USERS_IN_SESSION_DIALOG)
                            break;
                    }

                    if (n != 0)
                        this._openSessionWarnDialog(sessions);
                    else
                        this._session.ShutdownRemote();
            }));
        } else {
            this.menu.close(BoxPointer.PopupAnimation.NONE);
            this._loginManager.suspend();
        }
    },

    _onHoverChanged: function() {
        if (this.actor.get_hover()) {
            this._iconBox.child = this._settingsIconHover;
        } else {
            this._iconBox.child = this._settingsIconNormal;
        }
    }
});
