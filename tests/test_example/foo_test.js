// application/javascript;version=1.8
// We use Gio to have some objects that we know exist
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

fooImport = imports.test_example.some_class;

function testBarReturnsTwiceTheInputValue() {
    let parameterValue=Math.random(); 
    let expectedValue=parameterValue*2; 

    let foo = new fooImport.Foo(); 

    assertEquals(expectedValue, foo.bar(parameterValue));
}

