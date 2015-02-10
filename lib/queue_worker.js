var Firebase = require('firebase'),
    uuid = require('uuid');

/**
 * @param {Firebase} queueRef the Firebase reference for the queue.
 * @param {String} processId the ID of the current worker process.
 * @param {Function} processingFunction the function to be called each time a
 *   job is claimed.
 * @return {Object}
 */
function QueueWorker(queueRef, processId, processingFunction) {
  var self = this;
  if (typeof(processingFunction) !== 'function') {
    throw new Error('No processing function provided');
  }

  self.processId = processId;
  self.uuid = null;

  self.processingFunction = processingFunction;
  self.expiryTimeouts = {};

  self.queueRef = queueRef;
  self.processingItemsRef = null;
  self.currentItemRef = null;
  self.newItemRef = null;

  self.currentItemListener = null;
  self.newItemListener = null;
  self.processingItemAddedListener = null;
  self.processingItemRemovedListener = null;

  self.busy = false;

  return {
    resetJob: self.resetJob.bind(self)
  };
}

/**
 * Sets up the listeners to claim jobs and reset them if they timeout. Called
 *   any time the job spec changes.
 * @param {Object} jobSpec The specification for the job.
 */
QueueWorker.prototype.resetJob = function(jobSpec) {
  var self = this;

  if (jobSpec.startState !== null &&
      typeof(jobSpec.startState) !== 'string') {
    throw new Error('Job startState incorrectly defined');
  }
  if (!jobSpec.inProgressState ||
      typeof(jobSpec.inProgressState) !== 'string') {
    throw new Error('No inProgress state specified for this job');
  }
  if (!jobSpec.finishedState ||
      typeof(jobSpec.finishedState) !== 'string') {
    throw new Error('No finished state specified for this job');
  }
  if (jobSpec.jobTimeout !== null && (
      typeof(jobSpec.jobTimeout) !== 'number' ||
      jobSpec.jobTimeout % 1 !== 0 ||
      jobSpec.jobTimeout <= 0)) {
    throw new Error('Job timeout incorrectly defined');
  }

  // Reset the UUID so that jobs completing from before the change don't
  // continue to use incorrect data
  self.uuid = uuid.v4();

  self.startState = jobSpec.startState;
  self.inProgressState = jobSpec.inProgressState;
  self.finishedState = jobSpec.finishedState;
  self.jobTimeout = jobSpec.jobTimeout;

  if (self.newItemListener !== null) {
    self.newItemRef.off('child_added', self.newItemListener);
  }
  self.newItemRef = self.queueRef.orderByChild('_state').equalTo(self.startState).limitToFirst(1);
  self.info('listening');
  self.newItemListener = self.newItemRef.on('child_added', function(snapshot) {
    self.nextItemRef = snapshot.ref();
    self.tryToProcess(self.nextItemRef);
  }, function(error) {
    throw error;
  }, self);

  self.setUpTimeouts();
};

/**
 * Attempts to claim the next item in the queue.
 * @param {Firebase} nextItemRef Reference to the Firebase location of the next
 *   queue item.
 */
QueueWorker.prototype.tryToProcess = function(nextItemRef) {
  var self = this;
  if (!self.busy) {
    nextItemRef.transaction(function(queueItem) {
      if (queueItem === null) {
        return queueItem;
      }
      var currentState = queueItem._state || null;
      if (currentState === self.startState) {
        queueItem._state = self.inProgressState;
        queueItem._state_changed = Firebase.ServerValue.TIMESTAMP;
        queueItem._owner = self.uuid;
        queueItem._progress = 0;
        queueItem._error_details = null;
        return queueItem;
      } else {
        return;
      }
    }, function(error, committed, snapshot) {
      if (error) {
        throw error;
      }
      if (committed && snapshot.val() !== null) {
        if (self.busy) {
          // Worker has become busy while the transaction was processing - so
          // give up the job for now so another worker can claim it
          self.resetItem(nextItemRef);
        } else {
          self.busy = true;
          self.info('claimed ' + snapshot.key());
          self.currentItemRef = snapshot.ref();
          self.currentItemListener = self.currentItemRef
              .child('_owner').on('value', function(snapshot) {
            if (snapshot.val() !== self.uuid &&
                self.currentItemRef !== null &&
                self.currentItemListener !== null) {
              self.currentItemRef.child('_owner').off(
                'value',
                self.currentItemListener);
              self.currentItemRef = null;
              self.currentItemListener = null;
            }
          });
          self.processingFunction(
            snapshot.val(),
            self.updateProgress.bind(self),
            self.resolve.bind(self),
            self.reject.bind(self));
        }
      }
    }, false);
  }
};

/**
 * Sets up timeouts to reclaim jobs that fail due to taking too long.
 */
QueueWorker.prototype.setUpTimeouts = function() {
  var self = this;

  if (self.processingItemAddedListener !== null) {
    self.processingItemsRef.off(
      'child_added',
      self.processingItemAddedListener);
    self.processingItemAddedListener = null;
  }
  if (self.processingItemRemovedListener !== null) {
    self.processingItemsRef.off(
      'child_removed',
      self.processingItemRemovedListener);
    self.processingItemRemovedListener = null;
  }

  for (var i in self.expiryTimeouts) {
    clearTimeout(self.expiryTimeouts[i]);
  }
  self.expiryTimeouts = {};

  if (self.jobTimeout) {
    self.processingItemsRef = self.queueRef.orderByChild('_state')
      .equalTo(self.inProgressState);
    self.processingItemAddedListener = self.processingItemsRef.on('child_added',
      function(snapshot) {
        var queueItemName = snapshot.key();
        var now = new Date().getTime();
        var startTime = (snapshot.child('_state_changed').val() || now);
        var expires = Math.max(0, startTime - now + self.jobTimeout);
        var ref = snapshot.ref();
        self.expiryTimeouts[queueItemName] = setTimeout(
          self.resetItem.bind(self),
          expires,
          ref);
      }, function(error) {
        throw error;
      });
    self.processingItemRemovedListener = self.processingItemsRef.on(
      'child_removed',
      function(snapshot) {
        var queueItemName = snapshot.key();
        clearTimeout(self.expiryTimeouts[queueItemName]);
        delete self.expiryTimeouts[queueItemName];
      }, function(error) {
        throw error;
      });
  }
};

/**
 * Returns the state of an item to the start state.
 * @param {Firebase} itemRef Reference to the Firebase location of the queue item
 *   that's timed out.
 */
QueueWorker.prototype.resetItem = function(itemRef) {
  var self = this;

  itemRef.transaction(function(queueItem) {
    if (queueItem === null) {
      return queueItem;
    }
    var currentState = queueItem._state || null;
    if (currentState === self.inProgressState) {
      queueItem._state = self.startState;
      queueItem._state_changed = Firebase.ServerValue.TIMESTAMP;
      queueItem._owner = null;
      queueItem._progress = null;
      queueItem._error_details = null;
      return queueItem;
    } else {
      return;
    }
  }, function(error, committed, snapshot) {
    if (error) {
      throw error;
    }
    if (committed && snapshot.val() !== null) {
      self.info('reset ' + snapshot.key());
    }
  }, false);
};

/**
 * Resolves the current job item and changes the state to the finished state.
 * @param {Object} newQueueItem The new data to be stored at the location. If
 *   resolve is called without an object argument, the queue entry will be deleted.
 */
QueueWorker.prototype.resolve = function(newQueueItem) {
  var self = this;
  var deleteItem = (typeof(newQueueItem) !== 'object');
  if (self.currentItemRef === null) {
    self.busy = false;
    self.tryToProcess(self.nextItemRef);
  } else {
    self.currentItemRef.transaction(function(queueItem) {
      if (queueItem === null) {
        return queueItem;
      }
      var currentState = queueItem._state || null;
      if (currentState === self.inProgressState &&
          queueItem._owner === self.uuid) {
        if (deleteItem) {
          return null;
        }
        newQueueItem._state = self.finishedState;
        newQueueItem._state_changed = Firebase.ServerValue.TIMESTAMP;
        newQueueItem._owner = null;
        newQueueItem._progress = 100;
        newQueueItem._error_details = null;
        return newQueueItem;
      } else {
        return;
      }
    }, function(error, committed, snapshot) {
      if (error) {
        throw error;
      }
      if (committed && snapshot.val() !== null) {
        self.info('completed ' + snapshot.key());
      }
      self.busy = false;
      self.tryToProcess(self.nextItemRef);
    }, false);
  }
};

/**
 * Rejects the current job item and changes the state to 'error', adding
 * additional data to the '_error_details' sub key.
 * @param {Object} error The error message or object to be logged.
 */
QueueWorker.prototype.reject = function(error) {
  var self = this;
  if (self.currentItemRef === null) {
    self.busy = false;
    self.tryToProcess(self.nextItemRef);
  } else {
    self.currentItemRef.transaction(function(queueItem) {
      if (queueItem === null) {
        return queueItem;
      }
      var currentState = queueItem._state || null;
      if (currentState === self.inProgressState &&
          queueItem._owner === self.uuid) {
        queueItem._state = 'error';
        queueItem._state_changed = Firebase.ServerValue.TIMESTAMP;
        queueItem._owner = null;
        queueItem._error_details = {
          previousState: self.inProgressState,
          error: error || null
        };
        return queueItem;
      } else {
        return;
      }
    }, function(error, committed, snapshot) {
      if (error) {
        throw error;
      }
      if (committed && snapshot.val() !== null) {
        self.info('errored while attempting to complete ' + snapshot.key());
      }
      self.busy = false;
      self.tryToProcess(self.nextItemRef);
    }, false);
  }
};

/**
 * Updates the progress state of the item.
 * @param {Number} progress The progress to report.
 */
QueueWorker.prototype.updateProgress = function(progress) {
  var self = this;
  if (typeof(progress) === 'number' && progress >= 0 && progress <= 100 &&
      self.currentItemRef !== null) {
    self.currentItemRef.transaction(function(queueItem) {
      if (queueItem === null) {
        return queueItem;
      }
      var currentState = queueItem._state || null;
      if (currentState === self.inProgressState &&
          queueItem._owner === self.uuid) {
        queueItem._progress = progress;
        return queueItem;
      } else {
        return;
      }
    }, function(error, committed, snapshot) {
      if (error) {
        throw error;
      }
    }, false);
  }
};

/**
 * Logs an info message with a worker-specific prefix.
 * @param {String} message The message to log.
 */
QueueWorker.prototype.info = function(message) {
  var self = this;
  console.log('Worker ' + self.processId + ' (' + self.uuid + ') ' + message);
};

module.exports = QueueWorker;
