// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const CodingGameService = imports.gi.CodingGameService;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Meta = imports.gi.Meta;

const CodingChatboxTextService = new Lang.Class({
    Name: 'CodingChatboxTextService',

    _init: function() {
        this.parent();
        this._eventHandlers = {
            'move-window': Lang.bind(this, this._waitForNextWindowMove),
            'stop-moving-windows': Lang.bind(this, this._waitForNoWindowsToMove)
        };
    },

    _startListeningForEvent: function(name) {
        if (this._eventHandlers[name]) {
            this._disconnectHandlersFor(name);
            this._eventHandlers[name]();
        }
    },

    enable: function() {
        // Connect to the service
        try {
            this._service = CodingGameService.CodingGameServiceProxy.new_for_bus_sync(
                Gio.BusType.SESSION, 0,
                'com.endlessm.CodingGameService.Service',
                '/com/endlessm/CodingGameService/Service', null);
        } catch (e) {
            logError(e, 'Error occurred in creating CodingGameServiceProxy');
            return;
        }

        this._signalHandlers = {};
        this._listenForEventsId = this._service.connect('listen-for-event',
                                                        Lang.bind(this, function(proxy, name) {
            this._startListeningForEvent(name);
        }));
        this._stopListeningForEventsId =
            this._service.connect('stop-listening-for', Lang.bind(this, function(proxy, name) {
                // In this case, just disconnect any known event handlers, don't
                // need any custom logic here
                this._disconnectHandlersFor(name);
            }));

        this._service.call_currently_listening_for_events(null, Lang.bind(this, function(source, result) {
            let success, returnValue;

            try {
                [success, returnValue] = this._service.call_currently_listening_for_events_finish(result);
            } catch (e) {
                logError(e);
                return;
            }

            returnValue.deep_unpack().map(Lang.bind(this, this._startListeningForEvent));
        }));
    },

    disable: function() {
        Object.keys(this._signalHandlers, Lang.bind(this, function(key) {
            this._disconnectHandlersFor(key);
        }));
    },

    _popSignalHandlers: function(name) {
        name = name.replace(/\-/g, '_');
        let retval = this._signalHandlers[name];
        if (!retval) {
            return [];
        }

        delete this._signalHandlers[name];
        return retval;
    },

    _disconnectHandlersFor: function(name) {
        let handlers = this._popSignalHandlers(name);

        handlers.forEach(function(handler) {
            if (handler.object) {
                handler.object.disconnect(handler.connection);
            } else if (handler.source) {
                // Assume this is a GSource
                GLib.source_remove(handler.source);
            }
        });
    },

    _waitForNextWindowMove: function() {
        let wmCallback = Lang.bind(this, function(display, screen, window, op) {
            if (window && op == Meta.GrabOp.MOVING) {
                this._service.call_external_event('move-window', null, null);
                this._disconnectHandlersFor('move-window');
            }
        });
        this._signalHandlers.move_window = [{
            object: global.display,
            connection: global.display.connect('grab-op-begin', wmCallback)
        }];
    },

    _waitForNoWindowsToMove: function() {
        // Here we create a timeout of 5000ms and for a case where the user is
        // no longer moving windows around.
        //
        // Create the timeout on grab-op-end and if the user doesn't do something
        // that causes grab-op-begin within that time, call the ExternalEvent
        // method with 'stop-moving-window'

        let timeoutCb = Lang.bind(this, function() {
            this._disconnectHandlersFor('stop-moving-windows');
            this._service.call_external_event('stop-moving-windows', null, null);
            return false;
        });

        let grabOpBeginCb = Lang.bind(this, function(display, screen, window, op) {
            if (window && op === Meta.GrabOp.MOVING) {
                // Started moving a window again - disconnect this signal handler
                // and connect a signal handler to wait for windows to stop moving.
                this._disconnectHandlersFor('stop-moving-windows');
                this._signalHandlers.stop_moving_windows = [
                    {
                        object: global.display,
                        connection: global.display.connect('grab-op-end', grabOpEndCb)
                    }
                ];
            }
        });

        let grabOpEndCb = Lang.bind(this, function(display, screen, window, op) {
            if (window && op === Meta.GrabOp.MOVING) {
                // Window has finished moving - disconnect this signal handler
                // and connect a signal handler for both this timeout and
                // grab-op-begin in its place.
                this._disconnectHandlersFor('stop-moving-windows');
                this._signalHandlers.stop_moving_windows = [
                    {
                        object: global.display,
                        connection: global.display.connect('grab-op-begin', grabOpBeginCb)
                    },
                    {
                        source: GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, timeoutCb)
                    }
                ];
            }
        });

        this._signalHandlers.stop_moving_windows = [{
            object: global.display,
            connection: global.display.connect('grab-op-end', grabOpEndCb)
        }];
    }
});
const Component = CodingChatboxTextService;
