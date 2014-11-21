var QueueWorker = require('./lib/queue_worker');

/**
 * @constructor
 * @param {Firebase} ref A firebase reference to the queue.
 * @param {String} jobId the current job ID.
 * @param {Integer} numWorkers The number of workers to create for this job.
 * @param {Function} processingFunction A function that is called each time to
 *   process the queue item. This function is passed three parameters:
 *     - data {Object} The current data at the location.
 *     - resolve {Function} An asychronous callback function - call this
 *         function when the processingFunction completes successfully. This
 *         takes an optional Object parameter that, if passed, will overwrite
 *         the data at the queue item location
 *     - reject {Function} An asynchronous callback function - call this
 *         function if the processingFunction encounters an error. This takes
 *         an optional String or Object parameter that will be stored in the
 *         '_error_details/error' location in the queue item.
 */
module.exports = Queue;

function Queue(ref, jobId, numWorkers, processingFunction) {
  var self = this;
  if (typeof(numWorkers) !== 'number' ||
        numWorkers % 1 !== 0 ||
        numWorkers <= 0) {
    throw new Error('The number of workers must be a possitive integer');
  }
  self.ref = ref;
  self.workers = [];
  for (var i = 0; i < numWorkers; i++) {
    self.workers.push(QueueWorker(self.ref, i, processingFunction));
  }

  self.ref.parent().child('_jobs').child(jobId).on('value',
    function(jobSpecSnap) {
      if (jobSpecSnap.val() === null) {
        throw new Error('No job specified for this worker');
      }
      if (jobSpecSnap.child('state').val() === null) {
        throw new Error('No state specified for this job');
      }

      // TODO: change state specification to be more intuative

      var jobSpec = {
        startState: jobSpecSnap.child('state/start').val(),
        inProgressState: jobSpecSnap.child('state/inProgress').val(),
        finishedState: jobSpecSnap.child('state/finished').val(),
        jobTimeout: jobSpecSnap.child('timeout').val()
      };

      if (!jobSpec.inProgressState) {
        throw new Error('No inProgress state specified for this job');
      }
      if (!jobSpec.finishedState) {
        throw new Error('No finished state specified for this job');
      }

      for (var i = 0; i < numWorkers; i++) {
        self.workers[i].resetJob(jobSpec);
      }
    },
    function(error) {
      throw error;
    });

  return self;
}
