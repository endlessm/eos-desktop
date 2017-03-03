// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

const Main = imports.ui.main;
const Util = imports.misc.util;

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

        this._engineNameParsed = false;
        this._engineName = null;

        this._networkMonitor = Gio.NetworkMonitor.get_default();
    },

    _getEngineName: function() {
        if (!this._engineNameParsed) {
            this._engineNameParsed = true;
            this._engineName = Util.getSearchEngineName();
        }

        return this._engineName;
    },

    _launchURI: function(uri) {
        try {
            this.appInfo.launch_uris([uri], null);
        } catch (e) {
            logError(e, 'error while launching browser for uri: ' + uri);
        }
    },

    getResultMetas: function(results, callback) {
        let metas = results.map(Lang.bind(this, function(resultId) {
            let name;
            if (resultId.startsWith('uri:')) {
                let uri = resultId.slice('uri:'.length);
                name = _("Open \"%s\" in browser").format(uri);
            } else if (resultId.startsWith('search:')) {
                let query = resultId.slice('search:'.length);
                let engineName = this._getEngineName();

                if (engineName) {
                    /* Translators: the first %s is the search engine name, and the second
                     * is the search string. For instance, 'Search Google for "hello"'.
                     */
                    name = _("Search %s for \"%s\"").format(engineName, query);
                } else {
                    name = _("Search the internet for \"%s\"").format(query);
                }
            }

            return { id: resultId,
                     name: name,
                     // We will already have an app icon next to our result,
                     // so we don't need an individual result icon.
                     createIcon: function() { return null; } };
        }));
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
            this._launchURI(uri);
        } else if (metaId.startsWith('search:')) {
            let query = metaId.slice('search:'.length);
            this._launchURI('? '.concat(query));
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
