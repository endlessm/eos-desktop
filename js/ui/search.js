// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;
const Signals = imports.signals;
const St = imports.gi.St;
const Atk = imports.gi.Atk;

const ActorVisibility = imports.misc.actorVisibility;
const AppDisplay = imports.ui.appDisplay;
const DND = imports.ui.dnd;
const IconGrid = imports.ui.iconGrid;
const IconGridLayout = imports.ui.iconGridLayout;
const InternetSearch = imports.ui.internetSearch;
const Main = imports.ui.main;
const Overview = imports.ui.overview;
const RemoteSearch = imports.ui.remoteSearch;
const Separator = imports.ui.separator;

const SEARCH_PROVIDERS_SCHEMA = 'org.gnome.desktop.search-providers';

const MAX_LIST_SEARCH_RESULTS_ROWS = 3;
const MAX_GRID_SEARCH_RESULTS_ROWS = 1;
const MAX_GRID_SEARCH_RESULTS_COLS = 8;

const SearchResultsBin = new Lang.Class({
    Name: 'SearchResultsBin',
    Extends: St.Widget,

    vfunc_get_preferred_height: function(forHeight) {
        let themeNode = this.get_theme_node();
        let marginBottom = themeNode.get_length('-margin-bottom');

        let [min, nat] = this.parent(forHeight);
        return [min + marginBottom, nat + marginBottom];
    },

    vfunc_get_preferred_width: function(forHeight) {
        let themeNode = this.get_theme_node();
        let maxWidth = themeNode.get_max_width();
        let marginHorizontal = themeNode.get_length('-margin-horizontal');

        let [min, nat] = this.parent(forHeight);
        return [Math.min(maxWidth, min) + marginHorizontal,
                Math.min(maxWidth, nat) + marginHorizontal];
    },

    vfunc_allocate: function(box, flags) {
        let themeNode = this.get_theme_node();
        let maxWidth = themeNode.get_max_width();
        let marginBottom = themeNode.get_length('-margin-bottom');
        let marginHorizontal = themeNode.get_length('-margin-horizontal');

        box.x1 += marginHorizontal;
        box.x2 -= marginHorizontal;
        box.y2 -= marginBottom;

        let availWidth = box.x2 - box.x1;
        if (availWidth > maxWidth) {
            let excessWidth = availWidth - maxWidth;
            box.x1 += Math.floor(excessWidth / 2);
            box.x2 -= Math.floor(excessWidth / 2);
        }

        this.parent(box, flags);
    }
});

const SearchIcon = new Lang.Class({
    Name: 'SearchIcon',

    _init : function(app) {
        let id = app.get_id();
        let appSystem = Shell.AppSystem.get_default();
        let displayApp = appSystem.lookup_heuristic_basename(id);
        this._app = displayApp;

        this.icon = new IconGrid.BaseIcon(this._app.get_name(),
                                          { createIcon: Lang.bind(this, this._createIcon) },
                                          { reactive: false });
        this.actor = this.icon.actor;
    },

    _createIcon: function(iconSize) {
        return this._app.create_icon_texture(iconSize);
    },
});

const SearchResult = new Lang.Class({
    Name: 'SearchResult',

    _init: function(provider, metaInfo) {
        this.provider = provider;
        this.metaInfo = metaInfo;

        this.actor = new St.Button({ reactive: true,
                                     can_focus: true,
                                     track_hover: true,
                                     x_align: St.Align.START,
                                     y_fill: true });

        this.actor._delegate = this;
        this.actor.connect('clicked', Lang.bind(this, this.activate));
    },

    activate: function() {
        this.emit('activate', this.metaInfo.id);
        Main.overview.hide();
    },

    setSelected: function(selected) {
        if (selected)
            this.actor.add_style_pseudo_class('selected');
        else
            this.actor.remove_style_pseudo_class('selected');
    }
});
Signals.addSignalMethods(SearchResult.prototype);

const ListDescriptionBox = new Lang.Class({
    Name: 'ListDescriptionBox',
    Extends: St.BoxLayout,

    _init: function(params) {
        this.parent(params);
    },

    vfunc_get_preferred_height: function(forWidth) {
        // This container requests space for the title and description
        // regardless of visibility, but allocates normally to visible actors.
        // This allows us have a constant sized box, but still center the title
        // label when the description is not present.
        let min = 0, nat = 0;
        let children = this.get_children();
        for (let i = 0; i < children.length; i++) {
            let child = children[i];
            let [childMin, childNat] = child.get_preferred_height(forWidth);
            min += childMin;
            nat += childNat;
        }
        return [min, nat];
    }
});

const ListSearchResult = new Lang.Class({
    Name: 'ListSearchResult',
    Extends: SearchResult,

    ICON_SIZE: 32,

    _init: function(provider, metaInfo) {
        this.parent(provider, metaInfo);

        this.actor.style_class = 'list-search-result';
        this.actor.x_fill = true;

        let content = new St.BoxLayout({ style_class: 'list-search-result-content',
                                         vertical: false });
        this.actor.set_child(content);

        // An icon for, or thumbnail of, content
        let icon = this.metaInfo['createIcon'](this.ICON_SIZE);
        if (icon) {
            content.add(icon);
        }

        let details = new ListDescriptionBox({ vertical: true });
        content.add(details, { x_fill: true,
                               y_fill: false,
                               x_align: St.Align.START,
                               y_align: St.Align.MIDDLE });

        let title = new St.Label({ style_class: 'list-search-result-title',
                                   text: this.metaInfo['name'],
                                   y_align: Clutter.ActorAlign.CENTER });
        details.add(title, { x_fill: false,
                             y_fill: true,
                             x_align: St.Align.START,
                             expand: true });
        this.actor.label_actor = title;

        let description = new St.Label({ style_class: 'list-search-result-description',
                                         visible: false });
        details.add(description, { x_fill: false,
                                   y_fill: false,
                                   x_align: St.Align.START,
                                   y_align: St.Align.END });
        if (this.metaInfo['description']) {
            description.clutter_text.set_markup(this.metaInfo['description']);
            description.show();
        }

        let hoverIcon = new St.Icon({ style_class: 'list-search-result-arrow-icon',
                                      icon_name: 'go-next-symbolic' });
        content.add(hoverIcon,  { x_fill: false,
                                  x_align: St.Align.END,
                                  expand: true });
    }
});

const GridSearchResult = new Lang.Class({
    Name: 'GridSearchResult',
    Extends: SearchResult,

    _init: function(provider, metaInfo) {
        this.parent(provider, metaInfo);

        this.actor.style_class = 'grid-search-result';

        let icon = new SearchIcon(metaInfo['id']);
        this.actor.set_child(icon.actor);
        this.actor.label_actor = icon.actor.label_actor;
    },
});

const SearchResultsBase = new Lang.Class({
    Name: 'SearchResultsBase',

    _init: function(provider) {
        this.provider = provider;

        this._terms = [];

        this.actor = new St.BoxLayout({ style_class: 'search-section',
                                        vertical: true });

        this._resultDisplayBin = new St.Bin({ x_fill: true,
                                              y_fill: true });
        this.actor.add(this._resultDisplayBin, { expand: true });

        this.separator = new Separator.HorizontalSeparator({ style_class: 'search-section-separator' });
        this.actor.add(this.separator.actor);

        this._resultDisplays = {};

        this._cancellable = new Gio.Cancellable();
    },

    destroy: function() {
        this.actor.destroy();
        this._terms = [];
    },

    _clearResultDisplay: function() {
    },

    clear: function() {
        for (let resultId in this._resultDisplays)
            this._resultDisplays[resultId].actor.destroy();
        this._resultDisplays = {};
        this._clearResultDisplay();
        this.actor.hide();
    },

    _keyFocusIn: function(actor) {
        this.emit('key-focus-in', actor);
    },

    _activateResult: function(result, id) {
        this.provider.activateResult(id, this._terms);
        Main.overview.hide();
    },

    _ensureResultActors: function(results, callback) {
        let metasNeeded = results.filter(Lang.bind(this, function(resultId) {
            return this._resultDisplays[resultId] === undefined;
        }));

        if (metasNeeded.length === 0) {
            callback(true);
        } else {
            this._cancellable.cancel();
            this._cancellable.reset();

            this.provider.getResultMetas(metasNeeded, Lang.bind(this, function(metas) {
                if (metas.length != metasNeeded.length) {
                    log('Wrong number of result metas returned by search provider ' + this.provider.id +
                        ': expected ' + metasNeeded.length + ' but got ' + metas.length);
                    callback(false);
                    return;
                }

                metasNeeded.forEach(Lang.bind(this, function(resultId, i) {
                    let meta = metas[i];
                    let display = this._createResultDisplay(meta);
                    display.connect('activate', Lang.bind(this, this._activateResult));
                    display.actor.connect('key-focus-in', Lang.bind(this, this._keyFocusIn));
                    this._resultDisplays[resultId] = display;
                }));
                callback(true);
            }), this._cancellable);
        }
    },

    updateSearch: function(providerResults, terms, callback) {
        this._terms = terms;

        if (providerResults.length == 0) {
            this._clearResultDisplay();
            this.actor.hide();
            callback();
        } else {
            let maxResults = this._getMaxDisplayedResults();
            let results = this.provider.filterResults(providerResults, maxResults);
            let hasMoreResults = results.length < providerResults.length;

            this._ensureResultActors(results, Lang.bind(this, function(successful) {
                if (!successful) {
                    this._clearResultDisplay();
                    callback();
                    return;
                }

                // To avoid CSS transitions causing flickering when
                // the first search result stays the same, we hide the
                // content while filling in the results.
                this.actor.hide();
                this._clearResultDisplay();
                results.forEach(Lang.bind(this, function(resultId) {
                    this._addItem(this._resultDisplays[resultId]);
                }));
                this.actor.show();
                callback();
            }));
        }
    }
});

const ListSearchResults = new Lang.Class({
    Name: 'ListSearchResults',
    Extends: SearchResultsBase,

    _init: function(provider) {
        this.parent(provider);

        this._container = new St.BoxLayout({ style_class: 'search-section-content' });

        let providerIcon = new SearchIcon(provider.app);
        let providerButton = new St.Button({ style_class: 'search-provider',
                                             can_focus: true,
                                             child: providerIcon.actor });
        providerButton.connect('key-focus-in', Lang.bind(this, this._keyFocusIn));
        providerButton.connect('clicked', Lang.bind(this,
            function() {
                provider.launchSearch(this._terms);
                Main.overview.hide();
            }));

        this._container.add(providerButton, { x_fill: false,
                                              y_fill: false,
                                              x_align: St.Align.START,
                                              y_align: St.Align.START });

        this._content = new St.BoxLayout({ style_class: 'list-search-results',
                                           vertical: true });
        this._container.add(this._content, { expand: true,
                                             y_fill: false,
                                             y_align: St.Align.MIDDLE });


        this._resultDisplayBin.set_child(this._container);
    },

    _getMaxDisplayedResults: function() {
        return MAX_LIST_SEARCH_RESULTS_ROWS;
    },

    _clearResultDisplay: function () {
        this._content.remove_all_children();
    },

    _createResultDisplay: function(meta) {
        return new ListSearchResult(this.provider, meta);
    },

    _addItem: function(display) {
        if (this._content.get_n_children() > 0) {
            let separator = new Separator.HorizontalSeparator({ style_class: 'search-section-separator' });
            this._content.add(separator.actor);
        }
        this._content.add(display.actor, { expand: true });
    },

    getFirstResult: function() {
        if (this._content.get_n_children() > 0)
            return this._content.get_child_at_index(0)._delegate;
        else
            return null;
    }
});
Signals.addSignalMethods(ListSearchResults.prototype);

const GridSearchResults = new Lang.Class({
    Name: 'GridSearchResults',
    Extends: SearchResultsBase,

    _init: function(provider) {
        this.parent(provider);

        this._grid = new IconGrid.IconGrid({ rowLimit: MAX_GRID_SEARCH_RESULTS_ROWS,
                                             xAlign: St.Align.MIDDLE });
        this._bin = new St.Bin({ x_align: St.Align.MIDDLE });
        this._bin.set_child(this._grid.actor);

        this._resultDisplayBin.set_child(this._bin);
    },

    _getMaxDisplayedResults: function() {
        return MAX_GRID_SEARCH_RESULTS_ROWS * MAX_GRID_SEARCH_RESULTS_COLS;
    },

    _clearResultDisplay: function () {
        this._grid.removeAll();
    },

    _createResultDisplay: function(meta) {
        return new GridSearchResult(this.provider, meta);
    },

    _addItem: function(display) {
        this._grid.addItem(display.actor);
    },

    getFirstResult: function() {
        if (this._grid.visibleItemsCount() > 0)
            return this._grid.getItemAtIndex(0)._delegate;
        else
            return null;
    }
});
Signals.addSignalMethods(GridSearchResults.prototype);

const SearchResults = new Lang.Class({
    Name: 'SearchResults',

    _init: function() {
        this.actor = new SearchResultsBin({ name: 'searchResults',
                                            reactive: true,
                                            y_align: Clutter.ActorAlign.FILL,
                                            layout_manager: new Clutter.BinLayout() });
        this.actor.connect('button-press-event', function (actor, event) {
            if (event.get_button() != Gdk.BUTTON_PRIMARY) {
                return true;
            }
        });
        this.actor.connect('button-release-event', function (actor, event) {
            if (event.get_button() != Gdk.BUTTON_PRIMARY) {
                return true;
            }
        });

        let box = new St.BoxLayout({ name: 'searchResultsBox',
                                     vertical: true,
                                     y_align: Clutter.ActorAlign.FILL,
                                     x_align: Clutter.ActorAlign.FILL,
                                     x_expand: true,
                                     y_expand: true });
        this.actor.add_child(box);

        let closeIcon = new St.Icon({ icon_name: 'window-close-symbolic' });
        let closeButton = new St.Button({ name: 'searchResultsCloseButton',
                                          child: closeIcon,
                                          x_expand: true,
                                          y_expand: true });
        // We need to set the ClutterActor align, not St.Bin
        closeButton.set_x_align(Clutter.ActorAlign.END);
        closeButton.set_y_align(Clutter.ActorAlign.START);
        closeButton.connect('clicked', Lang.bind(this, function () {
            this.emit('search-close-clicked');
        }));
        this.actor.add_child(closeButton);

        this._topContent = new St.BoxLayout({ name: 'searchResultsTopContent',
                                              vertical: true });

        this._scrollContent = new St.BoxLayout({ name: 'searchResultsScrollContent',
                                                 vertical: true });

        this._scrollView = new St.ScrollView({ x_fill: true,
                                               y_fill: true,
                                               style_class: 'search-scroll vfade' });
        this._scrollView.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this._scrollView.add_actor(this._scrollContent);
        let action = new Clutter.PanAction({ interpolate: true });
        action.connect('pan', Lang.bind(this, this._onPan));
        this._scrollView.add_action(action);

        box.add(this._topContent, { x_fill: true });

        box.add(this._scrollView, { x_fill: true,
                                           y_fill: true,
                                           expand: true,
                                           x_align: St.Align.START,
                                           y_align: St.Align.START });

        this._statusText = new St.Label({ style_class: 'search-statustext' });
        this._statusBin = new St.Bin({ x_align: St.Align.MIDDLE,
                                       y_align: St.Align.MIDDLE });
        box.add(this._statusBin, { expand: true });
        this._statusBin.add_actor(this._statusText);

        this._highlightDefault = false;
        this._defaultResult = null;
        this._startingSearch = false;

        this._terms = [];
        this._results = {};
        this._isAnimating = false;

        this._providers = [];

        this._searchSettings = new Gio.Settings({ schema: SEARCH_PROVIDERS_SCHEMA });
        this._searchSettings.connect('changed::disabled', Lang.bind(this, this._reloadRemoteProviders));
        this._searchSettings.connect('changed::disable-external', Lang.bind(this, this._reloadRemoteProviders));
        this._searchSettings.connect('changed::sort-order', Lang.bind(this, this._reloadRemoteProviders));

        let appSystem = Shell.AppSystem.get_default();
        appSystem.connect('installed-changed', Lang.bind(this, this._reloadRemoteProviders));

        this._searchTimeoutId = 0;
        this._cancellable = new Gio.Cancellable();

        this._appProvider = new AppDisplay.AppSearchProvider();
        this._registerProvider(this._appProvider);
        this._registerProvider(new InternetSearch.InternetSearchProvider());
        this._reloadRemoteProviders();
    },

    _reloadRemoteProviders: function() {
        let remoteProviders = this._providers.filter(function(provider) {
            return provider.isRemoteProvider;
        });
        remoteProviders.forEach(Lang.bind(this, function(provider) {
            this._unregisterProvider(provider);
        }));

        RemoteSearch.loadRemoteSearchProviders(Lang.bind(this, function(providers) {
            providers.forEach(Lang.bind(this, this._registerProvider));
        }));
    },

    _registerProvider: function (provider) {
        this._providers.push(provider);
        this._ensureProviderDisplay(provider);
    },

    _unregisterProvider: function (provider) {
        let index = this._providers.indexOf(provider);
        this._providers.splice(index, 1);

        if (provider.display)
            provider.display.destroy();
    },

    _gotResults: function(results, provider) {
        this._results[provider.id] = results;
        this._updateResults(provider, results);
    },

    _clearSearchTimeout: function() {
        if (this._searchTimeoutId > 0) {
            GLib.source_remove(this._searchTimeoutId);
            this._searchTimeoutId = 0;
        }
    },

    _doSearch: function() {
        this._startingSearch = false;

        let previousResults = this._results;
        this._results = {};

        this._providers.forEach(Lang.bind(this, function(provider) {
            provider.searchInProgress = true;

            let previousProviderResults = previousResults[provider.id];
            if (this._isSubSearch && previousProviderResults)
                provider.getSubsearchResultSet(previousProviderResults, this._terms, Lang.bind(this, this._gotResults, provider), this._cancellable);
            else
                provider.getInitialResultSet(this._terms, Lang.bind(this, this._gotResults, provider), this._cancellable);
        }));

        this._updateSearchProgress();
        this._clearSearchTimeout();
    },

    _onSearchTimeout: function() {
        this._searchTimeoutId = 0;
        this._doSearch();
        return GLib.SOURCE_REMOVE;
    },

    _reset: function() {
        this._terms = [];
        this._results = {};
        this._clearDisplay();
        this._clearSearchTimeout();
        this._defaultResult = null;
        this._startingSearch = false;

        this._updateSearchProgress();
    },

    setTerms: function(terms) {
        // Check for the case of making a duplicate previous search before
        // setting state of the current search or cancelling the search.
        // This will prevent incorrect state being as a result of a duplicate
        // search while the previous search is still active.
        let searchString = terms.join(' ');
        let previousSearchString = this._terms.join(' ');
        if (searchString == previousSearchString)
            return;

        let searchEmpty = searchString.length == 0;
        let previousSearchEmpty = previousSearchString.length == 0;

        this._cancellable.cancel();
        this._cancellable.reset();

        // On first search after fade out, reset all state.
        if (previousSearchEmpty)
            this._reset();

        this._terms = terms;

        // On an empty search leave old results up, we will fade out the actor.
        if (searchEmpty)
            return;

        // We won't use a timeout for our first search, to get some results on
        // screen as quick as possible.
        if (previousSearchEmpty) {
            this._doSearch();
            return;
        }

        let isSubSearch = false;
        if (this._terms.length > 0)
            isSubSearch = searchString.indexOf(previousSearchString) == 0;

        this._isSubSearch = isSubSearch;
        this._updateSearchProgress();

        this._startingSearch = true;
        if (this._searchTimeoutId == 0)
            this._searchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, Lang.bind(this, this._onSearchTimeout));
    },

    _onPan: function(action) {
        let [dist, dx, dy] = action.get_motion_delta(0);
        let adjustment = this._scrollView.vscroll.adjustment;
        adjustment.value -= (dy / this.actor.height) * adjustment.page_size;
        return false;
    },

    _ensureResultActorVisible: function(resultActor) {
        if (this._scrollView.contains(resultActor))
            ActorVisibility.ensureActorVisibleInScrollView(this._scrollView, resultActor);
    },

    _keyFocusIn: function(provider, actor) {
        this._ensureResultActorVisible(actor);
    },

    _ensureProviderDisplay: function(provider) {
        if (provider.display)
            return;

        let providerDisplay;
        if (provider === this._appProvider) {
            providerDisplay = new GridSearchResults(provider);
            this._topContent.add(providerDisplay.actor);
        } else {
            providerDisplay = new ListSearchResults(provider);
            this._scrollContent.add(providerDisplay.actor);
        }

        providerDisplay.connect('key-focus-in', Lang.bind(this, this._keyFocusIn));
        providerDisplay.actor.hide();
        provider.display = providerDisplay;
    },

    _clearDisplay: function() {
        this._providers.forEach(function(provider) {
            provider.display.clear();
        });
    },

    _maybeSetInitialSelection: function() {
        let newDefaultResult = null;

        let providers = this._providers;
        for (let i = 0; i < providers.length; i++) {
            let provider = providers[i];
            let display = provider.display;

            if (!display.actor.visible)
                continue;

            let firstResult = display.getFirstResult();
            if (firstResult) {
                newDefaultResult = firstResult;
                break; // select this one!
            }
        }

        if (newDefaultResult != this._defaultResult) {
            if (this._defaultResult)
                this._defaultResult.setSelected(false);
            if (newDefaultResult) {
                newDefaultResult.setSelected(this._highlightDefault);
                if (this._highlightDefault)
                    this._ensureResultActorVisible(newDefaultResult.actor);
            }

            this._defaultResult = newDefaultResult;
        }
    },

    get searchInProgress() {
        if (this._startingSearch)
            return true;

        return this._providers.some(function(provider) {
            return provider.searchInProgress;
        });
    },

    get isAnimating() {
        return this._isAnimating;
    },

    set isAnimating (v) {
        if (this._isAnimating == v)
            return;

        this._isAnimating = v;
        this._updateSearchProgress();
        if (!this._isAnimating) {
            this._providers.forEach(Lang.bind(this, function (provider) {
                let results = this._results[provider.id];
                if (results) {
                    this._updateResults(provider, results);
                }
            }));
        }
    },

    _syncSeparatorVisiblity: function () {
        let lastVisibleDisplay;
        for (let i = 0; i < this._providers.length; i++) {
            let provider = this._providers[i];
            let display = provider.display;

            display.separator.actor.show();
            if (display.actor.visible)
                lastVisibleDisplay = display;
        }
        if (lastVisibleDisplay)
            lastVisibleDisplay.separator.actor.hide();
    },

    _updateSearchProgress: function () {
        let haveResults = this._providers.some(function(provider) {
            let display = provider.display;
            return (display.getFirstResult() != null);
        });
        let showStatus = !haveResults && !this.isAnimating;

        this._syncSeparatorVisiblity();
        this._scrollView.visible = haveResults;
        this._topContent.visible = haveResults;
        this._statusBin.visible = showStatus;

        if (showStatus) {
            if (this.searchInProgress) {
                this._statusText.set_text(_("Searching…"));
            } else {
                this._statusText.set_text(_("No results."));
            }
        }

        this.emit('search-progress-updated');
    },

    _updateResults: function(provider, results) {
        if (this.isAnimating)
            return;

        let terms = this._terms;
        let display = provider.display;

        display.updateSearch(results, terms, Lang.bind(this, function() {
            provider.searchInProgress = false;

            this._maybeSetInitialSelection();
            this._updateSearchProgress();
        }));
    },

    activateDefault: function() {
        // If we are about to activate a result, we are done animating and need
        // to update the display immediately.
        this.isAnimating = false;

        // If we have a search queued up, force the search now.
        if (this._searchTimeoutId > 0)
            this._doSearch();

        if (this._defaultResult)
            this._defaultResult.activate();
    },

    highlightDefault: function(highlight) {
        this._highlightDefault = highlight;
        if (this._defaultResult) {
            this._defaultResult.setSelected(highlight);
            if (highlight)
                this._ensureResultActorVisible(this._defaultResult.actor);
        }
    },

    navigateFocus: function(direction) {
        let rtl = this.actor.get_text_direction() == Clutter.TextDirection.RTL;
        if (direction == Gtk.DirectionType.TAB_BACKWARD ||
            direction == (rtl ? Gtk.DirectionType.RIGHT
                              : Gtk.DirectionType.LEFT) ||
            direction == Gtk.DirectionType.UP) {
            this.actor.navigate_focus(null, direction, false);
            return;
        }

        let from = this._defaultResult ? this._defaultResult.actor : null;
        this.actor.navigate_focus(from, direction, false);
    }
});
Signals.addSignalMethods(SearchResults.prototype);
