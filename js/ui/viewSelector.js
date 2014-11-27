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

const SEARCH_TIMEOUT = 150;
const SEARCH_METRIC_INACTIVITY_TIMEOUT_SECONDS = 3;
const SHELL_KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';

// Occurs when a user initiates a search from the desktop. The payload, with
// type `(us)`, consists of an enum value from the DesktopSearchProvider enum
// telling what kind of search was requested; followed by the search query.
const EVENT_DESKTOP_SEARCH = 'b02266bc-b010-44b2-ae0f-8f116ffa50eb';
// Represents the various search providers that can be used for searching from
// the desktop.
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

const ViewsDisplayContainer = new Lang.Class({
    Name: 'ViewsDisplayContainer',
    Extends: St.Widget,
    Signals: {
        'views-page-changed': { }
    },

    _init: function(entry, allView) {
        this._activePage = null;

        this._stack = new Shell.Stack({ x_expand: true,
                                        y_expand: true });
        this._entry = entry;
        this._allView = allView;

        let layoutManager = new ViewsDisplayLayout(this._stack, this._entry, this._allView);
        this.parent({ layout_manager: layoutManager,
                      x_expand: true,
                      y_expand: true });

        this.add_actor(this._stack);
        this.add_actor(this._entry);
    },

    addPage: function(page) {
        page.visible = false;
        this._stack.add_actor(page);
    },

    showPage: function(page) {
        if (page == this._activePage) {
            return;
        }

        if (this._activePage) {
            this._activePage.hide();
        }

        this._activePage = page;
        this.emit('views-page-changed');

        if (this._activePage) {
            this._activePage.show();
        }
    },

    get activePage() {
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
        this._searchTimeoutId = 0;
        this._localSearchMetricTimeoutId = 0;

        this._appSystem = Shell.AppSystem.get_default();
        this._allView = new AppDisplay.AllView();

        this._searchResults = new Search.SearchResults();
        this._searchResults.connect('search-progress-updated', Lang.bind(this, this._updateSpinner));

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
        clickAction.connect('clicked', Lang.bind(this, this._onEmptySpaceClicked));
        Main.overview.addAction(clickAction, false);
        this._searchResults.actor.bind_property('mapped', clickAction, 'enabled', GObject.BindingFlags.SYNC_CREATE);

        this.actor = new ViewsDisplayContainer(this.entry, this._allView);
        // This makes sure that any DnD ops get channeled to the icon grid logic
        // otherwise dropping an item outside of the grid bounds fails
        this.actor._delegate = this;

        // Add and show all the pages
        this.actor.addPage(this._allView.actor);
        this.actor.addPage(this._searchResults.actor);
        this.actor.showPage(this._allView.actor);

        Main.overview.connect('hidden', Lang.bind(this, this._onOverviewHidden));
    },

    _onOverviewHidden: function() {
        this.actor.showPage(this._allView.actor);
    },

    _recordDesktopSearchMetric: function (query, searchProvider) {
        let recorder = EosMetrics.EventRecorder.get_default();
        recorder.record_event(EVENT_DESKTOP_SEARCH,
            new GLib.Variant('(us)', [
                searchProvider,
                query
            ]));
    },

    _updateSpinner: function() {
        this.entry.setSpinning(this._searchResults.searchInProgress);
    },

    _enterLocalSearch: function() {
        this.actor.showPage(this._searchResults.actor);
    },

    _leaveLocalSearch: function() {
        this.actor.showPage(this._allView.actor);
    },

    _onSearchActivated: function() {
        this._searchResults.activateDefault();
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

    _onEmptySpaceClicked: function() {
        this.entry.resetSearch();
        this._leaveLocalSearch();
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
        let pageActor = this.actor.activePage;
        if (pageActor == this._allView.actor) {
            return ViewsDisplayPage.APP_GRID;
        } else {
            return ViewsDisplayPage.SEARCH;
        }
    }
});

const ViewsCloneLayout = new Lang.Class({
    Name: 'ViewsCloneLayout',
    Extends: Clutter.BoxLayout,

    vfunc_allocate: function(container, box, flags) {
        let panelClone = container.get_child_at_index(0);
        let viewsClone = container.get_child_at_index(1);

        let panelBox = box.copy();
        let panelHeight = panelClone.get_preferred_height(-1)[1];
        panelBox.y2 = Math.min(panelBox.y2, panelBox.y1 + panelHeight);
        panelClone.allocate(panelBox, flags);

        let viewsBox = box.copy();
        viewsBox.y1 = panelBox.y2;
        viewsClone.allocate(viewsBox, flags);
    }
});

const ViewsClone = new Lang.Class({
    Name: 'ViewsClone',
    Extends: St.Widget,

    _init: function(viewsDisplay, forOverview) {
        this._viewsDisplay = viewsDisplay;
        this._forOverview = forOverview;

        let viewsCloneLayout = new ViewsCloneLayout({ vertical: true });

        this.parent({ layout_manager: viewsCloneLayout,
                      opacity: AppDisplay.INACTIVE_GRID_OPACITY });

        this.add_child(new Clutter.Clone({ source: Main.panel.actor,
                                           opacity: 0 }));

        let allView = this._viewsDisplay.allView;
        let entry = new ShellEntry.OverviewEntry();
        entry.reactive = false;
        entry.clutter_text.reactive = false;

        let container = new ViewsDisplayContainer(entry, allView, true);
        let iconGridClone = new Clutter.Clone({ source: allView.gridActor,
                                                x_expand: true });
        let appGridContainer = new AppDisplay.AllViewContainer(iconGridClone);
        appGridContainer.reactive = false;

        this._saturation = new Clutter.DesaturateEffect({ factor: AppDisplay.INACTIVE_GRID_SATURATION,
                                                          enabled: false });
        iconGridClone.add_effect(this._saturation);
        container.addPage(appGridContainer);
        container.showPage(appGridContainer);
        this.add_child(container);

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
        this._appsPage.add_constraint(new ViewsDisplayConstraint({ primary: true,
                                                                   use_workarea: true }));
        this._entry = this._viewsDisplay.entry;
        this._viewsDisplay.actor.connect('views-page-changed', Lang.bind(this, this._onViewsPageChanged));

        this._addViewsPageClone();

        this._stageKeyPressId = 0;
    },

    _addViewsPageClone: function() {
        let layoutViewsClone = new ViewsClone(this._viewsDisplay, false);
        Main.layoutManager.setViewsClone(layoutViewsClone);

        this._overviewViewsClone = new ViewsClone(this._viewsDisplay, true);
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

    show: function(viewPage) {
        this._stageKeyPressId = global.stage.connect('key-press-event',
                                                     Lang.bind(this, this._onStageKeyPress));

        this._entry.resetSearch();
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

        let symbol = event.get_key_symbol();

        if (this._activePage == this._workspacesPage) {
            if (symbol == Clutter.Escape) {
                Main.overview.toggle();
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
