// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Signals = imports.signals;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const Params = imports.misc.params;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const WorkspacesView = imports.ui.workspacesView;

const SHELL_KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';

const BASE_SEARCH_URI = 'http://www.google.com/';
const QUERY_URI_PATH = 'search?q=';

const ViewPage = {
    WINDOWS: 1,
    APPS: 2,
};

function getTermsForSearchString(searchString) {
    searchString = searchString.replace(/^\s+/g, '').replace(/\s+$/g, '');
    if (searchString == '')
        return [];

    let terms = searchString.split(/\s+/);
    return terms;
}

const ViewSelector = new Lang.Class({
    Name: 'ViewSelector',

    _init : function(showAppsButton) {
        this.actor = new Shell.Stack({ name: 'viewSelector',
                                       x_expand: true,
                                       y_expand: true });

        this._showAppsButton = showAppsButton;
        this._showAppsButton.connect('notify::checked', Lang.bind(this, this._onShowAppsButtonToggled));

        this._activePage = null;

        this._workspacesDisplay = new WorkspacesView.WorkspacesDisplay();
        this._workspacesDisplay.connect('empty-space-clicked', Lang.bind(this, this._onEmptySpaceClicked));
        this._workspacesPage = this._addPage(this._workspacesDisplay.actor,
                                             _("Windows"), 'emblem-documents-symbolic');

        this._appDisplay = new AppDisplay.AppDisplay();
        this._appsPage = this._addPage(this._appDisplay.actor,
                                       _("Applications"), 'view-grid-symbolic');
        this._setupSearchEntry();

        this._stageKeyPressId = 0;
        Main.overview.connect('showing', Lang.bind(this,
            function () {
                this._stageKeyPressId = global.stage.connect('key-press-event',
                                                             Lang.bind(this, this._onStageKeyPress));
            }));
        Main.overview.connect('hiding', Lang.bind(this,
            function () {
                if (this._stageKeyPressId != 0) {
                    global.stage.disconnect(this._stageKeyPressId);
                    this._stageKeyPressId = 0;
                }
            }));
    },

    _setupSearchEntry: function() {
        this._entry = this._appDisplay.entry;

        this._searchActive = false;
        ShellEntry.addContextMenu(this._entry);

        this._text = this._entry.clutter_text;
        this._text.connect('text-changed', Lang.bind(this, this._onTextChanged));
        this._text.connect('key-press-event', Lang.bind(this, this._onKeyPress));
        this._entry.connect('notify::mapped', Lang.bind(this, this._onMapped));
        global.stage.connect('notify::key-focus', Lang.bind(this, this._onStageKeyFocusChanged));

        this._entry.set_primary_icon(new St.Icon({ style_class: 'search-entry-icon',
                                                   icon_name: 'edit-find-symbolic',
                                                   track_hover: true }));
        this._clearIcon = new St.Icon({ style_class: 'search-entry-icon',
                                        icon_name: 'edit-clear-symbolic',
                                        track_hover: true });

        let hintActor = new ShellEntry.EntryHint('search-entry-hint',
                                                 'google-logo-symbolic.svg');
        this._entry.set_hint_actor(hintActor);

        this._entry.connect('primary-icon-clicked', Lang.bind(this, this._activateDefaultSearch));

        this._iconClickedId = 0;
        this._capturedEventId = 0;
    },

    _activateDefaultSearch: function() {
        let uri = BASE_SEARCH_URI;
        let terms = getTermsForSearchString(this._entry.get_text());
        if (terms.length != 0) {
            let searchedUris = Util.findSearchUrls(terms);
            // Make sure search contains only a uri
            // Avoid cases like "what is github.com"
            if (searchedUris.length == 1 && terms.length == 1) {
                uri = searchedUris[0];
                // Ensure all uri has a scheme name
                if(!GLib.uri_parse_scheme(uri)) {
                    uri = "http://" + uri;
                }
            } else {
                uri = uri + QUERY_URI_PATH + encodeURI(terms.join(' '));
            }
        }

        try {
            Gio.AppInfo.launch_default_for_uri(uri, null);
            Main.overview.hide();
        } catch (e) {
            logError(e, 'error while launching the browser for uri: '
                     + uri);
        }
    },

    _onEmptySpaceClicked: function() {
        this.setActivePage(ViewPage.APPS);
    },

    _pageFromViewPage: function(viewPage) {
        let page;

        if (viewPage == ViewPage.WINDOWS) {
            page = this._workspacesPage;
        } else {
            page = this._appsPage;
        }

        return page;
    },

    _viewPageFromPage: function(page) {
        let viewPage;

        if (page == this._workspacesPage) {
            viewPage = ViewPage.WINDOWS;
        } else {
            viewPage = ViewPage.APPS;
        }

        return viewPage;
    },

    show: function(viewPage) {
        this.reset();
        this._workspacesDisplay.show();

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows())
            Main.overview.fadeOutDesktop();

        this._showPage(this._pageFromViewPage(viewPage), true);
    },

    zoomFromOverview: function() {
        this._workspacesDisplay.zoomFromOverview();

        if (!this._workspacesDisplay.activeWorkspaceHasMaximizedWindows())
            Main.overview.fadeInDesktop();
    },

    hide: function() {
        this._workspacesDisplay.hide();
    },

    _addPage: function(actor, name, a11yIcon, params) {
        params = Params.parse(params, { a11yFocus: null });

        let page = new St.Bin({ child: actor,
                                opacity: 0,
                                visible: false,
                                x_align: St.Align.START,
                                y_align: St.Align.START,
                                x_fill: true,
                                y_fill: true });
        if (params.a11yFocus)
            Main.ctrlAltTabManager.addGroup(params.a11yFocus, name, a11yIcon);
        else
            Main.ctrlAltTabManager.addGroup(actor, name, a11yIcon,
                                            { proxy: this.actor,
                                              focusCallback: Lang.bind(this,
                                                  function() {
                                                      this._a11yFocusPage(page);
                                                  })
                                            });;
        this.actor.add_actor(page);
        return page;
    },

    _pageChanged: function() {
        if (this._activePage == this._appsPage) {
            this._showAppsButton.checked = true;
        } else {
            this._showAppsButton.checked = false;
        }

        this.emit('page-changed');
    },

    _fadePageIn: function(oldPage, noFade) {
        if (oldPage) {
            oldPage.opacity = 0;
            oldPage.hide();
        }

        this.emit('page-empty');

        this._activePage.show();
        if (noFade) {
            this._activePage.opacity = 255;
        } else {
            Tweener.addTween(this._activePage,
                { opacity: 255,
                  time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                  transition: 'easeOutQuad'
                });
        }
    },

    _showPage: function(page, noFade) {
        if (page == this._activePage)
            return;

        let oldPage = this._activePage;
        this._activePage = page;
        this._pageChanged();

        if (oldPage && !noFade)
            Tweener.addTween(oldPage,
                             { opacity: 0,
                               time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                               transition: 'easeOutQuad',
                               onComplete: Lang.bind(this,
                                   function() {
                                       this._fadePageIn(oldPage, noFade);
                                   })
                             });
        else
            this._fadePageIn(oldPage, noFade);
    },

    _a11yFocusPage: function(page) {
        this._showAppsButton.checked = page == this._appsPage;
        page.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    },

    _onShowAppsButtonToggled: function() {
        if (this._showAppsButton.checked) {
            Main.overview.resetToggledState();
            this.setActivePage(ViewPage.APPS);
        } else {
            this.setActivePage(ViewPage.WINDOWS);
        }
    },

    _onStageKeyPress: function(actor, event) {
        // Ignore events while anything but the overview has
        // pushed a modal (system modals, looking glass, ...)
        if (Main.modalCount > 1)
            return false;

        let modifiers = event.get_state();
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.Escape) {
            if (this._searchActive) {
                this.reset();
                return true;
            }
        } else if (this._shouldTriggerSearch(symbol)) {
            this.startSearch(event);
        } else if (!this._searchActive) {
            if (symbol == Clutter.Tab || symbol == Clutter.Down) {
                this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
                return true;
            } else if (symbol == Clutter.ISO_Left_Tab) {
                this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_BACKWARD, false);
                return true;
            }
        }
        return false;
    },

    _searchCancelled: function() {
        // Leave the entry focused when it doesn't have any text;
        // when replacing a selected search term, Clutter emits
        // two 'text-changed' signals, one for deleting the previous
        // text and one for the new one - the second one is handled
        // incorrectly when we remove focus
        // (https://bugzilla.gnome.org/show_bug.cgi?id=636341) */
        if (this._text.text != '')
            this.reset();
    },

    reset: function () {
        global.stage.set_key_focus(null);

        this._entry.text = '';

        this._text.set_cursor_visible(true);
        this._text.set_selection(0, 0);
    },

    _onStageKeyFocusChanged: function() {
        let focus = global.stage.get_key_focus();
        let appearFocused = this._entry.contains(focus);

        this._text.set_cursor_visible(appearFocused);

        if (appearFocused)
            this._entry.add_style_pseudo_class('focus');
        else
            this._entry.remove_style_pseudo_class('focus');
    },

    _onMapped: function() {
        if (this._entry.mapped) {
            // Enable 'find-as-you-type'
            this._capturedEventId = global.stage.connect('captured-event',
                                 Lang.bind(this, this._onCapturedEvent));
            this._text.set_cursor_visible(true);
            this._text.set_selection(0, 0);
        } else {
            // Disable 'find-as-you-type'
            if (this._capturedEventId > 0)
                global.stage.disconnect(this._capturedEventId);
            this._capturedEventId = 0;
        }
    },

    _shouldTriggerSearch: function(symbol) {
        let unicode = Clutter.keysym_to_unicode(symbol);
        if (unicode == 0)
            return false;

        if (getTermsForSearchString(String.fromCharCode(unicode)).length > 0)
            return true;

        return symbol == Clutter.BackSpace && this._searchActive;
    },

    startSearch: function(event) {
        global.stage.set_key_focus(this._text);
        this._text.event(event, true);
    },

    // the entry does not show the hint
    _isActivated: function() {
        return this._text.text == this._entry.get_text();
    },

    _onTextChanged: function (se, prop) {
        let terms = getTermsForSearchString(this._entry.get_text());

        this._searchActive = (terms.length > 0);

        if (this._searchActive) {
            this._entry.set_secondary_icon(this._clearIcon);

            if (this._iconClickedId == 0)
                this._iconClickedId = this._entry.connect('secondary-icon-clicked',
                    Lang.bind(this, this.reset));
        } else {
            if (this._iconClickedId > 0) {
                this._entry.disconnect(this._iconClickedId);
                this._iconClickedId = 0;
            }

            this._entry.set_secondary_icon(null);
            this._searchCancelled();
        }
    },

    _onKeyPress: function(entry, event) {
        let symbol = event.get_key_symbol();
        if (symbol == Clutter.Escape) {
            if (this._isActivated()) {
                this.reset();
                return true;
            }
        } else if (this._searchActive) {
            let arrowNext, nextDirection;
            if (entry.get_text_direction() == Clutter.TextDirection.RTL) {
                arrowNext = Clutter.Left;
                nextDirection = Gtk.DirectionType.LEFT;
            } else {
                arrowNext = Clutter.Right;
                nextDirection = Gtk.DirectionType.RIGHT;
            }

            if (symbol == arrowNext && this._text.position == -1) {
                return true;
            } else if (symbol == Clutter.Return || symbol == Clutter.KP_Enter) {
                this._activateDefaultSearch();
                return true;
            }
        }
        return false;
    },

    _onCapturedEvent: function(actor, event) {
        if (event.type() == Clutter.EventType.BUTTON_PRESS) {
            let source = event.get_source();
            if (source != this._text && this._text.text == '' &&
                !Main.layoutManager.keyboardBox.contains(source)) {
                // the user clicked outside after activating the entry, but
                // with no search term entered and no keyboard button pressed
                // - cancel the search
                this.reset();
            }
        }

        return false;
    },

    getActivePage: function() {
        return this._viewPageFromPage(this._activePage);
    },

    setActivePage: function(viewPage) {
        this._showPage(this._pageFromViewPage(viewPage));
    },

    fadeIn: function() {
        let actor = this._activePage;
        Tweener.addTween(actor, { opacity: 255,
                                  time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME / 2,
                                  transition: 'easeInQuad'
                                });
    },

    fadeHalf: function() {
        let actor = this._activePage;
        Tweener.addTween(actor, { opacity: 128,
                                  time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME / 2,
                                  transition: 'easeOutQuad'
                                });
    }
});
Signals.addSignalMethods(ViewSelector.prototype);
