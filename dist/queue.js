/*!
 * Firebase Queue is a fault-tolerant, multi-worker, multi-stage job pipeline
 * built on Firebase.
 *
 * Firebase Queue 1.2.1
 * https://github.com/firebase/firebase-queue/
 * License: MIT
 */
'use strict';

var _ = require('lodash'),
    RSVP = require('rsvp'),
    logger = require('winston'),
    QueueWorker = require('./lib/queue_worker.js');

var DEFAULT_NUM_WORKERS = 1,
    DEFAULT_SANITIZE = true,
    DEFAULT_SUPPRESS_STACK = false,
    DEFAULT_TASK_SPEC = {
      inProgressState: 'in_progress',
      timeout: 300000 // 5 minutes
    };


/**
 * @constructor
 * @param {Firebase} ref A Firebase reference to the queue.
 * @param {Object} options (optional) Object containing possible keys:
 *   - specId: {String} the task specification ID for the workers.
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
 * @returns {Object} The new Queue object.
 */
function Queue() {
  var self = this;
  var constructorArguments = arguments;

  var error;
  self.numWorkers = DEFAULT_NUM_WORKERS;
  self.sanitize = DEFAULT_SANITIZE;
  self.suppressStack = DEFAULT_SUPPRESS_STACK;
  self.initialized = false;

  self.specChangeListener = null;

  if (constructorArguments.length < 2) {
    error = 'Queue must at least have the queueRef and ' +
      'processingFunction arguments.';
    logger.debug('Queue(): Error during initialization', error);
    throw new Error(error);
  } else if (constructorArguments.length === 2) {
    self.ref = constructorArguments[0];
    self.processingFunction = constructorArguments[1];
  } else if (constructorArguments.length === 3) {
    self.ref = constructorArguments[0];
    var options = constructorArguments[1];
    if (!_.isPlainObject(options)) {
      error = 'Options parameter must be a plain object.';
      logger.debug('Queue(): Error during initialization', error);
      throw new Error(error);
    }
    if (!_.isUndefined(options.specId)) {
      if (_.isString(options.specId)) {
        self.specId = options.specId;
      } else {
        error = 'options.specId must be a String.';
        logger.debug('Queue(): Error during initialization', error);
        throw new Error(error);
      }
    }
    if (!_.isUndefined(options.numWorkers)) {
      if (_.isNumber(options.numWorkers) &&
          options.numWorkers > 0 &&
          options.numWorkers % 1 === 0) {
        self.numWorkers = options.numWorkers;
      } else {
        error = 'options.numWorkers must be a positive integer.';
        logger.debug('Queue(): Error during initialization', error);
        throw new Error(error);
      }
    }
    if (!_.isUndefined(options.sanitize)) {
      if (_.isBoolean(options.sanitize)) {
        self.sanitize = options.sanitize;
      } else {
        error = 'options.sanitize must be a boolean.';
        logger.debug('Queue(): Error during initialization', error);
        throw new Error(error);
      }
    }
    if (!_.isUndefined(options.suppressStack)) {
      if (_.isBoolean(options.suppressStack)) {
        self.suppressStack = options.suppressStack;
      } else {
        error = 'options.suppressStack must be a boolean.';
        logger.debug('Queue(): Error during initialization', error);
        throw new Error(error);
      }
    }
    self.processingFunction = constructorArguments[2];
  } else {
    error = 'Queue can only take at most three arguments - queueRef, ' +
      'options (optional), and processingFunction.';
    logger.debug('Queue(): Error during initialization', error);
    throw new Error(error);
  }

  self.workers = [];
  for (var i = 0; i < self.numWorkers; i++) {
    var processId = (self.specId ? self.specId + ':' : '') + i;
    self.workers.push(new QueueWorker(
      self.ref.child('tasks'),
      processId,
      self.sanitize,
      self.suppressStack,
      self.processingFunction
    ));
  }

  if (_.isUndefined(self.specId)) {
    for (var j = 0; j < self.numWorkers; j++) {
      self.workers[j].setTaskSpec(DEFAULT_TASK_SPEC);
    }
    self.initialized = true;
  } else {
    self.specChangeListener = self.ref.child('specs').child(self.specId).on(
      'value',
      function(taskSpecSnap) {
        var taskSpec = {
              startState: taskSpecSnap.child('start_state').val(),
              inProgressState: taskSpecSnap.child('in_progress_state').val(),
              finishedState: taskSpecSnap.child('finished_state').val(),
              errorState: taskSpecSnap.child('error_state').val(),
              timeout: taskSpecSnap.child('timeout').val(),
              retries: taskSpecSnap.child('retries').val()
            };

        for (var i = 0; i < self.numWorkers; i++) {
          self.workers[i].setTaskSpec(taskSpec);
        }
        self.initialized = true;
      }, /* istanbul ignore next */ function(error) {
        logger.debug('Queue(): Error connecting to Firebase reference',
          error.message);
      });
  }

  return self;
}


/**
 * Gracefully shuts down a queue.
 * @returns {RSVP.Promise} A promise fulfilled when all the worker processes
 *   have finished their current tasks and are no longer listening for new ones.
 */
Queue.prototype.shutdown = function() {
  var self = this;

  logger.debug('Queue: Shutting down');
  if (!_.isNull(self.specChangeListener)) {
    self.ref.child('specs').child(self.specId).off('value',
      self.specChangeListener);
    self.specChangeListener = null;
  }

  return RSVP.all(_.map(self.workers, function(worker) {
    return worker.shutdown();
  }));
};

module.exports = Queue;
