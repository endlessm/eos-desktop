// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const St = imports.gi.St;
const Signals = imports.signals;
const Atk = imports.gi.Atk;

const ANIMATED_ICON_UPDATE_TIMEOUT = 100;

const Animation = new Lang.Class({
    Name: 'Animation',

    _init: function(filename, width, height, speed) {
        this.actor = new St.Bin();
        this.actor.connect('destroy', Lang.bind(this, this._onDestroy));
        this._speed = speed;

        this._isLoaded = false;
        this._isPlaying = false;
        this._timeoutId = 0;
        this._frame = 0;
        this._animations = St.TextureCache.get_default().load_sliced_image (filename, width, height,
                                                                            Lang.bind(this, this._animationsLoaded));
        this.actor.set_child(this._animations);
    },

    play: function() {
        if (this._isLoaded && this._timeoutId == 0) {
            if (this._frame == 0)
                this._showFrame(0);

            this._timeoutId = Mainloop.timeout_add(this._speed, Lang.bind(this, this._update));
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
        let oldFrameActor = this._animations.get_child_at_index(this._frame);
        if (oldFrameActor)
            oldFrameActor.hide();

        this._frame = (frame % this._animations.get_n_children());

        let newFrameActor = this._animations.get_child_at_index(this._frame);
        if (newFrameActor)
            newFrameActor.show();
    },

    _update: function() {
        this._showFrame(this._frame + 1);
        return true;
    },

    _animationsLoaded: function() {
        this._isLoaded = true;

        if (this._isPlaying)
            this.play();
    },

    _onDestroy: function() {
        this.stop();
    }
});

const VariableSpeedAnimation = new Lang.Class({
    Name: 'VariableSpeedAnimation',
    Extends: Animation,

    _init: function(name, size, initialTimeout, skipEndFrames) {
        this.parent(global.datadir + '/theme/' + name, size, size,
                    initialTimeout, skipEndFrames);
    },

    _updateSpeed: function(newSpeed) {
        if (newSpeed == this._speed) {
            return;
        }

        this._clearTimeoutSource();
        this._speed = newSpeed;
        this._setTimeoutSource();
    },

    completeInTime: function(time, callback) {
        // Note: the skipEndFrames does not apply to the final steps
        // in the sequence once this method is called
        let frameTime = Math.floor(time / (this._frames.length - this._frame));
        this._updateSpeed(frameTime);

        this._completeCallback = callback;
        this._completeTimeGoal = time;
        this._completeStartTime = GLib.get_monotonic_time();
        this._completeStartFrame = this._frame;
    },

    _update: function() {
        if (!this._completeCallback) {
            return this.parent();
        }

        if (this._frame == (this._frames.length - 1)) {
            // we finished
            this.stop();

            this._completeCallback();
            this._completeCallback = null;

            return false;
        }

        let elapsedTime = (GLib.get_monotonic_time() - this._completeStartTime) / 1000;
        let percentage =  Math.min(1, elapsedTime / this._completeTimeGoal);
        let frameNum = this._completeStartFrame +
            Math.floor((this._frames.length - this._completeStartFrame) * percentage);

        if (frameNum == this._frames.length) {
            frameNum--;
        }

        this._showFrame(frameNum);

        return true;
    }
});

const AnimatedIcon = new Lang.Class({
    Name: 'AnimatedIcon',
    Extends: Animation,

    _init: function(filename, size) {
        this.parent(filename, size, size, ANIMATED_ICON_UPDATE_TIMEOUT);
    }
});
