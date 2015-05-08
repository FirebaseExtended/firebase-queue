'use strict';

var _ = require('lodash'),
    RSVP = require('rsvp'),
    logger = require('winston'),
    QueueWorker = require('./lib/queue_worker.js');

var DEFAULT_NUM_WORKERS = 1,
    DEFAULT_SANITIZE = true,
    DEFAULT_TASK_SPEC = {
      inProgressState: 'in_progress',
      timeout: 300000 // 5 minutes
    };

/**
 * @constructor
 * @param {Firebase} ref A Firebase reference to the queue.
 * @param {Object} options (optional) Object containing possible keys:
 *   - taskId: {String} the task specification ID for the workers.
 *   - numWorkers: {Number} The number of workers to create for this task.
 *   - sanitize: {Boolean} Whether to sanitize the 'data' passed to the
 *       processing function of internal queue keys.
 * @param {Function} processingFunction A function that is called each time to
 *   process a task. This function is passed four parameters:
 *     - data {Object} The current data at the location.
 *     - progress {Function} A function to update the progress percent of the
 *         task for informational purposes. Pass it a number between 0 and 100.
 *         Returns a promise of whether the operation was completed
 *         successfully.
 *     - resolve {Function} An asychronous callback function - call this
 *         function when the processingFunction completes successfully. This
 *         takes an optional Object parameter that, if passed, will overwrite
 *         the data at the task location, and returns a promise of whether the
 *         operation was successful.
 *     - reject {Function} An asynchronous callback function - call this
 *         function if the processingFunction encounters an error. This takes
 *         an optional String or Object parameter that will be stored in the
 *         '_error_details/error' location in the task and returns a promise
 *         of whether the operation was successful.
 * @returns {RSVP.Promise} A resolved promise if the Queue is initialized
 *   correctly, or a rejection if the parameters or Firebase reference are
 *   incorrect.
 */
function Queue() {
  var self = this;
  var constructorArguments = arguments;

  return new RSVP.Promise(function(resolve, reject) {
    var error;
    self.numWorkers = DEFAULT_NUM_WORKERS;
    self.sanitize = DEFAULT_SANITIZE;

    if (constructorArguments.length < 2) {
      error = 'Queue must at least have the queueRef and ' +
        'processingFunction arguments.';
      logger.error('Queue(): Error during initialization', error);
      return reject(error);
    } else if (constructorArguments.length === 2) {
      self.ref = constructorArguments[0];
      self.processingFunction = constructorArguments[1];
    } else if (constructorArguments.length === 3) {
      self.ref = constructorArguments[0];
      var options = constructorArguments[1];
      if (!_.isPlainObject(options)) {
        error = 'Options parameter must be a plain object.';
        logger.error('Queue(): Error during initialization', error);
        return reject(error);
      }
      if (!_.isUndefined(options.taskId)) {
        if (_.isString(options.taskId)) {
          self.taskId = options.taskId;
        } else {
          error = 'options.taskId must be a String.';
          logger.error('Queue(): Error during initialization', error);
          return reject(error);
        }
      }
      if (!_.isUndefined(options.numWorkers)) {
        if (_.isNumber(options.numWorkers) &&
            options.numWorkers > 0 &&
            options.numWorkers % 1 === 0) {
          self.numWorkers = options.numWorkers;
        } else {
          error = 'options.numWorkers must be a positive integer.';
          logger.error('Queue(): Error during initialization', error);
          return reject(error);
        }
      }
      if (!_.isUndefined(options.sanitize)) {
        if (_.isBoolean(options.sanitize)) {
          self.sanitize = options.sanitize;
        } else {
          error = 'options.sanitize must be a boolean.';
          logger.error('Queue(): Error during initialization', error);
          return reject(error);
        }
      }
      self.processingFunction = constructorArguments[2];
    } else {
      error = 'Queue can only take at most three arguments - queueRef, ' +
        'options (optional), and processingFunction.';
      logger.error('Queue(): Error during initialization', error);
      return reject(error);
    }

    self.workers = [];
    for (var i = 0; i < self.numWorkers; i++) {
      var processId = (self.taskId ? self.taskId + ':' : '') + i;
      self.workers.push(new QueueWorker(
        self.ref.child('tasks'),
        processId,
        self.sanitize,
        self.processingFunction
      ));
    }

    if (_.isUndefined(self.taskId)) {
      for (var j = 0; j < self.numWorkers; j++) {
        self.workers[j].setTaskSpec(DEFAULT_TASK_SPEC);
      }
      return resolve(self);
    } else {
      var initialized = false;
      self.ref.child('specs').child(self.taskId).on(
        'value',
        function(taskSpecSnap) {
          var taskSpec = {
                startState: taskSpecSnap.child('start_state').val(),
                inProgressState: taskSpecSnap.child('in_progress_state').val(),
                finishedState: taskSpecSnap.child('finished_state').val(),
                errorState: taskSpecSnap.child('error_state').val(),
                timeout: taskSpecSnap.child('timeout').val()
              };

          for (var i = 0; i < self.numWorkers; i++) {
            self.workers[i].setTaskSpec(taskSpec);
          }
          /* istanbul ignore else */
          if (!initialized) {
            initialized = true;
            return resolve(self);
          }
        }, /* istanbul ignore next */ function(error) {
          logger.error('Queue(): Error connecting to Firebase reference',
            error);
          if (!initialized) {
            initialized = true;
            return reject(error.message || 'Error connectino to Firebase ' +
              'Reference');
          }
        });
    }
  });
}

module.exports = Queue;
