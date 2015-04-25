const GLib = imports.gi.GLib;

function resetEnvironment() {
    let settings = jasmine.createSpyObj('settings', [
        'connect',
        'get_boolean',
        'get_value',
        'reset',
    ]);
    settings.get_value.and.returnValue(new GLib.Variant('a{sv}',
        [new GLib.Variant('{sv}', ['desktop', new GLib.Variant('as', [])])]));
    settings.get_boolean.and.returnValue(true);

    window.global = {
        settings: settings,
    };
    window._ = (str) => str;
    window.C_ = (ctx, str) => str;
}
resetEnvironment();  // Needed for following import

let sessionModeImport = imports.js.ui.sessionMode;

describe('The clock', function () {
    beforeEach(resetEnvironment);

    it('is on the right', function () {
        let modes = sessionModeImport._modes;

        let rightPanel = modes['gdm']['panel']['right'];

        expect(rightPanel[0]).toEqual('dateMenu');
    });
});
