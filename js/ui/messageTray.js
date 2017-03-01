// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GnomeDesktop = imports.gi.GnomeDesktop;
const Atk = imports.gi.Atk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;

const BoxPointer = imports.ui.boxpointer;
const CtrlAltTab = imports.ui.ctrlAltTab;
const CloseButton = imports.ui.closeButton;
const GnomeSession = imports.misc.gnomeSession;
const GrabHelper = imports.ui.grabHelper;
const Lightbox = imports.ui.lightbox;
const Main = imports.ui.main;
const MessageTrayMarkup = imports.ui.messageTrayMarkup;
const PointerWatcher = imports.ui.pointerWatcher;
const PopupMenu = imports.ui.popupMenu;
const Params = imports.misc.params;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;

const SHELL_KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';

const ANIMATION_TIME = 0.2;
const NOTIFICATION_TIMEOUT = 4;
const SUMMARY_TIMEOUT = 1;
const LONGER_SUMMARY_TIMEOUT = 4;

const HIDE_TIMEOUT = 0.2;
const LONGER_HIDE_TIMEOUT = 0.6;

// We delay hiding of the tray if the mouse is within MOUSE_LEFT_ACTOR_THRESHOLD
// range from the point where it left the tray.
const MOUSE_LEFT_ACTOR_THRESHOLD = 20;

// Time the user needs to leave the mouse on the bottom pixel row to open the tray
const TRAY_DWELL_TIME = 1000; // ms
// Time resolution when tracking the mouse to catch the open tray dwell
const TRAY_DWELL_CHECK_INTERVAL = 100; // ms

const IDLE_TIME = 1000;

const State = {
    HIDDEN:  0,
    SHOWING: 1,
    SHOWN:   2,
    HIDING:  3
};

// These reasons are useful when we destroy the notifications received through
// the notification daemon. We use EXPIRED for transient notifications that the
// user did not interact with, DISMISSED for all other notifications that were
// destroyed as a result of a user action, and SOURCE_CLOSED for the notifications
// that were requested to be destroyed by the associated source.
const NotificationDestroyedReason = {
    EXPIRED: 1,
    DISMISSED: 2,
    SOURCE_CLOSED: 3
};

// Message tray has its custom Urgency enumeration. LOW, NORMAL and CRITICAL
// urgency values map to the corresponding values for the notifications received
// through the notification daemon. HIGH urgency value is used for chats received
// through the Telepathy client.
const Urgency = {
    LOW: 0,
    NORMAL: 1,
    HIGH: 2,
    CRITICAL: 3
}

function _fixMarkup(text, allowMarkup) {
    MessageTrayMarkup.fixMarkup(text, allowMarkup);
}

const FocusGrabber = new Lang.Class({
    Name: 'FocusGrabber',

    _init: function(actor) {
        this._actor = actor;
        this._prevKeyFocusActor = null;
        this._focusActorChangedId = 0;
        this._focused = false;
    },

    grabFocus: function() {
        if (this._focused)
            return;

        this._prevFocusedWindow = global.display.focus_window;
        this._prevKeyFocusActor = global.stage.get_key_focus();

        this._focusActorChangedId = global.stage.connect('notify::key-focus', Lang.bind(this, this._focusActorChanged));

        if (!this._actor.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false))
            this._actor.grab_key_focus();

        this._focused = true;
    },

    _focusUngrabbed: function() {
        if (!this._focused)
            return false;

        if (this._focusActorChangedId > 0) {
            global.stage.disconnect(this._focusActorChangedId);
            this._focusActorChangedId = 0;
        }

        this._focused = false;
        return true;
    },

    _focusActorChanged: function() {
        let focusedActor = global.stage.get_key_focus();
        if (!focusedActor || !this._actor.contains(focusedActor))
            this._focusUngrabbed();
    },

    ungrabFocus: function() {
        if (!this._focusUngrabbed())
            return;

        if (this._prevKeyFocusActor) {
            global.stage.set_key_focus(this._prevKeyFocusActor);
            this._prevKeyFocusActor = null;
        } else {
            let focusedActor = global.stage.get_key_focus();
            if (focusedActor && this._actor.contains(focusedActor))
                global.stage.set_key_focus(null);
        }
    }
});

const URLHighlighter = new Lang.Class({
    Name: 'URLHighlighter',

    _init: function(text, lineWrap, allowMarkup) {
        if (!text)
            text = '';
        this.actor = new St.Label({ reactive: true, style_class: 'url-highlighter' });
        this._linkColor = '#ccccff';
        this.actor.connect('style-changed', Lang.bind(this, function() {
            let [hasColor, color] = this.actor.get_theme_node().lookup_color('link-color', false);
            if (hasColor) {
                let linkColor = color.to_string().substr(0, 7);
                if (linkColor != this._linkColor) {
                    this._linkColor = linkColor;
                    this._highlightUrls();
                }
            }
        }));
        if (lineWrap) {
            this.actor.clutter_text.line_wrap = true;
            this.actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            this.actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        }

        this.setMarkup(text, allowMarkup);
        this.actor.connect('button-press-event', Lang.bind(this, function(actor, event) {
            // Don't try to URL highlight when invisible.
            // The MessageTray doesn't actually hide us, so
            // we need to check for paint opacities as well.
            if (!actor.visible || actor.get_paint_opacity() == 0)
                return false;

            // Keep Notification.actor from seeing this and taking
            // a pointer grab, which would block our button-release-event
            // handler, if an URL is clicked
            return this._findUrlAtPos(event) != -1;
        }));
        this.actor.connect('button-release-event', Lang.bind(this, function (actor, event) {
            if (!actor.visible || actor.get_paint_opacity() == 0)
                return false;

            let urlId = this._findUrlAtPos(event);
            if (urlId != -1) {
                let url = this._urls[urlId].url;
                if (url.indexOf(':') == -1)
                    url = 'http://' + url;

                Gio.app_info_launch_default_for_uri(url, global.create_app_launch_context());
                return true;
            }
            return false;
        }));
        this.actor.connect('motion-event', Lang.bind(this, function(actor, event) {
            if (!actor.visible || actor.get_paint_opacity() == 0)
                return false;

            let urlId = this._findUrlAtPos(event);
            if (urlId != -1 && !this._cursorChanged) {
                global.screen.set_cursor(Meta.Cursor.POINTING_HAND);
                this._cursorChanged = true;
            } else if (urlId == -1) {
                global.screen.set_cursor(Meta.Cursor.DEFAULT);
                this._cursorChanged = false;
            }
            return false;
        }));
        this.actor.connect('leave-event', Lang.bind(this, function() {
            if (!this.actor.visible || this.actor.get_paint_opacity() == 0)
                return;

            if (this._cursorChanged) {
                this._cursorChanged = false;
                global.screen.set_cursor(Meta.Cursor.DEFAULT);
            }
        }));
    },

    setMarkup: function(text, allowMarkup) {
        text = text ? MessageTrayMarkup.fixMarkup(text, allowMarkup) : '';
        this._text = text;

        this.actor.clutter_text.set_markup(text);
        /* clutter_text.text contain text without markup */
        this._urls = Util.findUrls(this.actor.clutter_text.text);
        this._highlightUrls();
    },

    _highlightUrls: function() {
        // text here contain markup
        let urls = Util.findUrls(this._text);
        let markup = '';
        let pos = 0;
        for (let i = 0; i < urls.length; i++) {
            let url = urls[i];
            let str = this._text.substr(pos, url.pos - pos);
            markup += str + '<span foreground="' + this._linkColor + '"><u>' + url.url + '</u></span>';
            pos = url.pos + url.url.length;
        }
        markup += this._text.substr(pos);
        this.actor.clutter_text.set_markup(markup);
    },

    _findUrlAtPos: function(event) {
        let success;
        let [x, y] = event.get_coords();
        [success, x, y] = this.actor.transform_stage_point(x, y);
        let find_pos = -1;
        for (let i = 0; i < this.actor.clutter_text.text.length; i++) {
            let [success, px, py, line_height] = this.actor.clutter_text.position_to_coords(i);
            if (py > y || py + line_height < y || x < px)
                continue;
            find_pos = i;
        }
        if (find_pos != -1) {
            for (let i = 0; i < this._urls.length; i++)
            if (find_pos >= this._urls[i].pos &&
                this._urls[i].pos + this._urls[i].url.length > find_pos)
                return i;
        }
        return -1;
    }
});

// NotificationPolicy:
// An object that holds all bits of configurable policy related to a notification
// source, such as whether to play sound or honour the critical bit.
//
// A notification without a policy object will inherit the default one.
const NotificationPolicy = new Lang.Class({
    Name: 'NotificationPolicy',

    _init: function(params) {
        params = Params.parse(params, { enable: true,
                                        enableSound: true,
                                        showBanners: true,
                                        forceExpanded: false,
                                        showInLockScreen: true,
                                        detailsInLockScreen: false,
                                        notificationTimeout: NOTIFICATION_TIMEOUT
                                      });
        Lang.copyProperties(params, this);
    },

    // Do nothing for the default policy. These methods are only useful for the
    // GSettings policy.
    store: function() { },
    destroy: function() { }
});
Signals.addSignalMethods(NotificationPolicy.prototype);

const NotificationGenericPolicy = new Lang.Class({
    Name: 'NotificationGenericPolicy',
    Extends: NotificationPolicy,

    _init: function() {
        // Don't chain to parent, it would try setting
        // our properties to the defaults

        this.id = 'generic';

        this._masterSettings = new Gio.Settings({ schema: 'org.gnome.desktop.notifications' });
        this._masterSettings.connect('changed', Lang.bind(this, this._changed));
    },

    store: function() { },

    destroy: function() {
        this._masterSettings.run_dispose();
    },

    _changed: function(settings, key) {
        this.emit('policy-changed', key);
    },

    get enable() {
        return true;
    },

    get enableSound() {
        return true;
    },

    get showBanners() {
        return this._masterSettings.get_boolean('show-banners');
    },

    get forceExpanded() {
        return false;
    },

    get showInLockScreen() {
        return this._masterSettings.get_boolean('show-in-lock-screen');
    },

    get detailsInLockScreen() {
        return false;
    }
});

const NotificationApplicationPolicy = new Lang.Class({
    Name: 'NotificationApplicationPolicy',
    Extends: NotificationPolicy,

    _init: function(id) {
        // Don't chain to parent, it would try setting
        // our properties to the defaults

        this.id = id;
        this._canonicalId = this._canonicalizeId(id);

        this._masterSettings = new Gio.Settings({ schema: 'org.gnome.desktop.notifications' });
        this._settings = new Gio.Settings({ schema: 'org.gnome.desktop.notifications.application',
                                            path: '/org/gnome/desktop/notifications/application/' + this._canonicalId + '/' });

        this._masterSettings.connect('changed', Lang.bind(this, this._changed));
        this._settings.connect('changed', Lang.bind(this, this._changed));
    },

    store: function() {
        this._settings.set_string('application-id', this.id + '.desktop');

        let apps = this._masterSettings.get_strv('application-children');
        if (apps.indexOf(this._canonicalId) < 0) {
            apps.push(this._canonicalId);
            this._masterSettings.set_strv('application-children', apps);
        }
    },

    destroy: function() {
        this._masterSettings.run_dispose();
        this._settings.run_dispose();
    },

    _changed: function(settings, key) {
        this.emit('policy-changed', key);
    },

    _canonicalizeId: function(id) {
        // Keys are restricted to lowercase alphanumeric characters and dash,
        // and two dashes cannot be in succession
        return id.toLowerCase().replace(/[^a-z0-9\-]/g, '-').replace(/--+/g, '-');
    },

    get enable() {
        return this._settings.get_boolean('enable');
    },

    get enableSound() {
        return this._settings.get_boolean('enable-sound-alerts');
    },

    get showBanners() {
        return this._masterSettings.get_boolean('show-banners') &&
            this._settings.get_boolean('show-banners');
    },

    get forceExpanded() {
        return this._settings.get_boolean('force-expanded');
    },

    get showInLockScreen() {
        return this._masterSettings.get_boolean('show-in-lock-screen') &&
            this._settings.get_boolean('show-in-lock-screen');
    },

    get detailsInLockScreen() {
        return this._settings.get_boolean('details-in-lock-screen');
    }
});

// Notification:
// @source: the notification's Source
// @title: the title
// @banner: the banner text
// @params: optional additional params
//
// Creates a notification. In the banner mode, the notification
// will show an icon, @title (in bold) and @banner, all on a single
// line (with @banner ellipsized if necessary).
//
// The notification will be expandable if either it has additional
// elements that were added to it or if the @banner text did not
// fit fully in the banner mode. When the notification is expanded,
// the @banner text from the top line is always removed. The complete
// @banner text is added as the first element in the content section,
// unless 'customContent' parameter with the value 'true' is specified
// in @params.
//
// Additional notification content can be added with addActor() and
// addBody() methods. The notification content is put inside a
// scrollview, so if it gets too tall, the notification will scroll
// rather than continue to grow. In addition to this main content
// area, there is also a single-row action area, which is not
// scrolled and can contain a single actor. The action area can
// be set by calling setActionArea() method. There is also a
// convenience method addButton() for adding a button to the action
// area.
//
// @params can contain values for 'customContent', 'body', 'icon',
// 'titleMarkup', 'bannerMarkup', 'bodyMarkup', and 'clear'
// parameters.
//
// If @params contains a 'customContent' parameter with the value %true,
// then @banner will not be shown in the body of the notification when the
// notification is expanded and calls to update() will not clear the content
// unless 'clear' parameter with value %true is explicitly specified.
//
// If @params contains a 'body' parameter, then that text will be added to
// the content area (as with addBody()).
//
// By default, the icon shown is the same as the source's.
// However, if @params contains a 'gicon' parameter, the passed in gicon
// will be used.
//
// You can add a secondary icon to the banner with 'secondaryGIcon'. There
// is no fallback for this icon.
//
// If @params contains a 'titleMarkup', 'bannerMarkup', or
// 'bodyMarkup' parameter with the value %true, then the corresponding
// element is assumed to use pango markup. If the parameter is not
// present for an element, then anything that looks like markup in
// that element will appear literally in the output.
//
// If @params contains a 'clear' parameter with the value %true, then
// the content and the action area of the notification will be cleared.
// The content area is also always cleared if 'customContent' is false
// because it might contain the @banner that didn't fit in the banner mode.
//
// If @params contains 'soundName' or 'soundFile', the corresponding
// event sound is played when the notification is shown (if the policy for
// @source allows playing sounds).
const Notification = new Lang.Class({
    Name: 'Notification',

    ICON_SIZE: 24,

    IMAGE_SIZE: 125,

    _init: function(source, title, banner, params) {
        this.source = source;
        this.title = title;
        this.urgency = Urgency.NORMAL;
        this.resident = false;
        // 'transient' is a reserved keyword in JS, so we have to use an alternate variable name
        this.isTransient = false;
        this.isMusic = false;
        this.forFeedback = false;
        this.expanded = false;
        this.focused = false;
        this.acknowledged = false;
        this._destroyed = false;
        this._customContent = false;
        this.bannerBodyText = null;
        this.bannerBodyMarkup = false;
        this._bannerBodyAdded = false;
        this._titleFitsInBannerMode = true;
        this._titleDirection = Clutter.TextDirection.DEFAULT;
        this._spacing = 0;
        this._scrollPolicy = Gtk.PolicyType.AUTOMATIC;
        this._imageBin = null;
        this._soundName = null;
        this._soundFile = null;
        this._soundPlayed = false;
        this.ignoreHover = false;

        source.connect('destroy', Lang.bind(this,
            function (source, reason) {
                this.destroy(reason);
            }));

        this.actor = new St.Button({ accessible_role: Atk.Role.NOTIFICATION });
        this.actor.add_style_class_name('notification-unexpanded');
        this.actor._delegate = this;
        this.actor.connect('clicked', Lang.bind(this, this._onClicked));
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));

        this._table = new St.Table({ style_class: 'notification',
                                     reactive: true });
        this._table.connect('style-changed', Lang.bind(this, this._styleChanged));
        this.actor.set_child(this._table);

        // The first line should have the title, followed by the
        // banner text, but ellipsized if they won't both fit. We can't
        // make St.Table or St.BoxLayout do this the way we want (don't
        // show banner at all if title needs to be ellipsized), so we
        // use Shell.GenericContainer.
        this._bannerBox = new Shell.GenericContainer();
        this._bannerBox.connect('get-preferred-width', Lang.bind(this, this._bannerBoxGetPreferredWidth));
        this._bannerBox.connect('get-preferred-height', Lang.bind(this, this._bannerBoxGetPreferredHeight));
        this._bannerBox.connect('allocate', Lang.bind(this, this._bannerBoxAllocate));
        this._table.add(this._bannerBox, { row: 0,
                                           col: 1,
                                           col_span: 2,
                                           x_expand: false,
                                           y_expand: false,
                                           y_fill: false });

        // This is an empty cell that overlaps with this._bannerBox cell to ensure
        // that this._bannerBox cell expands horizontally, while not forcing the
        // this._imageBin that is also in col: 2 to expand horizontally.
        this._table.add(new St.Bin(), { row: 0,
                                        col: 2,
                                        y_expand: false,
                                        y_fill: false });

        this._titleLabel = new St.Label();
        this._bannerBox.add_actor(this._titleLabel);
        this._bannerUrlHighlighter = new URLHighlighter();
        this._bannerLabel = this._bannerUrlHighlighter.actor;
        this._bannerBox.add_actor(this._bannerLabel);

        this.update(title, banner, params);
    },

    // update:
    // @title: the new title
    // @banner: the new banner
    // @params: as in the Notification constructor
    //
    // Updates the notification by regenerating its icon and updating
    // the title/banner. If @params.clear is %true, it will also
    // remove any additional actors/action buttons previously added.
    update: function(title, banner, params) {
        params = Params.parse(params, { customContent: false,
                                        body: null,
                                        gicon: null,
                                        secondaryGIcon: null,
                                        titleMarkup: false,
                                        bannerMarkup: false,
                                        bodyMarkup: false,
                                        clear: false,
                                        soundName: null,
                                        soundFile: null });

        this._customContent = params.customContent;

        let oldFocus = global.stage.key_focus;

        if (this._icon && (params.gicon || params.clear)) {
            this._icon.destroy();
            this._icon = null;
        }

        if (this._secondaryIcon && (params.secondaryGIcon || params.clear)) {
            this._secondaryIcon.destroy();
            this._secondaryIcon = null;
        }

        // We always clear the content area if we don't have custom
        // content because it might contain the @banner that didn't
        // fit in the banner mode.
        if (this._scrollArea && (!this._customContent || params.clear)) {
            if (oldFocus && this._scrollArea.contains(oldFocus))
                this.actor.grab_key_focus();

            this._scrollArea.destroy();
            this._scrollArea = null;
            this._contentArea = null;
        }
        if (this._actionArea && params.clear) {
            if (oldFocus && this._actionArea.contains(oldFocus))
                this.actor.grab_key_focus();

            this._actionArea.destroy();
            this._actionArea = null;
            this._buttonBox = null;
        }
        if (params.clear)
            this.unsetImage();

        if (!this._scrollArea && !this._actionArea && !this._imageBin)
            this._table.remove_style_class_name('multi-line-notification');

        if (params.gicon) {
            this._icon = new St.Icon({ gicon: params.gicon,
                                       icon_size: this.ICON_SIZE });
        } else {
            this._icon = this.source.createIcon(this.ICON_SIZE);
        }

        if (this._icon) {
            this._table.add(this._icon, { row: 0,
                                          col: 0,
                                          x_expand: false,
                                          y_expand: false,
                                          y_fill: false,
                                          y_align: St.Align.START });
        }

        if (params.secondaryGIcon) {
            this._secondaryIcon = new St.Icon({ gicon: params.secondaryGIcon,
                                                style_class: 'secondary-icon' });
            this._bannerBox.add_actor(this._secondaryIcon);
        }

        this.title = title;
        title = title ? MessageTrayMarkup.fixMarkup(title.replace(/\n/g, ' '), params.titleMarkup) : '';
        this._titleLabel.clutter_text.set_markup('<b>' + title + '</b>');

        if (Pango.find_base_dir(title, -1) == Pango.Direction.RTL)
            this._titleDirection = Clutter.TextDirection.RTL;
        else
            this._titleDirection = Clutter.TextDirection.LTR;

        // Let the title's text direction control the overall direction
        // of the notification - in case where different scripts are used
        // in the notification, this is the right thing for the icon, and
        // arguably for action buttons as well. Labels other than the title
        // will be allocated at the available width, so that their alignment
        // is done correctly automatically.
        this._table.set_text_direction(this._titleDirection);

        // Unless the notification has custom content, we save this.bannerBodyText
        // to add it to the content of the notification if the notification is
        // expandable due to other elements in its content area or due to the banner
        // not fitting fully in the single-line mode.
        this.bannerBodyText = this._customContent ? null : banner;
        this.bannerBodyMarkup = params.bannerMarkup;
        this._bannerBodyAdded = false;

        banner = banner ? banner.replace(/\n/g, '  ') : '';

        this._bannerUrlHighlighter.setMarkup(banner, params.bannerMarkup);
        this._bannerLabel.queue_relayout();

        // Add the bannerBody now if we know for sure we'll need it
        if (this.bannerBodyText && this.bannerBodyText.indexOf('\n') > -1)
            this._addBannerBody();

        if (params.body)
            this.addBody(params.body, params.bodyMarkup);

        if (this._soundName != params.soundName ||
            this._soundFile != params.soundFile) {
            this._soundName = params.soundName;
            this._soundFile = params.soundFile;
            this._soundPlayed = false;
        }

        this.updated();
    },

    setIconVisible: function(visible) {
        this._icon.visible = visible;
    },

    enableScrolling: function(enableScrolling) {
        this._scrollPolicy = enableScrolling ? Gtk.PolicyType.AUTOMATIC : Gtk.PolicyType.NEVER;
        if (this._scrollArea) {
            this._scrollArea.vscrollbar_policy = this._scrollPolicy;
            this._scrollArea.enable_mouse_scrolling = enableScrolling;
        }
    },

    _createScrollArea: function() {
        this._table.add_style_class_name('multi-line-notification');
        this._scrollArea = new St.ScrollView({ style_class: 'notification-scrollview',
                                               vscrollbar_policy: this._scrollPolicy,
                                               hscrollbar_policy: Gtk.PolicyType.NEVER,
                                               visible: this.expanded });
        this._table.add(this._scrollArea, { row: 1,
                                            col: 2 });
        this._updateLastColumnSettings();
        this._contentArea = new St.BoxLayout({ style_class: 'notification-body',
                                               vertical: true });
        this._scrollArea.add_actor(this._contentArea);
        // If we know the notification will be expandable, we need to add
        // the banner text to the body as the first element.
        this._addBannerBody();
    },

    // addActor:
    // @actor: actor to add to the body of the notification
    //
    // Appends @actor to the notification's body
    addActor: function(actor, style) {
        if (!this._scrollArea) {
            this._createScrollArea();
        }

        this._contentArea.add(actor, style ? style : {});
        this.updated();
    },

    // addBody:
    // @text: the text
    // @markup: %true if @text contains pango markup
    // @style: style to use when adding the actor containing the text
    //
    // Adds a multi-line label containing @text to the notification.
    //
    // Return value: the newly-added label
    addBody: function(text, markup, style) {
        let label = new URLHighlighter(text, true, markup);

        this.addActor(label.actor, style);
        return label.actor;
    },

    _addBannerBody: function() {
        if (this.bannerBodyText && !this._bannerBodyAdded) {
            this._bannerBodyAdded = true;
            this.addBody(this.bannerBodyText, this.bannerBodyMarkup);
        }
    },

    // scrollTo:
    // @side: St.Side.TOP or St.Side.BOTTOM
    //
    // Scrolls the content area (if scrollable) to the indicated edge
    scrollTo: function(side) {
        let adjustment = this._scrollArea.vscroll.adjustment;
        if (side == St.Side.TOP)
            adjustment.value = adjustment.lower;
        else if (side == St.Side.BOTTOM)
            adjustment.value = adjustment.upper;
    },

    // setActionArea:
    // @actor: the actor
    // @props: (option) St.Table child properties
    //
    // Puts @actor into the action area of the notification, replacing
    // the previous contents
    setActionArea: function(actor, props) {
        if (this._actionArea) {
            this._actionArea.destroy();
            this._actionArea = null;
            if (this._buttonBox)
                this._buttonBox = null;
        } else {
            this._addBannerBody();
        }
        this._actionArea = actor;
        this._actionArea.visible = this.expanded;

        if (!props)
            props = {};
        props.row = 2;
        props.col = 2;

        this._table.add_style_class_name('multi-line-notification');
        this._table.add(this._actionArea, props);
        this._updateLastColumnSettings();
        this.updated();
    },

    _updateLastColumnSettings: function() {
        if (this._scrollArea)
            this._table.child_set(this._scrollArea, { col: this._imageBin ? 2 : 1,
                                                      col_span: this._imageBin ? 1 : 2 });
        if (this._actionArea)
            this._table.child_set(this._actionArea, { col: this._imageBin ? 2 : 1,
                                                      col_span: this._imageBin ? 1 : 2 });
    },

    setImage: function(image) {
        this.unsetImage();

        if (!image)
            return;

        this._imageBin = new St.Bin({ opacity: 230,
                                      child: image,
                                      visible: this.expanded });

        this._table.add_style_class_name('multi-line-notification');
        this._table.add_style_class_name('notification-with-image');
        this._addBannerBody();
        this._updateLastColumnSettings();
        this._table.add(this._imageBin, { row: 1,
                                          col: 1,
                                          row_span: 2,
                                          x_expand: false,
                                          y_expand: false,
                                          x_fill: false,
                                          y_fill: false });
    },

    unsetImage: function() {
        if (this._imageBin) {
            this._table.remove_style_class_name('notification-with-image');
            this._table.remove_actor(this._imageBin);
            this._imageBin = null;
            this._updateLastColumnSettings();
            if (!this._scrollArea && !this._actionArea)
                this._table.remove_style_class_name('multi-line-notification');
        }
    },

    addButton: function(button, callback) {
        if (!this._buttonBox) {

            let box = new St.BoxLayout({ style_class: 'notification-actions' });
            this.setActionArea(box, { x_expand: false,
                                      y_expand: false,
                                      x_fill: false,
                                      y_fill: false,
                                      x_align: St.Align.END });
            this._buttonBox = box;
        }

        if (this._buttonBox.get_n_children() > 0)
            global.focus_manager.remove_group(this._buttonBox);

        this._buttonBox.add(button);
        global.focus_manager.add_group(this._buttonBox);
        button.connect('clicked', Lang.bind(this, function() {
            callback();

            if (!this.resident) {
                // We don't hide a resident notification when the user invokes one of its actions,
                // because it is common for such notifications to update themselves with new
                // information based on the action. We'd like to display the updated information
                // in place, rather than pop-up a new notification.
                this.emit('done-displaying');
                this.destroy();
            }
        }));

        this.updated();
        return button;
    },

    // addAction:
    // @label: the label for the action's button
    // @callback: the callback for the action
    //
    // Adds a button with the given @label to the notification. All
    // action buttons will appear in a single row at the bottom of
    // the notification.
    addAction: function(label, callback) {
        let button = new St.Button({ style_class: 'notification-button',
                                     label: label,
                                     can_focus: true });

        return this.addButton(button, callback);
    },

    setUrgency: function(urgency) {
        this.urgency = urgency;
    },

    setResident: function(resident) {
        this.resident = resident;
    },

    setTransient: function(isTransient) {
        this.isTransient = isTransient;
    },

    setForFeedback: function(forFeedback) {
        this.forFeedback = forFeedback;
    },

    _styleChanged: function() {
        this._spacing = this._table.get_theme_node().get_length('spacing-columns');
    },

    _bannerBoxGetPreferredWidth: function(actor, forHeight, alloc) {
        let [titleMin, titleNat] = this._titleLabel.get_preferred_width(forHeight);
        let [bannerMin, bannerNat] = this._bannerLabel.get_preferred_width(forHeight);

        if (this._secondaryIcon) {
            let [secondaryIconMin, secondaryIconNat] = this._secondaryIcon.get_preferred_width(forHeight);

            alloc.min_size = secondaryIconMin + this._spacing + titleMin;
            alloc.natural_size = secondaryIconNat + this._spacing + titleNat + this._spacing + bannerNat;
        } else {
            alloc.min_size = titleMin;
            alloc.natural_size = titleNat + this._spacing + bannerNat;
        }
    },

    _bannerBoxGetPreferredHeight: function(actor, forWidth, alloc) {
        [alloc.min_size, alloc.natural_size] =
            this._titleLabel.get_preferred_height(forWidth);
    },

    _bannerBoxAllocate: function(actor, box, flags) {
        let availWidth = box.x2 - box.x1;

        let [titleMinW, titleNatW] = this._titleLabel.get_preferred_width(-1);
        let [titleMinH, titleNatH] = this._titleLabel.get_preferred_height(availWidth);
        let [bannerMinW, bannerNatW] = this._bannerLabel.get_preferred_width(availWidth);

        let rtl = (this._titleDirection == Clutter.TextDirection.RTL);
        let x = rtl ? availWidth : 0;

        if (this._secondaryIcon) {
            let [iconMinW, iconNatW] = this._secondaryIcon.get_preferred_width(-1);
            let [iconMinH, iconNatH] = this._secondaryIcon.get_preferred_height(availWidth);

            let secondaryIconBox = new Clutter.ActorBox();
            let secondaryIconBoxW = Math.min(iconNatW, availWidth);

            // allocate secondary icon box
            if (rtl) {
                secondaryIconBox.x1 = x - secondaryIconBoxW;
                secondaryIconBox.x2 = x;
                x = x - (secondaryIconBoxW + this._spacing);
            } else {
                secondaryIconBox.x1 = x;
                secondaryIconBox.x2 = x + secondaryIconBoxW;
                x = x + secondaryIconBoxW + this._spacing;
            }
            secondaryIconBox.y1 = 0;
            // Using titleNatH ensures that the secondary icon is centered vertically
            secondaryIconBox.y2 = titleNatH;

            availWidth = availWidth - (secondaryIconBoxW + this._spacing);
            this._secondaryIcon.allocate(secondaryIconBox, flags);
        }

        let titleBox = new Clutter.ActorBox();
        let titleBoxW = Math.min(titleNatW, availWidth);
        if (rtl) {
            titleBox.x1 = availWidth - titleBoxW;
            titleBox.x2 = availWidth;
        } else {
            titleBox.x1 = x;
            titleBox.x2 = titleBox.x1 + titleBoxW;
        }
        titleBox.y1 = 0;
        titleBox.y2 = titleNatH;
        this._titleLabel.allocate(titleBox, flags);
        this._titleFitsInBannerMode = (titleNatW <= availWidth);

        let bannerFits = true;
        if (titleBoxW + this._spacing > availWidth) {
            this._bannerLabel.opacity = 0;
            bannerFits = false;
        } else {
            let bannerBox = new Clutter.ActorBox();

            if (rtl) {
                bannerBox.x1 = 0;
                bannerBox.x2 = titleBox.x1 - this._spacing;

                bannerFits = (bannerBox.x2 - bannerNatW >= 0);
            } else {
                bannerBox.x1 = titleBox.x2 + this._spacing;
                bannerBox.x2 = availWidth;

                bannerFits = (bannerBox.x1 + bannerNatW <= availWidth);
            }
            bannerBox.y1 = 0;
            bannerBox.y2 = titleNatH;
            this._bannerLabel.allocate(bannerBox, flags);

            // Make _bannerLabel visible if the entire notification
            // fits on one line, or if the notification is currently
            // unexpanded and only showing one line anyway.
            if (!this.expanded || (bannerFits && this._table.row_count == 1))
                this._bannerLabel.opacity = 255;
        }

        // If the banner doesn't fully fit in the banner box, we possibly need to add the
        // banner to the body. We can't do that from here though since that will force a
        // relayout, so we add it to the main loop.
        if (!bannerFits && this._canExpandContent())
            Meta.later_add(Meta.LaterType.BEFORE_REDRAW,
                           Lang.bind(this,
                                     function() {
                                        if (this._canExpandContent()) {
                                            this._addBannerBody();
                                            this._table.add_style_class_name('multi-line-notification');
                                            this.updated();
                                        }
                                        return false;
                                     }));
    },

    _canExpandContent: function() {
        return (this.bannerBodyText && !this._bannerBodyAdded) ||
               (!this._titleFitsInBannerMode && !this._table.has_style_class_name('multi-line-notification'));
    },

    playSound: function() {
        if (this._soundPlayed)
            return;

        if (!this.source.policy.enableSound) {
            this._soundPlayed = true;
            return;
        }

        if (this._soundName) {
            if (this.source.app) {
                let app = this.source.app;

                global.play_theme_sound_full(0, this._soundName,
                                             this.title, null,
                                             app.get_id(), app.get_name());
            } else {
                global.play_theme_sound(0, this._soundName, this.title, null);
            }
        } else if (this._soundFile) {
            if (this.source.app) {
                let app = this.source.app;

                global.play_sound_file_full(0, this._soundFile,
                                            this.title, null,
                                            app.get_id(), app.get_name());
            } else {
                global.play_sound_file(0, this._soundFile, this.title, null);
            }
        }
    },

    updated: function() {
        if (this.expanded)
            this.expand(false);
    },

    expand: function(animate) {
        this.expanded = true;
        this.actor.remove_style_class_name('notification-unexpanded');

        // Show additional content that we keep hidden in banner mode
        if (this._imageBin)
            this._imageBin.show();
        if (this._actionArea)
            this._actionArea.show();
        if (this._scrollArea)
            this._scrollArea.show();

        // The banner is never shown when the title did not fit, so this
        // can be an if-else statement.
        if (!this._titleFitsInBannerMode) {
            // Remove ellipsization from the title label and make it wrap so that
            // we show the full title when the notification is expanded.
            this._titleLabel.clutter_text.line_wrap = true;
            this._titleLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
            this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        } else if (this._table.row_count > 1 && this._bannerLabel.opacity != 0) {
            // We always hide the banner if the notification has additional content.
            //
            // We don't need to wrap the banner that doesn't fit the way we wrap the
            // title that doesn't fit because we won't have a notification with
            // row_count=1 that has a banner that doesn't fully fit. We'll either add
            // that banner to the content of the notification in _bannerBoxAllocate()
            // or the notification will have custom content.
            if (animate)
                Tweener.addTween(this._bannerLabel,
                                 { opacity: 0,
                                   time: ANIMATION_TIME,
                                   transition: 'easeOutQuad' });
            else
                this._bannerLabel.opacity = 0;
        }
        this.emit('expanded');
    },

    collapseCompleted: function() {
        if (this._destroyed)
            return;
        this.expanded = false;

        // Hide additional content that we keep hidden in banner mode
        if (this._imageBin)
            this._imageBin.hide();
        if (this._actionArea)
            this._actionArea.hide();
        if (this._scrollArea)
            this._scrollArea.hide();

        // Make sure we don't line wrap the title, and ellipsize it instead.
        this._titleLabel.clutter_text.line_wrap = false;
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        // Restore banner opacity in case the notification is shown in the
        // banner mode again on update.
        this._bannerLabel.opacity = 255;

        // Restore height requisition
        this.actor.add_style_class_name('notification-unexpanded');
        this.emit('collapsed');
    },

    _onClicked: function() {
        this.emit('clicked');
        // We hide all types of notifications once the user clicks on them because the common
        // outcome of clicking should be the relevant window being brought forward and the user's
        // attention switching to the window.
        this.emit('done-displaying');
        if (!this.resident)
            this.destroy();
    },

    _onDestroy: function() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        if (!this._destroyedReason)
            this._destroyedReason = NotificationDestroyedReason.DISMISSED;
        this.emit('destroy', this._destroyedReason);
    },

    destroy: function(reason) {
        this._destroyedReason = reason;
        this.actor.destroy();
        this.actor._delegate = null;
    }
});
Signals.addSignalMethods(Notification.prototype);

const SourceActor = new Lang.Class({
    Name: 'SourceActor',

    _init: function(source, size) {
        this._source = source;
        this._size = size;

        this.actor = new Shell.GenericContainer();
        this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
        this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
        this.actor.connect('allocate', Lang.bind(this, this._allocate));
        this.actor.connect('destroy', Lang.bind(this, function() {
            this._actorDestroyed = true;
        }));
        this._actorDestroyed = false;

        this._counterLabel = new St.Label( {x_align: Clutter.ActorAlign.CENTER,
                                            x_expand: true,
                                            y_align: Clutter.ActorAlign.CENTER,
                                            y_expand: true });

        this._counterBin = new St.Bin({ style_class: 'summary-source-counter',
                                        child: this._counterLabel,
                                        layout_manager: new Clutter.BinLayout() });
        this._counterBin.hide();

        this._counterBin.connect('style-changed', Lang.bind(this, function() {
            let themeNode = this._counterBin.get_theme_node();
            this._counterBin.translation_x = themeNode.get_length('-shell-counter-overlap-x');
            this._counterBin.translation_y = themeNode.get_length('-shell-counter-overlap-y');
        }));

        this._iconBin = new St.Bin({ width: size,
                                     height: size,
                                     x_fill: true,
                                     y_fill: true });

        this.actor.add_actor(this._iconBin);
        this.actor.add_actor(this._counterBin);

        this._source.connect('count-updated', Lang.bind(this, this._updateCount));
        this._updateCount();

        this._source.connect('icon-updated', Lang.bind(this, this._updateIcon));
        this._updateIcon();
    },

    setIcon: function(icon) {
        this._iconBin.child = icon;
        this._iconSet = true;
    },

    get source() {
        return this._source;
    },

    _getPreferredWidth: function (actor, forHeight, alloc) {
        let [min, nat] = this._iconBin.get_preferred_width(forHeight);
        alloc.min_size = min; alloc.nat_size = nat;
    },

    _getPreferredHeight: function (actor, forWidth, alloc) {
        let [min, nat] = this._iconBin.get_preferred_height(forWidth);
        alloc.min_size = min; alloc.nat_size = nat;
    },

    _allocate: function(actor, box, flags) {
        // the iconBin should fill our entire box
        this._iconBin.allocate(box, flags);

        let childBox = new Clutter.ActorBox();

        let [minWidth, minHeight, naturalWidth, naturalHeight] = this._counterBin.get_preferred_size();
        let direction = this.actor.get_text_direction();

        if (direction == Clutter.TextDirection.LTR) {
            // allocate on the right in LTR
            childBox.x1 = box.x2 - naturalWidth;
            childBox.x2 = box.x2;
        } else {
            // allocate on the left in RTL
            childBox.x1 = 0;
            childBox.x2 = naturalWidth;
        }

        childBox.y1 = box.y2 - naturalHeight;
        childBox.y2 = box.y2;

        this._counterBin.allocate(childBox, flags);
    },

    _updateIcon: function() {
        if (this._actorDestroyed)
            return;

        if (!this._iconSet)
            this._iconBin.child = this._source.createIcon(this._size);
    },

    _updateCount: function() {
        if (this._actorDestroyed)
            return;

        this._counterBin.visible = this._shouldShowCount();

        let text;
        if (this._source.count < 100)
            text = this._source.count.toString();
        else
            text = String.fromCharCode(0x22EF); // midline horizontal ellipsis

        this._counterLabel.set_text(text);
    },

    _shouldShowCount: function() {
        return this._source.count > 1;
    }
});

const Source = new Lang.Class({
    Name: 'MessageTraySource',

    SOURCE_ICON_SIZE: 48,

    _init: function(title, iconName) {
        this.title = title;
        this.iconName = iconName;

        this.isTransient = false;
        this.isChat = false;
        this.isMuted = false;
        this.keepTrayOnSummaryClick = false;

        this.notifications = [];

        this.policy = new NotificationPolicy();
    },

    get count() {
        return this.notifications.length;
    },

    get indicatorCount() {
        let notifications = this.notifications.filter(function(n) { return !n.isTransient && !n.resident; });
        return notifications.length;
    },

    get unseenCount() {
        return this.notifications.filter(function(n) { return !n.acknowledged; }).length;
    },

    countUpdated: function() {
        this.emit('count-updated');
    },

    buildRightClickMenu: function() {
        let item;
        let rightClickMenu = new St.BoxLayout({ name: 'summary-right-click-menu',
                                                vertical: true });

        item = new PopupMenu.PopupMenuItem(_("Open"));
        item.connect('activate', Lang.bind(this, function() {
            this.open();
            this.emit('done-displaying-content', true);
        }));
        rightClickMenu.add(item.actor);

        item = new PopupMenu.PopupMenuItem(_("Remove"));
        item.connect('activate', Lang.bind(this, function() {
            this.destroy();
            this.emit('done-displaying-content', false);
        }));
        rightClickMenu.add(item.actor);
        return rightClickMenu;
    },

    setTransient: function(isTransient) {
        this.isTransient = isTransient;
    },

    setTitle: function(newTitle) {
        this.title = newTitle;
        this.emit('title-changed');
    },

    setMuted: function(muted) {
        if (!this.isChat || this.isMuted == muted)
            return;
        this.isMuted = muted;
        this.emit('muted-changed');
    },

    // Called to create a new icon actor.
    // Provides a sane default implementation, override if you need
    // something more fancy.
    createIcon: function(size) {
        return new St.Icon({ gicon: this.getIcon(),
                             icon_size: size });
    },

    getIcon: function() {
        return new Gio.ThemedIcon({ name: this.iconName });
    },

    _ensureMainIcon: function() {
        if (this._mainIcon)
            return;

        this._mainIcon = new SourceActor(this, this.SOURCE_ICON_SIZE);
    },

    // Unlike createIcon, this always returns the same actor;
    // there is only one summary icon actor for a Source.
    getSummaryIcon: function() {
        this._ensureMainIcon();
        return this._mainIcon.actor;
    },

    pushNotification: function(notification) {
        if (this.notifications.indexOf(notification) < 0) {
            this.notifications.push(notification);
            this.emit('notification-added', notification);
        }

        notification.connect('destroy', Lang.bind(this,
            function () {
                let index = this.notifications.indexOf(notification);
                if (index < 0)
                    return;

                this.notifications.splice(index, 1);
                if (this.notifications.length == 0)
                    this._lastNotificationRemoved();

                this.countUpdated();
            }));

        this.countUpdated();
    },

    notify: function(notification) {
        notification.acknowledged = false;
        this.pushNotification(notification);

        if (!this.isMuted) {
            // Play the sound now, if banners are disabled.
            // Otherwise, it will be played when the notification
            // is next shown.
            if (this.policy.showBanners) {
                this.emit('notify', notification);
            } else {
                notification.playSound();
            }
        }
    },

    destroy: function(reason) {
        this.policy.destroy();
        this.emit('destroy', reason);
    },

    // A subclass can redefine this to "steal" clicks from the
    // summaryitem; Use Clutter.get_current_event() to get the
    // details, return true to prevent the default handling from
    // ocurring.
    handleSummaryClick: function() {
        return false;
    },

    iconUpdated: function() {
        this.emit('icon-updated');
    },

    //// Protected methods ////
    _setSummaryIcon: function(icon) {
        this._ensureMainIcon();
        this._mainIcon.setIcon(icon);
        this.iconUpdated();
    },

    open: function(notification) {
        this.emit('opened', notification);
    },

    destroyNonResidentNotifications: function() {
        for (let i = this.notifications.length - 1; i >= 0; i--)
            if (!this.notifications[i].resident)
                this.notifications[i].destroy();

        this.countUpdated();
    },

    // Default implementation is to destroy this source, but subclasses can override
    _lastNotificationRemoved: function() {
        this.destroy();
    },

    hasResidentNotification: function() {
        return this.notifications.some(function(n) { return n.resident; });
    },

    getMusicNotification: function() {
        for (let i = 0; i < this.notifications.length; i++) {
            if (this.notifications[i].isMusic)
                return this.notifications[i];
        }

        return null;
    },
});
Signals.addSignalMethods(Source.prototype);

const SummaryItem = new Lang.Class({
    Name: 'SummaryItem',

    _init: function(source) {
        this.source = source;
        this.source.connect('notification-added', Lang.bind(this, this._notificationAddedToSource));

        this.actor = new St.Button({ style_class: 'summary-source-button',
                                     y_fill: true,
                                     reactive: true,
                                     button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
                                     can_focus: true,
                                     track_hover: true });
        this.actor.label_actor = new St.Label({ text: source.title });
        this.actor.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        this._sourceBox = new St.BoxLayout({ style_class: 'summary-source' });

        this._sourceIcon = source.getSummaryIcon();
        this._sourceBox.add(this._sourceIcon, { y_fill: false });
        this.actor.child = this._sourceBox;

        this.notificationStackWidget = new St.Widget({ layout_manager: new Clutter.BinLayout() });

        this.notificationStackView = new St.ScrollView({ style_class: source.isChat ? '' : 'summary-notification-stack-scrollview',
                                                         vscrollbar_policy: source.isChat ? Gtk.PolicyType.NEVER : Gtk.PolicyType.AUTOMATIC,
                                                         hscrollbar_policy: Gtk.PolicyType.NEVER });
        this.notificationStackView.add_style_class_name('vfade');
        this.notificationStack = new St.BoxLayout({ style_class: 'summary-notification-stack',
                                                    vertical: true });
        this.notificationStackView.add_actor(this.notificationStack);
        this.notificationStackWidget.add_actor(this.notificationStackView);

        this.closeButton = CloseButton.makeCloseButton();
        this.notificationStackWidget.add_actor(this.closeButton);
        this._stackedNotifications = [];

        this._oldMaxScrollAdjustment = 0;

        this.notificationStackView.vscroll.adjustment.connect('changed', Lang.bind(this, function(adjustment) {
            let currentValue = adjustment.value + adjustment.page_size;
            if (currentValue == this._oldMaxScrollAdjustment)
                this.scrollTo(St.Side.BOTTOM);
            this._oldMaxScrollAdjustment = adjustment.upper;
        }));

        this.rightClickMenu = source.buildRightClickMenu();
        if (this.rightClickMenu)
            global.focus_manager.add_group(this.rightClickMenu);
    },

    destroy: function() {
        // remove the actor from the summary item so it doesn't get destroyed
        // with us
        this._sourceBox.remove_actor(this._sourceIcon);

        this.actor.destroy();
    },

    _onKeyPress: function(actor, event) {
        if (event.get_key_symbol() == Clutter.KEY_Up) {
            actor.emit('clicked', 1);
            return true;
        }
        return false;
    },

    prepareNotificationStackForShowing: function() {
        if (this.notificationStack.get_n_children() > 0)
            return;

        for (let i = 0; i < this.source.notifications.length; i++) {
            this._appendNotificationToStack(this.source.notifications[i]);
        }

        this.scrollTo(St.Side.BOTTOM);
    },

    doneShowingNotificationStack: function() {
        for (let i = 0; i < this._stackedNotifications.length; i++) {
            let stackedNotification = this._stackedNotifications[i];
            let notification = stackedNotification.notification;
            notification.collapseCompleted();
            notification.disconnect(stackedNotification.notificationExpandedId);
            notification.disconnect(stackedNotification.notificationDoneDisplayingId);
            notification.disconnect(stackedNotification.notificationDestroyedId);
            if (notification.actor.get_parent() == this.notificationStack)
                this.notificationStack.remove_actor(notification.actor);
            notification.setIconVisible(true);
            notification.enableScrolling(true);
        }
        this._stackedNotifications = [];
    },

    _notificationAddedToSource: function(source, notification) {
        if (this.notificationStack.mapped)
            this._appendNotificationToStack(notification);
    },

    _appendNotificationToStack: function(notification) {
        let stackedNotification = {};
        stackedNotification.notification = notification;
        stackedNotification.notificationExpandedId = notification.connect('expanded', Lang.bind(this, this._contentUpdated));
        stackedNotification.notificationDoneDisplayingId = notification.connect('done-displaying', Lang.bind(this, this._notificationDoneDisplaying));
        stackedNotification.notificationDestroyedId = notification.connect('destroy', Lang.bind(this, this._notificationDestroyed));
        this._stackedNotifications.push(stackedNotification);
        if (!this.source.isChat)
            notification.enableScrolling(false);
        if (this.notificationStack.get_n_children() > 0)
            notification.setIconVisible(false);
        this.notificationStack.add(notification.actor);
        notification.expand(false);
    },

    // scrollTo:
    // @side: St.Side.TOP or St.Side.BOTTOM
    //
    // Scrolls the notifiction stack to the indicated edge
    scrollTo: function(side) {
        let adjustment = this.notificationStackView.vscroll.adjustment;
        if (side == St.Side.TOP)
            adjustment.value = adjustment.lower;
        else if (side == St.Side.BOTTOM)
            adjustment.value = adjustment.upper;
    },

    _contentUpdated: function() {
        this.emit('content-updated');
    },

    _notificationDoneDisplaying: function() {
        this.source.emit('done-displaying-content', true);
    },

    _notificationDestroyed: function(notification) {
        for (let i = 0; i < this._stackedNotifications.length; i++) {
            if (this._stackedNotifications[i].notification == notification) {
                let stackedNotification = this._stackedNotifications[i];
                notification.disconnect(stackedNotification.notificationExpandedId);
                notification.disconnect(stackedNotification.notificationDoneDisplayingId);
                notification.disconnect(stackedNotification.notificationDestroyedId);
                this._stackedNotifications.splice(i, 1);
                if (notification.actor.get_parent() == this.notificationStack)
                    this.notificationStack.remove_actor(notification.actor);
                this._contentUpdated();
                break;
            }
        }

        let firstNotification = this._stackedNotifications[0];
        if (firstNotification)
            firstNotification.notification.setIconVisible(true);
    }
});
Signals.addSignalMethods(SummaryItem.prototype);

const MessageTrayContextMenu = new Lang.Class({
    Name: 'MessageTrayContextMenu',
    Extends: PopupMenu.PopupMenu,

    _init: function(tray) {
        this._dummy = new St.Bin({ opacity: 0 });
        Main.uiGroup.add_actor(this._dummy);

        this.parent(this._dummy, 0, St.Side.BOTTOM);
        this._tray = tray;

        this._clearItem = this.addAction(_("Clear Messages"), function() {
            let toDestroy = [];
            let sources = tray.getSources();
            for (let i = 0; i < sources.length; i++) {
                // We exclude trayIcons, chat and resident sources
                if (sources[i].trayIcon ||
                    sources[i].isChat ||
                    sources[i].resident)
                    continue;
                toDestroy.push(sources[i]);
            }

            for (let i = 0; i < toDestroy.length; i++) {
                toDestroy[i].destroy();
            }

            toDestroy = null;
            tray.close();
        });

        tray.connect('source-added', Lang.bind(this, this._updateClearSensitivity));
        tray.connect('source-removed', Lang.bind(this, this._updateClearSensitivity));
        this._updateClearSensitivity();

        let separator = new PopupMenu.PopupSeparatorMenuItem();
        this.addMenuItem(separator);

        let settingsItem = this.addSettingsAction(_("Notification Settings"), 'gnome-notifications-panel.desktop');
        settingsItem.connect('activate', function() { tray.close(); });
    },

    _updateClearSensitivity: function() {
        let sources = this._tray.getSources();
        sources = sources.filter(function(source) {
            return !source.trayIcon && !source.isChat && !source.resident;
        });
        this._clearItem.setSensitive(sources.length > 0);
    },

    setPosition: function(x, y) {
        this._dummy.set_position(x, y);
    }

});

const MessageTray = new Lang.Class({
    Name: 'MessageTray',

    _init: function() {
        this._presence = new GnomeSession.Presence(Lang.bind(this, function(proxy, error) {
            this._onStatusChanged(proxy.status);
        }));
        this._busy = false;
        this._presence.connectSignal('StatusChanged', Lang.bind(this, function(proxy, senderName, [status]) {
            this._onStatusChanged(status);
        }));

        this.actor = new St.Widget({ name: 'message-tray',
                                     reactive: true,
                                     track_hover: true,
                                     layout_manager: new Clutter.BinLayout(),
                                     x_expand: true,
                                     y_expand: true,
                                     y_align: Clutter.ActorAlign.START,
                                   });
        this.actor.connect('notify::hover', Lang.bind(this, this._onTrayHoverChanged));
        this._trayBox = new St.Widget ({ name: 'message-tray-box',
                                         x_expand: true,
                                         y_expand: true,
                                         layout_manager: new Clutter.BinLayout(),
                                         y_align: Clutter.ActorAlign.START });
        this.actor.add_actor(this._trayBox);

        this._notificationWidget = new St.Widget({ name: 'notification-container',
                                                   y_align: Clutter.ActorAlign.START,
                                                   x_align: Clutter.ActorAlign.CENTER,
                                                   y_expand: true,
                                                   x_expand: true,
                                                   layout_manager: new Clutter.BinLayout() });
        this._notificationWidget.connect('key-release-event', Lang.bind(this, this._onNotificationKeyRelease));

        this._trayBox.add_actor(this._notificationWidget);

        this._notificationBin = new St.Bin({ y_expand: true });
        this._notificationBin.set_y_align(Clutter.ActorAlign.START);
        this._notificationWidget.add_actor(this._notificationBin);
        this._notificationWidget.hide();
        this._notificationFocusGrabber = new FocusGrabber(this._notificationWidget);
        this._notificationQueue = [];
        this._notification = null;
        this._notificationClickedId = 0;

        this.actor.connect('button-release-event', Lang.bind(this, function(actor, event) {
            this._setClickedSummaryItem(null);
            this._updateState();
            actor.grab_key_focus();
        }));
        global.focus_manager.add_group(this.actor);
        this._summary = new St.BoxLayout({ style_class: 'message-tray-summary',
                                           reactive: true,
                                           x_align: Clutter.ActorAlign.END,
                                           x_expand: true,
                                           y_align: Clutter.ActorAlign.CENTER,
                                           y_expand: true });
        this._trayBox.add_actor(this._summary);

        this._summaryMotionId = 0;

        this._summaryBoxPointer = new BoxPointer.BoxPointer(St.Side.BOTTOM,
                                                            { reactive: true,
                                                              track_hover: true });
        this._summaryBoxPointer.actor.connect('key-press-event',
                                              Lang.bind(this, this._onSummaryBoxPointerKeyPress));
        this._summaryBoxPointer.actor.style_class = 'summary-boxpointer';
        this._summaryBoxPointer.actor.hide();
        Main.layoutManager.addChrome(this._summaryBoxPointer.actor);

        this._summaryBoxPointerItem = null;
        this._summaryBoxPointerContentUpdatedId = 0;
        this._summaryBoxPointerDoneDisplayingId = 0;
        this._clickedSummaryItem = null;
        this._clickedSummaryItemMouseButton = -1;
        this._clickedSummaryItemAllocationChangedId = 0;

        this._closeButton = CloseButton.makeCloseButton();
        this._closeButton.hide();
        this._closeButton.connect('clicked', Lang.bind(this, this._closeNotification));
        this._notificationWidget.add_actor(this._closeButton);

        this._userActiveWhileNotificationShown = false;

        this.idleMonitor = Meta.IdleMonitor.get_core();

        this._grabHelper = new GrabHelper.GrabHelper(this.actor,
                                                     { keybindingMode: Shell.KeyBindingMode.MESSAGE_TRAY });
        this._grabHelper.addActor(this._summaryBoxPointer.actor);
        this._grabHelper.addActor(this.actor);

        Main.layoutManager.connect('keyboard-visible-changed', Lang.bind(this, this._onKeyboardVisibleChanged));

        this._trayState = State.HIDDEN;
        this._traySummoned = false;
        this._useLongerTrayLeftTimeout = false;
        this._trayLeftTimeoutId = 0;

        // pointerInTray is sort of a misnomer -- it tracks whether
        // a message tray notification should expand. The value is
        // partially driven by the hover state of the tray, but has
        // a lot of complex state related to timeouts and the current
        // state of the pointer when a notification pops up.
        this._pointerInTray = false;

        // This tracks this.actor.hover and is used to fizzle
        // out non-changing hover notifications in onTrayHoverChanged.
        this._trayHovered = false;

        this._keyboardVisible = false;
        this._notificationClosed = false;
        this._notificationState = State.HIDDEN;
        this._notificationTimeoutId = 0;
        this._notificationExpandedId = 0;
        this._summaryBoxPointerState = State.HIDDEN;
        this._summaryBoxPointerTimeoutId = 0;
        this._desktopCloneState = State.HIDDEN;
        this._notificationRemoved = false;
        this._reNotifyAfterHideNotification = null;
        this._desktopClone = null;
        this._inCtrlAltTab = false;

        this._lightbox = new Lightbox.Lightbox(Main.layoutManager.overviewGroup,
                                               { inhibitEvents: true,
                                                 fadeInTime: ANIMATION_TIME,
                                                 fadeOutTime: ANIMATION_TIME,
                                                 fadeFactor: 0.2
                                               });

        Main.layoutManager.trayBox.add_actor(this.actor);
        Main.layoutManager.trackChrome(this.actor);
        Main.layoutManager.trackChrome(this._notificationWidget);
        Main.layoutManager.trackChrome(this._closeButton);

        global.screen.connect('in-fullscreen-changed', Lang.bind(this, this._updateState));
        Main.layoutManager.connect('hot-corners-changed', Lang.bind(this, this._hotCornersChanged));

        // If the overview shows or hides while we're in
        // the message tray, revert back to normal mode.
        Main.overview.connect('showing', Lang.bind(this, this._escapeTray));
        Main.overview.connect('hiding', Lang.bind(this, this._escapeTray));

        Main.sessionMode.connect('updated', Lang.bind(this, this._sessionUpdated));

        Main.wm.addKeybinding('toggle-message-tray',
                              new Gio.Settings({ schema: SHELL_KEYBINDINGS_SCHEMA }),
                              Meta.KeyBindingFlags.NONE,
                              Shell.KeyBindingMode.NORMAL |
                              Shell.KeyBindingMode.MESSAGE_TRAY |
                              Shell.KeyBindingMode.OVERVIEW,
                              Lang.bind(this, this.toggleAndNavigate));
        Main.wm.addKeybinding('focus-active-notification',
                              new Gio.Settings({ schema: SHELL_KEYBINDINGS_SCHEMA }),
                              Meta.KeyBindingFlags.NONE,
                              Shell.KeyBindingMode.NORMAL |
                              Shell.KeyBindingMode.MESSAGE_TRAY |
                              Shell.KeyBindingMode.OVERVIEW,
                              Lang.bind(this, this._expandActiveNotification));

        this._sources = new Map();
        this._chatSummaryItemsCount = 0;

        this._trayDwellTimeoutId = 0;

        // Disable the message tray popup
        // this._setupTrayDwellIfNeeded();

        this._sessionUpdated();
        this._hotCornersChanged();

        this._noMessages = new St.Label({ text: _("No Messages"),
                                          style_class: 'no-messages-label',
                                          x_align: Clutter.ActorAlign.CENTER,
                                          x_expand: true,
                                          y_align: Clutter.ActorAlign.CENTER,
                                          y_expand: true });
        this._trayBox.add_actor(this._noMessages);
        this._updateNoMessagesLabel();

        this._contextMenu = new MessageTrayContextMenu(this);

        let clickAction = new Clutter.ClickAction();
        this.actor.add_action(clickAction);

        clickAction.connect('clicked', Lang.bind(this, function(action) {
            let button = action.get_button();
            if (button == Gdk.BUTTON_SECONDARY) {
                this._openContextMenu();
            }
            if (button == Gdk.BUTTON_PRIMARY && this._contextMenu.isOpen) {
                this._grabHelper.ungrab({ actor: this._contextMenu.actor });
            }
        }));

        clickAction.connect('long-press', Lang.bind(this, function(action, actor, state) {
            switch (state) {
            case Clutter.LongPressState.QUERY:
                return true;
            case Clutter.LongPressState.ACTIVATE:
                this._openContextMenu();
            }
            return false;
        }));

        this._contextMenu.actor.hide();
        Main.layoutManager.addChrome(this._contextMenu.actor);

    },

    _openContextMenu: function () {
        let [x, y, mask] = global.get_pointer();
        this._contextMenu.setPosition(Math.round(x), Math.round(y));
        this._grabHelper.grab({ actor: this._contextMenu.actor,
                                onUngrab: Lang.bind(this, function () {
                                    this._contextMenu.close(BoxPointer.PopupAnimation.FULL);
                                })
        });
        this._contextMenu.open(BoxPointer.PopupAnimation.FULL);
    },

    close: function() {
        this._escapeTray();
    },

    _setupTrayDwellIfNeeded: function() {
        // If we don't have extended barrier features, then we need
        // to support the old tray dwelling mechanism.
        if (!global.display.supports_extended_barriers()) {
            let pointerWatcher = PointerWatcher.getPointerWatcher();
            pointerWatcher.addWatch(TRAY_DWELL_CHECK_INTERVAL, Lang.bind(this, this._checkTrayDwell));
            this._trayDwelling = false;
            this._trayDwellUserTime = 0;
        }
    },

    _updateNoMessagesLabel: function() {
        this._noMessages.visible = this._sources.size == 0;
    },

    _sessionUpdated: function() {
        if ((Main.sessionMode.isLocked || Main.sessionMode.isGreeter) && this._inCtrlAltTab) {
            Main.ctrlAltTabManager.removeGroup(this._summary);
            this._inCtrlAltTab = false;
        } else if (!this._inCtrlAltTab) {
            Main.ctrlAltTabManager.addGroup(this._summary, _("Message Tray"), 'user-available-symbolic',
                                            { focusCallback: Lang.bind(this, this.toggleAndNavigate),
                                              sortGroup: CtrlAltTab.SortGroup.BOTTOM });
            this._inCtrlAltTab = true;
        }
        this._updateState();
    },

    _checkTrayDwell: function(x, y) {
        let monitor = Main.layoutManager.bottomMonitor;
        let shouldDwell = (x >= monitor.x && x <= monitor.x + monitor.width &&
                           y == monitor.y + monitor.height - 1);
        if (shouldDwell) {
            // We only set up dwell timeout when the user is not hovering over the tray
            // (!this.actor.hover). This avoids bringing up the message tray after the
            // user clicks on a notification with the pointer on the bottom pixel
            // of the monitor. The _trayDwelling variable is used so that we only try to
            // fire off one tray dwell - if it fails (because, say, the user has the mouse down),
            // we don't try again until the user moves the mouse up and down again.
            if (!this._trayDwelling && !this.actor.hover && this._trayDwellTimeoutId == 0) {
                // Save the interaction timestamp so we can detect user input
                let focusWindow = global.display.focus_window;
                this._trayDwellUserTime = focusWindow ? focusWindow.user_time : 0;

                this._trayDwellTimeoutId = Mainloop.timeout_add(TRAY_DWELL_TIME,
                                                                Lang.bind(this, this._trayDwellTimeout));
            }
            this._trayDwelling = true;
        } else {
            this._cancelTrayDwell();
            this._trayDwelling = false;
        }
    },

    _cancelTrayDwell: function() {
        if (this._trayDwellTimeoutId != 0) {
            Mainloop.source_remove(this._trayDwellTimeoutId);
            this._trayDwellTimeoutId = 0;
        }
    },

    _trayDwellTimeout: function() {
        this._trayDwellTimeoutId = 0;

        if (Main.layoutManager.bottomMonitor.inFullscreen)
            return false;

        // We don't want to open the tray when a modal dialog
        // is up, so we check the modal count for that. When we are in the
        // overview we have to take the overview's modal push into account
        if (Main.modalCount > (Main.overview.visible ? 1 : 0))
            return false;

        // If the user interacted with the focus window since we started the tray
        // dwell (by clicking or typing), don't activate the message tray
        let focusWindow = global.display.focus_window;
        let currentUserTime = focusWindow ? focusWindow.user_time : 0;
        if (currentUserTime != this._trayDwellUserTime)
            return false;

        this.openTray();
        return false;
    },

    _onNotificationKeyRelease: function(actor, event) {
        if (event.get_key_symbol() == Clutter.KEY_Escape && event.get_state() == 0) {
            this._closeNotification();
            return true;
        }

        return false;
    },

    _closeNotification: function() {
        if (this._notificationState == State.SHOWN) {
            this._closeButton.hide();
            this._notificationClosed = true;
            this._updateState();
            this._notificationClosed = false;
        }
    },

    contains: function(source) {
        return this._sources.has(source);
    },

    add: function(source) {
        if (this.contains(source)) {
            log('Trying to re-add source ' + source.title);
            return;
        }

        // Register that we got a notification for this source
        source.policy.store();

        source.policy.connect('enable-changed', Lang.bind(this, this._onSourceEnableChanged, source));
        source.policy.connect('policy-changed', Lang.bind(this, this._updateState));
        this._onSourceEnableChanged(source.policy, source);
    },

    _addSource: function(source) {
        let obj = {
            source: source,
            summaryItem: new SummaryItem(source),
            notifyId: 0,
            destroyId: 0,
            mutedChangedId: 0
        };
        let summaryItem = obj.summaryItem;

        if (source.isChat) {
            this._summary.insert_child_at_index(summaryItem.actor, 0);
            this._chatSummaryItemsCount++;
        } else {
            this._summary.insert_child_at_index(summaryItem.actor, this._chatSummaryItemsCount);
        }

        this._sources.set(source, obj);

        obj.notifyId = source.connect('notify', Lang.bind(this, this._onNotify));
        obj.destroyId = source.connect('destroy', Lang.bind(this, this._onSourceDestroy));
        obj.mutedChangedId = source.connect('muted-changed', Lang.bind(this,
            function () {
                if (source.isMuted)
                    this._notificationQueue = this._notificationQueue.filter(function(notification) {
                        return source != notification.source;
                    });
            }));

        summaryItem.actor.connect('clicked', Lang.bind(this,
            function(actor, button) {
                actor.grab_key_focus();
                this._onSummaryItemClicked(summaryItem, button);
            }));
        summaryItem.actor.connect('popup-menu', Lang.bind(this,
            function(actor, button) {
                actor.grab_key_focus();
                this._onSummaryItemClicked(summaryItem, 3);
            }));

        // We need to display the newly-added summary item, but if the
        // caller is about to post a notification, we want to show that
        // *first* and not show the summary item until after it hides.
        // So postpone calling _updateState() a tiny bit.
        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this, function() { this._updateState(); return false; }));

        this.emit('source-added', source);

        this._updateNoMessagesLabel();
    },

    _removeSource: function(source) {
        let obj = this._sources.get(source);
        this._sources.delete(source);
        let summaryItem = obj.summaryItem;

        if (source.isChat)
            this._chatSummaryItemsCount--;

        source.disconnect(obj.notifyId);
        source.disconnect(obj.destroyId);
        source.disconnect(obj.mutedChangedId);

        let needUpdate = false;

        if (this._notification && this._notification.source == source) {
            this._updateNotificationTimeout(0);
            this._notificationRemoved = true;
            needUpdate = true;
        }
        if (this._clickedSummaryItem == summaryItem) {
            this._setClickedSummaryItem(null);
            needUpdate = true;
        }

        summaryItem.destroy();

        this.emit('source-removed', source);

        this._updateNoMessagesLabel();

        if (needUpdate)
            this._updateState();
    },

    getSources: function() {
        return [k for (k of this._sources.keys())];
    },

    _onSourceEnableChanged: function(policy, source) {
        let wasEnabled = this.contains(source);
        let shouldBeEnabled = policy.enable;

        if (wasEnabled != shouldBeEnabled) {
            if (shouldBeEnabled)
                this._addSource(source);
            else
                this._removeSource(source);
        }
    },

    _onSourceDestroy: function(source) {
        this._removeSource(source);
    },

    _onNotificationDestroy: function(notification) {
        if (this._notification == notification && (this._notificationState == State.SHOWN || this._notificationState == State.SHOWING)) {
            this._updateNotificationTimeout(0);
            this._notificationRemoved = true;
            this._updateState();
            return;
        }

        let index = this._notificationQueue.indexOf(notification);
        notification.destroy();
        if (index != -1)
            this._notificationQueue.splice(index, 1);
    },

    openTray: function() {
        if (Main.overview.animationInProgress)
            return;

        this._traySummoned = true;
        this._updateState();
    },

    toggle: function() {
        if (Main.overview.animationInProgress)
            return false;

        this._traySummoned = !this._traySummoned;
        this._updateState();
        return true;
    },

    toggleAndNavigate: function() {
        if (this.toggle())
            this._summary.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    },

    hide: function() {
        this._traySummoned = false;
        this.actor.set_hover(false);
        this._updateState();
    },

    _onNotify: function(source, notification) {
        if (this._summaryBoxPointerItem && this._summaryBoxPointerItem.source == source) {
            if (this._summaryBoxPointerState == State.HIDING) {
                // We are in the process of hiding the summary box pointer.
                // If there is an update for one of the notifications or
                // a new notification to be added to the notification stack
                // while it is in the process of being hidden, we show it as
                // a new notification. However, we first wait till the hide
                // is complete. This is especially important if one of the
                // notifications in the stack was updated because we will
                // need to be able to re-parent its actor to a different
                // part of the stage.
                this._reNotifyAfterHideNotification = notification;
            } else {
                // The summary box pointer is showing or shown (otherwise,
                // this._summaryBoxPointerItem would be null)
                // Immediately mark the notification as acknowledged and play its
                // sound, as it's not going into the queue
                notification.acknowledged = true;
                notification.playSound();
            }

            return;
        }

        if (this._notification == notification) {
            // If a notification that is being shown is updated, we update
            // how it is shown and extend the time until it auto-hides.
            // If a new notification is updated while it is being hidden,
            // we stop hiding it and show it again.
            this._updateShowingNotification();
        } else if (this._notificationQueue.indexOf(notification) < 0) {
            notification.connect('destroy',
                                 Lang.bind(this, this._onNotificationDestroy));
            this._notificationQueue.push(notification);
            this._notificationQueue.sort(function(notification1, notification2) {
                return (notification2.urgency - notification1.urgency);
            });
        }
        this._updateState();
    },

    _onSummaryItemClicked: function(summaryItem, button) {
        if (summaryItem.source.handleSummaryClick(button)) {
            if (summaryItem.source.keepTrayOnSummaryClick)
                this._setClickedSummaryItem(null);
            else
                this._escapeTray();
        } else {
            if (!this._setClickedSummaryItem(summaryItem, button))
                this._setClickedSummaryItem(null);
        }

        this._updateState();
    },

    _hotCornersChanged: function() {
        let primary = Main.layoutManager.primaryIndex;
        let corner = Main.layoutManager.hotCorners[primary];
        if (corner && corner.actor)
            this._grabHelper.addActor(corner.actor);
    },

    _onTrayHoverChanged: function() {
        if (this.actor.hover == this._trayHovered)
            return;

        this._trayHovered = this.actor.hover;
        if (this._trayHovered) {
            // No dwell inside notifications at the bottom of the screen
            this._cancelTrayDwell();

            // Don't do anything if the one pixel area at the bottom is hovered over while the tray is hidden.
            if (this._trayState == State.HIDDEN && this._notificationState == State.HIDDEN)
                return;

            this._useLongerTrayLeftTimeout = false;
            if (this._trayLeftTimeoutId) {
                Mainloop.source_remove(this._trayLeftTimeoutId);
                this._trayLeftTimeoutId = 0;
                this._trayLeftMouseX = -1;
                this._trayLeftMouseY = -1;
                return;
            }

            if (this._showNotificationMouseX >= 0) {
                let actorAtShowNotificationPosition =
                    global.stage.get_actor_at_pos(Clutter.PickMode.ALL, this._showNotificationMouseX, this._showNotificationMouseY);
                this._showNotificationMouseX = -1;
                this._showNotificationMouseY = -1;
                // Don't set this._pointerInTray to true if the pointer was initially in the area where the notification
                // popped up. That way we will not be expanding notifications that happen to pop up over the pointer
                // automatically. Instead, the user is able to expand the notification by mousing away from it and then
                // mousing back in. Because this is an expected action, we set the boolean flag that indicates that a longer
                // timeout should be used before popping down the notification.
                if (this.actor.contains(actorAtShowNotificationPosition)) {
                    this._useLongerTrayLeftTimeout = true;
                    return;
                }
            }
            this._pointerInTray = true;
            this._updateState();
        } else {
            // We record the position of the mouse the moment it leaves the tray. These coordinates are used in
            // this._onTrayLeftTimeout() to determine if the mouse has moved far enough during the initial timeout for us
            // to consider that the user intended to leave the tray and therefore hide the tray. If the mouse is still
            // close to its previous position, we extend the timeout once.
            let [x, y, mods] = global.get_pointer();
            this._trayLeftMouseX = x;
            this._trayLeftMouseY = y;

            if (this._notification && this._notification.ignoreHover) {
                // the notification will not be hidden if the pointer leaves it
                // but we need to handle the focus properly in that case
                this._notificationFocusGrabber.ungrabFocus();
                this._pointerInTray = false;
            } else {
                // We wait just a little before hiding the message tray in case the user quickly moves the mouse back into it.
                // We wait for a longer period if the notification popped up where the mouse pointer was already positioned.
                // That gives the user more time to mouse away from the notification and mouse back in in order to expand it.
                let timeout = this._useLongerTrayLeftTimeout ? LONGER_HIDE_TIMEOUT * 1000 : HIDE_TIMEOUT * 1000;
                this._trayLeftTimeoutId = Mainloop.timeout_add(timeout, Lang.bind(this, this._onTrayLeftTimeout));
            }
        }
    },

    _onKeyboardVisibleChanged: function(layoutManager, keyboardVisible) {
        this._keyboardVisible = keyboardVisible;
        this._updateState();
    },

    _onStatusChanged: function(status) {
        if (status == GnomeSession.PresenceStatus.BUSY) {
            // remove notification and allow the summary to be closed now
            this._updateNotificationTimeout(0);
            this._busy = true;
        } else if (status != GnomeSession.PresenceStatus.IDLE) {
            // We preserve the previous value of this._busy if the status turns to IDLE
            // so that we don't start showing notifications queued during the BUSY state
            // as the screensaver gets activated.
            this._busy = false;
        }

        this._updateState();
    },

    _onTrayLeftTimeout: function() {
        let [x, y, mods] = global.get_pointer();
        // We extend the timeout once if the mouse moved no further than MOUSE_LEFT_ACTOR_THRESHOLD to either side or up.
        // We don't check how far down the mouse moved because any point above the tray, but below the exit coordinate,
        // is close to the tray.
        if (this._trayLeftMouseX > -1 &&
            y > this._trayLeftMouseY - MOUSE_LEFT_ACTOR_THRESHOLD &&
            x < this._trayLeftMouseX + MOUSE_LEFT_ACTOR_THRESHOLD &&
            x > this._trayLeftMouseX - MOUSE_LEFT_ACTOR_THRESHOLD) {
            this._trayLeftMouseX = -1;
            this._trayLeftTimeoutId = Mainloop.timeout_add(LONGER_HIDE_TIMEOUT * 1000,
                                                             Lang.bind(this, this._onTrayLeftTimeout));
        } else {
            this._trayLeftTimeoutId = 0;
            this._useLongerTrayLeftTimeout = false;
            this._pointerInTray = false;
            this._updateNotificationTimeout(0);
            this._updateState();
        }
        return false;
    },

    _escapeTray: function() {
        this._pointerInTray = false;
        this._traySummoned = false;
        this._setClickedSummaryItem(null);
        this._updateNotificationTimeout(0);
        this._updateState();
    },

    // All of the logic for what happens when occurs here; the various
    // event handlers merely update variables such as
    // 'this._pointerInTray', 'this._traySummoned', etc, and
    // _updateState() figures out what (if anything) needs to be done
    // at the present time.
    _updateState: function() {
        // Notifications
        let notificationQueue = this._notificationQueue;
        let notificationUrgent = notificationQueue.length > 0 && notificationQueue[0].urgency == Urgency.CRITICAL;
        let notificationForFeedback = notificationQueue.length > 0 && notificationQueue[0].forFeedback;
        let notificationForFeedbackHidden = notificationForFeedback && (Main.layoutManager.bottomMonitor && Main.layoutManager.bottomMonitor.inFullscreen);
        let notificationsLimited = this._busy || (Main.layoutManager.bottomMonitor && Main.layoutManager.bottomMonitor.inFullscreen);
        let notificationsPending = notificationQueue.length > 0 && (!notificationsLimited || notificationUrgent || notificationForFeedback) && Main.sessionMode.hasNotifications;
        let nextNotification = notificationQueue.length > 0 ? notificationQueue[0] : null;
        let notificationPinned = this._pointerInTray && !this._notificationRemoved;
        let notificationExpanded = this._notification && this._notification.expanded;
        let notificationExpired = this._notificationTimeoutId == 0 &&
                                  !(this._notification && this._notification.urgency == Urgency.CRITICAL) &&
                                  !(this._notification && this._notification.focused) &&
                                  !this._pointerInTray;
        let notificationLockedOut = !Main.sessionMode.hasNotifications && this._notification;
        let notificationMustClose = this._notificationRemoved || notificationLockedOut || (notificationExpired && this._userActiveWhileNotificationShown) || this._notificationClosed || notificationForFeedbackHidden;
        let canShowNotification = notificationsPending && this._trayState == State.HIDDEN;

        if (this._notificationState == State.HIDDEN) {
            if (canShowNotification)
                this._showNotification();
        } else if (this._notificationState == State.SHOWN) {
            if (notificationMustClose)
                this._hideNotification();
            else if (notificationPinned && !notificationExpanded)
                this._expandNotification(false);
            else if (notificationPinned)
                this._ensureNotificationFocused();
        }

        let notificationsVisible = this._notificationState != State.HIDDEN;
        let notificationsDone = !notificationsVisible && !notificationsPending;

        let mustHideTray = ((notificationsPending && notificationUrgent)
                           || notificationsVisible || !Main.sessionMode.hasNotifications);

        // Summary notification
        let haveClickedSummaryItem = this._clickedSummaryItem != null;
        let summarySourceIsMainNotificationSource = (haveClickedSummaryItem && this._notification &&
                                                     this._clickedSummaryItem.source == this._notification.source);
        let canShowSummaryBoxPointer = this._trayState == State.SHOWN;
        // We only have sources with empty notification stacks for legacy tray icons. Currently, we never attempt
        // to show notifications for legacy tray icons, but this would be necessary if we did.
        let requestedNotificationStackIsEmpty = (this._clickedSummaryItemMouseButton == 1 && this._clickedSummaryItem.source.notifications.length == 0);
        let wrongSummaryNotificationStack = (this._clickedSummaryItemMouseButton == 1 &&
                                             this._summaryBoxPointer.bin.child != this._clickedSummaryItem.notificationStackWidget);
        let wrongSummaryRightClickMenu = (this._clickedSummaryItemMouseButton == 3 &&
                                          this._summaryBoxPointer.bin.child != this._clickedSummaryItem.rightClickMenu);
        let wrongSummaryBoxPointer = (haveClickedSummaryItem &&
                                      (wrongSummaryNotificationStack || wrongSummaryRightClickMenu));

        if (this._summaryBoxPointerState == State.HIDDEN) {
            if (haveClickedSummaryItem && !summarySourceIsMainNotificationSource && canShowSummaryBoxPointer && !requestedNotificationStackIsEmpty)
                this._showSummaryBoxPointer();
        } else if (this._summaryBoxPointerState == State.SHOWN) {
            if (!haveClickedSummaryItem || !canShowSummaryBoxPointer || wrongSummaryBoxPointer || mustHideTray) {
                this._hideSummaryBoxPointer();
                if (wrongSummaryBoxPointer)
                    this._showSummaryBoxPointer();
            }
        }

        // Tray itself
        let trayIsVisible = (this._trayState == State.SHOWING ||
                             this._trayState == State.SHOWN);
        let trayShouldBeVisible = this._traySummoned && !this._keyboardVisible && !mustHideTray;
        if (!trayIsVisible && trayShouldBeVisible)
            trayShouldBeVisible = this._showTray();
        else if (trayIsVisible && !trayShouldBeVisible)
            this._hideTray();

        // Desktop clone
        let desktopCloneIsVisible = (this._desktopCloneState == State.SHOWING ||
                                     this._desktopCloneState == State.SHOWN);
        let desktopCloneShouldBeVisible = (trayShouldBeVisible);

        if (!desktopCloneIsVisible && desktopCloneShouldBeVisible) {
            this._showDesktopClone();
        } else if (desktopCloneIsVisible && !desktopCloneShouldBeVisible) {
            this._hideDesktopClone();
        }
    },

    _tween: function(actor, statevar, value, params) {
        let onComplete = params.onComplete;
        let onCompleteScope = params.onCompleteScope;
        let onCompleteParams = params.onCompleteParams;

        params.onComplete = this._tweenComplete;
        params.onCompleteScope = this;
        params.onCompleteParams = [statevar, value, onComplete, onCompleteScope, onCompleteParams];

        // Remove other tweens that could mess with the state machine
        Tweener.removeTweens(actor);
        Tweener.addTween(actor, params);

        let valuing = (value == State.SHOWN) ? State.SHOWING : State.HIDING;
        this[statevar] = valuing;
    },

    _tweenComplete: function(statevar, value, onComplete, onCompleteScope, onCompleteParams) {
        this[statevar] = value;
        if (onComplete)
            onComplete.apply(onCompleteScope, onCompleteParams);
        this._updateState();
    },

    _showTray: function() {
        if (!this._grabHelper.grab({ actor: this.actor,
                                     onUngrab: Lang.bind(this, this._escapeTray) })) {
            this._traySummoned = false;
            return false;
        }

        this.emit('showing');
        this._tween(this.actor, '_trayState', State.SHOWN,
                    { y: -this.actor.height,
                      time: ANIMATION_TIME,
                      transition: 'easeOutQuad'
                    });

        this._lightbox.show();

        return true;
    },

    _updateDesktopCloneClip: function() {
        let geometry = this._bottomMonitorGeometry;
        let progress = -Math.round(this._desktopClone.y);
        this._desktopClone.set_clip(geometry.x,
                                    geometry.y + progress,
                                    geometry.width,
                                    geometry.height - progress);
    },

    _showDesktopClone: function() {
        let bottomMonitor = Main.layoutManager.bottomMonitor;
        this._bottomMonitorGeometry = { x: bottomMonitor.x,
                                        y: bottomMonitor.y,
                                        width: bottomMonitor.width,
                                        height: bottomMonitor.height };

        if (this._desktopClone)
            this._desktopClone.destroy();
        let cloneSource = Main.overview.visible ? Main.layoutManager.overviewGroup : global.window_group;
        this._desktopClone = new Clutter.Clone({ source: cloneSource,
                                                 clip: new Clutter.Geometry(this._bottomMonitorGeometry) });
        Main.uiGroup.insert_child_above(this._desktopClone, cloneSource);
        this._desktopClone.x = 0;
        this._desktopClone.y = 0;
        this._desktopClone.show();

        this._tween(this._desktopClone, '_desktopCloneState', State.SHOWN,
                    { y: -this.actor.height + Main.layoutManager.panelBox.height,
                      time: ANIMATION_TIME,
                      transition: 'easeOutQuad',
                      onUpdate: Lang.bind(this, this._updateDesktopCloneClip)
                    });
    },

    _hideTray: function() {
        // Having the summary item animate out while sliding down the tray
        // is distracting, so hide it immediately in case it was visible.
        this._summaryBoxPointer.actor.hide();

        this.emit('hiding');
        this._tween(this.actor, '_trayState', State.HIDDEN,
                    { y: 0,
                      time: ANIMATION_TIME,
                      transition: 'easeOutQuad'
                    });

        // Note that we might have entered here without a grab,
        // which would happen if GrabHelper ungrabbed for us.
        // This is a no-op in that case.
        this._grabHelper.ungrab({ actor: this.actor });
        this._lightbox.hide();
    },

    _hideDesktopClone: function() {
        this._tween(this._desktopClone, '_desktopCloneState', State.HIDDEN,
                    { y: 0,
                      time: ANIMATION_TIME,
                      transition: 'easeOutQuad',
                      onComplete: Lang.bind(this, function() {
                          this._desktopClone.destroy();
                          this._desktopClone = null;
                          this._bottomMonitorGeometry = null;
                      }),
                      onUpdate: Lang.bind(this, this._updateDesktopCloneClip)
                    });
    },

    _onIdleMonitorBecameActive: function() {
        this._userActiveWhileNotificationShown = true;
        this._updateNotificationTimeout(2000);
        this._updateState();
    },

    _showNotification: function() {
        this._notification = this._notificationQueue.shift();

        this._userActiveWhileNotificationShown = this.idleMonitor.get_idletime() <= IDLE_TIME;
        if (!this._userActiveWhileNotificationShown) {
            // If the user isn't active, set up a watch to let us know
            // when the user becomes active.
            this.idleMonitor.add_user_active_watch(Lang.bind(this, this._onIdleMonitorBecameActive));
        }

        this._notificationClickedId = this._notification.connect('done-displaying',
                                                                 Lang.bind(this, this._escapeTray));
        this._notificationUnfocusedId = this._notification.connect('unfocused', Lang.bind(this, function() {
            this._updateState();
        }));
        this._notificationBin.child = this._notification.actor;

        this._notificationWidget.opacity = 0;
        this._notificationWidget.y = 0;
        this._notificationWidget.show();

        this._updateShowingNotification();

        let [x, y, mods] = global.get_pointer();
        // We save the position of the mouse at the time when we started showing the notification
        // in order to determine if the notification popped up under it. We make that check if
        // the user starts moving the mouse and _onTrayHoverChanged() gets called. We don't
        // expand the notification if it just happened to pop up under the mouse unless the user
        // explicitly mouses away from it and then mouses back in.
        this._showNotificationMouseX = x;
        this._showNotificationMouseY = y;
        // We save the coordinates of the mouse at the time when we started showing the notification
        // and then we update it in _notificationTimeout(). We don't pop down the notification if
        // the mouse is moving towards it or within it.
        this._lastSeenMouseX = x;
        this._lastSeenMouseY = y;
    },

    _updateShowingNotification: function() {
        this._notification.acknowledged = true;
        this._notification.playSound();

        // We auto-expand notifications with CRITICAL urgency, or for which the relevant setting
        // is on in the control center.
        if (this._notification.urgency == Urgency.CRITICAL ||
            this._notification.source.policy.forceExpanded)
            this._expandNotification(true);

        // We tween all notifications to full opacity. This ensures that both new notifications and
        // notifications that might have been in the process of hiding get full opacity.
        //
        // We tween any notification showing in the banner mode to the appropriate height
        // (which is banner height or expanded height, depending on the notification state)
        // This ensures that both new notifications and notifications in the banner mode that might
        // have been in the process of hiding are shown with the correct height.
        //
        // We use this._showNotificationCompleted() onComplete callback to extend the time the updated
        // notification is being shown.

        let tweenParams = { opacity: 255,
                            y: -this._notificationWidget.height - Main.layoutManager.panelBox.height,
                            time: ANIMATION_TIME,
                            transition: 'easeOutQuad',
                            onComplete: this._showNotificationCompleted,
                            onCompleteScope: this
                          };

        this._tween(this._notificationWidget, '_notificationState', State.SHOWN, tweenParams);
   },

    _showNotificationCompleted: function() {
        if (this._notification.urgency != Urgency.CRITICAL)
            this._updateNotificationTimeout(this._notification.source.policy.notificationTimeout * 1000);
    },

    _updateNotificationTimeout: function(timeout) {
        if (this._notificationTimeoutId) {
            Mainloop.source_remove(this._notificationTimeoutId);
            this._notificationTimeoutId = 0;
        }
        if (timeout > 0)
            this._notificationTimeoutId =
                Mainloop.timeout_add(timeout,
                                     Lang.bind(this, this._notificationTimeout));
    },

    _notificationTimeout: function() {
        let [x, y, mods] = global.get_pointer();
        if (y > this._lastSeenMouseY + 10 && !this.actor.hover) {
            // The mouse is moving towards the notification, so don't
            // hide it yet. (We just create a new timeout (and destroy
            // the old one) each time because the bookkeeping is
            // simpler.)
            this._updateNotificationTimeout(1000);
        } else if (this._useLongerTrayLeftTimeout && !this._trayLeftTimeoutId &&
                  (x != this._lastSeenMouseX || y != this._lastSeenMouseY)) {
            // Refresh the timeout if the notification originally
            // popped up under the pointer, and the pointer is hovering
            // inside it.
            this._updateNotificationTimeout(1000);
        } else {
            this._notificationTimeoutId = 0;
            this._updateState();
        }

        this._lastSeenMouseX = x;
        this._lastSeenMouseY = y;
        return false;
    },

    _hideNotification: function() {
        this._notificationFocusGrabber.ungrabFocus();

        if (this._notificationExpandedId) {
            this._notification.disconnect(this._notificationExpandedId);
            this._notificationExpandedId = 0;
        }
        if (this._notificationClickedId) {
            this._notification.disconnect(this._notificationClickedId);
            this._notificationClickedId = 0;
        }
        if (this._notificationUnfocusedId) {
            this._notification.disconnect(this._notificationUnfocusedId);
            this._notificationUnfocusedId = 0;
        }

        this._useLongerTrayLeftTimeout = false;
        if (this._trayLeftTimeoutId) {
            Mainloop.source_remove(this._trayLeftTimeoutId);
            this._trayLeftTimeoutId = 0;
            this._trayLeftMouseX = -1;
            this._trayLeftMouseY = -1;
        }

        if (this._notificationRemoved) {
            Tweener.removeTweens(this._notificationWidget);
            this._notificationWidget.y = this.actor.height;
            this._notificationWidget.opacity = 0;
            this._notificationState = State.HIDDEN;
            this._hideNotificationCompleted();
        } else {
            this._tween(this._notificationWidget, '_notificationState', State.HIDDEN,
                        { y: this.actor.height,
                          opacity: 0,
                          time: ANIMATION_TIME,
                          transition: 'easeOutQuad',
                          onComplete: this._hideNotificationCompleted,
                          onCompleteScope: this
                        });

        }
    },

    _hideNotificationCompleted: function() {
        this._notification.collapseCompleted();

        let notification = this._notification;
        this._notification = null;
        if (notification.isTransient)
            notification.destroy(NotificationDestroyedReason.EXPIRED);

        this._notificationRemoved = false;
        this._closeButton.hide();
        this._pointerInTray = false;

        // Clutter will send a leave-event the next time the mouse
        // moves, but we need to set this here now to update the
        // state machine.
        this.actor.hover = false;
        this._notificationBin.child = null;
        this._notificationWidget.hide();
    },

    _expandActiveNotification: function() {
        if (!this._notification)
            return;

        this._expandNotification(false);
    },

    _expandNotification: function(autoExpanding) {
        // Don't focus notifications that are auto-expanding.
        if (!autoExpanding)
            this._ensureNotificationFocused();

        if (!this._notificationExpandedId)
            this._notificationExpandedId =
                this._notification.connect('expanded',
                                           Lang.bind(this, this._onNotificationExpanded));
        // Don't animate changes in notifications that are auto-expanding.
        this._notification.expand(!autoExpanding);
    },

    _onNotificationExpanded: function() {
        let expandedY = - this._notificationWidget.height - Main.layoutManager.panelBox.height;
        this._closeButton.show();

        // Don't animate the notification to its new position if it has shrunk:
        // there will be a very visible "gap" that breaks the illusion.
        if (this._notificationWidget.y < expandedY) {
            this._notificationWidget.y = expandedY;
        } else if (this._notification.y != expandedY) {
            // Tween also opacity here, to override a possible tween that's
            // currently hiding the notification.
            this._tween(this._notificationWidget, '_notificationState', State.SHOWN,
                        { y: expandedY,
                          opacity: 255,
                          time: ANIMATION_TIME,
                          transition: 'easeOutQuad'
                        });
        }
    },

    _ensureNotificationFocused: function() {
        this._notificationFocusGrabber.grabFocus();
    },

    _onSourceDoneDisplayingContent: function(source, closeTray) {
        if (closeTray) {
            this._escapeTray();
        } else {
            this._setClickedSummaryItem(null);
            this._updateState();
        }
    },

    _showSummaryBoxPointer: function() {
        this._summaryBoxPointerItem = this._clickedSummaryItem;
        this._summaryBoxPointerContentUpdatedId = this._summaryBoxPointerItem.connect('content-updated',
                                                                                      Lang.bind(this, this._onSummaryBoxPointerContentUpdated));
        this._sourceDoneDisplayingId = this._summaryBoxPointerItem.source.connect('done-displaying-content',
                                                                                  Lang.bind(this, this._onSourceDoneDisplayingContent));

        let hasRightClickMenu = this._summaryBoxPointerItem.rightClickMenu != null;
        if (this._clickedSummaryItemMouseButton == 1 || !hasRightClickMenu) {
            let newQueue = [];
            for (let i = 0; i < this._notificationQueue.length; i++) {
                let notification = this._notificationQueue[i];
                let sameSource = this._summaryBoxPointerItem.source == notification.source;
                if (sameSource)
                    notification.acknowledged = true;
                else
                    newQueue.push(notification);
            }
            this._notificationQueue = newQueue;

            this._summaryBoxPointer.bin.child = this._summaryBoxPointerItem.notificationStackWidget;

            let closeButton = this._summaryBoxPointerItem.closeButton;
            closeButton.show();
            this._summaryBoxPointerCloseClickedId = closeButton.connect('clicked', Lang.bind(this, this._hideSummaryBoxPointer));
            this._summaryBoxPointerItem.prepareNotificationStackForShowing();
        } else if (this._clickedSummaryItemMouseButton == 3) {
            this._summaryBoxPointer.bin.child = this._clickedSummaryItem.rightClickMenu;
            this._summaryBoxPointerCloseClickedId = 0;
        }

        this._grabHelper.grab({ actor: this._summaryBoxPointer.bin.child,
                                onUngrab: Lang.bind(this, this._onSummaryBoxPointerUngrabbed) });

        this._summaryBoxPointer.actor.opacity = 0;
        this._summaryBoxPointer.actor.show();
        this._adjustSummaryBoxPointerPosition();

        this._summaryBoxPointerState = State.SHOWING;
        this._clickedSummaryItem.actor.add_style_pseudo_class('selected');
        this._summaryBoxPointer.show(BoxPointer.PopupAnimation.FULL, Lang.bind(this, function() {
            this._summaryBoxPointerState = State.SHOWN;
        }));
    },

    _onSummaryBoxPointerContentUpdated: function() {
        if (this._summaryBoxPointerItem.notificationStack.get_n_children() == 0)
            this._hideSummaryBoxPointer();
        this._adjustSummaryBoxPointerPosition();
    },

    _adjustSummaryBoxPointerPosition: function() {
        if (!this._clickedSummaryItem)
            return;

        this._summaryBoxPointer.setPosition(this._clickedSummaryItem.actor, 0);
    },

    _setClickedSummaryItem: function(item, button) {
        if (item == this._clickedSummaryItem &&
            button == this._clickedSummaryItemMouseButton)
            return false;

        if (this._clickedSummaryItem) {
            this._clickedSummaryItem.actor.remove_style_pseudo_class('selected');
            this._clickedSummaryItem.actor.disconnect(this._clickedSummaryItemAllocationChangedId);
            this._summary.disconnect(this._summaryMotionId);
            this._clickedSummaryItemAllocationChangedId = 0;
            this._summaryMotionId = 0;
        }

        this._clickedSummaryItem = item;
        this._clickedSummaryItemMouseButton = button;

        if (this._clickedSummaryItem) {
            this._clickedSummaryItem.source.emit('summary-item-clicked', button);
            this._clickedSummaryItem.actor.add_style_pseudo_class('selected');
            this._clickedSummaryItemAllocationChangedId =
                this._clickedSummaryItem.actor.connect('allocation-changed',
                                                       Lang.bind(this, this._adjustSummaryBoxPointerPosition));
            // _clickedSummaryItem.actor can change absolute position without changing allocation
            this._summaryMotionId = this._summary.connect('allocation-changed',
                                                          Lang.bind(this, this._adjustSummaryBoxPointerPosition));
        }

        return true;
    },

    _onSummaryBoxPointerKeyPress: function(actor, event) {
        switch (event.get_key_symbol()) {
        case Clutter.KEY_Down:
        case Clutter.KEY_Escape:
            this._setClickedSummaryItem(null);
            this._updateState();
            return true;
        case Clutter.KEY_Delete:
            this._clickedSummaryItem.source.destroy();
            this._escapeTray();
            return true;
        }
        return false;
    },

    _onSummaryBoxPointerUngrabbed: function() {
        this._summaryBoxPointerState = State.HIDING;
        this._setClickedSummaryItem(null);

        if (this._summaryBoxPointerContentUpdatedId) {
            this._summaryBoxPointerItem.disconnect(this._summaryBoxPointerContentUpdatedId);
            this._summaryBoxPointerContentUpdatedId = 0;
        }
        if (this._summaryBoxPointerCloseClickedId != 0) {
            this._summaryBoxPointerItem.closeButton.disconnect(this._summaryBoxPointerCloseClickedId);
            this._summaryBoxPointerCloseClickedId = 0;
        }
        if (this._sourceDoneDisplayingId) {
            this._summaryBoxPointerItem.source.disconnect(this._sourceDoneDisplayingId);
            this._sourceDoneDisplayingId = 0;
        }

        if (this._summaryBoxPointerItem.source.notifications.length == 0) {
            this._summaryBoxPointer.actor.hide();
            this._hideSummaryBoxPointerCompleted();
        } else {
            if (global.stage.key_focus &&
                !this.actor.contains(global.stage.key_focus))
                this._setClickedSummaryItem(null);
            this._summaryBoxPointer.hide(BoxPointer.PopupAnimation.FULL, Lang.bind(this, this._hideSummaryBoxPointerCompleted));
        }
    },

    _hideSummaryBoxPointer: function() {
        this._grabHelper.ungrab({ actor: this._summaryBoxPointer.bin.child });
    },

    _hideSummaryBoxPointerCompleted: function() {
        let doneShowingNotificationStack = (this._summaryBoxPointer.bin.child == this._summaryBoxPointerItem.notificationStackWidget);

        this._summaryBoxPointerState = State.HIDDEN;
        this._summaryBoxPointer.bin.child = null;

        let sourceNotificationStackDoneShowing = null;
        if (doneShowingNotificationStack) {
            this._summaryBoxPointerItem.doneShowingNotificationStack();
            sourceNotificationStackDoneShowing = this._summaryBoxPointerItem.source;
        }

        this._summaryBoxPointerItem = null;

        if (sourceNotificationStackDoneShowing) {
            if (sourceNotificationStackDoneShowing.isTransient && !this._reNotifyAfterHideNotification)
                sourceNotificationStackDoneShowing.destroy(NotificationDestroyedReason.EXPIRED);
            if (this._reNotifyAfterHideNotification) {
                this._onNotify(this._reNotifyAfterHideNotification.source, this._reNotifyAfterHideNotification);
                this._reNotifyAfterHideNotification = null;
            }
        }

        if (this._clickedSummaryItem)
            this._updateState();
    }
});
Signals.addSignalMethods(MessageTray.prototype);

const SystemNotificationSource = new Lang.Class({
    Name: 'SystemNotificationSource',
    Extends: Source,

    _init: function() {
        this.parent(_("System Information"), 'dialog-information-symbolic');
        this.setTransient(true);
    },

    open: function() {
        this.destroy();
    }
});
