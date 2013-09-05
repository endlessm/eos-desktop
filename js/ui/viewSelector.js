// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Signals = imports.signals;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const Params = imports.misc.params;
const RemoteSearch = imports.ui.remoteSearch;
const Search = imports.ui.search;
const SearchDisplay = imports.ui.searchDisplay;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const WorkspacesView = imports.ui.workspacesView;

const BASE_SEARCH_URI = 'http://www.google.com/';
const QUERY_URI_PATH = 'search?q=';

const SEARCH_TIMEOUT = 150;
const SHELL_KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';

const ViewPage = {
    WINDOWS: 1,
    APPS: 2,
};

const ViewsDisplayLayout = new Lang.Class({
    Name: 'ViewsDisplayLayout',
    Extends: Clutter.BinLayout,

    _init: function(stack, entry, allView) {
        this.parent();

        this._stack = stack;

        this._allView = allView;
        this._allView.actor.connect('style-changed', Lang.bind(this, this._onStyleChanged));

        this._entry = entry;
        this._entry.connect('style-changed', Lang.bind(this, this._onStyleChanged));
    },

    _onStyleChanged: function() {
        this.layout_changed();
    },

    vfunc_allocate: function(container, box, flags) {
        let viewActor = this._stack;
        let entry = this._entry;

        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        let viewHeight = viewActor.get_preferred_height(availWidth);
        viewHeight[1] = Math.max(viewHeight[1], this._allView.getEntryAnchor());

        let themeNode = entry.get_theme_node();
        let entryMinPadding = themeNode.get_length('-minimum-vpadding');
        let entryHeight = entry.get_preferred_height(availWidth);
        entryHeight[0] += entryMinPadding * 2;
        entryHeight[1] += entryMinPadding * 2;

        let entryBox = box.copy();
        let viewBox = box.copy();

        // Always give the view the whole allocation, unless
        // doing so wouldn't fit the entry
        let extraSpace = availHeight - viewHeight[1];
        let viewAllocHeight = viewHeight[1];

        if (extraSpace / 2 < entryHeight[0]) {
            extraSpace = 0;
            viewAllocHeight = availHeight - entryHeight[0];
        }

        viewBox.y1 = Math.floor(extraSpace / 2);
        viewBox.y2 = viewBox.y1 + viewAllocHeight;

        viewActor.allocate(viewBox, flags);

        // Now center the entry in the space below the grid
        let gridHeight = this._allView.getHeightForEntry(availWidth);

        extraSpace = availHeight - gridHeight[1];
        viewAllocHeight = gridHeight[1];

        if (extraSpace / 2 < entryHeight[0]) {
            extraSpace = 0;
            viewAllocHeight = availHeight - entryHeight[0];
        }

        entryBox.y1 = Math.floor(extraSpace / 2) + viewAllocHeight;
        entry.allocate(entryBox, flags);
    }
});

const FocusTrap = new Lang.Class({
    Name: 'FocusTrap',
    Extends: St.Widget,

    vfunc_navigate_focus: function(from, direction) {
        if (direction == Gtk.DirectionType.TAB_FORWARD ||
            direction == Gtk.DirectionType.TAB_BACKWARD)
            return this.parent(from, direction);
        return false;
    }
});

const ViewsDisplay = new Lang.Class({
    Name: 'ViewsDisplay',

    _init: function() {
        this._activePage = null;
        this._searchTimeoutId = 0;

        this._stack = new Shell.Stack({ x_expand: true,
                                        y_expand: true });

        this._appSystem = Shell.AppSystem.get_default();
        this._allView = new AppDisplay.AllView();
        this._addPage(this._allView.actor);

        this._searchSystem = new Search.SearchSystem();
        this._searchResults = new SearchDisplay.SearchResults(this._searchSystem);
        this._addPage(this._searchResults.actor);

        // Since the entry isn't inside the results container we install this
        // dummy widget as the last results container child so that we can
        // include the entry in the keynav tab path
        this._focusTrap = new FocusTrap({ can_focus: true });
        this._focusTrap.connect('key-focus-in', Lang.bind(this, function() {
            this.entry.grab_key_focus();
        }));
        this._searchResults.actor.add_actor(this._focusTrap);

        global.focus_manager.add_group(this._searchResults.actor);

        this.entry = new ShellEntry.OverviewEntry();
        this.entry.connect('search-activated', Lang.bind(this, this._onSearchActivated));
        this.entry.connect('search-active-changed', Lang.bind(this, this._onSearchActiveChanged));
        this.entry.connect('search-navigate-focus', Lang.bind(this, this._onSearchNavigateFocus));
        this.entry.connect('search-state-changed', Lang.bind(this, this._onSearchStateChanged));
        this.entry.connect('search-terms-changed', Lang.bind(this, this._onSearchTermsChanged));

        this.entry.clutter_text.connect('key-focus-in', Lang.bind(this, function() {
            this._searchResults.highlightDefault(true);
        }));
        this.entry.clutter_text.connect('key-focus-out', Lang.bind(this, function() {
            this._searchResults.highlightDefault(false);
        }));

        let layoutManager = new ViewsDisplayLayout(this._stack, this.entry, this._allView);
        this.actor = new St.Widget({ layout_manager: layoutManager,
                                     x_expand: true,
                                     y_expand: true });

        this.actor.add_actor(this.entry);
        this.actor.add_actor(this._stack);

        // This makes sure that any DnD ops get channeled to the icon grid logic
        // otherwise dropping an item outside of the grid bounds fails
        this.actor._delegate = this;

        // Setup search
        this._searchSettings = new Gio.Settings({ schema: Search.SEARCH_PROVIDERS_SCHEMA });
        this._searchSettings.connect('changed::disabled', Lang.bind(this, this._reloadRemoteProviders));
        this._searchSettings.connect('changed::disable-external', Lang.bind(this, this._reloadRemoteProviders));
        this._searchSettings.connect('changed::sort-order', Lang.bind(this, this._reloadRemoteProviders));

        // Default search providers
        this._addSearchProvider(new AppDisplay.AppSearchProvider());

        // Load remote search providers provided by applications
        RemoteSearch.loadRemoteSearchProviders(Lang.bind(this, this._addSearchProvider));

        this._showPage(this._allView.actor);
    },

    _addPage: function(page) {
        page.visible = false;
        page.y_align = Clutter.ActorAlign.START;
        this._stack.add_actor(page);
    },

    _showPage: function(page) {
        if (page == this._activePage) {
            return;
        }

        if (this._activePage) {
            this._activePage.hide();
        }

        this._activePage = page;

        if (this._activePage) {
            this._activePage.show();
        }
    },

    _activateGoogleSearch: function() {
        let uri = BASE_SEARCH_URI;
        let terms = this.entry.getSearchTerms();
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

    _doLocalSearch: function() {
        this._searchTimeoutId = 0;

        let terms = this.entry.getSearchTerms();
        this._searchSystem.updateSearchResults(terms);

        return false;
    },

    _clearLocalSearch: function() {
        if (this._searchTimeoutId > 0) {
            Mainloop.source_remove(this._searchTimeout);
            this._searchTimeoutId = 0;
        }

        this._searchResults.reset();
    },

    _queueLocalSearch: function() {
        if (this._searchTimeoutId == 0) {
            this._searchTimeoutId = Mainloop.timeout_add(SEARCH_TIMEOUT,
                Lang.bind(this, this._doLocalSearch));
        }
    },

    _enterLocalSearch: function() {
        this._searchResults.startingSearch();
        this._queueLocalSearch();
        this._showPage(this._searchResults.actor);        
    },

    _leaveLocalSearch: function() {
        this._clearLocalSearch();
        this._showPage(this._allView.actor);
    },

    _onSearchActivated: function() {
        let searchState = this.entry.getSearchState();
        if (searchState == ShellEntry.EntrySearchMenuState.GOOGLE) {
            this._activateGoogleSearch();
        } else if (searchState == ShellEntry.EntrySearchMenuState.LOCAL) {
            this._searchResults.activateDefault();
        } else if (searchState == ShellEntry.EntrySearchMenuState.WIKIPEDIA) {
            // TODO: wikipedia app activation goes here
            log('Wikipedia activation!');
        }
    },

    _onSearchActiveChanged: function() {
        let searchState = this.entry.getSearchState();
        if (searchState != ShellEntry.EntrySearchMenuState.LOCAL) {
            return;
        }

        if (this.entry.active) {
            this._enterLocalSearch();
        } else {
            this._leaveLocalSearch();
        }
    },

    _onSearchNavigateFocus: function(entry, direction) {
        let searchState = this.entry.getSearchState();
        if (searchState != ShellEntry.EntrySearchMenuState.LOCAL) {
            return;
        }

        this._searchResults.navigateFocus(direction);
    },

    _onSearchStateChanged: function() {
        let searchState = this.entry.getSearchState();
        if (searchState == ShellEntry.EntrySearchMenuState.LOCAL &&
            this.entry.active) {
            this._enterLocalSearch();
        } else {
            this._leaveLocalSearch();
        }
    },

    _onSearchTermsChanged: function() {
        let searchState = this.entry.getSearchState();
        if (searchState != ShellEntry.EntrySearchMenuState.LOCAL) {
            return;
        }

        this._queueLocalSearch();
    },

    _shouldUseSearchProvider: function(provider) {
        // the disable-external GSetting only affects remote providers
        if (!provider.isRemoteProvider) {
            return true;
        }

        if (this._searchSettings.get_boolean('disable-external')) {
            return false;
        }

        let appId = provider.app.get_id();
        let disable = this._searchSettings.get_strv('disabled');
        disable = disable.map(function(appId) {
            let shellApp = this._appSystem.lookup_heuristic_basename(appId);
            if (shellApp) {
                return shellApp.get_id();
            } else {
                return null;
            }
        });
        return disable.indexOf(appId) == -1;
    },

    _reloadRemoteProviders: function() {
        // removeSearchProvider() modifies the provider list we iterate on,
        // so make a copy first
        let remoteProviders = this._searchSystem.getRemoteProviders().slice(0);

        remoteProviders.forEach(Lang.bind(this, this._removeSearchProvider));
        RemoteSearch.loadRemoteSearchProviders(Lang.bind(this, this._addSearchProvider));
    },

    _addSearchProvider: function(provider) {
        if (!this._shouldUseSearchProvider(provider)) {
            return;
        }

        this._searchSystem.registerProvider(provider);
        this._searchResults.createProviderDisplay(provider);
    },

    _removeSearchProvider: function(provider) {
        this._searchSystem.unregisterProvider(provider);
        this._searchResults.destroyProviderDisplay(provider);
    },

    acceptDrop: function(source, actor, x, y, time) {
        // Forward all DnD releases to the scrollview if we're 
        // displaying apps
        if (this._activePage == this._allView.actor) {
            this._allView.acceptDrop(source, actor, x, y, time);
        }
    }
});

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

        this._viewsDisplay = new ViewsDisplay();
        this._appsPage = this._addPage(this._viewsDisplay.actor,
                                       _("Applications"), 'view-grid-symbolic');
        this._entry = this._viewsDisplay.entry;

        this._stageKeyPressId = 0;
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
        this._entry.resetSearch();
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

    _enableSearch: function() {
        this._stageKeyPressId = global.stage.connect('key-press-event',
            Lang.bind(this, this._onStageKeyPress));
    },

    _disableSearch: function() {
        if (this._stageKeyPressId != 0) {
            global.stage.disconnect(this._stageKeyPressId);
            this._stageKeyPressId = 0;
        }
    },

    _pageChanged: function() {
        if (this._activePage == this._appsPage) {
            this._showAppsButton.checked = true;
            this._enableSearch();
        } else {
            this._showAppsButton.checked = false;
            this._disableSearch();
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

        if (this._entry.handleStageEvent(event)) {
            return true;
        }

        if (this._entry.active) {
            return false;
        }

        let symbol = event.get_key_symbol();

        if (symbol == Clutter.Tab || symbol == Clutter.Down) {
            this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
            return true;
        } else if (symbol == Clutter.ISO_Left_Tab) {
            this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_BACKWARD, false);
            return true;
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
