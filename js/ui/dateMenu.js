// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const GnomeDesktop = imports.gi.GnomeDesktop;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Atk = imports.gi.Atk;

const Params = imports.misc.params;
const Util = imports.misc.util;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Calendar = imports.ui.calendar;

const DateMenuButton = new Lang.Class({
    Name: 'DateMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        let item;
        let hbox;
        let vbox;

        let menuAlignment = 0.25;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            menuAlignment = 1.0 - menuAlignment;
        this.parent(menuAlignment);

        // At this moment calendar menu is not keyboard navigable at
        // all (so not accessible), so it doesn't make sense to set as
        // role ATK_ROLE_MENU like other elements of the panel.
        this.actor.accessible_role = Atk.Role.LABEL;

        this._clockDisplay = new St.Label();
        this.actor.add_actor(this._clockDisplay);

        hbox = new St.BoxLayout({name: 'calendarArea' });
        this.menu.addActor(hbox);

        // Fill up the first column

        vbox = new St.BoxLayout({vertical: true});
        hbox.add(vbox);

        // Date
        this._date = new St.Label();
        this.actor.label_actor = this._clockDisplay;
        this._date.style_class = 'datemenu-date-label';
        vbox.add(this._date);

        this._eventList = new Calendar.EventsList();
        this._calendar = new Calendar.Calendar();

        this._calendar.connect('selected-date-changed',
                               Lang.bind(this, function(calendar, date) {
                                  // we know this._eventList is defined here, because selected-data-changed
                                  // only gets emitted when the user clicks a date in the calendar,
                                  // and the calender makes those dates unclickable when instantiated with
                                  // a null event source
                                   this._eventList.setDate(date);
                               }));
        vbox.add(this._calendar.actor);

        let separator = new PopupMenu.PopupSeparatorMenuItem();
        vbox.add(separator.actor, {y_align: St.Align.END, expand: true, y_fill: false});

        this._openCalendarItem = new PopupMenu.PopupMenuItem(_("Open Calendar"));
        this._openCalendarItem.connect('activate', Lang.bind(this, this._onOpenCalendarActivate));
        this._openCalendarItem.actor.can_focus = false;
        vbox.add(this._openCalendarItem.actor, {y_align: St.Align.END, expand: true, y_fill: false});

        this._openClocksItem = new PopupMenu.PopupMenuItem(_("Open Clocks"));
        this._openClocksItem.connect('activate', Lang.bind(this, this._onOpenClocksActivate));
        this._openClocksItem.actor.can_focus = false;
        vbox.add(this._openClocksItem.actor, {y_align: St.Align.END, expand: true, y_fill: false});

        Shell.AppSystem.get_default().connect('installed-changed',
                                              Lang.bind(this, this._appInstalledChanged));
        this._appInstalledChanged();

        item = this.menu.addSettingsAction(_("Date & Time Settings"), 'gnome-datetime-panel.desktop');
        if (item) {
            item.actor.show_on_set_parent = false;
            item.actor.can_focus = false;
            item.actor.reparent(vbox);
            this._dateAndTimeSeparator = separator;
        }

        this._separator = new PopupMenu.PopupMenuSeparator();
        hbox.add(this._separator);

        // Fill up the second column
        vbox = new St.BoxLayout({ name: 'calendarEventsArea',
                                  vertical: true });
        hbox.add(vbox, { expand: true });

        // Event list
        vbox.add(this._eventList.actor, { expand: true });

        // Whenever the menu is opened, select today
        this.menu.connect('open-state-changed', Lang.bind(this, function(menu, isOpen) {
            if (isOpen) {
                let now = new Date();
                /* Passing true to setDate() forces events to be reloaded. We
                 * want this behavior, because
                 *
                 *   o It will cause activation of the calendar server which is
                 *     useful if it has crashed
                 *
                 *   o It will cause the calendar server to reload events which
                 *     is useful if dynamic updates are not supported or not
                 *     properly working
                 *
                 * Since this only happens when the menu is opened, the cost
                 * isn't very big.
                 */
                this._calendar.setDate(now, true);
                // No need to update this._eventList as ::selected-date-changed
                // signal will fire
            }
        }));

        // Done with hbox for calendar and event list

        this._clock = new GnomeDesktop.WallClock({'time_only' : true});
        this._clock.connect('notify::clock', Lang.bind(this, this._updateClockAndDate));
        this._updateClockAndDate();

        Main.sessionMode.connect('updated', Lang.bind(this, this._sessionUpdated));
        this._sessionUpdated();
    },

    _appInstalledChanged: function() {
        let app = Shell.AppSystem.get_default().lookup_app('org.gnome.clocks.desktop');
        this._openClocksItem.actor.visible = app !== null;
    },

    _updateEventsVisibility: function() {
        let visible = this._eventSource.hasCalendars;
        this._openCalendarItem.actor.visible = visible;
        this._openClocksItem.actor.visible = visible;
        this._separator.visible = visible;
        if (visible) {
          let alignment = 0.25;
          if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            alignment = 1.0 - alignment;
          this.menu._arrowAlignment = alignment;
          this._eventList.actor.get_parent().show();
        } else {
          this.menu._arrowAlignment = 0.5;
          this._eventList.actor.get_parent().hide();
        }
    },

    _setEventSource: function(eventSource) {
        if (this._eventSource)
            this._eventSource.destroy();

        this._calendar.setEventSource(eventSource);
        this._eventList.setEventSource(eventSource);

        this._eventSource = eventSource;
        this._eventSource.connect('notify::has-calendars', Lang.bind(this, function() {
            this._updateEventsVisibility();
        }));
    },

    _sessionUpdated: function() {
        let eventSource;
        let showEvents = Main.sessionMode.showCalendarEvents;
        if (showEvents) {
            eventSource = new Calendar.DBusEventSource();
        } else {
            eventSource = new Calendar.EmptyEventSource();
        }
        this._setEventSource(eventSource);
        this._updateEventsVisibility();

        // This needs to be handled manually, as the code to
        // autohide separators doesn't work across the vbox
        this._dateAndTimeSeparator.actor.visible = Main.sessionMode.allowSettings;
    },

    _updateClockAndDate: function() {
        this._clockDisplay.set_text(this._clock.clock);
        /* Translators: This is the date format to use when the calendar popup is
         * shown - it is shown just below the time in the shell (e.g. "Tue 9:29 AM").
         */
        let dateFormat = _("%A %B %e, %Y");
        let displayDate = new Date();
        this._date.set_text(displayDate.toLocaleFormat(dateFormat));
    },

    _onOpenCalendarActivate: function() {
        this.menu.close();

        let app = Gio.AppInfo.get_default_for_type('text/calendar', false);
        if (app.get_id() == 'evolution')
            app = Gio.DesktopAppInfo.new('evolution-calendar');
        Main.overview.hide();
        app.launch([], global.create_app_launch_context());
    },

    _onOpenClocksActivate: function() {
        this.menu.close();
        let app = Shell.AppSystem.get_default().lookup_app('org.gnome.clocks.desktop');
        Main.overview.hide();
        app.activate();
    }
});
