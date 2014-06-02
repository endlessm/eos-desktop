// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GObject = imports.gi.GObject;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Meta = imports.gi.Meta;

const Main = imports.ui.main;
const ViewSelector = imports.ui.viewSelector;

const SIDE_COMPONENT_ROLE = 'eos-side-component';

/**
 * isSideComponentWindow:
 * @metaWindow: an instance of #Meta.Window
 * @return: whether the #Meta.Window belongs to a #SideComponent 
 */
function isSideComponentWindow (metaWindow) {
    return metaWindow && (metaWindow.get_role() == SIDE_COMPONENT_ROLE);
};

/**
 * isAppStoreWindow:
 * @metaWindow: an instance of #Meta.Window
 * @return: whether the #Meta.Window belongs to the App Store application
 */
function isAppStoreWindow (metaWindow) {
    return isSideComponentWindow(metaWindow) && (metaWindow.get_wm_class() == 'Eos-app-store');
};

const SideComponent = new Lang.Class({
    Name: 'SideComponent',
    Extends: GObject.Object,

    _init: function(proxyIface, proxyName, proxyPath) {
        this.parent();
        this._propertiesChangedId = 0;
        this._desktopShownId = 0;

        this._proxyIface = proxyIface;
        this._proxyInfo = Gio.DBusInterfaceInfo.new_for_xml(this._proxyIface);
        this._proxyName = proxyName;
        this._proxyPath = proxyPath;

        this._visible = false;
    },

    enable: function() {
        if (!this.proxy) {
            this.proxy = new Gio.DBusProxy({ g_connection: Gio.DBus.session,
                                             g_interface_name: this._proxyInfo.name,
                                             g_interface_info: this._proxyInfo,
                                             g_name: this._proxyName,
                                             g_object_path: this._proxyPath,
                                             g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION });
            this.proxy.init_async(GLib.PRIORITY_DEFAULT, null, Lang.bind(this, this._onProxyConstructed));
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

        // Same when clicking the background from the window picker.
        this._overviewPageChangedId = Main.overview.connect('page-changed', Lang.bind(this, function() {
            if (this._visible && Main.overview.visible &&
                    Main.overview.getActivePage() == ViewSelector.ViewPage.APPS) {
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

        if (this._overviewPageChangedId > 0) {
            Main.overview.disconnect(this._overviewPageChangedId);
            this._overviewPageChangedId = 0;
        }
    },

    _onProxyConstructed: function(object, res) {
        try {
            object.init_finish(res);
        } catch (e) {
            logError(e, 'Error while constructing the DBus proxy for ' + this._proxyName);
        }
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
    },

    toggle: function(timestamp, params) {
        if (this._visible) {
            this.hide(timestamp, params);
        } else {
            this.show(timestamp, params);
        }
    },

    show: function(timestamp, params) {
        if (this._visible && Main.overview.visible) {
            // the component is already open, but obscured by the overview
            Main.overview.hide();
        } else {
            this.callShow(timestamp, params);
        }
    },

    hide: function(timestamp, params) {
        this.callHide(timestamp, params);
    }
});
