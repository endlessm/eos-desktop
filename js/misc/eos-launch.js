const Gio = imports.gi.Gio;

const AppLauncherIface = '<node> \
<interface name="org.gnome.Shell.AppLauncher"> \
<method name="Launch"> \
    <arg type="s" direction="in" name="name" /> \
    <arg type="u" direction="in" name="timestamp" /> \
    <arg type="b" direction="out" name="success" /> \
</method> \
</interface> \
</node>';

const AppLauncherProxy = Gio.DBusProxy.makeProxyWrapper(AppLauncherIface);

function createProxyAndLaunch(appName) {
    try {
        var proxy = new AppLauncherProxy(Gio.DBus.session,
                                         'org.gnome.Shell',
                                         '/org/gnome/Shell');
        proxy.LaunchSync(appName, 0);
        log("Application '" + appName + "' successfully launched");
    } catch (error) {
        logError(error, "Failed to launch application '" + appName + "'");
    }
}

var uri = ARGV[0];
if (! uri) {
    print("Usage: eos-launch endlessm-app://<application-name>\n");
} else {
    var tokens = uri.match(/(endlessm-app:\/\/|)([0-9,a-z,A-Z,-_.]+)/);
    if (tokens) {
        var appName = tokens[2];

        createProxyAndLaunch(appName);
    }
}
