// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const Util = imports.misc.util;

const BASE_SEARCH_URI = 'http://www.google.com/';
const QUERY_URI_PATH = 'search?q=';

// Returns a plain URI if the user types in
// something like "facebook.com"
function getURIForSearch(terms) {
    let searchedUris = Util.findSearchUrls(terms);
    // Make sure search contains only a uri
    // Avoid cases like "what is github.com"
    if (searchedUris.length == 1 && terms.length == 1) {
        let uri = searchedUris[0];
        // Ensure all uri has a scheme name
        if (!GLib.uri_parse_scheme(uri)) {
            uri = "http://" + uri;
        }
        return uri;
    } else {
        return null;
    }
}

function activateURI(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, null);
    } catch (e) {
        logError(e, 'error while launching the browser for uri: ' + uri);
    }
}

function activateGoogleSearch(query) {
    let uri = BASE_SEARCH_URI + QUERY_URI_PATH + encodeURI(query);
    activateURI(uri);
}

function getInternetSearchProvider() {
    let browserApp = Util.getBrowserApp();
    if (browserApp) {
        return new InternetSearchProvider(browserApp);
    }

    return null;
}

const InternetSearchProvider = new Lang.Class({
    Name: 'InternetSearchProvider',

    _init: function(browserApp) {
        this.id = 'internet';
        this.appInfo = browserApp.get_app_info();
        this.canLaunchSearch = true;

        this._networkMonitor = Gio.NetworkMonitor.get_default();
    },

    getResultMetas: function(results, callback) {
        let metas = results.map(function(resultId) {
            let name;
            if (resultId.startsWith('uri:')) {
                let uri = resultId.slice('uri:'.length);
                name = _("Open \"%s\" in browser").format(uri);
            } else if (resultId.startsWith('search:')) {
                let query = resultId.slice('search:'.length);
                name = _("Search the internet for \"%s\"").format(query);
            }

            return { id: resultId,
                     name: name,
                     // We will already have an app icon next to our result,
                     // so we don't need an individual result icon.
                     createIcon: function() { return null; } };
        });
        callback(metas);
    },

    filterResults: function(results, maxNumber) {
        return results.slice(0, maxNumber);
    },

    getInitialResultSet: function(terms, callback, cancellable) {
        let results = [];

        if (this._networkMonitor.network_available) {
            let uri = getURIForSearch(terms);
            let query = terms.join(' ');
            if (uri) {
                results.push('uri:' + query);
            } else {
                results.push('search:' + query);
            }
        }

        callback(results);
    },

    getSubsearchResultSet: function(previousResults, terms, callback, cancellable) {
        this.getInitialResultSet(terms, callback, cancellable);
    },

    activateResult: function(metaId) {
        if (metaId.startsWith('uri:')) {
            let uri = metaId.slice('uri:'.length);
            uri = getURIForSearch([uri]);
            activateURI(uri);
        } else if (metaId.startsWith('search:')) {
            let query = metaId.slice('search:'.length);
            activateGoogleSearch(query);
        }
    },

    launchSearch: function(terms) {
        this.getInitialResultSet(terms, Lang.bind(this, function(results) {
            if (results) {
                this.activateResult(results[0]);
            }
        }));
    },
});
