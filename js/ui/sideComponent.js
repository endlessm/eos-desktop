// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Meta = imports.gi.Meta;

const Main = imports.ui.main;

const SIDE_COMPONENT_ROLE = 'eos-side-component';

/**
 * isSideComponentWindow:
 * @metaWindow: an instance of #Meta.Window
 * @return: whether the #Meta.Window belongs to a #SideComponent 
 */
function isSideComponentWindow (metaWindow) {
    return metaWindow && (metaWindow.get_role() == SIDE_COMPONENT_ROLE);
};

const SideComponent = new Lang.Class({
    Name: 'SideComponent',
    Extends: GObject.Object,

    _init: function(proxyProto, proxyName, proxyPath) {
        this.parent();
        this._propertiesChangedId = 0;
        this._desktopShownId = 0;

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

        // Clicking the background (which calls overview.showApps) hides the component,
        // so trying to open it again will call WindowManager._mapWindow(),
        // which will hide the overview and animate the window.
        // Note that this is not the case when opening the window picker.
        this._desktopShownId = Main.layoutManager.connect('background-clicked', Lang.bind(this, function() {
            if (this._visible) {
                this.hide(global.get_current_time());
            }
        }));
    },

    disable: function() {
        if (this._propertiesChangedId > 0) {
            this.proxy.disconnect(this._propertiesChangedId);
            this._propertiesChangedId = 0;
        }

        if (this._desktopShownId > 0) {
            Main.layoutManager.disconnect(this._desktopShownId);
            this._desktopShownId = 0;
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

    toggle: function(timestamp, params) {
        if (this._visible) {
            this.hide(timestamp, params);
        } else {
            this.show(timestamp, params);
        }
    },

    show: function(timestamp, params) {
        this.callShow(timestamp, params);
    },

    hide: function(timestamp, params) {
        this.callHide(timestamp, params);
    }
});
