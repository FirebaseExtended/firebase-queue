var QueueWorker = require('./lib/queue_worker'),
    Firebase = require('firebase');

/**
 * @constructor
 * @param {String} referenceUrl The URL to the Firebase queue.
 * @param {String} token A JWT with the uid set to the current job ID.
 * @param {Integer} workers The number of workers to create for this job.
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

function Queue(referenceUrl, token, workers, processingFunction) {
  var self = this;
  if (typeof(workers) !== 'number' ||
        workers % 1 !== 0 ||
        workers <= 0) {
    throw new Error('The number of workers must be a possitive integer');
  }
  self.ref = new Firebase(referenceUrl, new Firebase.Context());
  self.workers = [];
  self.ref.authWithCustomToken(token, function(error, authData) {
    if (error) {
      throw error;
    }
    for (var i = 0; i < workers; i++) {
      self.workers.push(QueueWorker(self.ref, i, processingFunction));
    }
  });
  return self;
}
