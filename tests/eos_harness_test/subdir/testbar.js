// application/javascript;version=1.8
// We use Gio to have some objects that we know exist
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

function setUp() {
    this.value = 100;
}

function tearDown() {
    this.value = 123;
}

function testSubdirTest() {
    assertEquals(true, true);
}


