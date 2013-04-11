// application/javascript;version=1.8

window.C_=function(type,text){
 return text;
}

window._=window.C_;
window.global={};

let sessionModeImport = imports.js.ui.sessionMode;

function testClockIsOnTheRight() {
    let modes = sessionModeImport._modes;

    let rightPanel = modes['gdm']['panel']['right'];
    
    assertEquals('dateMenu', rightPanel[0]);
}

