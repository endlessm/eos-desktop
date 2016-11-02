// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Signals = imports.signals;
const Atk = imports.gi.Atk;

const ANIMATED_ICON_UPDATE_TIMEOUT = 16;

const Animation = new Lang.Class({
    Name: 'Animation',

    _init: function(file, width, height, speed) {
        this.actor = new St.Bin({ width: width, height: height });
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this._speed = speed;

        this._isLoaded = false;
        this._isPlaying = false;
        this._timeoutId = 0;
        this._frame = 0;
        this._frames = null;

        St.TextureCache.get_default().load_sliced_image_async(file, width, height,
                                                              Lang.bind(this, this._animationsLoaded));
    },

    play: function() {
        if (this._isLoaded && this._timeoutId == 0) {
            if (this._frame == 0)
                this._showFrame(0);

            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, this._speed, Lang.bind(this, this._update));
            GLib.Source.set_name_by_id(this._timeoutId, '[gnome-shell] this._update');
        }

        this._isPlaying = true;
    },

    stop: function() {
        if (this._timeoutId > 0) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._isPlaying = false;
    },

    _showFrame: function(frame) {
        this._frame = (frame % this._frames.length);
        let newFrame = this._frames[this._frame];
        this.actor.set_content(newFrame);
    },

    _update: function() {
        this._showFrame(this._frame + 1);
        return GLib.SOURCE_CONTINUE;
    },

    _animationsLoaded: function(cache, res) {
        try {
            this._frames = cache.load_sliced_image_finish(res);
        } catch (e) {
            logError(e, ' Unable to load sliced image for animation');
            return;
        }

        this._isLoaded = true;

        if (this._isPlaying)
            this.play();
    },

    _onDestroy: function() {
        this.stop();
    }
});

const AnimatedIcon = new Lang.Class({
    Name: 'AnimatedIcon',
    Extends: Animation,

    _init: function(file, size) {
        this.parent(file, size, size, ANIMATED_ICON_UPDATE_TIMEOUT);
    }
});
