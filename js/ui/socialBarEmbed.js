const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const Signals = imports.signals;

const Main = imports.ui.main;

const SOCKET_EXPORTER_IFACE = 'com.endlessm.SocketExporter';
const SOCKET_EXPORTER_PATH = '/com/endlessm/SocketExporter';
const SOCKET_EXPORTER_NAME = 'com.endlessm.SocketExporter';

const SocketExporterIface = <interface name={SOCKET_EXPORTER_IFACE}>
    <method name="GetSocketId">
    <arg type="u" direction="out"/>
    </method>
    </interface>;

const SOCIAL_BAR_IFACE = 'com.endlessm.SocialBar';
const SOCIAL_BAR_PATH = '/com/endlessm/SocialBar';
const SOCIAL_BAR_NAME = 'com.endlessm.SocialBar';

const SocialBarIface = <interface name={SOCIAL_BAR_IFACE}>
    <method name="toggle"/>
    <property name="Visible" type="b" access="read"/>
    </interface>;
const SocialBarProxy = Gio.DBusProxy.makeProxyWrapper(SocialBarIface);
let socialBarProxy = null;

const SocialBarManager = new Lang.Class({
    Name: 'SocialBarManager',
    Extends: Shell.EmbeddedWindow,

    _init: function() {
        this.parent();

        this._socket = null;
        this.show_all();

        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(SocketExporterIface, this);
        this._dbusImpl.export(Gio.DBus.session, SOCKET_EXPORTER_PATH);

        Gio.DBus.session.own_name(SOCKET_EXPORTER_NAME, Gio.BusNameOwnerFlags.REPLACE, null, null);

        this.socialBarProxy = new SocialBarProxy(Gio.DBus.session,
            SOCIAL_BAR_NAME, SOCIAL_BAR_PATH,
            Lang.bind(this, this._onProxyConstructed));

        this.socialBarProxy.connect('g-properties-changed',
            Lang.bind(this, this._onPropertiesChanged));
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

    },

    GetSocketId: function() {
        this._ensureSocket();
        return this._socket.get_id();
    },

    _ensureSocket: function() {
        if (this._socket) {
            return;
        }

        this._socket = new Gtk.Socket();
        this.add(this._socket);
        this._socket.show();

        this._socket.connect('plug-added', Lang.bind(this, this._onPlugAdded));
        this._socket.connect('plug-removed', Lang.bind(this,
            function() {
                this._socket = null;
                this._gtkEmbed = null;
            }));
    },

    _onPlugAdded: function() {
        this._gtkEmbed = new Shell.GtkEmbed({ window: this, reactive: true });
        Main.uiGroup.add_actor(this._gtkEmbed);
    }
});
Signals.addSignalMethods(SocialBarManager.prototype);
