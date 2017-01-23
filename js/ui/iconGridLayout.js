// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Signals = imports.signals;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Json = imports.gi.Json;

const Config = imports.misc.config;
const EosMetrics = imports.gi.EosMetrics;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;

const DESKTOP_GRID_ID = 'desktop';

const SCHEMA_KEY = 'icon-grid-layout';
const DESKTOP_EXT = '.desktop';
const DIRECTORY_EXT = '.directory';
const APP_DIR_NAME = 'applications';
const FOLDER_DIR_NAME = 'desktop-directories';

const DEFAULT_CONFIGS_DIR = Config.DATADIR + '/eos-shell-content/icon-grid-defaults';
const DEFAULT_CONFIG_NAME_BASE = 'icon-grid';

const PREPEND_CONFIGS_DIR = Config.LOCALSTATEDIR + '/eos-image-defaults/icon-grid';
const PREPEND_CONFIG_NAME_BASE = 'icon-grid-prepend';

const APPEND_CONFIGS_DIR = Config.LOCALSTATEDIR + '/eos-image-defaults/icon-grid';
const APPEND_CONFIG_NAME_BASE = 'icon-grid-append';

/* Occurs when an application is uninstalled, meaning removed from the desktop's
 * app grid. Applications can be uninstalled in the app store or via dragging
 * and dropping to the trash.
 */
const SHELL_APP_REMOVED_EVENT = '683b40a7-cac0-4f9a-994c-4b274693a0a0';

/* Optional dependency: this schema will be installed on certain configurations where,
 * if the 'enabled' key is set, we'll want Chrome to replace Chromium in the desktop. */
const GOOGLE_CHROME_INITIAL_SETUP_SCHEMA = 'com.endlessm.GoogleChromeInitialSetup';

const IconGridLayout = new Lang.Class({
    Name: 'IconGridLayout',

    _init: function(params) {
        let schema_source = Gio.SettingsSchemaSource.get_default();
        this._chrome_helper_settings = null;
        if (schema_source.lookup(GOOGLE_CHROME_INITIAL_SETUP_SCHEMA, true)) {
            this._chrome_helper_settings = new Gio.Settings({ schema_id: GOOGLE_CHROME_INITIAL_SETUP_SCHEMA });
        }

        this._updateIconTree();

        this._removeUndone = false;

        global.settings.connect('changed::' + SCHEMA_KEY, Lang.bind(this, function() {
            this._updateIconTree();
            this.emit('changed');
        }));
    },

    _getIconTreeFromVariant: function(allIcons) {
        let iconTree = {};
        let appSys = Shell.AppSystem.get_default();

        for (let i = 0; i < allIcons.n_children(); i++) {
            let context = allIcons.get_child_value(i);
            let [folder, ] = context.get_child_value(0).get_string();
            let children = context.get_child_value(1).get_strv();
            iconTree[folder] = children.map(function(appId) {
                // Some older versions of eos-app-store incorrectly added eos-app-*.desktop
                // files to the icon grid layout, instead of the proper unprefixed .desktop
                // files, which should never leak out of the Shell. Take these out of the
                // icon layout.
                if (appId.startsWith('eos-app-'))
                    return appId.slice('eos-app-'.length);

                // Some apps have their name superceded, for instance gedit -> org.gnome.gedit.
                // We want the new name, not the old one.
                let app = appSys.lookup_alias(appId);
                if (app)
                    return app.get_id();

                return appId;
            });
        }

        return iconTree;
    },

    _updateIconTree: function() {
        let allIcons = global.settings.get_value(SCHEMA_KEY);
        let nIcons = allIcons.n_children();
        let iconTree = this._getIconTreeFromVariant(allIcons);

        if (nIcons > 0 && !iconTree[DESKTOP_GRID_ID]) {
            // Missing toplevel desktop ID indicates we are reading a
            // corrupted setting. Reset grid to defaults, and let the logic
            // below run after the GSettings notification
            log('Corrupted icon-grid-layout detected, resetting to defaults');
            global.settings.reset(SCHEMA_KEY);
            return;
        }

        if (nIcons == 0) {
            // Entirely empty indicates that we need to read in the defaults
            allIcons = this._getDefaultIcons();
            iconTree = this._getIconTreeFromVariant(allIcons);

            // Replace the Chromium browser's icon by Chrome's if the latter is to be
            // enabled
            if (this._chrome_helper_settings && this._chrome_helper_settings.get_boolean('enabled')) {
                for (let folderId in iconTree) {
                    for (let iconId in iconTree[folderId]) {
                        if (iconTree[folderId][iconId] == 'chromium-browser.desktop') {
                            iconTree[folderId][iconId] = 'google-chrome.desktop';
                            break;
                        }
                    }
                }
            }
        }

        this._iconTree = iconTree;
    },

    _loadConfigJsonString: function(dir, base) {
        let jsonString = null;
        let defaultFiles = GLib.get_language_names()
            .filter(function(name) {
                return name.indexOf('.') == -1;
            })
            .map(function(name) {
                let path = GLib.build_filenamev([dir, base + '-' + name + '.json']);
                return Gio.File.new_for_path(path);
            })
            .some(function(defaultsFile) {
                try {
                    let [success, data] = defaultsFile.load_contents(null, null,
                                                                     null);
                    jsonString = data.toString();
                    return true;
                } catch (e) {
                    // Ignore errors, as we always have a fallback
                }
                return false;
            });
        return jsonString;
    },

    _mergeJsonStrings: function(base, prepend, append) {
        let baseNode = JSON.parse(base)
        let prependNode = null;
        let appendNode = null;
        if (prepend) {
            prependNode = JSON.parse(prepend);
        }
        if (append) {
            appendNode = JSON.parse(append);
        }
        for (let key in baseNode) {
            if (prependNode && prependNode[key]) {
                baseNode[key] = prependNode[key].concat(baseNode[key]);
            }
            if (appendNode && appendNode[key]) {
                baseNode[key] = baseNode[key].concat(appendNode[key]);
            }
        }
        return JSON.stringify(baseNode);
    },

    _getDefaultIcons: function() {
        let mergedJson = this._mergeJsonStrings(
            this._loadConfigJsonString(DEFAULT_CONFIGS_DIR, DEFAULT_CONFIG_NAME_BASE),
            this._loadConfigJsonString(PREPEND_CONFIGS_DIR, PREPEND_CONFIG_NAME_BASE),
            this._loadConfigJsonString(APPEND_CONFIGS_DIR ,APPEND_CONFIG_NAME_BASE)
        );
        let iconTree = Json.gvariant_deserialize_data(mergedJson, -1, 'a{sas}');

        if (iconTree === null || iconTree.n_children() == 0) {
            log('No icon grid defaults found!');
            // At the minimum, put in something that avoids exceptions later
            let fallback = {};
            fallback[DESKTOP_GRID_ID] = [];
            iconTree = GLib.Variant.new('a{sas}', fallback);
        }

        return iconTree;
    },

    hasIcon: function(id) {
        for (let folderId in this._iconTree) {
            let folder = this._iconTree[folderId];
            if (folder.indexOf(id) != -1) {
                return true;
            }
        }

        return false;
    },

    _getIconLocation: function(id) {
        for (let folderId in this._iconTree) {
            let folder = this._iconTree[folderId];
            let nIcons = folder.length;

            let itemIdx = folder.indexOf(id);
            let nextId;

            if (itemIdx < nIcons) {
                nextId = folder[itemIdx + 1];
            } else {
                // append to the folder
                nextId = null;
            }

            if (itemIdx != -1) {
                return [folderId, nextId];
            }
        }
        return null;
    },

    getIcons: function(folder) {
        if (this._iconTree && this._iconTree[folder]) {
            return this._iconTree[folder];
        } else {
            return [];
        }
    },

    iconIsFolder: function(id) {
        return id && (id.endsWith(DIRECTORY_EXT));
    },

    appendIcon: function(id, folderId) {
        this.repositionIcon(id, null, folderId);
    },

    removeIcon: function(id, interactive) {
        if (!this.hasIcon(id)) {
            return;
        }

        this._removeUndone = false;

        let undoInfo = null;
        let currentLocation = this._getIconLocation(id);
        if (currentLocation) {
            undoInfo = { id: id,
                         folderId: currentLocation[0],
                         insertId: currentLocation[1] };
        }

        this.repositionIcon(id, null, null);

        let info = null;
        if (this.iconIsFolder(id)) {
            info = Shell.DesktopDirInfo.new(id);
        } else {
            let appSystem = Shell.AppSystem.get_default();
            let app = appSystem.lookup_alias(id);
            if (app) {
                info = app.get_app_info();
            }
        }

        if (!info) {
            return;
        }

        if (interactive) {
            Main.overview.setMessage(_("%s has been deleted").format(info.get_name()),
                                     { forFeedback: true,
                                       destroyCallback: Lang.bind(this, this._onMessageDestroy, info),
                                       undoCallback: Lang.bind(this, this._undoRemoveItem, undoInfo)
                                     });
        } else {
            this._onMessageDestroy(info);
        }
    },

    _onMessageDestroy: function(info) {
        if (this._removeUndone) {
            this._removeUndone = false;
            return;
        }

        if (!this.iconIsFolder(info.get_id())) {
            let eventRecorder = EosMetrics.EventRecorder.get_default();
            let appId = new GLib.Variant('s', info.get_id());
            eventRecorder.record_event(SHELL_APP_REMOVED_EVENT, appId);
        }

        let filename = info.get_filename();
        let userDir = GLib.get_user_data_dir();
        if (filename && userDir && GLib.str_has_prefix(filename, userDir) &&
            info.get_string('X-Endless-CreatedBy') === 'eos-desktop') {
            // only delete .desktop files if they are in the user's local data
            // folder and they were created by eos-desktop
            info.delete();
        }
    },

    _undoRemoveItem: function(undoInfo) {
        if (undoInfo != null) {
            this.repositionIcon(undoInfo.id, undoInfo.insertId, undoInfo.folderId);
        }
        this._removeUndone = true;
    },

    listApplications: function() {
        let allApplications = [];

        for (let folderId in this._iconTree) {
            let folder = this._iconTree[folderId];
            for (let iconIdx in folder) {
                let icon = folder[iconIdx];
                if (!this.iconIsFolder(icon)) {
                    allApplications.push(icon);
                }
            }
        }

        return allApplications;
    },

    repositionIcon: function(id, insertId, newFolderId) {
        let icons;
        let existing = false;
        let isFolder = this.iconIsFolder(id);

        for (let i in this._iconTree) {
            icons = this._iconTree[i];
            let oldPos = icons.indexOf(id);
            if (oldPos != -1) {
                icons.splice(oldPos, 1);
                existing = true;
                break;
            }
        }

        if (newFolderId != null) {
            // We're adding or repositioning an icon
            icons = this._iconTree[newFolderId];
            if (!icons) {
                // Invalid destination folder
                return;
            }
            this._insertIcon(icons, id, insertId);

            if (isFolder && !existing) {
                // We're adding a folder, need to initialize an
                // array for its contents
                this._iconTree[id] = [];
            }
        } else {
            // We're removing an entry
            if (isFolder && existing) {
                // We're removing a folder, need to delete the array
                // for its contents as well
                delete this._iconTree[id];
            }
        }

        // Recreate GVariant from iconTree
        let newLayout = GLib.Variant.new('a{sas}', this._iconTree);

        // Store gsetting
        global.settings.set_value(SCHEMA_KEY, newLayout);
    },

    resetDesktop: function() {
        // Reset the gsetting to restore the default layout
        global.settings.reset(SCHEMA_KEY);

        // Remove any user-specified desktop files,
        // to restore all default names
        // and clean up any unused resources
        let userPath = GLib.get_user_data_dir();
        let userDir = Gio.File.new_for_path(userPath);

        if (!userDir) {
            return;
        }

        let appDir = userDir.get_child(APP_DIR_NAME);
        if (appDir) {
            let children = appDir.enumerate_children_async(
                Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, this._enumerateDesktopFiles));
        }

        let folderDir = userDir.get_child(FOLDER_DIR_NAME);
        if (folderDir) {
            let children = folderDir.enumerate_children_async(
                Gio.FILE_ATTRIBUTE_STANDARD_NAME,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                null,
                Lang.bind(this, this._enumerateDirectoryFiles));
        }
    },

    _enumerateFiles: function(file, result, removeCallback) {
        let enumerator = file.enumerate_children_finish(result);
        enumerator.next_files_async(
            GLib.MAXINT32, GLib.PRIORITY_DEFAULT, null, removeCallback);
    },

    _enumerateDesktopFiles: function(file, result) {
        this._enumerateFiles(file, result,
                             Lang.bind(this, this._removeDesktopFiles));
    },

    _enumerateDirectoryFiles: function(file, result) {
        this._enumerateFiles(file, result,
                             Lang.bind(this, this._removeDirectoryFiles));
    },

    _removeFiles: function(enumerator, result, extension) {
        let fileInfos = enumerator.next_files_finish(result);
        for (let i = 0; i < fileInfos.length; i++) {
            let fileInfo = fileInfos[i];
            let fileName = fileInfo.get_name();
            if (fileName.endsWith(extension)) {
                let file = enumerator.get_child(fileInfo);
                file.delete_async(GLib.PRIORITY_DEFAULT, null, null);
            }
        }
    },

    _removeDesktopFiles: function(enumerator, result) {
        this._removeFiles(enumerator, result, DESKTOP_EXT);
    },

    _removeDirectoryFiles: function(enumerator, result) {
        this._removeFiles(enumerator, result, DIRECTORY_EXT);
    },

    // We use the insert Id instead of the index here since gsettings
    // includes the full application list that the desktop may have.
    // Relying on the position leads to faulty behaviour if some
    // apps are not present on the system
    _insertIcon: function(icons, id, insertId) {
        let insertIdx = -1;

        if (insertId != null) {
            insertIdx = icons.indexOf(insertId);
        }

        // We were dropped to the left of the trashcan,
        // or we were asked to append
        if (insertIdx == -1) {
            insertIdx = icons.length;
        }

        icons.splice(insertIdx, 0, id);
    }
});
Signals.addSignalMethods(IconGridLayout.prototype);

// to be used as singleton
const layout = new IconGridLayout();
