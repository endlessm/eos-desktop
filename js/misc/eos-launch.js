const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;

const AppLauncherIface = '<node> \
<interface name="org.gnome.Shell.AppLauncher"> \
<method name="Launch"> \
    <arg type="s" direction="in" name="name" /> \
    <arg type="b" direction="out" name="success" /> \
</method> \
</interface> \
</node>';

function onError(error) {
    log(error);
    Mainloop.quit('main');
    return false;
}

function remoteLaunch(proxy, appName) {
    proxy.LaunchRemote(appName,
                       function(result, error) {
                           if (error)
                               return onError (error);

                           if (result)
                               log("Application '" + appName + "' successfully launched");
                           else
                               log("Failed to launch application '" + appName + "'");

                           return Mainloop.quit('main');
                       });
}

function createProxyAndLaunch(appName) {

    function onProxy(proxy, error) {
        if (error)
            return onError(error);

        return remoteLaunch(proxy, appName);
    }

    const ProxyClass = Gio.DBusProxy.makeProxyWrapper(AppLauncherIface);
    var proxy = new ProxyClass(Gio.DBus.session,
                               'org.gnome.Shell',
                               '/org/gnome/Shell',
                               onProxy);
}

var uri = ARGV[0];
if (! uri) {
    print("Usage: eos-launch endlessm-app://<application-name>\n");
}
else {
    var tokens = uri.match(/(endlessm-app:\/\/|)([0-9,a-z,A-Z,-_.]+)/);
    if (tokens) {
        var appName = tokens[2];

        createProxyAndLaunch(appName);

        Mainloop.run('main');
    }
}
