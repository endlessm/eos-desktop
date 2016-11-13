// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Clutter = imports.gi.Clutter;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Shell = imports.gi.Shell;
const St = imports.gi.St;

const Config = imports.misc.config;
const Tweener = imports.ui.tweener;
const Params = imports.misc.params;

const SCROLL_TIME = 0.1;

const FALLBACK_BROWSER_ID = 'chromium-browser.desktop';

// http://daringfireball.net/2010/07/improved_regex_for_matching_urls
const _balancedParens = '\\((?:[^\\s()<>]+|(?:\\(?:[^\\s()<>]+\\)))*\\)';
const _leadingJunk = '[\\s`(\\[{\'\\"<\u00AB\u201C\u2018]';
const _notTrailingJunk = '[^\\s`!()\\[\\]{};:\'\\".,<>?\u00AB\u00BB\u201C\u201D\u2018\u2019]';

const _urlRegexp = new RegExp(
    '(^|' + _leadingJunk + ')' +
    '(' +
        '(?:' +
            '[a-z][\\w-]+://' +                   // scheme://
            '|' +
            'www\\d{0,3}[.]' +                    // www.
            '|' +
            '[a-z0-9.\\-]+[.][a-z]{2,4}/' +       // foo.xx/
        ')' +
        '(?:' +                                   // one or more:
            '[^\\s()<>]+' +                       // run of non-space non-()
            '|' +                                 // or
            _balancedParens +                     // balanced parens
        ')+' +
        '(?:' +                                   // end with:
            _balancedParens +                     // balanced parens
            '|' +                                 // or
            _notTrailingJunk +                    // last non-junk char
        ')' +
    ')', 'gi');

let _desktopSettings = null;

// findUrls:
// @str: string to find URLs in
//
// Searches @str for URLs and returns an array of objects with %url
// properties showing the matched URL string, and %pos properties indicating
// the position within @str where the URL was found.
//
// Return value: the list of match objects, as described above
function findUrls(str) {
    let res = [], match;
    while ((match = _urlRegexp.exec(str)))
        res.push({ url: match[2], pos: match.index + match[1].length });
    return res;
}

// http://stackoverflow.com/questions/4691070/validate-url-without-www-or-http
const _searchUrlRegexp = new RegExp(
    '^([a-zA-Z0-9]+(\.[a-zA-Z0-9]+)+.*)\\.+[A-Za-z0-9\.\/%&=\?\-_]+$',
    'gi');

// findSearchUrls:
// @terms: list of searchbar terms to find URLs in
//
// Similar to "findUrls", but for use only with terms from the searchbar.
// The regex for these URLs matches strings such as "google.com" (note the
// lack of preceding scheme).
//
// Return value: the list of URLs found in the string
function findSearchUrls(terms) {
    let res = [], match;
    for (let i in terms) {
        while ((match = _searchUrlRegexp.exec(terms[i]))) {
            res.push(match[0]);
        }
    }
    return res;
}

// spawn:
// @argv: an argv array
//
// Runs @argv in the background, handling any errors that occur
// when trying to start the program.
function spawn(argv, errorNotifier) {
    try {
        trySpawn(argv);
    } catch (err) {
        _handleSpawnError(argv[0], err, errorNotifier);
    }
}

// spawnCommandLine:
// @command_line: a command line
//
// Runs @command_line in the background, handling any errors that
// occur when trying to parse or start the program.
function spawnCommandLine(command_line, errorNotifier) {
    try {
        let [success, argv] = GLib.shell_parse_argv(command_line);
        trySpawn(argv);
    } catch (err) {
        _handleSpawnError(command_line, err, errorNotifier);
    }
}

// spawnApp:
// @argv: an argv array
//
// Runs @argv as if it was an application, handling startup notification
function spawnApp(argv) {
    try {
        let app = Gio.AppInfo.create_from_commandline(argv.join(' '), null,
                                                      Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION);

        let context = global.create_app_launch_context(0, -1);
        app.launch([], context);
    } catch(err) {
        _handleSpawnError(argv[0], err);
    }
}

// trySpawn:
// @argv: an argv array
//
// Runs @argv in the background. If launching @argv fails,
// this will throw an error.
function trySpawn(argv)
{
    var success, pid;
    try {
        [success, pid] = GLib.spawn_async(null, argv, null,
                                          GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                                          null);
    } catch (err) {
        /* Rewrite the error in case of ENOENT */
        if (err.matches(GLib.SpawnError, GLib.SpawnError.NOENT)) {
            throw new GLib.SpawnError({ code: GLib.SpawnError.NOENT,
                                        message: _("Command not found") });
        } else if (err instanceof GLib.Error) {
            // The exception from gjs contains an error string like:
            //   Error invoking GLib.spawn_command_line_async: Failed to
            //   execute child process "foo" (No such file or directory)
            // We are only interested in the part in the parentheses. (And
            // we can't pattern match the text, since it gets localized.)
            let message = err.message.replace(/.*\((.+)\)/, '$1');
            throw new (err.constructor)({ code: err.code,
                                          message: message });
        } else {
            throw err;
        }
    }
    // Dummy child watch; we don't want to double-fork internally
    // because then we lose the parent-child relationship, which
    // can break polkit.  See https://bugzilla.redhat.com//show_bug.cgi?id=819275
    GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, function () {}, null);
}

// trySpawnCommandLine:
// @command_line: a command line
//
// Runs @command_line in the background. If launching @command_line
// fails, this will throw an error.
function trySpawnCommandLine(command_line) {
    let success, argv;

    try {
        [success, argv] = GLib.shell_parse_argv(command_line);
    } catch (err) {
        // Replace "Error invoking GLib.shell_parse_argv: " with
        // something nicer
        err.message = err.message.replace(/[^:]*: /, _("Could not parse command:") + "\n");
        throw err;
    }

    trySpawn(argv);
}

function _handleSpawnError(command, err, errorNotifier) {
    let title = _("Execution of '%s' failed:").format(command);
    errorNotifier(title, err.message);
}

// killall:
// @processName: a process name
//
// Kills @processName. If no process with the given name is found,
// this will fail silently.
function killall(processName) {
    try {
        // pkill is more portable than killall, but on Linux at least
        // it won't match if you pass more than 15 characters of the
        // process name... However, if you use the '-f' flag to match
        // the entire command line, it will work, but we have to be
        // careful in that case that we can match
        // '/usr/bin/processName' but not 'gedit processName.c' or
        // whatever...

        let argv = ['pkill', '-f', '^([^ ]*/)?' + processName + '($| )'];
        GLib.spawn_sync(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
        // It might be useful to return success/failure, but we'd need
        // a wrapper around WIFEXITED and WEXITSTATUS. Since none of
        // the current callers care, we don't bother.
    } catch (e) {
        logError(e, 'Failed to kill ' + processName);
    }
}

function createTimeLabel(date, params) {
    if (_desktopSettings == null)
        _desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });

    let label = new St.Label({ text: formatTime(date, params) });
    let id = _desktopSettings.connect('changed::clock-format', function() {
        label.text = formatTime(date, params);
    });
    label.connect('destroy', function() {
        _desktopSettings.disconnect(id);
    });
    return label;
}

function formatTime(date, params) {
    let now = new Date();

    let daysAgo = (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);

    let format;

    if (_desktopSettings == null)
        _desktopSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    let clockFormat = _desktopSettings.get_string('clock-format');
    let hasAmPm = date.toLocaleFormat('%p') != '';

    params = Params.parse(params, { timeOnly: false });

    if (clockFormat == '24h' || !hasAmPm) {
        // Show only the time if date is on today
        if (daysAgo < 1 || params.timeOnly)
            /* Translators: Time in 24h format */
            format = N_("%H\u2236%M");
        // Show the word "Yesterday" and time if date is on yesterday
        else if (daysAgo <2)
            /* Translators: this is the word "Yesterday" followed by a
             time string in 24h format. i.e. "Yesterday, 14:30" */
            // xgettext:no-c-format
            format = N_("Yesterday, %H\u2236%M");
        // Show a week day and time if date is in the last week
        else if (daysAgo < 7)
            /* Translators: this is the week day name followed by a time
             string in 24h format. i.e. "Monday, 14:30" */
            // xgettext:no-c-format
            format = N_("%A, %H\u2236%M");
        else if (date.getYear() == now.getYear())
            /* Translators: this is the month name and day number
             followed by a time string in 24h format.
             i.e. "May 25, 14:30" */
            // xgettext:no-c-format
            format = N_("%B %d, %H\u2236%M");
        else
            /* Translators: this is the month name, day number, year
             number followed by a time string in 24h format.
             i.e. "May 25 2012, 14:30" */
            // xgettext:no-c-format
            format = N_("%B %d %Y, %H\u2236%M");
    } else {
        // Show only the time if date is on today
        if (daysAgo < 1 || params.timeOnly)
            /* Translators: Time in 12h format */
            format = N_("%l\u2236%M %p");
        // Show the word "Yesterday" and time if date is on yesterday
        else if (daysAgo <2)
            /* Translators: this is the word "Yesterday" followed by a
             time string in 12h format. i.e. "Yesterday, 2:30 pm" */
            // xgettext:no-c-format
            format = N_("Yesterday, %l\u2236%M %p");
        // Show a week day and time if date is in the last week
        else if (daysAgo < 7)
            /* Translators: this is the week day name followed by a time
             string in 12h format. i.e. "Monday, 2:30 pm" */
            // xgettext:no-c-format
            format = N_("%A, %l\u2236%M %p");
        else if (date.getYear() == now.getYear())
            /* Translators: this is the month name and day number
             followed by a time string in 12h format.
             i.e. "May 25, 2:30 pm" */
            // xgettext:no-c-format
            format = N_("%B %d, %l\u2236%M %p");
        else
            /* Translators: this is the month name, day number, year
             number followed by a time string in 12h format.
             i.e. "May 25 2012, 2:30 pm"*/
            // xgettext:no-c-format
            format = N_("%B %d %Y, %l\u2236%M %p");
    }
    return date.toLocaleFormat(Shell.util_translate_time_string(format));
}

// lowerBound:
// @array: an array or array-like object, already sorted
//         according to @cmp
// @val: the value to add
// @cmp: a comparator (or undefined to compare as numbers)
//
// Returns the position of the first element that is not
// lower than @val, according to @cmp.
// That is, returns the first position at which it
// is possible to insert @val without violating the
// order.
// This is quite like an ordinary binary search, except
// that it doesn't stop at first element comparing equal.

function lowerBound(array, val, cmp) {
    let min, max, mid, v;
    cmp = cmp || function(a, b) { return a - b; };

    if (array.length == 0)
        return 0;

    min = 0; max = array.length;
    while (min < (max - 1)) {
        mid = Math.floor((min + max) / 2);
        v = cmp(array[mid], val);

        if (v < 0)
            min = mid + 1;
        else
            max = mid;
    }

    return (min == max || cmp(array[min], val) < 0) ? max : min;
}

// insertSorted:
// @array: an array sorted according to @cmp
// @val: a value to insert
// @cmp: the sorting function
//
// Inserts @val into @array, preserving the
// sorting invariants.
// Returns the position at which it was inserted
function insertSorted(array, val, cmp) {
    let pos = lowerBound(array, val, cmp);
    array.splice(pos, 0, val);

    return pos;
}

function getBrowserApp() {
    let id = FALLBACK_BROWSER_ID;
    let app = Gio.app_info_get_default_for_type('x-scheme-handler/http', true);
    if (app != null)
        id = app.get_id();
    let appSystem = Shell.AppSystem.get_default();
    let browserApp = appSystem.lookup_app(id);
    return browserApp;
}

function getRectForActor(actor) {
    let rect = new Clutter.Rect();
    rect.origin.x = actor.x;
    rect.origin.y = actor.y;
    rect.size.width = actor.width;
    rect.size.height = actor.height;

    return rect;
}

function blockClickEventsOnActor(actor) {
    actor.reactive = true;
    actor.connect('button-press-event', function (actor, event) {
        return true;
    });
    actor.connect('button-release-event', function (actor, event) {
        return true;
    });
}

function ensureActorVisibleInScrollView(scrollView, actor) {
    let adjustment = scrollView.vscroll.adjustment;
    let [value, lower, upper, stepIncrement, pageIncrement, pageSize] = adjustment.get_values();

    let offset = 0;
    let vfade = scrollView.get_effect("fade");
    if (vfade)
        offset = vfade.vfade_offset;

    let box = actor.get_allocation_box();
    let y1 = box.y1, y2 = box.y2;

    let parent = actor.get_parent();
    while (parent != scrollView) {
        if (!parent)
            throw new Error("actor not in scroll view");

        let box = parent.get_allocation_box();
        y1 += box.y1;
        y2 += box.y1;
        parent = parent.get_parent();
    }

    if (y1 < value + offset)
        value = Math.max(0, y1 - offset);
    else if (y2 > value + pageSize - offset)
        value = Math.min(upper, y2 + offset - pageSize);
    else
        return;

    Tweener.addTween(adjustment,
                     { value: value,
                       time: SCROLL_TIME,
                       transition: 'easeOutQuad' });
}
