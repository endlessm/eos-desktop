// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const St = imports.gi.St;
const Shell = imports.gi.Shell;

const IconGridLayout = imports.ui.iconGridLayout;
const Search = imports.ui.search;

const KEY_FILE_GROUP = 'Shell Search Provider';

const SearchProviderIface = '<node> \
<interface name="org.gnome.Shell.SearchProvider"> \
<method name="GetInitialResultSet"> \
    <arg type="as" direction="in" /> \
    <arg type="as" direction="out" /> \
</method> \
<method name="GetSubsearchResultSet"> \
    <arg type="as" direction="in" /> \
    <arg type="as" direction="in" /> \
    <arg type="as" direction="out" /> \
</method> \
<method name="GetResultMetas"> \
    <arg type="as" direction="in" /> \
    <arg type="aa{sv}" direction="out" /> \
</method> \
<method name="ActivateResult"> \
    <arg type="s" direction="in" /> \
</method> \
</interface> \
</node>';

const SearchProvider2Iface = '<node> \
<interface name="org.gnome.Shell.SearchProvider2"> \
<method name="GetInitialResultSet"> \
    <arg type="as" direction="in" /> \
    <arg type="as" direction="out" /> \
</method> \
<method name="GetSubsearchResultSet"> \
    <arg type="as" direction="in" /> \
    <arg type="as" direction="in" /> \
    <arg type="as" direction="out" /> \
</method> \
<method name="GetResultMetas"> \
    <arg type="as" direction="in" /> \
    <arg type="aa{sv}" direction="out" /> \
</method> \
<method name="ActivateResult"> \
    <arg type="s" direction="in" /> \
    <arg type="as" direction="in" /> \
    <arg type="u" direction="in" /> \
</method> \
<method name="LaunchSearch"> \
    <arg type="as" direction="in" /> \
    <arg type="u" direction="in" /> \
</method> \
</interface> \
</node>';

var SearchProviderProxyInfo = Gio.DBusInterfaceInfo.new_for_xml(SearchProviderIface);
var SearchProvider2ProxyInfo = Gio.DBusInterfaceInfo.new_for_xml(SearchProvider2Iface);

function loadRemoteSearchProviders(addProviderCallback) {
    let objectPaths = {};
    let loadedProviders = [];
    let appSys = Shell.AppSystem.get_default();

    function loadRemoteSearchProvider(file) {
        let keyfile = new GLib.KeyFile();
        let path = file.get_path();

        try {
            keyfile.load_from_file(path, 0);
        } catch(e) {
            return;
        }

        if (!keyfile.has_group(KEY_FILE_GROUP))
            return;

        let remoteProvider;
        try {
            let group = KEY_FILE_GROUP;
            let busName = keyfile.get_string(group, 'BusName');
            let objectPath = keyfile.get_string(group, 'ObjectPath');

            if (objectPaths[objectPath])
                return;

            let desktopId;
            try {
                desktopId = keyfile.get_string(group, 'DesktopId');
            } catch (e) {
                log('Ignoring search provider ' + path + ': missing DesktopId');
                return;
            }

            // Check if it is available on desktop
            if (!IconGridLayout.layout.hasIcon(desktopId)) {
                return
            }

            let app = appSys.lookup_heuristic_basename(desktopId);
            
            let version = '1';
            try {
                version = keyfile.get_string(group, 'Version');
            } catch (e) {
                // ignore error
            }

            if (version >= 2)
                remoteProvider = new RemoteSearchProvider2(app, busName, objectPath);
            else
                remoteProvider = new RemoteSearchProvider(app, busName, objectPath);

            objectPaths[objectPath] = remoteProvider;
            loadedProviders.push(remoteProvider);
        } catch(e) {
            log('Failed to add search provider %s: %s'.format(path, e.toString()));
        }
    }

    let dataDirs = GLib.get_system_data_dirs();
    dataDirs.forEach(function(dataDir) {
        let path = GLib.build_filenamev([dataDir, 'gnome-shell', 'search-providers']);
        let dir = Gio.File.new_for_path(path);
        let fileEnum;
        try {
            fileEnum = dir.enumerate_children('standard::name,standard::type',
                                              Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            fileEnum = null;
        }
        if (fileEnum != null) {
            let info;
            while ((info = fileEnum.next_file(null)))
                loadRemoteSearchProvider(fileEnum.get_child(info));
        }
    });

    let searchSettings = new Gio.Settings({ schema: Search.SEARCH_PROVIDERS_SCHEMA });
    let sortOrder = searchSettings.get_strv('sort-order');

    // Special case gnome-control-center to be always active and always first
    sortOrder.unshift('gnome-control-center.desktop');
    // Make sure we get the vendor-prefixed versions of the app IDs, as the
    // provider will use that as well
    sortOrder = sortOrder.map(function(appId) {
        let shellApp = appSys.lookup_heuristic_basename(appId);
        if (shellApp) {
            return shellApp.get_id();
        } else {
            return null;
        }
    });

    loadedProviders.sort(function(providerA, providerB) {
        let idxA, idxB;
        let appIdA, appIdB;

        appIdA = providerA.app.get_id();
        appIdB = providerB.app.get_id();

        idxA = sortOrder.indexOf(appIdA);
        idxB = sortOrder.indexOf(appIdB);

        // if no provider is found in the order, use alphabetical order
        if ((idxA == -1) && (idxB == -1)) {
            let nameA = providerA.app.get_name();
            let nameB = providerB.app.get_name();

            return GLib.utf8_collate(nameA, nameB);
        }

        // if providerA isn't found, it's sorted after providerB
        if (idxA == -1)
            return 1;

        // if providerB isn't found, it's sorted after providerA
        if (idxB == -1)
            return -1;

        // finally, if both providers are found, return their order in the list
        return (idxA - idxB);
    });

    loadedProviders.forEach(addProviderCallback);
}

const RemoteSearchProvider = new Lang.Class({
    Name: 'RemoteSearchProvider',

    _init: function(shellApp, dbusName, dbusPath, proxyInfo) {
        if (!proxyInfo)
            proxyInfo = SearchProviderProxyInfo;

        this.proxy = new Gio.DBusProxy({ g_bus_type: Gio.BusType.SESSION,
                                         g_name: dbusName,
                                         g_object_path: dbusPath,
                                         g_interface_info: proxyInfo,
                                         g_interface_name: proxyInfo.name,
                                         g_flags: (Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION |
                                                   Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES) });
        this.proxy.init_async(GLib.PRIORITY_DEFAULT, null, null);

        this.app = shellApp;
        this.id = shellApp.get_id();
        this.isRemoteProvider = true;

        this._cancellable = new Gio.Cancellable();
    },

    createIcon: function(size, meta) {
        let gicon = null;
        let icon = null;

        if (meta['icon']) {
            gicon = Gio.icon_deserialize(meta['icon']);
        } else if (meta['gicon']) {
            gicon = Gio.icon_new_for_string(meta['gicon']);
        } else if (meta['icon-data']) {
            let [width, height, rowStride, hasAlpha,
                 bitsPerSample, nChannels, data] = meta['icon-data'];
            gicon = Shell.util_create_pixbuf_from_data(data, GdkPixbuf.Colorspace.RGB, hasAlpha,
                                                       bitsPerSample, width, height, rowStride);
        }

        if (gicon)
            icon = new St.Icon({ gicon: gicon,
                                 icon_size: size });
        return icon;
    },

    _getResultsFinished: function(results, error) {
        if (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                log('Received error from DBus search provider %s: %s'.format(this.id, String(error)));
        } else {
            this.searchSystem.setResults(this, results[0]);
        }
    },

    getInitialResultSet: function(terms) {
        this._cancellable.cancel();
        this._cancellable.reset();
        this.proxy.GetInitialResultSetRemote(terms,
                                             Lang.bind(this, this._getResultsFinished),
                                             this._cancellable);
    },

    getSubsearchResultSet: function(previousResults, newTerms) {
        this._cancellable.cancel();
        this._cancellable.reset();
        this.proxy.GetSubsearchResultSetRemote(previousResults, newTerms,
                                               Lang.bind(this, this._getResultsFinished),
                                               this._cancellable);
    },

    _getResultMetasFinished: function(results, error, callback) {
        if (error) {
            if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                log('Received error from DBus search provider %s during GetResultMetas: %s'.format(this.id, String(error)));
            callback([]);
            return;
        }
        let metas = results[0];
        let resultMetas = [];
        for (let i = 0; i < metas.length; i++) {
            for (let prop in metas[i]) {
                // we can use the serialized icon variant directly
                if (prop != 'icon')
                    metas[i][prop] = metas[i][prop].deep_unpack();
            }

            resultMetas.push({ id: metas[i]['id'],
                               name: metas[i]['name'],
                               description: metas[i]['description'],
                               createIcon: Lang.bind(this,
                                                     this.createIcon, metas[i]) });
        }
        callback(resultMetas);
    },

    getResultMetas: function(ids, callback) {
        this._cancellable.cancel();
        this._cancellable.reset();
        this.proxy.GetResultMetasRemote(ids,
                                        Lang.bind(this, this._getResultMetasFinished, callback),
                                        this._cancellable);
    },

    activateResult: function(id) {
        this.proxy.ActivateResultRemote(id);
    },

    launchSearch: function(terms) {
        // the provider is not compatible with the new version of the interface, launch
        // the app itself but warn so we can catch the error in logs
        log('Search provider ' + this.id + ' does not implement LaunchSearch');
        this.app.activate();
    }
});

const RemoteSearchProvider2 = new Lang.Class({
    Name: 'RemoteSearchProvider2',
    Extends: RemoteSearchProvider,

    _init: function(shellApp, dbusName, dbusPath) {
        this.parent(shellApp, dbusName, dbusPath, SearchProvider2ProxyInfo);

        this.canLaunchSearch = true;
    },

    activateResult: function(id, terms) {
        this.proxy.ActivateResultRemote(id, terms, global.get_current_time());
    },

    launchSearch: function(terms) {
        this.proxy.LaunchSearchRemote(terms, global.get_current_time());
    }
});
