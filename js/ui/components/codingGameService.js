// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const CodingGameService = imports.gi.CodingGameService;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Meta = imports.gi.Meta;

const CodingChatboxTextService = new Lang.Class({
    Name: 'CodingChatboxTextService',

    _init: function() {
        this._signalHandlers = {};
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
        this._controller = new CodingGameService.AppIntegrationController();
        this._controller.service_event_with_listener('move-window', Lang.bind(this, function() {
            this._startListeningForEvent('move-window');
        }), Lang.bind(this, function() {
            this._disconnectHandlersFor('move-window');
        }));
        this._controller.service_event_with_listener('stop-moving-windows', Lang.bind(this, function() {
            this._startListeningForEvent('stop-moving-windows');
        }), Lang.bind(this, function() {
            this._disconnectHandlersFor('stop-moving-windows');
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
                this._controller.event_occurred('move-window');
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
            this._controller.event_occurred('stop-moving-windows');
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
