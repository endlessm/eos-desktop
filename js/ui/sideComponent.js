// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;

const SideComponent = new Lang.Class({
    Name: 'SideComponent',

    _init: function(proxyProto, proxyName, proxyPath) {
        this._overviewHiddenId = 0;
        this._overviewShowingId = 0;
        this._propertiesChangedId = 0;

        this._proxyProto = proxyProto;
        this._proxyName = proxyName;
        this._proxyPath = proxyPath;

        this._visible = false;
    },

    enable: function() {
        if (!this.proxy) {
            this.proxy = new this._proxyProto(Gio.DBus.session, 
                                              this._proxyName, this._proxyPath,
                                              Lang.bind(this, this._onProxyConstructed));
        }

        this._propertiesChangedId =
            this.proxy.connect('g-properties-changed', Lang.bind(this, this._onPropertiesChanged));

        this._overviewShowingId =
            Main.overview.connect('showing', Lang.bind(this, this._onOverviewShowing));
    },

    disable: function() {
        if (this._overviewShowingId > 0) {
            Main.overview.disconnect(this._overviewShowingId);
            this._overviewShowingId = 0;
        }

        if (this._propertiesChangedId > 0) {
            this.proxy.disconnect(this._propertiesChangedId);
            this._propertiesChangedId = 0;
        }
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
        if (this._visible == this.proxy.Visible) {
            return;
        }

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
            this._doToggle(global.get_current_time());
        }
    },

    _doToggle: function(timestamp, params) {
        this.removeHiddenId();
        this._visible = !this._visible;

        this.callToggle(timestamp, params);
    },

    toggle: function(params) {
        this.activateAfterHide(Lang.bind(this, function(timestamp) { this._doToggle(timestamp, params); }));
    },

    activateAfterHide: function(activateMethod) {
        let timestamp = global.get_current_time();

        // The background menu is shown on the overview screen. However, to
        // show the AppStore, we must first hide the overview. For maximum
        // visual niceness, we also take the extra step to wait until the
        // overview has finished hiding itself before triggering the slide-in
        // animation of the AppStore.
        if (Main.overview.visible) {
            if (!this._overviewHiddenId) {
                this._overviewHiddenId = Main.overview.connect('hidden', function() {
                    activateMethod(timestamp);
                });
            }
            Main.overview.hide();
        } else {
            activateMethod(timestamp);
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
