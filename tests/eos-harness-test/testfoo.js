// application/javascript;version=1.8
// We use Gio to have some objects that we know exist
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

function setUp() {
    this.value = 100;
}

function tearDown() {
}

function testValueChange() {
    this.value = 150;
    assertEquals(150, this.value);
}

function testValueIsHundred() {
    assertEquals(100, this.value);
}

function testLifeUniverseAndEverything() {
    assertEquals(false,false);
    assertEquals(-42, "-420");
}

function testPass() {
    assertEquals(false,false);
}

function testBadConstructor() {
     //Gio.AppLaunchContext();
}

function testLifeUniverseAndEverything2() {
    assertEquals(false,false);
    assertEquals(-42, "-420");
}

function testPass2() {
    assertEquals(false,true);
}

function testBadConstructor2() {
         assertRa
}

function testLifeUniverseAndEverything3() {
    assertEquals(false,false);
    assertEquals(-42, "-420");
}

function testPass3() {
    assertEquals(false,false);
}

function testBadConstructor3() {
     //Gio.AppLaunchContext();
}
