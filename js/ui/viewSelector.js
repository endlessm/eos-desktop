// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const EosMetrics = imports.gi.EosMetrics;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Signals = imports.signals;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const IconGridLayout = imports.ui.iconGridLayout;
const LayoutManager = imports.ui.layout;
const Main = imports.ui.main;
const OverviewControls = imports.ui.overviewControls;
const Params = imports.misc.params;
const Search = imports.ui.search;
const ShellEntry = imports.ui.shellEntry;
const Tweener = imports.ui.tweener;
const Util = imports.misc.util;
const WorkspacesView = imports.ui.workspacesView;

const SEARCH_ACTIVATION_TIMEOUT = 50;
const SEARCH_METRIC_INACTIVITY_TIMEOUT_SECONDS = 3;
const SHELL_KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';

// Occurs when a user initiates a search from the desktop. The payload, with
// type `(us)`, consists of an enum value from the DesktopSearchProvider enum
// telling what kind of search was requested; followed by the search query.
const EVENT_DESKTOP_SEARCH = 'b02266bc-b010-44b2-ae0f-8f116ffa50eb';
// Represents the various search providers that can be used for searching from
// the desktop. Keep in sync with the corresponding enum in
// https://github.com/endlessm/eos-analytics/tree/master/src/main/java/com/endlessm/postprocessing/query/SearchQuery.java.
const DesktopSearchProvider = {
    MY_COMPUTER: 0,
};

const ViewPage = {
    WINDOWS: 1,
    APPS: 2,
};

const ViewsDisplayPage = {
    APP_GRID: 1,
    SEARCH: 2,
};

const ViewsDisplayLayout = new Lang.Class({
    Name: 'ViewsDisplayLayout',
    Extends: Clutter.BinLayout,

    _init: function(entry, allViewActor, searchResultsActor) {
        this.parent();

        this._entry = entry;
        this._allViewActor = allViewActor;
        this._searchResultsActor = searchResultsActor;

        this._entry.connect('style-changed', Lang.bind(this, this._onStyleChanged));
        this._allViewActor.connect('style-changed', Lang.bind(this, this._onStyleChanged));

        this._heightAboveEntry = 0;
        this.searchResultsTween = 0;
        this._lowResolutionMode = false;

        /* Setup composite mode */
        Main.layoutManager.connect('monitors-changed', Lang.bind(this, this._updateLowResolutionMode));
        this._updateLowResolutionMode();
    },

    _onStyleChanged: function() {
        this.layout_changed();
    },

    set searchResultsTween(v) {
        if (v == this._searchResultsTween || this._searchResultsActor == null)
            return;

        this._allViewActor.visible = v != 1;
        this._searchResultsActor.visible = v != 0;

        this._allViewActor.opacity = (1 - v) * 255;
        this._searchResultsActor.opacity = v * 255;

        let entryTranslation = - this._heightAboveEntry * v;
        this._entry.translation_y = entryTranslation;
        this._searchResultsActor.translation_y = entryTranslation;

        this._searchResultsTween = v;
    },

    get searchResultsTween() {
        return this._searchResultsTween;
    },

    _centeredHeightAbove: function (height, availHeight) {
        return Math.floor(Math.max((availHeight - height) / 2, 0));
    },

    _calcAllViewPlacement: function (viewHeight, entryHeight, availHeight) {
        // If we have the space for it, we add some padding to the top of the
        // all view when calculating its centered position. This is to offset
        // the icon labels at the bottom of the icon grid, so the icons
        // themselves appears centered.
        let themeNode = this._allViewActor.get_theme_node();
        let topPadding = themeNode.get_length('-natural-padding-top');
        let heightAbove = this._centeredHeightAbove(viewHeight + topPadding, availHeight);
        let leftover = Math.max(availHeight - viewHeight - heightAbove, 0);
        heightAbove += Math.min(topPadding, leftover);
        // Always leave enough room for the search entry at the top
        heightAbove = Math.max(entryHeight, heightAbove);
        return heightAbove;
    },

    vfunc_allocate: function(container, box, flags) {
        let availWidth = box.x2 - box.x1;
        let availHeight = box.y2 - box.y1;

        // Entry height
        let entryHeight = this._entry.get_preferred_height(availWidth)[1];
        let themeNode = this._entry.get_theme_node();
        let entryMinPadding = themeNode.get_length('-minimum-vpadding');
        let entryTopMargin = themeNode.get_length('margin-top');
        entryHeight += entryMinPadding * 2;

        // AllView height
        let allViewHeight = this._allViewActor.get_preferred_height(availWidth)[1];
        let heightAboveGrid = this._calcAllViewPlacement(allViewHeight, entryHeight, availHeight);
        this._heightAboveEntry = this._centeredHeightAbove(entryHeight, heightAboveGrid);

        let entryBox = box.copy();
        entryBox.y1 = this._heightAboveEntry + entryTopMargin;
        entryBox.y2 = entryBox.y1 + entryHeight;
        this._entry.allocate(entryBox, flags);

        let allViewBox = box.copy();
        allViewBox.y1 = this._calcAllViewPlacement(allViewHeight, entryHeight, availHeight);
        allViewBox.y2 = Math.min(allViewBox.y1 + allViewHeight, box.y2);
        this._allViewActor.allocate(allViewBox, flags);

        // The views clone does not have a searchResultsActor
        if (this._searchResultsActor) {
            let searchResultsBox = box.copy();
            let searchResultsHeight = availHeight - entryHeight;
            searchResultsBox.y1 = entryBox.y2;
            searchResultsBox.y2 = searchResultsBox.y1 + searchResultsHeight;
            this._searchResultsActor.allocate(searchResultsBox, flags);
        }
    },

    _updateLowResolutionMode: function() {
        if (this._lowResolutionMode == Main.lowResolutionDisplay)
            return;

        this._lowResolutionMode = Main.lowResolutionDisplay;

        /* When running on small screens, to make it fit 3 rows of icons,
         * reduce the space above and below the search entry by adding (or
         * removing, in case the screen is big enough) the .composite-mode
         * style class.
         */
        if (this._lowResolutionMode) {
            this._entry.add_style_class_name('low-resolution');
            this._allViewActor.add_style_class_name('low-resolution');
        } else {
            this.entry.remove_style_class_name('low-resolution');
            this._allViewActor.remove_style_class_name('low-resolution');
        }
    }
});

const ViewsDisplayContainer = new Lang.Class({
    Name: 'ViewsDisplayContainer',
    Extends: St.Widget,
    Signals: {
        'views-page-changed': { }
    },

    _init: function(entry, allView, searchResults) {
        this._activePage = null;

        this._entry = entry;
        this._allView = allView;
        this._searchResults = searchResults;

        let layoutManager = new ViewsDisplayLayout(entry, allView.actor, searchResults.actor);
        this.parent({ layout_manager: layoutManager,
                      x_expand: true,
                      y_expand: true });

        this.add_actor(this._entry);
        this.add_actor(this._allView.actor);
        this.add_actor(this._searchResults.actor);

        this._activePage = ViewsDisplayPage.APP_GRID;
    },

    _onTweenComplete: function() {
        this._searchResults.isAnimating = false;
    },

    showPage: function(page, doAnimation) {
        if (this._activePage !== page) {
            this._activePage = page;
            this.emit('views-page-changed');
        }

        let tweenTarget = page == ViewsDisplayPage.SEARCH ? 1 : 0;
        if (doAnimation) {
            this._searchResults.isAnimating = true;
            Tweener.addTween(this.layout_manager,
                             { searchResultsTween: tweenTarget,
                               transition: 'easeOutQuad',
                               time: 0.25,
                               onComplete: this._onTweenComplete,
                               onCompleteScope: this,
                             });
        } else {
            this.layout_manager.searchResultsTween = tweenTarget;
        }
    },

    getActivePage: function() {
        return this._activePage;
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
        this._enterSearchTimeoutId = 0;
        this._localSearchMetricTimeoutId = 0;

        this._allView = new AppDisplay.AllView();

        this._searchResults = new Search.SearchResults();
        this._searchResults.connect('search-progress-updated', Lang.bind(this, this._updateSpinner));
        this._searchResults.connect('search-close-clicked', Lang.bind(this, this._resetSearch));

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
        this.entry.connect('search-terms-changed', Lang.bind(this, this._onSearchTermsChanged));

        this.entry.clutter_text.connect('key-focus-in', Lang.bind(this, function() {
            this._searchResults.highlightDefault(true);
        }));
        this.entry.clutter_text.connect('key-focus-out', Lang.bind(this, function() {
            this._searchResults.highlightDefault(false);
        }));

        // Clicking on any empty area should exit search and get back to the desktop.
        let clickAction = new Clutter.ClickAction();
        clickAction.connect('clicked', Lang.bind(this, this._resetSearch));
        Main.overview.addAction(clickAction, false);
        this._searchResults.actor.bind_property('mapped', clickAction, 'enabled', GObject.BindingFlags.SYNC_CREATE);

        this.actor = new ViewsDisplayContainer(this.entry, this._allView, this._searchResults);
        // This makes sure that any DnD ops get channeled to the icon grid logic
        // otherwise dropping an item outside of the grid bounds fails
        this.actor._delegate = this;
    },

    _recordDesktopSearchMetric: function (query, searchProvider) {
        let eventRecorder = EosMetrics.EventRecorder.get_default();
        let auxiliaryPayload =
            new GLib.Variant('(us)', [searchProvider, query]);
        eventRecorder.record_event(EVENT_DESKTOP_SEARCH, auxiliaryPayload);
    },

    _updateSpinner: function() {
        this.entry.setSpinning(this._searchResults.searchInProgress);
    },

    _enterLocalSearch: function() {
        if (this._enterSearchTimeoutId > 0)
            return;

        // We give a very short time for search results to populate before
        // triggering the animation, unless an animation is already in progress
        if (this._searchResults.isAnimating) {
            this.actor.showPage(ViewsDisplayPage.SEARCH, true);
            return;
        }

        this._enterSearchTimeoutId = Mainloop.timeout_add(SEARCH_ACTIVATION_TIMEOUT, Lang.bind(this, function () {
            this._enterSearchTimeoutId = 0;
            this.actor.showPage(ViewsDisplayPage.SEARCH, true);
        }));
    },

    _leaveLocalSearch: function() {
        if (this._enterSearchTimeoutId > 0) {
            Mainloop.source_remove(this._enterSearchTimeoutId);
            this._enterSearchTimeoutId = 0;
        }
        this.actor.showPage(ViewsDisplayPage.APP_GRID, true);
    },

    _onSearchActivated: function() {
        this._searchResults.activateDefault();
        this._resetSearch();
    },

    _onSearchActiveChanged: function() {
        if (this.entry.active) {
            this._enterLocalSearch();
        } else {
            this._leaveLocalSearch();
        }
    },

    _onSearchNavigateFocus: function(entry, direction) {
        this._searchResults.navigateFocus(direction);
    },

    _onSearchTermsChanged: function() {
        let terms = this.entry.getSearchTerms();
        this._searchResults.setTerms(terms);

        // Since the search is live, only record a metric a few seconds after
        // the user has stopped typing. Don't record one if the user deleted
        // what they wrote and left it at that.
        if (this._localSearchMetricTimeoutId > 0)
            Mainloop.source_remove(this._localSearchMetricTimeoutId);
        this._localSearchMetricTimeoutId = Mainloop.timeout_add_seconds(
            SEARCH_METRIC_INACTIVITY_TIMEOUT_SECONDS,
            function () {
                let query = terms.join(' ');
                if (query !== '')
                    this._recordDesktopSearchMetric(query,
                        DesktopSearchProvider.MY_COMPUTER);
                this._localSearchMetricTimeoutId = 0;
                return GLib.SOURCE_REMOVE;
            }.bind(this));
    },

    _resetSearch: function() {
        this.entry.resetSearch();
    },

    acceptDrop: function(source, actor, x, y, time) {
        // Forward all DnD releases to the scrollview if we're 
        // displaying apps
        if (this.actor.activePage == this._allView.actor) {
            this._allView.acceptDrop(source, actor, x, y, time);
        }
    },

    get allView() {
        return this._allView;
    },

    get activeViewsPage() {
        return this.actor.getActivePage();
    }
});

const ViewsClone = new Lang.Class({
    Name: 'ViewsClone',
    Extends: St.Widget,

    _init: function(viewSelector, viewsDisplay, forOverview) {
        let settings = Clutter.Settings.get_default();

        this._viewSelector = viewSelector;
        this._viewsDisplay = viewsDisplay;
        this._forOverview = forOverview;

        let allView = this._viewsDisplay.allView;
        let entry = new ShellEntry.OverviewEntry();
        entry.reactive = false;
        entry.clutter_text.reactive = false;

        let iconGridClone = new Clutter.Clone({ source: allView.gridActor,
                                                x_expand: true });
        let appGridContainer = new AppDisplay.AllViewContainer(iconGridClone);
        appGridContainer.reactive = false;

        let layoutManager = new ViewsDisplayLayout(entry, appGridContainer, null);
        this.parent({ layout_manager: layoutManager,
                      x_expand: true,
                      y_expand: true,
                      opacity: AppDisplay.INACTIVE_GRID_OPACITY });

        this._saturation = new Clutter.DesaturateEffect({ factor: AppDisplay.INACTIVE_GRID_SATURATION,
                                                          enabled: false });
        iconGridClone.add_effect(this._saturation);

        this.add_child(entry);
        this.add_child(appGridContainer);

        let workareaConstraint = new LayoutManager.MonitorConstraint({ primary: true,
                                                                       use_workarea: true });
        this.add_constraint(workareaConstraint);

        Main.overview.connect('showing', Lang.bind(this, function() {
            this.opacity = AppDisplay.INACTIVE_GRID_OPACITY;
            this._saturation.factor = AppDisplay.INACTIVE_GRID_SATURATION;
            this._saturation.enabled = this._forOverview;
        }));
        Main.overview.connect('hidden', Lang.bind(this, function() {
            this.opacity = AppDisplay.INACTIVE_GRID_OPACITY;
            this._saturation.factor = AppDisplay.INACTIVE_GRID_SATURATION;
            this._saturation.enabled = !this._forOverview;

            // When we're hidden and coming from the apps page, tween out the
            // clone saturation and opacity in the background as an override
            if (!this._forOverview &&
                this._viewSelector.getActivePage() == ViewPage.APPS) {
                this.opacity = AppDisplay.ACTIVE_GRID_OPACITY;
                this.saturation = AppDisplay.ACTIVE_GRID_SATURATION;
                Tweener.addTween(this,
                                 { opacity: AppDisplay.INACTIVE_GRID_OPACITY,
                                   saturation: AppDisplay.INACTIVE_GRID_SATURATION,
                                   time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                                   transition: 'easeOutQuad' });
            }
        }));

        settings.connect('notify::font-dpi', Lang.bind(this, function() {
            let overviewVisible = Main.layoutManager.overviewGroup.visible;
            let saturationEnabled = this._saturation.enabled;

            /* Maybe because of the already known issue with FBO and ClutterClones,
             * simply redrawing the overview group without assuring it is visible
             * won't work. Clutter was supposed to do that, but it doesn't. The
             * FBO, in this case, is introduced through the saturation effect.
             */
            this._saturation.enabled = false;
            Main.layoutManager.overviewGroup.visible = true;

            Main.layoutManager.overviewGroup.queue_redraw();

            /* Restore the previous states */
            Main.layoutManager.overviewGroup.visible = overviewVisible;
            this._saturation.enabled = saturationEnabled;
        }));
    },

    set saturation(factor) {
        this._saturation.factor = factor;
    },

    get saturation() {
        return this._saturation.factor;
    }
});

const ViewsDisplayConstraint = new Lang.Class({
    Name: 'ViewsDisplayConstraint',
    Extends: LayoutManager.MonitorConstraint,

    vfunc_update_allocation: function(actor, actorBox) {
        let originalBox = actorBox.copy();
        this.parent(actor, actorBox);

        actorBox.init_rect(originalBox.get_x(), originalBox.get_y(),
                           actorBox.get_width(), originalBox.get_height());
    }
});

const ViewSelector = new Lang.Class({
    Name: 'ViewSelector',

    _init : function() {
        this.actor = new Shell.Stack({ name: 'viewSelector',
                                       x_expand: true,
                                       y_expand: true });

        this._activePage = null;

        this._workspacesDisplay = new WorkspacesView.WorkspacesDisplay();
        this._workspacesDisplay.connect('empty-space-clicked', Lang.bind(this, this._onEmptySpaceClicked));
        this._workspacesPage = this._addPage(this._workspacesDisplay.actor,
                                             _("Windows"), 'emblem-documents-symbolic');

        this._viewsDisplay = new ViewsDisplay();
        this._appsPage = this._addPage(this._viewsDisplay.actor,
                                       _("Applications"), 'view-grid-symbolic');
        this._appsPage.add_constraint(new ViewsDisplayConstraint({ primary: true,
                                                                   use_workarea: true }));
        this._entry = this._viewsDisplay.entry;
        this._viewsDisplay.actor.connect('views-page-changed', Lang.bind(this, this._onViewsPageChanged));

        this._addViewsPageClone();

        this._stageKeyPressId = 0;
    },

    _addViewsPageClone: function() {
        let layoutViewsClone = new ViewsClone(this, this._viewsDisplay, false);
        Main.layoutManager.setViewsClone(layoutViewsClone);

        this._overviewViewsClone = new ViewsClone(this, this._viewsDisplay, true);
        Main.overview.setViewsClone(this._overviewViewsClone);
        this._appsPage.bind_property('visible',
                                     this._overviewViewsClone, 'visible',
                                     GObject.BindingFlags.SYNC_CREATE |
                                     GObject.BindingFlags.INVERT_BOOLEAN);
    },

    _onEmptySpaceClicked: function() {
        this.setActivePage(ViewPage.APPS);
    },

    _onViewsPageChanged: function() {
        this.emit('views-page-changed');
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

    _clearSearch: function() {
        this._entry.resetSearch();
        this._viewsDisplay.actor.showPage(ViewsDisplayPage.APP_GRID, false);
    },

    show: function(viewPage) {
        this._stageKeyPressId = global.stage.connect('key-press-event',
                                                     Lang.bind(this, this._onStageKeyPress));

        this._clearSearch();
        this._workspacesDisplay.show();

        this._showPage(this._pageFromViewPage(viewPage), true);
    },

    zoomFromOverview: function() {
        this._workspacesDisplay.zoomFromOverview();
    },

    hide: function() {
        if (this._stageKeyPressId != 0) {
            global.stage.disconnect(this._stageKeyPressId);
            this._stageKeyPressId = 0;
        }

        this._workspacesDisplay.hide();
    },

    focusSearch: function() {
        if (this._activePage == this._appsPage) {
            this._entry.grab_key_focus();
        }
    },

    blinkSearch: function() {
        this._entry.blink();
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
        if (this._activePage != this._appsPage) {
            this._clearSearch();
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

        if (oldPage && !noFade) {
            // When fading to the apps page, tween the opacity of the
            // clone instead, and set the apps page to full solid immediately
            if (page == this._appsPage) {
                page.opacity = 255;
                this._overviewViewsClone.opacity = AppDisplay.INACTIVE_GRID_OPACITY;
                Tweener.addTween(this._overviewViewsClone,
                                 { opacity: AppDisplay.ACTIVE_GRID_OPACITY,
                                   saturation: AppDisplay.ACTIVE_GRID_SATURATION,
                                   time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                                   transition: 'easeOutQuad',
                                   onComplete: function() {
                                       this._overviewViewsClone.opacity = AppDisplay.INACTIVE_GRID_OPACITY;
                                       this._overviewViewsClone.saturation = AppDisplay.INACTIVE_GRID_SATURATION;
                                   },
                                   onCompleteScope: this });
            }

            // When fading from the apps page, tween the opacity of the
            // clone instead. The code in this._fadePageIn() will hide
            // the actual page immediately
            if (oldPage == this._appsPage) {
                this._overviewViewsClone.opacity = AppDisplay.ACTIVE_GRID_OPACITY;
                this._overviewViewsClone.saturation = AppDisplay.ACTIVE_GRID_SATURATION;
                Tweener.addTween(this._overviewViewsClone,
                                 { opacity: AppDisplay.INACTIVE_GRID_OPACITY,
                                   saturation: AppDisplay.INACTIVE_GRID_SATURATION,
                                   time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                                   transition: 'easeOutQuad' });
                this._fadePageIn(oldPage, noFade);
            } else {
                Tweener.addTween(oldPage,
                                 { opacity: 0,
                                   time: OverviewControls.SIDE_CONTROLS_ANIMATION_TIME,
                                   transition: 'easeOutQuad',
                                   onComplete: Lang.bind(this,
                                       function() {
                                           this._fadePageIn(oldPage, noFade);
                                       })
                                 });
            }
        } else {
            this._fadePageIn(oldPage, noFade);
        }
    },

    _a11yFocusPage: function(page) {
        page.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
    },

    _onStageKeyPress: function(actor, event) {
        // Ignore events while anything but the overview has
        // pushed a modal (system modals, looking glass, ...)
        if (Main.modalCount > 1)
            return false;

        let symbol = event.get_key_symbol();

        if (this._activePage == this._workspacesPage) {
            if (symbol == Clutter.Escape) {
                Main.overview.toggleWindows();
                return true;
            }
            return false;
        }

        if (this._entry.handleStageEvent(event)) {
            return true;
        }

        if (this._entry.active) {
            return false;
        }

        if (symbol == Clutter.Tab || symbol == Clutter.Down) {
            this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_FORWARD, false);
            return true;
        } else if (symbol == Clutter.ISO_Left_Tab) {
            this._activePage.navigate_focus(null, Gtk.DirectionType.TAB_BACKWARD, false);
            return true;
        }

        return false;
    },

    getActiveViewsPage: function() {
        return this._viewsDisplay.activeViewsPage;
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
