'use strict';

var _ = require('lodash'),
    RSVP = require('rsvp'),
    logger = require('winston'),
    QueueWorker = require('./lib/queue_worker.js');

var DEFAULT_NUM_WORKERS = 1,
    DEFAULT_JOB_SPEC = {
      inProgressState: 'in_progress',
      timeout: 300000 // 5 minutes
    };

/**
 * @constructor
 * @param {Firebase} ref A Firebase reference to the queue.
 * @param {Object} options (optional) Object containing possible keys:
 *   - jobId: {String} the current job identifier.
 *   - numWorkers: {Number} The number of workers to create for this job.
 * @param {Function} processingFunction A function that is called each time to
 *   process the queue item. This function is passed three parameters:
 *     - data {Object} The current data at the location.
 *     - progress {Function} A function to update the progress percent of the
 *         queue item for informational purposes. Pass it a number between
 *         0 and 100.
 *     - resolve {Function} An asychronous callback function - call this
 *         function when the processingFunction completes successfully. This
 *         takes an optional Object parameter that, if passed, will overwrite
 *         the data at the queue item location, and returns a promise of
 *         whether the operation was successful.
 *     - reject {Function} An asynchronous callback function - call this
 *         function if the processingFunction encounters an error. This takes
 *         an optional String or Object parameter that will be stored in the
 *         '_error_details/error' location in the queue item and returns a
 *         promise of whether the operation was successful.
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
      if (!_.isUndefined(options.jobId)) {
        if (_.isString(options.jobId)) {
          self.jobId = options.jobId;
        } else {
          error = 'options.jobId must be a String.';
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
      self.processingFunction = constructorArguments[2];
    } else {
      error = 'Queue can only take at most three arguments - queueRef, ' +
        'options (optional), and processingFunction.';
      logger.error('Queue(): Error during initialization', error);
      return reject(error);
    }

    self.workers = [];
    for (var i = 0; i < self.numWorkers; i++) {
      var processId = (self.jobId ? self.jobId + ':' : '') + i;
      self.workers.push(new QueueWorker(
        self.ref.child('queue'),
        processId,
        self.processingFunction
      ));
    }

    if (_.isUndefined(self.jobId)) {
      for (var j = 0; j < self.numWorkers; j++) {
        self.workers[j].setJob(DEFAULT_JOB_SPEC);
      }
      return resolve(self);
    } else {
      var initialized = false;
      self.ref.child('jobs').child(self.jobId).on('value', function(jobSpecSnap) {
        var jobSpec = {
              startState: jobSpecSnap.child('start_state').val(),
              inProgressState: jobSpecSnap.child('in_progress_state').val(),
              finishedState: jobSpecSnap.child('finished_state').val(),
              timeout: jobSpecSnap.child('timeout').val()
            };

        for (var i = 0; i < self.numWorkers; i++) {
          self.workers[i].setJob(jobSpec);
        }
        /* istanbul ignore else */
        if (!initialized) {
          initialized = true;
          return resolve(self);
        }
      }, /* istanbul ignore next */ function(error) {
        logger.error('Queue(): Error connecting to Firebase reference', error);
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
