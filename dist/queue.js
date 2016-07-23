/*
 * Firebase Queue is a fault-tolerant, multi-worker, multi-stage job pipeline
 * built on Firebase.
 *
 * Firebase Queue 1.5.0
 * https://github.com/firebase/firebase-queue/
 * License: MIT
 */
'use strict';

var _ = require('lodash');
var RSVP = require('rsvp');
var logger = require('winston');
var QueueWorker = require('./lib/queue_worker.js');

var DEFAULT_NUM_WORKERS = 1;
var DEFAULT_SANITIZE = true;
var DEFAULT_SUPPRESS_STACK = false;
var DEFAULT_TASK_SPEC = {
  inProgressState: 'in_progress',
  timeout: 300000 // 5 minutes
};


/**
 * @constructor
 * @param {firebase.database.Reference|Object} ref A Firebase Realtime Database
 *  reference to the queue or an object containing both keys:
 *     - tasksRef: {firebase.database.Reference} A Firebase Realtime Database
 *         reference to the queue tasks location.
 *     - specsRef: {firebase.database.Reference} A Firebase Realtime Database
 *         reference to the queue specs location.
 * @param {Object} options (optional) Object containing possible keys:
 *     - specId: {String} the task specification ID for the workers.
 *     - numWorkers: {Number} The number of workers to create for this task.
 *     - sanitize: {Boolean} Whether to sanitize the 'data' passed to the
 *         processing function of internal queue keys.
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
  self.shuttingDown = false;

  self.specChangeListener = null;

  if (constructorArguments.length < 2) {
    error = 'Queue must at least have the queueRef and ' +
      'processingFunction arguments.';
    logger.debug('Queue(): Error during initialization', error);
    throw new Error(error);
  } else if (constructorArguments.length === 2) {
    self.processingFunction = constructorArguments[1];
  } else if (constructorArguments.length === 3) {
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

  if (_.has(constructorArguments[0], 'tasksRef') &&
      _.has(constructorArguments[0], 'specsRef')) {
    self.tasksRef = constructorArguments[0].tasksRef;
    self.specsRef = constructorArguments[0].specsRef;
  } else if (_.isPlainObject(constructorArguments[0])) {
    error = 'When ref is an object it must contain both keys \'tasksRef\' ' +
      'and \'specsRef\'';
    logger.debug('Queue(): Error during initialization', error);
    throw new Error(error);
  } else {
    self.tasksRef = constructorArguments[0].child('tasks');
    self.specsRef = constructorArguments[0].child('specs');
  }

  self.workers = [];
  for (var i = 0; i < self.numWorkers; i++) {
    var processId = (self.specId ? self.specId + ':' : '') + i;
    self.workers.push(new QueueWorker(
      self.tasksRef,
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
    self.specChangeListener = self.specsRef.child(self.specId).on(
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

        for (var k = 0; k < self.numWorkers; k++) {
          self.workers[k].setTaskSpec(taskSpec);
        }
        self.currentTaskSpec = taskSpec;
        self.initialized = true;
      }, /* istanbul ignore next */ function(err) {
        logger.debug('Queue(): Error connecting to Firebase reference',
          err.message);
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
  this.shuttingDown = true;
  logger.debug('Queue: Shutting down');
  if (!_.isNull(this.specChangeListener)) {
    this.specsRef.child(this.specId).off('value',
      this.specChangeListener);
    this.specChangeListener = null;
  }

  return RSVP.all(_.map(this.workers, function(worker) {
    return worker.shutdown();
  }));
};

/**
 * Gets queue worker count.
 * @returns {Number} Total number of workers for this queue.
 */
Queue.prototype.getWorkerCount = function() {
  return this.workers.length;
};

/**
 * Adds a queue worker.
 * @returns {QueueWorker} the worker created.
 */
Queue.prototype.addWorker = function() {
  if (this.shuttingDown) {
    throw new Error('Cannot add worker while queue is shutting down');
  }

  logger.debug('Queue: adding worker');
  var processId = (this.specId ? this.specId + ':' : '') + this.workers.length;
  var worker = new QueueWorker(
    this.tasksRef,
    processId,
    this.sanitize,
    this.suppressStack,
    this.processingFunction
  );
  this.workers.push(worker);

  if (_.isUndefined(this.specId)) {
    worker.setTaskSpec(DEFAULT_TASK_SPEC);
  // if the currentTaskSpec is not yet set it will be called once it's fetched
  } else if (!_.isUndefined(this.currentTaskSpec)) {
    worker.setTaskSpec(this.currentTaskSpec);
  }

  return worker;
};

/**
 * Shutdowns a queue worker if one exists.
 * @returns {RSVP.Promise} A promise fulfilled once the worker is shutdown
 *   or rejected if there are no workers left to shutdown.
 */
Queue.prototype.shutdownWorker = function() {
  var worker = this.workers.pop();

  var promise;
  if (_.isUndefined(worker)) {
    promise = RSVP.reject(new Error('No workers to shutdown'));
  } else {
    logger.debug('Queue: shutting down worker');
    promise = worker.shutdown();
  }

  return promise;
};


module.exports = Queue;
