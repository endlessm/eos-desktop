// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Showmehow = imports.gi.Showmehow;
const Signals = imports.signals;

const Batch = imports.gdm.batch;

/**
 * acquireHoldUntil
 *
 * Acquire the hold until the function returned by this function
 * is called (which will then call @callback and then release
 * @
 */
function acquireHoldUntil(hold, callback) {
    hold.acquire();
    return function() {
        callback.apply(this, arguments);
        hold.release();
    };
}

const MissionChatboxTextService = new Lang.Class({
    Name: 'MissionChatboxTextService',

    _init: function() {
        this.parent();

        /* Null-initialise service for now, but we'll set it later */
        this._service = null;

        /* These properties make up the lesson's content. _introLesson refers
         * to all of the text we need to display about the broader 'lesson'
         * and _currenTask is all the text that we need to display about the
         * currently active task.
         *
         * The state of this service moves through each each task until
         * it reaches the end, at which point these are set back to null.
         */
        this._openedForTheFirstTime = false;
        this._introLesson = null;
        this._currentTask = null;

        let name = 'com.endlessm.Showmehow.Service';
        let path = '/com/endlessm/Showmehow/Service';

        /* Connect to the service and refresh the content once we have a connection */
        Showmehow.ServiceProxy.new_for_bus(Gio.BusType.SESSION, 0, name, path, null,
                                           Lang.bind(this, function(source, result) {
            try {
                this._service = Showmehow.ServiceProxy.new_for_bus_finish(result);
            } catch (e) {
                logError(e, "Error occurred in creating ShowmehowServiceProxy");
                return;
            }

            this._service.connect('lessons-changed', Lang.bind(this, function() {
                /* When the underlying lessons change, we need to reset the entire
                 * state of this component and start from the beginning, including
                 * showing any warnings.
                 *
                 * Get the intro lesson again then reset all the state back
                 * to its initial point.
                 */
                this._refreshContent(Lang.bind(this, function() {
                    this._openedForTheFirstTime = false;
                    this._currentTask = null;
                }));
            }));
            /* It doesn't seem possible to return an array of strings here, looks like it has to be an array
             * of tuples (which contain strings). */
            this._service.connect('listening-for-lesson-events', Lang.bind(this, function(proxy, interestingEvents) {
                this.emit('listening-for-events', interestingEvents.deep_unpack().map(function(i) {
                    return i[0];
                }));
            }));
            this._refreshContent();
        }));
    },
    _handleLessonResponse: function(source, result) {
        let success, returnValue;

        try {
            [success, returnValue] = this._service.call_attempt_lesson_remote_finish(result);
        } catch (e) {
            logError(e, 'Error occurred in attempting lesson');
            return;
        }

        /* XXX: Does !sucess here imply that an exception was thrown
         * earlier? IF so, this block can be removed. */
        if (!success) {
            log('Couldn\'t attempt lesson successfully');
            return;
        }

        let [responsesJSON, moveTo] = returnValue.deep_unpack();
        let responses = JSON.parse(responsesJSON);

        responses.forEach(Lang.bind(this, function(response) {
            this.emit('chat-message', {
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
            return;
        }

        if (moveTo !== this._currentTask.name) {
            this._showTaskDescriptionForLesson(moveTo);
        } else {
            this.emit('user-input-bubble', this._currentTask.input);
        }
    },
    ready: function() {
        /* If we don't have any content, then we can't do anything */
        if (!this._introLesson) {
            return;
        }

        /* If possible in the current state, commence the intro lesson. */
        if (!this._openedForTheFirstTime) {
            this._openedForTheFirstTime = true;

            /* Get warnings and show them first, then show the first
             * chatbox description */
            this._service.call_get_warnings(null, Lang.bind(this, function(source, result) {
                let success, returnValue;
                try {
                    [success, returnValue] = this._service.call_get_warnings_finish(result);
                } catch (e) {
                    logError(e, 'Error occurred in calling get_warnings');
                }

                if (!success) {
                    log('Call to get_warnings_finish failed');
                    return;
                }

                /* Immediately display all warnings in the chatbox */
                returnValue.deep_unpack().map(function(w) {
                    return w[0];
                }).forEach(Lang.bind(this, function(w) {
                    this.emit('chat-message', {
                        kind: 'scrolled',
                        mode: 'immediate',
                        text: w
                    });
                }));

                this._showTaskDescriptionForLesson(this._introLesson.entry);
            }));

            return;
        }

        /* If we need to re-attempt the current lesson, do so */
        if (this._currentTask) {
            this.emit('lesson-events-satisfied-input-fired');
            this.evaluate('');
            return;
        }
    },
    evaluate: function(text) {
        if (this._introLesson && this._currentTask) {
            this._service.call_attempt_lesson_remote('intro', this._currentTask.name, text, null,
                                                     Lang.bind(this, this._handleLessonResponse));
        }
    },
    _refreshContent: function(completedCallback) {
        if (!this._service) {
            log('Attempted to refresh content without a service!');
        }

        let hold = new Batch.Hold();
        let connection = hold.connect('release', function() {
            hold.disconnect(connection);
            if (completedCallback) {
                completedCallback();
            }
        });

        this._service.call_get_unlocked_lessons('console', null, acquireHoldUntil(hold, Lang.bind(this, function(source, result) {
            let success, lessons;

            try {
                [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);
            } catch (e) {
                logError(e, 'Error occurred in getting unlocked lessons');
                return;
            }

            if (!success) {
                log('Warning: Call to showmehow get_unlocked_lessons failed');
                return;
            }

            lessons = lessons.deep_unpack();

            this.emit('discover-new-adventures', lessons.map(function(lesson_spec) {
                return {
                    name: lesson_spec[0],
                    desc: lesson_spec[1]
                };
            }));
        })));

        this._service.call_get_known_spells('console', null, acquireHoldUntil(hold, Lang.bind(this, function(source, result) {
            let success, lessons;

            try {
                [success, lessons] = this._service.call_get_known_spells_finish(result);
            } catch (e) {
                logError(e, 'Error occurred in getting known spells');
                return;
            }

            if (!success) {
                log('Warning: call to showmhow get_known_spells failed');
                return;
            }

            lessons = lessons.deep_unpack();

            this.emit('discover-new-spells', lessons.map(function(lesson_spec) {
                return {
                    name: lesson_spec[0],
                    desc: lesson_spec[1]
                };
            }));
        })));

        this._service.call_get_unlocked_lessons('shell', null, acquireHoldUntil(hold, Lang.bind(this, function(source, result) {
            let success, lessons;

            try {
                [success, lessons] = this._service.call_get_unlocked_lessons_finish(result);
            } catch (e) {
                logError(e, 'Error occurred in getting unlocked lessons for shell');
                return;
            }

            if (!success) {
                log('Warning: Call to showmehow get_unlocked_lessons failed, cannot show intro lesson');
                return;
            }

            /* There should be a single lesson here called introduction here. Save
             * it. */
            lessons = lessons.deep_unpack().filter(function(lesson) {
                return lesson[0] == 'intro';
            });

            if (lessons.length !== 1) {
                log('Expected a single lesson for shell, cannot show intro lesson!');
                return;
            }

            let [name, desc, entry] = lessons[0];
            this._introLesson = {
                name: name,
                desc: desc,
                entry: entry
            };
        })));

        this._service.call_get_clues('shell', null, acquireHoldUntil(hold, Lang.bind(this, function(source, result) {
            let success, clues;

            try {
                [success, clues] = this._service.call_get_clues_finish(result);
            } catch (e) {
                logError(e, 'Error occurred in getting clues');
                return;
            }

            if (!success) {
                log('Warning: Call to showmehow get_clues failed');
                return;
            }

            this.emit('discover-new-inventory-items', clues.deep_unpack().map(function(clue) {
                let [name, type] = clue;
                return {
                    name: name,
                    type: type
                };
            }));
        })));

        /* Now that we've made all these requests, release the hold so
         * that its reference count drops back to the request count */
        hold.release();
    },
    _showTaskDescriptionForLesson: function(taskName) {
        if (!this._introLesson) {
            return;
        }

        this._service.call_get_task_description('intro', taskName, null,
                                                Lang.bind(this, function(source, result) {
            let success, returnValue;

            try {
                [success, returnValue] = this._service.call_get_task_description_finish(result);
            } catch (e) {
                logError(e, 'Error occurred in getting task description for ' + taskName);
                return;
            }

            if (!success) {
                log('Call to get_task_description failed, cannot show this task.');
                return;
            }

            let [desc, inputSpecString] = returnValue.deep_unpack();
            let inputSpec = JSON.parse(inputSpecString);
            this._currentTask = {
                desc: desc,
                input: inputSpec,
                name: taskName
            };

            this.emit('chat-message', {
                kind: 'scrolled',
                mode: 'animated',
                text: desc
            });

            this.emit('user-input-bubble', inputSpec);
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
