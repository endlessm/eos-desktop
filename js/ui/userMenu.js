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
const Panel = imports.ui.panel;
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
const SHOW_FULL_NAME_IN_TOP_BAR_KEY = 'show-full-name-in-top-bar';

const SUSPEND_TEXT = _("Suspend");
const LOCK_TEXT = _("Lock");
const EXIT_TEXT = _("Exit");

const YELP_TEXT = _("Help");
const SETTINGS_TEXT = _("Settings");
const FEEDBACK_TEXT = _("Give Us Feedback");

const FEEDBACK_LAUNCHER = "eos-app-feedback.desktop";
const YELP_LAUNCHER = "eos-app-yelp.desktop";
const CONTROL_CENTER_LAUNCHER = "eos-app-gnome-control-center.desktop";

const DIALOG_ICON_SIZE = 64;

const MAX_USERS_IN_SESSION_DIALOG = 5;

const SystemdLoginSessionIface = '<node> \
<interface name="org.freedesktop.login1.Session"> \
    <property name="Id" type="s" access="read"/> \
    <property name="Remote" type="b" access="read"/> \
    <property name="Class" type="s" access="read"/> \
    <property name="Type" type="s" access="read"/> \
    <property name="State" type="s" access="read"/> \
</interface> \
</node>';

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

const AltSwitcher = new Lang.Class({
    Name: 'AltSwitcher',

    _init: function(standard, alternate) {
        this._standard = standard;
        this._standard.connect('notify::visible', Lang.bind(this, this._sync));

        this._alternate = alternate;
        this._alternate.connect('notify::visible', Lang.bind(this, this._sync));

        this._capturedEventId = global.stage.connect('captured-event', Lang.bind(this, this._onCapturedEvent));

        this.actor = new St.Bin();
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
    },

    _sync: function() {
        let childToShow = null;
        if (this._standard.visible && this._alternate.visible) {
            let [x, y, mods] = global.get_pointer();
            let altPressed = (mods & Clutter.ModifierType.MOD1_MASK) != 0;
            childToShow = altPressed ? this._alternate : this._standard;
        } else if (this._standard.visible) {
            childToShow = this._standard;
        } else if (this._alternate.visible) {
            childToShow = this._alternate;
        }

        if (this.actor.get_child() != childToShow) {
            this.actor.set_child(childToShow);

            // The actors might respond to hover, so
            // sync the pointer to make sure they update.
            global.sync_pointer();
        }

        this.actor.visible = (childToShow != null);
    },

    _onDestroy: function() {
        if (this._capturedEventId > 0) {
            global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    },

    _onCapturedEvent: function(actor, event) {
        let type = event.type();
        if (type == Clutter.EventType.KEY_PRESS || type == Clutter.EventType.KEY_RELEASE) {
            let key = event.get_key_symbol();
            if (key == Clutter.KEY_Alt_L || key == Clutter.KEY_Alt_R)
                this._sync();
        }

        return false;
    },
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

        this._icon = new St.Icon({ style_class: 'settings-menu-icon' });

        Panel.animateIconIn(this._icon, 0);
        box.add(this._icon);

        let iconFileNormal = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/settings-normal.png');
        this._giconNormal = new Gio.FileIcon({ file: iconFileNormal });

        let iconFileHover = Gio.File.new_for_uri('resource:///org/gnome/shell/theme/settings-hover.png');
        this._giconHover = new Gio.FileIcon({ file: iconFileHover });

        this._icon.gicon = this._giconNormal;
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
        this._user.connect('notify::automatic-login',
                            Lang.bind(this, this._updateLockScreen));
        this._user.connect('notify::password-mode',
                            Lang.bind(this, this._updateLockScreen));
        this._lockdownSettings.connect('changed::' + DISABLE_USER_SWITCH_KEY,
                                       Lang.bind(this, this._updateSwitchUser));
        this._lockdownSettings.connect('changed::' + DISABLE_LOCK_SCREEN_KEY,
                                       Lang.bind(this, this._updateLockScreen));
        this._updateSwitchUser();
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

    _updateActionsVisibility: function() {
        let visible = (this._lockScreenAction.visible ||
                       this._altSwitcher.actor.visible ||
                       this._helpAction.visible);

        this._actionsItem.actor.visible = visible;
    },

    _sessionUpdated: function() {
        this.actor.visible = !Main.sessionMode.isGreeter;

        let allowSettings = Main.sessionMode.allowSettings;
        this._statusChooser.setSensitive(allowSettings);
        this._systemSettings.visible = allowSettings;

        this.setSensitive(!Main.sessionMode.isLocked);
        this._updateButtonIcon();
        this._updateActionsVisibility();
    },

    _onDestroy: function() {
        this._user.disconnect(this._userLoadedId);
        this._user.disconnect(this._userChangedId);
    },

    _updateMultiUser: function() {
        this._updateSwitchUser();
    },

    _updateSwitchUser: function() {
        let allowSwitch = !this._lockdownSettings.get_boolean(DISABLE_USER_SWITCH_KEY);
        let multiUser = this._userManager.can_switch() && this._userManager.has_multiple_users;

        this._loginScreenItem.actor.visible = allowSwitch && multiUser;
    },

    _updateLockScreen: function() {
        let allowLockScreen = !this._lockdownSettings.get_boolean(DISABLE_LOCK_SCREEN_KEY);
        this._lockScreenAction.visible = allowLockScreen
            && LoginManager.canLock()
            && !this._user.get_automatic_login()
            && this._user.get_password_mode() == AccountsService.UserPasswordMode.REGULAR;
        this._updateActionsVisibility();
    },

    _updateHaveShutdown: function() {
        this._session.CanShutdownRemote(Lang.bind(this,
            function(result, error) {
                if (!error) {
                    this._haveShutdown = result[0];
                    this._updatePowerOff();
                }
            }));
    },

    _updatePowerOff: function() {
        this._powerOffAction.visible = this._haveShutdown;
        this._updateActionsVisibility();
    },

    _updateHaveSuspend: function() {
        this._loginManager.canSuspend(Lang.bind(this,
            function(result) {
                this._haveSuspend = result;
                this._updateSuspend();
        }));
    },

    _updateSuspend: function() {
        this._suspendAction.visible = this._haveSuspend;
        this._updateActionsVisibility();
    },

    _updateButtonIcon: function() {
        // We only use the simple settings icon,
        // so no need to change the icon here based on the presence

        if (Main.sessionMode.isLocked)
            this._icon.visible = Main.screenShield.locked;
        else
            this._icon.visible = true;
    },

    _createActionButton: function(accessibleName) {
        let item = new St.Button({ style_class: 'system-menu-action',
                                   track_hover: true,
                                   can_focus: true,
                                   reactive: true,
                                   x_expand: true,
                                   accessible_name: accessibleName });
        return item;
    },

    _createActionButtonForIconName: function(accessibleName, iconName) {
        let item = this._createActionButton(accessibleName);
        item.child = new St.Icon({ icon_name: iconName });
        return item;
    },

    _createActionButtonForIconPath: function(accessibleName, iconPath) {
        let iconFile = Gio.File.new_for_uri('resource:///org/gnome/shell' + iconPath);
        let gicon = new Gio.FileIcon({ file: iconFile });

        let item = this._createActionButton(accessibleName);
        item.child = new St.Icon({ gicon: gicon });
        return item;
    },

    _createSubMenu: function() {
        let item;

        item = new IMStatusChooserItem();
        item.connect('activate', Lang.bind(this, this._onMyAccountActivate));
        this.menu.addMenuItem(item);
        this._statusChooser = item;

        item = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(item);

        this._systemSettings = new PopupMenu.PopupUserMenuItem(SETTINGS_TEXT,
                { imagePath: '/theme/settings-symbolic.svg' });
        this._systemSettings.connect('activate', Lang.bind(this, this._onPreferencesActivate));
        this.menu.addMenuItem(this._systemSettings);

        if (this._haveLauncher(FEEDBACK_LAUNCHER)) {
            item = new PopupMenu.PopupUserMenuItem(FEEDBACK_TEXT,
                                                   { imagePath: '/theme/feedback-symbolic.svg' });
            item.connect('activate', Lang.bind(this, this._onFeedbackActivate));
            this.menu.addMenuItem(item);
        }

        item = new PopupMenu.PopupUserMenuItem(_("Switch User"));
        item.connect('activate', Lang.bind(this, this._onLoginScreenActivate));
        this.menu.addMenuItem(item);
        this._loginScreenItem = item;

        item = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(item);

        item = new PopupMenu.PopupActionsMenuItem();

        this._helpAction = this._createActionButtonForIconPath(YELP_TEXT, '/theme/help-symbolic.svg');
        this._helpAction.connect('clicked', Lang.bind(this, this._onHelpClicked));
        this._helpAction.visible = this._haveLauncher(YELP_LAUNCHER);
        item.actor.add(this._helpAction, { expand: true, x_fill: false })

        this._lockScreenAction = this._createActionButtonForIconName(LOCK_TEXT, 'changes-prevent-symbolic');
        this._lockScreenAction.connect('clicked', Lang.bind(this, this._onLockScreenClicked));
        item.actor.add(this._lockScreenAction, { expand: true, x_fill: false })

        this._suspendAction = this._createActionButtonForIconName(SUSPEND_TEXT, 'media-playback-pause-symbolic');
        this._suspendAction.connect('clicked', Lang.bind(this, this._onSuspendClicked));

        this._powerOffAction = this._createActionButtonForIconName(EXIT_TEXT, 'system-shutdown-symbolic');
        this._powerOffAction.connect('clicked', Lang.bind(this, this._onPowerOffClicked));

        this._altSwitcher = new AltSwitcher(this._powerOffAction, this._suspendAction);
        item.actor.add(this._altSwitcher.actor, { expand: true, x_fill: false });

        this._actionsItem = item
        this.menu.addMenuItem(item);
    },

    _haveLauncher: function(launcher) {
        let app = Shell.AppSystem.get_default().lookup_app(launcher);
        return app != null;
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
        let app = Shell.AppSystem.get_default().lookup_app(CONTROL_CENTER_LAUNCHER);
        app.activate();
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

        let powerOffButton = { label: EXIT_TEXT,  action: Lang.bind(this, function() {
            dialog.close();
            this._session.ShutdownRemote();
        }), default: true };

        dialog.setButtons([cancelButton, powerOffButton]);

        dialog.open();
    },

    _onHelpClicked: function() {
        this.menu.close(BoxPointer.PopupAnimation.NONE);
        Main.overview.hide();

        let app = Shell.AppSystem.get_default().lookup_app(YELP_LAUNCHER);
        app.activate();
    },

    _onLockScreenClicked: function() {
        this.menu.close(BoxPointer.PopupAnimation.NONE);
        Main.screenShield.lock(true);
    },

    _onSuspendClicked: function() {
        this.menu.close(BoxPointer.PopupAnimation.NONE);
        this._loginManager.suspend();
    },

    _onPowerOffClicked: function() {
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
    },

    _onHoverChanged: function() {
        if (this.actor.get_hover()) {
            this._icon.gicon = this._giconHover;
        } else {
            this._icon.gicon = this._giconNormal;
        }
    }
});
