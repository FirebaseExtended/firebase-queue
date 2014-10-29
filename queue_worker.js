var Firebase = require('firebase'),
    uuid = require('uuid');

/**
 * @param {Firebase} authenticatedRef the Firebase reference for the queue.
 * @param {Number} processId the ID of the current worker process.
 * @param {Function} processingFunction the function to be called each time a
 *   job is claimed.
 * @return {Object}
 */
module.exports = function(authenticatedRef, processId, processingFunction) {
  return new QueueWorker(authenticatedRef, processId, processingFunction);
};

function QueueWorker(authenticatedRef, processId, processingFunction) {
  var self = this;
  var authData = authenticatedRef.getAuth();
  if (!authData || !authData.uid) {
    throw new Error('The Firebase reference must be authenticated');
  }
  if (typeof(processingFunction) !== 'function') {
    throw new Error('No processing function provided');
  }

  self.jobId = authData.uid;
  self.processId = processId;
  self.uuid = null;

  self.processingFunction = processingFunction;
  self.expiryTimeouts = {};

  self.ref = authenticatedRef;
  self.processingItemsRef = null;
  self.currentItemRef = null;
  self.newItemRef = null;

  self.currentItemListener = null;
  self.newItemListener = null;
  self.processingItemAddedListener = null;
  self.processingItemRemovedListener = null;

  self.busy = false;
  self.nextItem = null;

  self.ref.parent().child('_jobs').child(self.jobId).on(
    'value',
    self.listen,
    function(error) {
      throw error;
    }, self);

  return {
    getUUID: self.getUUID
  };
}

/**
 * Sets up the listeners to claim jobs and reset them if they timeout. Called
 * any time the job spec changes.
 * @param {Firebase.DataSnapshot} jobSpecSnap The snapshot for the job
 *   specification.
 */
QueueWorker.prototype.listen = function(jobSpecSnap) {
  var self = this;

  // Reset the UUID so that jobs completing from before the change don't
  // continue to use incorrect data
  self.uuid = uuid.v4();

  if (jobSpecSnap.val() === null) {
    throw new Error('No job specified for this worker');
  }
  if (jobSpecSnap.child('state').val() === null) {
    throw new Error('No state specified for this job');
  }

  self.startState = jobSpecSnap.child('state/start').val();
  self.inProgressState = jobSpecSnap.child('state/inProgress').val();
  self.finishedState = jobSpecSnap.child('state/finished').val();
  self.jobTimeout = jobSpecSnap.child('timeout').val();

  if (!self.inProgressState) {
    throw new Error('No inProgress state specified for this job');
  }
  if (!self.finishedState) {
    throw new Error('No finished state specified for this job');
  }

  if (self.newItemListener !== null) {
    self.newItemRef.off('child_added', self.newItemListener);
  }
  self.newItemRef = self.ref.orderBy('_state').equalTo(self.startState);
  self.newItemListener = self.newItemRef.on('child_added', function(snapshot) {
    // TODO: remove this ugly hack -------------------------------------------------
    self.nextItem = new Firebase(snapshot.ref().toString(), new Firebase.Context());
    // -----------------------------------------------------------------------------
    // self.nextItem = snapshot.ref();
    self.tryToProcess();
  }, function(error) {
    throw error;
  }, self);

  self.setUpTimeouts();
};

/**
 * Attempts to claim the next item in the queue.
 */
QueueWorker.prototype.tryToProcess = function() {
  var self = this;
  if (!self.busy) {
    self.nextItem.transaction(function(queueItem) {
      if (queueItem === null) {
        return queueItem;
      }
      var currentState = queueItem['_state'] || null;
      if (currentState === self.startState) {
        queueItem['_state'] = self.inProgressState;
        queueItem['_state_changed'] = Firebase.ServerValue.TIMESTAMP;
        queueItem['_owner'] = self.uuid;
        queueItem['_progress'] = 0;
        queueItem['_error_details'] = null;
        return queueItem;
      } else {
        return;
      }
    }, function(error, committed, snapshot) {
      if (error) {
        throw error;
      }
      if (committed &&
          snapshot.child('_state').val() === self.inProgressState) {
        console.log('Process ' + self.jobId + ':' + self.processId + ' (' +
          self.uuid + ') claimed ' + snapshot.name());
        // TODO: remove this ugly hack -------------------------------------------------------
        self.currentItemRef = new Firebase(snapshot.ref().toString(), new Firebase.Context());
        // -----------------------------------------------------------------------------------
        // self.currentItemRef = snapshot.ref();
        self.currentItemListener = self.currentItemRef
            .child('_owner').on('value', function(snapshot) {
          if (snapshot.val() !== self.uuid) {
            self.currentItemRef.child('_owner').off(
              'value',
              self.currentItemListener);
            self.currentItemRef = null;
          }
        });
        self.busy = true;
        self.processingFunction(
          snapshot.val(),
          self.updateProgress.bind(self),
          self.resolve.bind(self),
          self.reject.bind(self));
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
    self.processingItemsRef = self.ref.orderBy('_state')
      .equalTo(self.inProgressState);
    self.processingItemAddedListener = self.processingItemsRef.on('child_added',
      function(snapshot) {
        var queueItemName = snapshot.name();
        var now = new Date().getTime();
        var startTime = (snapshot.child('_state_changed').val() || now);
        var expires = Math.max(0, startTime - now + self.jobTimeout);
        // TODO: remove this ugly hack -------------------------------------------
        var ref = new Firebase(snapshot.ref().toString(), new Firebase.Context());
        // -----------------------------------------------------------------------
        // var ref = snapshot.ref();
        self.expiryTimeouts[queueItemName] = setTimeout(
          self.processTimeout.bind(self),
          expires,
          ref);
      }, function(error) {
        throw error;
      });
    self.processingItemRemovedListener = self.processingItemsRef.on(
      'child_removed',
      function(snapshot) {
        var queueItemName = snapshot.name();
        clearTimeout(self.expiryTimeouts[queueItemName]);
        delete self.expiryTimeouts[queueItemName];
      }, function(error) {
        throw error;
      });
  }
};

/**
 * Returns the state of an item that has timed out to the start state.
 * @param {Firebase} ref Reference to the Firebase location of the queue item
 *   that's timed out.
 */
QueueWorker.prototype.processTimeout = function(ref) {
  var self = this;

  ref.transaction(function(queueItem) {
    if (queueItem === null) {
      return queueItem;
    }
    var currentState = queueItem['_state'] || null;
    if (currentState === self.inProgressState) {
      queueItem['_state'] = self.startState;
      queueItem['_state_changed'] = Firebase.ServerValue.TIMESTAMP;
      queueItem['_owner'] = null;
      queueItem['_error_details'] = null;
      return queueItem;
    } else {
      return;
    }
  }, function(error, committed, snapshot) {
    if (error) {
      throw error;
    }
    if (committed && snapshot.child('_state').val() === self.startState) {
      console.log('Process ' + self.jobId + ':' + self.processId + ' (' +
          self.uuid + ') reported ' + snapshot.name() + ' timed out.');
    }
  }, false);
};

/**
 * Resolves the current job item and changes the state to the finished state.
 * @param {Object} newQueueItem The new data to be stored at the location. If
 *   not an Object, this defaults to the current data.
 */
QueueWorker.prototype.resolve = function(newQueueItem) {
  var self = this;
  if (self.currentItemRef !== null) {
    self.currentItemRef.transaction(function(queueItem) {
      if (queueItem === null) {
        return queueItem;
      }
      var currentState = queueItem['_state'] || null;
      if (currentState === self.inProgressState &&
          queueItem['_owner'] === self.uuid) {
        if (typeof(newQueueItem) !== 'object') {
          newQueueItem = queueItem;
        }
        newQueueItem['_state'] = self.finishedState;
        newQueueItem['_state_changed'] = Firebase.ServerValue.TIMESTAMP;
        newQueueItem['_owner'] = null;
        newQueueItem['_progress'] = 100;
        newQueueItem['_error_details'] = null;
        return newQueueItem;
      } else {
        return;
      }
    }, function(error, committed, snapshot) {
      if (error) {
        throw error;
      }
      if (committed && snapshot.child('_state').val() === self.finishedState) {
        console.log('Process ' + self.jobId + ':' + self.processId + ' (' +
            self.uuid + ') completed ' + snapshot.name() + '.');
      }
      self.busy = false;
      self.tryToProcess();
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
  if (self.currentItemRef !== null) {
    self.currentItemRef.transaction(function(queueItem) {
      if (queueItem === null) {
        return queueItem;
      }
      var currentState = queueItem['_state'] || null;
      if (currentState === self.inProgressState &&
          queueItem['_owner'] === self.uuid) {
        queueItem['_state'] = 'error';
        queueItem['_state_changed'] = Firebase.ServerValue.TIMESTAMP;
        queueItem['_owner'] = null;
        queueItem['_error_details'] = {
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
      if (committed && snapshot.child('_state').val() === 'error') {
        console.log('Process ' + self.jobId + ':' + self.processId + ' (' +
            self.uuid + ') errored while attempting to complete ' +
            snapshot.name() + '.');
      }
      self.busy = false;
      self.tryToProcess();
    }, false);
  }
};

/**
 * Updates the progress of the .
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
      var currentState = queueItem['_state'] || null;
      if (currentState === self.inProgressState &&
          queueItem['_owner'] === self.uuid) {
        queueItem['_progress'] = progress;
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
 * @return {String} The current UUID of the process.
 */
QueueWorker.prototype.getUUID = function() {
  return self.uuid;
};
