let sessionModeImport = imports.js.ui.sessionMode;

function testClockIsOnTheRight() {
    let modes = sessionModeImport._modes;

    let rightPanel = modes['gdm']['panel']['right'];
    
    assertEquals('dateMenu', rightPanel[0]);
}

