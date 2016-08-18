// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Lang = imports.lang;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Showmehow = imports.gi.Showmehow;
const Signals = imports.signals;


/**
 * callWhenComplete
 *
 * Takes an object with keys mapping to bool values, a callback
 * and a key name. Flips the key name to true and checks if
 * they are all true, and if so, calls the callback.
 *
 * This is used by MissionChatboxTextService to ensure that
 * all asynchronous tasks are completed before calling
 * the completion callback. The callback is called with
 * the key that triggered the callback.
 */
function callWhenComplete(completion, key, callback) {
    completion[key] = true;

    /* This is a shorthand way of implementing Array.all
     * using De Morgan's laws and Array.some */
    const complete = !Object.keys(completion).some(function(key) {
        return !completion[key];
    });

    if (complete && callback) {
        callback(key);
    }
}

const MissionChatboxTextService = new Lang.Class({
    Name: 'MissionChatboxTextService',
    Extends: GLib.GObject,

    _init: function(props) {
        this.parent(props);

        /* Null-initialise service for now, but we'll set it later */
        this._service = null;

        /* These properties make up the lesson's content. _lessonInfo refers
         * to all of the text we need to display about the broader "lesson"
         * and _taskInfo is all the text that we need to display about the
         * currently active task.
         *
         * The state of this service moves through each each task until
         * it reaches the end, at which point it displays a message
         * and sets itself to a "done" state.
         */
        this._introLesson = null;
        this._openedForTheFirstTime = false;
        this._currentTaskText = null;
        this._chatboxLessonCounter = 0;

        const name = "com.endlessm.Showmehow.Service";
        const path = "/com/endlessm/Showmehow/Service";

        /* Connect to the service and refresh the content once we have a connection */
        Showmehow.ServiceProxy.new_for_bus(Gio.BusType.SESSION, 0, name, path, null,
                                           Lang.bind(this, function(source, result) {
            this._service = Showmehow.ServiceProxy.new_for_bus_finish(result);
            this._service.connect("lessons-changed", Lang.bind(this, function(proxy) {
                /* When the underlying lessons change, we need to reset the entire
                 * state of this component and start from the beginning, including
                 * showing any warnings.
                 *
                 * Get the intro lesson again then reset all the state back
                 * to its initial point.
                 */
                this._refreshContent(function() {
                    this._introLesson = lessons[0];
                    this._openedForTheFirstTime = false;
                    this._chatboxLessonCounter = 0;
                });
            }));
            this._refreshContent();
        }));
    },
    commenceIntroLesson: function() {
        /* If possible in the current state, commence the intro lesson.
         *
         * That depends on us having not been opened for the first
         * time and the content being loaded. */
        if (!this._openedForTheFirstTime && this._introLesson) {
            this._openedForTheFirstTime = true;
            this._chatboxLessonCounter = 0;

            /* Get warnings and show them first, then show the first
             * chatbox description */
            this._service.call_get_warnings(null, Lang.bind(this, function(source, result) {
                [success, returnValue] = this._service.call_get_warnings_finish(result);
                if (success) {
                    /* Immediately display all warnings in the chatbox */
                    returnValue.deep_unpack().map(function(w) {
                        return w[0];
                    }).forEach(Lang.bind(this, function(w) {
                        this.emit("chat-message", {
                            kind: "scrolling",
                            mode: "immediate",
                            text: w
                        });
                    }));
                } else {
                    log("Call to get_warnings_finish failed");
                }

                this._showTaskDescriptionForLesson(this._chatboxLessonCounter);
            }));
        }
    },
    evaluate: function(text) {
        /* If we're currently doing a lesson, submit this to the
         * service and see what the response is */
        const numLessons = this._introLesson ? this._introLesson[2] : 0;

        if (this._introLesson &&
            this._currentTaskText &&
            this._chatboxLessonCounter < numLessons) {
            this._service.call_attempt_lesson_remote("intro", this._chatboxLessonCounter, text, null,
                                                     Lang.bind(this, function(source, result) {
                [success, returnValue] = this._service.call_attempt_lesson_remote_finish(result);

                if (success) {
                    const [wait_message, printable_output, attemptResult] = returnValue.deep_unpack();

                    /* Ignore the wait message, just print the success or fail message */
                    const textToPrint = attemptResult ? this._currentTaskText.success : this._currentTaskText.fail;
                    this.emit("chat-message", {
                        kind: "scrolling",
                        mode: "animated",
                        text: textToPrint
                    });

                    /* If we were successful, increment the lesson counter and display
                     * the next lesson, if applicable */
                    if (attemptResult) {
                        this._chatboxLessonCounter++;
                        this._showTaskDescriptionForLesson(this._chatboxLessonCounter);
                    }
                } else {
                    log("Failed to call call_attempt_lesson_remote");
                }
            }));
        }
    },
    _refreshContent: function(completedCallback) {
        if (!this._service) {
            log("Attempted to refresh content without a service!");
        }

        var completion = {
            "adventures": false,
            "spells": false,
            "inventory": false,
            "intro": false
        };

        this._service.call_get_unlocked_lessons("console", null, Lang.bind(this, function(source, result) {
            [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);
            lessons = lessons.deep_unpack();

            if (success) {
                this.emit("discover-new-adventures", lessons.map(function(lesson_spec) {
                    return {
                        name: lesson_spec[0],
                        desc: lesson_spec[1]
                    };
                }));
                callWhenComplete(completion, "adventures", completedCallback);
            } else {
                log("Warning: Call to showmehow get_unlocked_lessons failed");
            }
        }));

        this._service.call_get_known_spells("console", null, Lang.bind(this, function(source, result) {
            [success, lessons] = this._service.call_get_known_spells_finish(result);
            lessons = lessons.deep_unpack();

            if (success) {
                this.emit("discover-new-spells", lessons.map(function(lesson_spec) {
                    return {
                        name: lesson_spec[0],
                        desc: lesson_spec[1]
                    };
                }));
                callWhenComplete(completion, "spells", completedCallback);
            } else {
                log("Warning: Call to showmehow get_known_spells failed");
            }
        }));

        this._service.call_get_unlocked_lessons("shell", null, Lang.bind(this, function(source, result) {
            [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);

            if (success) {
                /* There should be a single lesson here called introduction here. Save
                 * it. */
                lessons = lessons.deep_unpack().filter(function(lesson) {
                    return lesson[0] == "intro";
                });

                if (lessons.length !== 1) {
                    log("Expected a single lesson for shell, cannot show intro lesson!");
                    return;
                }

                this._introLesson = lessons[0];
                callWhenComplete(completion, "intro", completedCallback);
            } else {
                log("Warning: Call to showmehow get_unlocked_lessons failed for intro lesson");
            }
        }));

        this._service.call_get_clues("shell", null, Lang.bind(this, function(source, result) {
            [success, clues] = this._service.call_get_clues_finish(result);

            if (success) {
                this.emit("discover-new-inventory-items", clues.deep_unpack().map(function(clue) {
                    const [name, type] = clue;
                    return {
                        name: name,
                        type: type
                    };
                }));
                callWhenComplete(completion, "inventory", completedCallback);
            } else {
                log("Warning: Call to showmehow get_unlocked_lessons failed for intro lesson");
            }
        }));
    },
    _showTaskDescriptionForLesson: function(lessonIndex) {
        if (!this._introLesson) {
            return;
        }

        const numLessons = this._introLesson[2];

        if (lessonIndex >= numLessons) {
            /* We have a currently active intro lesson. Display the
             * "done" message, and then set everything back to null. */
            const doneMessage = this._introLesson[3];
            if (this._introLesson) {
                this.emit("chat-message", {
                    kind: "scrolling",
                    mode: "animated",
                    text: doneMessage
                });
                this._introLesson = null;
                this._currentTaskText = null;
                this._chatboxLessonCounter = 0;
            }

            return;
        }

        this._service.call_get_task_description("intro", lessonIndex, null,
                                                Lang.bind(this, function(source, result) {
            [success, returnValue] = this._service.call_get_task_description_finish(result);

            if (success) {
                const [desc, successText, failText] = returnValue.deep_unpack();
                this._currentTaskText = {
                    desc: desc,
                    success: successText,
                    fail: failText
                };

                this.emit("chat-message", {
                    kind: "scrolling",
                    mode: "animated",
                    text: desc
                });
            } else {
                log("Call to call_get_task_description_finish failed");
            }
        }));
    }
});
Signals.addSignalMethods(MissionChatboxTextService.prototype);
