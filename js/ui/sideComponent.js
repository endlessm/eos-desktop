// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;

const SIDE_COMPONENT_ROLE = 'eos-side-component';

function isSideComponentWindow (actor) {
    let win = actor.meta_window;
    return win && (win.get_role() == SIDE_COMPONENT_ROLE);
};

const SideComponent = new Lang.Class({
    Name: 'SideComponent',
    Extends: GObject.Object,

    _init: function(proxyProto, proxyName, proxyPath) {
        this.parent();
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
    },

    disable: function() {
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

    callOnOverviewHidden: function(callback) {
        if (!Main.overview.visible) {
            callback();
            return;
        }

        let overviewHiddenId = Main.overview.connect('hidden', function() {
            Main.overview.disconnect(overviewHiddenId);
            callback();
        });

        Main.overview.hide();
    },

    toggle: function(timestamp, params) {
        if (this._visible) {
            this.hide(timestamp, params);
        } else {
            this.show(timestamp, params);
        }
    },

    show: function(timestamp, params) {
        this.callOnOverviewHidden(Lang.bind(this, function() {
            this.callShow(timestamp, params);
        }));
    },

    hide: function(timestamp, params) {
        this.callHide(timestamp, params);
    }
});
