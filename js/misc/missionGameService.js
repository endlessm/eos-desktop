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
        callback.apply(this, [key].concat(Array.from(arguments)));
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
        this._openedForTheFirstTime = false;
        this._introLesson = null;
        this._currentTask = null;

        const name = "com.endlessm.Showmehow.Service";
        const path = "/com/endlessm/Showmehow/Service";

        /* Connect to the service and refresh the content once we have a connection */
        Showmehow.ServiceProxy.new_for_bus(Gio.BusType.SESSION, 0, name, path, null,
                                           Lang.bind(this, function(source, result) {
            this._service = Showmehow.ServiceProxy.new_for_bus_finish(result);
            this._service.connect("lessons-changed", Lang.bind(this, function() {
                /* When the underlying lessons change, we need to reset the entire
                 * state of this component and start from the beginning, including
                 * showing any warnings.
                 *
                 * Get the intro lesson again then reset all the state back
                 * to its initial point.
                 */
                this._refreshContent(function() {
                    this._openedForTheFirstTime = false;
                    this._currentTask = null;
                });
            }));
            this._service.connect("listening-for-lesson-events", Lang.bind(this, function(proxy, interestingEvents) {
                this.emit("listening-for-events", interestingEvents.deep_unpack());
            }));
            this._refreshContent();
        }));
    },
    commenceIntroLesson: function() {

    },
    _handleLessonResponse: function(source, result) {
        const [success, returnValue] = this._service.call_attempt_lesson_remote_finish(result);

        if (success) {
            const [responsesJSON, moveTo] = returnValue.deep_unpack();
            const responses = JSON.parse(responsesJSON);

            responses.forEach(Lang.bind(this, function(response) {
                this.emit("chat-message", {
                    kind: response.type,
                    text: response.value
                });
            }));

            /* Move to the next specified task. If this is an empty
             * string, then it means there are no more tasks to
             * complete and we should respond accordingly. */
            if (moveTo.length === 0) {
                this._introLesson = null;
                this._currentTask = null;
            }

            if (this._currentTask) {
                if (moveTo !== this._currentTask.name) {
                    this._showTaskDescriptionForLesson(moveTo);
                } else {
                    this.emit('user-input-bubble', this._currentTask.input);
                }
            }
        } else {
            log("Failed to call call_attempt_lesson_remote");
        }
    },
    ready: function() {
        /* If possible in the current state, commence the intro lesson.
         *
         * That depends on us having not been opened for the first
         * time and the content being loaded. */
        if (!this._openedForTheFirstTime && this._introLesson) {
            this._openedForTheFirstTime = true;

            /* Get warnings and show them first, then show the first
             * chatbox description */
            this._service.call_get_warnings(null, Lang.bind(this, function(source, result) {
                const [success, returnValue] = this._service.call_get_warnings_finish(result);
                if (success) {
                    /* Immediately display all warnings in the chatbox */
                    returnValue.deep_unpack().map(function(w) {
                        return w[0];
                    }).forEach(Lang.bind(this, function(w) {
                        this.emit("chat-message", {
                            kind: "scrolled",
                            mode: "immediate",
                            text: w
                        });
                    }));
                } else {
                    log("Call to get_warnings_finish failed");
                }

                this._showTaskDescriptionForLesson(this._introLesson.entry);
            }));

            return;
        }

        /* If we need to re-attempt the current lesson, do so */
        if (this._currentTask && this._introLesson) {
            this.emit('lesson-events-satisfied-input-fired');
            this.evaluate('');
            return;
        }
    },
    evaluate: function(text) {
        if (this._introLesson && this._currentTask) {
            this._service.call_attempt_lesson_remote("intro", this._currentTask.name, text, null,
                                                     Lang.bind(this, this._handleLessonResponse));
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
            let [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);
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
            let [success, lessons] = this._service.call_get_known_spells_finish(result);
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
            let [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);

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

                const [name, desc, entry] = lessons[0];
                this._introLesson = {
                    name: name,
                    desc: desc,
                    entry: entry
                };

                callWhenComplete(completion, "intro", completedCallback);
            } else {
                log("Warning: Call to showmehow get_unlocked_lessons failed for intro lesson");
            }
        }));

        this._service.call_get_clues("shell", null, Lang.bind(this, function(source, result) {
            const [success, clues] = this._service.call_get_clues_finish(result);

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
    _showTaskDescriptionForLesson: function(taskName) {
        if (!this._introLesson) {
            return;
        }

        this._service.call_get_task_description("intro", taskName, null,
                                                Lang.bind(this, function(source, result) {
            const [success, returnValue] = this._service.call_get_task_description_finish(result);

            if (success) {
                const [desc, inputSpecString] = returnValue.deep_unpack();
                const inputSpec = JSON.parse(inputSpecString);
                this._currentTask = {
                    desc: desc,
                    input: inputSpec,
                    name: taskName
                };

                this.emit("chat-message", {
                    kind: "scrolled",
                    mode: "animated",
                    text: desc
                });

                this.emit("user-input-bubble", inputSpec);
            } else {
                log("Call to call_get_task_description_finish failed");
            }
        }));
    },
    noteEventOccurrence: function(event) {
        this._service.call_lesson_event(event, null, null);
    }
});
Signals.addSignalMethods(MissionChatboxTextService.prototype);

function getService() {
    if (!global._missionChatboxTextService) {
        global._missionChatboxTextService = new MissionChatboxTextService();
    }

    return global._missionChatboxTextService;
}
