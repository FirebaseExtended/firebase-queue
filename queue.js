var QueueWorker = require('./lib/queue_worker');

var DEFAULT_NUM_WORKERS = 1,
    DEFAULT_JOB_STATE_IN_PROGRESS = "in_progress",
    DEFAULT_JOB_STATE_FINISHED = "finished",
    DEFAULT_TIMEOUT = 360000;

/**
 * @constructor
 * @param {Firebase} ref A Firebase reference to the queue.
 * @param {Object} (optional) Object containing possible keys:
     - jobId: {String} the current job identifier.
     - numWorkers: {Number} The number of workers to create for this job.
 * @param {Function} processingFunction A function that is called each time to
 *   process the queue item. This function is passed three parameters:
 *     - data {Object} The current data at the location.
 *     - progress {Function} A function to update the progress percent of the
 *         queue item for informational purposes. Pass it an integer
 *         between 0 and 100.
 *     - resolve {Function} An asychronous callback function - call this
 *         function when the processingFunction completes successfully. This
 *         takes an optional Object parameter that, if passed, will overwrite
 *         the data at the queue item location
 *     - reject {Function} An asynchronous callback function - call this
 *         function if the processingFunction encounters an error. This takes
 *         an optional String or Object parameter that will be stored in the
 *         '_error_details/error' location in the queue item.
 */
function Queue() {
  var self = this;
  self.numWorkers = DEFAULT_NUM_WORKERS;
  if (arguments.length < 2) {
    throw new Error('Queue must at least have the queueRef and processingFunction arguments.');
  } else if (arguments.length === 2) {
    self.ref = arguments[0];
    self.processingFunction = arguments[1];
  } else if (arguments.length === 3) {
    self.ref = arguments[0];
    var options = arguments[1];
    if (typeof(options.jobId) === 'string') {
      self.jobId = options.jobId;
    }
    if (typeof(options.numWorkers) === 'number' && options.numWorkers % 1 === 0 && options.numWorkers > 0) {
      self.numWorkers = options.numWorkers;
    }
    self.processingFunction = arguments[2];
  } else {
    throw new Error('Queue can only take at most three arguments - queueRef, options (optional), and processingFunction.');
  }
  self.workers = [];
  for (var i = 0; i < self.numWorkers; i++) {
    var processId = (self.jobId ? self.jobId + ':' : '') + i;
    self.workers.push(new QueueWorker(self.ref.child('queue'), processId, self.processingFunction));
  }
  if (typeof(self.jobId) === 'undefined') {
    var jobSpec = {
      startState: null,
      inProgressState: DEFAULT_JOB_STATE_IN_PROGRESS,
      finishedState: DEFAULT_JOB_STATE_FINISHED,
      jobTimeout: DEFAULT_TIMEOUT
    };
    for (var j = 0; j < self.numWorkers; j++) {
      self.workers[j].resetJob(jobSpec);
    }
  } else {
    self.ref.child('jobs').child(self.jobId).on('value',
      function(jobSpecSnap) {
        if (jobSpecSnap.val() === null) {
          throw new Error('No job specified for this worker');
        }
        var finishedState = jobSpecSnap.child('state_finished').val();
        if (finishedState === null) {
          throw new Error('No state_finished specified for this job');
        }
        var inProgressState = jobSpecSnap.child('state_in_progress').val();
        if (inProgressState === null) {
          throw new Error('No state_in_progress specified for this job');
        }
        var jobSpec = {
          startState: jobSpecSnap.child('state_start').val(),
          inProgressState: inProgressState,
          finishedState: finishedState,
          jobTimeout: jobSpecSnap.child('timeout').val()
        };
        for (var i = 0; i < self.numWorkers; i++) {
          self.workers[i].resetJob(jobSpec);
        }
      },
      function(error) {
        throw error;
      });
  }
  return self;
}

module.exports = Queue;
