// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GObject = imports.gi.GObject;
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
    Properties: {'visible': GObject.ParamSpec.boolean('visible',
                                                      'Visible', 'Visibility of the component',
                                                      GObject.ParamFlags.READABLE | GObject.ParamFlags.WRITABLE,
                                                      false)},

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
        this.visible = this.proxy.Visible;

        if (!this._visible) {
            let visibleWindows = Main.workspaceMonitor.visibleWindows;
            if (visibleWindows == 0) {
                Main.overview.showApps();
            }
        }
    },

    toggle: function(params) {
        Main.overview.hide();
        this.callToggle(global.get_current_time(), params);
    },

    get visible() {
        return this._visible;
    },

    set visible(v) {
        this._visible = v;
        this.notify('visible');
    }
});
