// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Showmehow = imports.gi.Showmehow;
const Signals = imports.signals;

const MissionChatboxTextService = new Lang.Class({
    Name: 'MissionChatboxTextService',

    _init: function() {
        let name = 'com.endlessm.Showmehow.Service';
        let path = '/com/endlessm/Showmehow/Service';

        /* Connect to the service and refresh the content once we have a connection */
        try {
            this._service = Showmehow.ServiceProxy.new_for_bus_sync(Gio.BusType.SESSION,
                                                                    0, name, path, null);
        } catch (e) {
            logError(e, 'Error occurred in creating ShowmehowServiceProxy');
            return;
        }

        /* It doesn't seem possible to return an array of strings here, looks like it has to be an array
         * of tuples (which contain strings). */
        this._service.connect('listening-for-lesson-events', Lang.bind(this, function(proxy, interestingEvents) {
            this.emit('listening-for-events', interestingEvents.deep_unpack().map(function(i) {
                return i[0];
            }));
        }));
    },

    noteEventOccurrence: function(event) {
        this._service.call_lesson_event(event, null, null);
    }
});
Signals.addSignalMethods(MissionChatboxTextService.prototype);

const getService = (function() {
    let missionChatboxTextService = null;

    return function() {
        if (!missionChatboxTextService) {
            missionChatboxTextService = new MissionChatboxTextService();
        }

        return missionChatboxTextService;
    };
})();
