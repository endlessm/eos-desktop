// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
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
const WorkspacesView = imports.ui.workspacesView;

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

const ViewsDisplay = new Lang.Class({
    Name: 'ViewsDisplay',

    _init: function() {
        this._stack = new Shell.Stack({ x_expand: true,
                                        y_expand: true });

        this._allView = new AppDisplay.AllView();
        this._stack.add_actor(this._allView.actor);

        this.entry = new ShellEntry.OverviewEntry();

        let layoutManager = new ViewsDisplayLayout(this._stack, this.entry, this._allView);
        this.actor = new St.Widget({ layout_manager: layoutManager,
                                     x_expand: true,
                                     y_expand: true });

        this.actor.add_actor(this.entry);
        this.actor.add_actor(this._stack);

        // This makes sure that any DnD ops get channeled to the icon grid logic
        // otherwise dropping an item outside of the grid bounds fails
        this.actor._delegate = this;
    },

    acceptDrop: function(source, actor, x, y, time) {
        // Forward all DnD releases to the scrollview
        this._allView.acceptDrop(source, actor, x, y, time);
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
