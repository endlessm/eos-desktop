// application/javascript;version=1.8
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;

window.C_=function(type,text){
 return text;
}

window._=window.C_;
window.St = {};
window.St.Bin = new Lang.Class({Name:'Bin'});

let sessionModeImport = imports.js.ui.sessionMode;

function testClockIsOnTheRight() {
    print(Object.keys(this));
    let modes = sessionModeImport._modes;

    let rightPanel = modes['gdm']['panel']['right'];
    
    assertEquals('dateMenu', rightPanel[0]);
}

