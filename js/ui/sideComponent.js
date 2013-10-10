// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;

const SideComponent = new Lang.Class({
    Name: 'SideComponent',

    _init: function(proxyProto, proxyName, proxyPath) {
        this._overviewHiddenId = 0;

        this.proxy = new proxyProto(Gio.DBus.session, 
                                    proxyName, proxyPath,
                                    Lang.bind(this, this._onProxyConstructed));
        this.proxy.connect('g-properties-changed', Lang.bind(this, this._onPropertiesChanged));

        Main.overview.connect('showing', Lang.bind(this, this._onOverviewShowing));

        this._visible = false;
    },

    _onProxyConstructed: function() {
        // nothing to do
    },

    _onPropertiesChanged: function(proxy, changedProps, invalidatedProps) {
        let propsDict = changedProps.deep_unpack();
        if (propsDict.hasOwnProperty('Visible')) {
            this._onVisibilityChanged();
        }
    },

    _onVisibilityChanged: function() {
        // resync visibility
        this._visible = this.proxy.Visible;

        if (!this._visible) {
            let visibleWindows = Main.workspaceMonitor.visibleWindows;
            if (visibleWindows == 0) {
                Main.overview.showApps();
            }
        }
    },

    _onOverviewShowing: function() {
        // Make the component close (slide in) when the overview is shown
        if (this._visible) {
            this._doToggle();
        }
    },

    _doToggle: function(params) {
        this.removeHiddenId();
        this._visible = !this._visible;

        this.callToggle(params);
    },

    toggle: function(params) {
        this.activateAfterHide(Lang.bind(this, function() { this._doToggle(params); }));
    },

    activateAfterHide: function(activateMethod) {
        // The background menu is shown on the overview screen. However, to
        // show the AppStore, we must first hide the overview. For maximum
        // visual niceness, we also take the extra step to wait until the
        // overview has finished hiding itself before triggering the slide-in
        // animation of the AppStore.
        if (Main.overview.visible) {
            if (!this._overviewHiddenId) {
                this._overviewHiddenId =
                    Main.overview.connect('hidden', activateMethod);
            }
            Main.overview.hide();
        } else {
            activateMethod();
        }
    },

    removeHiddenId: function() {
        if (this._overviewHiddenId) {
            Main.overview.disconnect(this._overviewHiddenId);
            this._overviewHiddenId = 0;
        }
    },

    get visible() {
        return this._visible;
    },

    set visible(v) {
        this._visible = v;
    }
});
