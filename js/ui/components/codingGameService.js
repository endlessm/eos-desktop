// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Showmehow = imports.gi.Showmehow;

const CodingChatboxTextService = new Lang.Class({
    Name: 'CodingChatboxTextService',

    enable: function() {
        // Connect to the service
        try {
            this._service = Showmehow.ServiceProxy.new_for_bus_sync(
                Gio.BusType.SESSION, 0,
                'com.endlessm.Showmehow.Service',
                '/com/endlessm/Showmehow/Service', null);
        } catch (e) {
            logError(e, 'Error occurred in creating ShowmehowServiceProxy');
            return;
        }

        // It doesn't seem possible to return an array of strings here, looks like it has to be an array
        // of tuples (which contain strings).
        this._listenForLessonsId =
            this._service.connect('listening-for-lesson-events', Lang.bind(this, function(proxy, interestingEvents) {
                let events = interestingEvents.deep_unpack().map(function(i) {
                    return i[0];
                });

                if (events.indexOf('window-moved') !== -1)
                    this._waitForNextWindowMove();
            }));
    },

    disable: function() {
        if (this._listenForLessonsId > 0) {
            this._service.disconnect(this._listenForLessonsId);
            this._listenForLessonsId = 0;
        }
    },

    _waitForNextWindowMove: function() {
        let grabBeginId = global.display.connect('grab-op-begin', function(display, screen, window, op) {
            if (window && op == Meta.GrabOp.MOVING) {
                this._service.call_lesson_event('window-moved', null, null);
                global.display.disconnect(grabBeginId);
            }
        });
    }
});
const Component = CodingChatboxTextService;
