'use strict';

var Firebase = require('firebase'),
    logger = require('winston'),
    uuid = require('uuid'),
    RSVP = require('rsvp'),
    _ = require('lodash');

var MAX_TRANSACTION_ATTEMPTS = 10;

/**
 * @param {Firebase} queueRef the Firebase reference for the queue.
 * @param {String} processId the ID of the current worker process.
 * @param {Function} processingFunction the function to be called each time a
 *   job is claimed.
 * @return {Object}
 */
function QueueWorker(queueRef, processId, processingFunction) {
  var self = this,
      error;
  if (_.isUndefined(queueRef)) {
    error = 'No queue reference provided.';
    logger.error('QueueWorker(): ' + error);
    throw new Error(error);
  }
  if (!_.isString(processId)) {
    error = 'Invalid process ID provided.';
    logger.error('QueueWorker(): ' + error);
    throw new Error(error);
  }
  if (!_.isFunction(processingFunction)) {
    error = 'No processing function provided.';
    logger.error('QueueWorker(): ' + error);
    throw new Error(error);
  }

  self.processId = processId;
  self.uuid = uuid.v4();

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

  return self;
}

/**
 * Logs an info message with a worker-specific prefix.
 * @param {String} message The message to log.
 */
QueueWorker.prototype._getLogEntry = function(message) {
  return 'QueueWorker ' + this.processId + ' (' + this.uuid + ') ' + message;
};

/**
 * Returns the state of an item to the start state.
 * @param {Firebase} itemRef Reference to the Firebase location of the queue
 *   item that's timed out.
 * @returns {RSVP.Promise} Whether the job was able to be reset.
 */
QueueWorker.prototype._resetItem = function(itemRef, deferred) {
  var self = this,
      retries = 0;

  /* istanbul ignore else */
  if (_.isUndefined(deferred)) {
    deferred = RSVP.defer();
  }

  itemRef.transaction(function(queueItem) {
    /* istanbul ignore if */
    if (_.isNull(queueItem)) {
      return queueItem;
    }
    if (queueItem._state === self.inProgressState) {
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
    /* istanbul ignore if */
    if (error) {
      if (++retries < MAX_TRANSACTION_ATTEMPTS) {
        logger.warn(self._getLogEntry('reset item errored, retrying'), error);
        setImmediate(self._resetItem.bind(self), itemRef, deferred);
      } else {
        var errorMsg = 'reset item errored too many times, ' +
          'no longer retrying';
        logger.error(self._getLogEntry(errorMsg), error);
        deferred.reject(errorMsg);
      }
    } else {
      if (committed && snapshot.exists()) {
        logger.info(self._getLogEntry('reset ' + snapshot.key()));
      }
      deferred.resolve();
    }
  }, false);

  return deferred.promise;
};

/**
 * Resolves the current job item and changes the state to the finished state.
 * @param {Object} newQueueItem The new data to be stored at the location. If
 *   resolve is called without an object argument, the queue entry will be
 *   deleted.
 * @returns {RSVP.Promise} Whether the job was able to be resolved.
 */
QueueWorker.prototype._resolve = function(newQueueItem, deferred) {
  var self = this,
      retries = 0;

  /* istanbul ignore else */
  if (_.isUndefined(deferred)) {
    deferred = RSVP.defer();
  }

  if (_.isNull(self.currentItemRef)) {
    self.busy = false;
    deferred.resolve();
    self._tryToProcess(self.nextItemRef);
  } else {
    var existedBefore;
    self.currentItemRef.transaction(function(queueItem) {
      existedBefore = true;
      if (_.isNull(queueItem)) {
        existedBefore = false;
        return queueItem;
      }
      if (queueItem._state === self.inProgressState &&
          queueItem._owner === self.uuid) {
        if (_.isNull(self.finishedState)) {
          return null;
        }
        if (!_.isPlainObject(newQueueItem)) {
          newQueueItem = {};
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
      /* istanbul ignore if */
      if (error) {
        if (++retries < MAX_TRANSACTION_ATTEMPTS) {
          logger.warn(self._getLogEntry('resolve item errored, retrying'), error);
          setImmediate(self._resolve.bind(self), newQueueItem, deferred);
        } else {
          var errorMsg = 'resolve item errored too many ' +
            'times, no longer retrying';
          logger.error(self._getLogEntry(errorMsg), error);
          deferred.reject(errorMsg);
        }
      } else {
        if (committed && existedBefore) {
          logger.info(self._getLogEntry('completed ' + snapshot.key()));
        }
        self.busy = false;
        deferred.resolve();
        self._tryToProcess(self.nextItemRef);
      }
    }, false);
  }

  return deferred.promise;
};

/**
 * Rejects the current job item and changes the state to 'error', adding
 * additional data to the '_error_details' sub key.
 * @param {Object} error The error message or object to be logged.
 * @returns {RSVP.Promise} Whether the job was able to be rejected.
 */
QueueWorker.prototype._reject = function(error, deferred) {
  var self = this,
      retries = 0,
      errorString = null;
  /* istanbul ignore else */
  if (_.isUndefined(deferred)) {
    deferred = RSVP.defer();
  }
  if (_.isNull(self.currentItemRef)) {
    self.busy = false;
    deferred.resolve();
    self._tryToProcess(self.nextItemRef);
  } else {
    if (_.isString(error)) {
      errorString = error;
    }
    var existedBefore;
    self.currentItemRef.transaction(function(queueItem) {
      existedBefore = true;
      if (_.isNull(queueItem)) {
        existedBefore = false;
        return queueItem;
      }
      if (queueItem._state === self.inProgressState &&
          queueItem._owner === self.uuid) {
        queueItem._state = 'error';
        queueItem._state_changed = Firebase.ServerValue.TIMESTAMP;
        queueItem._owner = null;
        queueItem._error_details = {
          previousState: self.inProgressState,
          error: errorString
        };
        return queueItem;
      } else {
        return;
      }
    }, function(error, committed, snapshot) {
      /* istanbul ignore if */
      if (error) {
        if (++retries < MAX_TRANSACTION_ATTEMPTS) {
          logger.warn(self._getLogEntry('reject item errored, retrying'), error);
          setImmediate(self._reject.bind(self), error, deferred);
        } else {
          var errorMsg = 'reject item errored too many ' +
            'times, no longer retrying';
          logger.error(self._getLogEntry(errorMsg), error);
          deferred.reject(errorMsg);
        }
      } else {
        if (committed && existedBefore) {
          logger.error(self._getLogEntry('errored while attempting to complete ' +
            snapshot.key()));
        }
        self.busy = false;
        deferred.resolve();
        self._tryToProcess(self.nextItemRef);
      }
    }, false);
  }
  return deferred.promise;
};

/**
 * Updates the progress state of the item.
 * @param {Number} progress The progress to report.
 * @returns {RSVP.Promise} Whether the progress was updated.
 */
QueueWorker.prototype._updateProgress = function(progress) {
  var self = this;
  return new RSVP.Promise(function(resolve, reject) {
    if (_.isNumber(progress) && progress >= 0 && progress <= 100) {
      if (!_.isNull(self.currentItemRef)) {
        self.currentItemRef.transaction(function(queueItem) {
          /* istanbul ignore if */
          if (_.isNull(queueItem)) {
            return queueItem;
          }
          if (queueItem._state === self.inProgressState &&
              queueItem._owner === self.uuid) {
            queueItem._progress = progress;
            return queueItem;
          } else {
            return;
          }
        }, function(error, committed, snapshot) {
          /* istanbul ignore if */
          if (error) {
            return reject(error);
          }
          if (committed && snapshot.exists()) {
            resolve();
          } else {
            reject('Current item no longer owned by this process');
          }
        }, false);
      } else {
        reject('No item currently being processed');
      }
    } else {
      reject('Invalid progress');
    }
  });
};

/**
 * Attempts to claim the next item in the queue.
 * @param {Firebase} nextItemRef Reference to the Firebase location of the next
 *   queue item.
 */
QueueWorker.prototype._tryToProcess = function(nextItemRef, deferred) {
  var self = this,
      retries = 0,
      malformed = false;

  /* istanbul ignore else */
  if (_.isUndefined(deferred)) {
    deferred = RSVP.defer();
  }

  if (!self.busy) {
    nextItemRef.transaction(function(queueItem) {
      /* istanbul ignore if */
      if (_.isNull(queueItem)) {
        return queueItem;
      }
      if (!_.isPlainObject(queueItem)) {
        malformed = true;
        return {
          _queue_item: queueItem,
          _state: 'error',
          _state_changed: Firebase.ServerValue.TIMESTAMP,
          _error_details: {
            error: 'Queue item was malformed'
          }
        };
      }
      if (queueItem._state === self.startState) {
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
      /* istanbul ignore if */
      if (error) {
        if (++retries < MAX_TRANSACTION_ATTEMPTS) {
          logger.warn(self._getLogEntry('errored while attempting to claim a ' +
            'new item, retrying'), error);
          return setImmediate(self._tryToProcess.bind(self), nextItemRef, deferred);
        } else {
          var errorMsg = 'errored while attempting to claim ' +
            'a new item too many times, no longer retrying';
          logger.error(self._getLogEntry(errorMsg), error);
          return deferred.reject(errorMsg);
        }
      } else if (committed && snapshot.exists()) {
        if (malformed) {
          logger.warn(self._getLogEntry('found malformed entry ' +
            snapshot.key()));
        } else {
          /* istanbul ignore if */
          if (self.busy) {
            // Worker has become busy while the transaction was processing - so
            // give up the job for now so another worker can claim it
            self._resetItem(nextItemRef);
          } else {
            self.busy = true;
            logger.info(self._getLogEntry('claimed ' + snapshot.key()));
            self.currentItemRef = snapshot.ref();
            self.currentItemListener = self.currentItemRef
                .child('_owner').on('value', function(snapshot) {
              /* istanbul ignore else */
              if (snapshot.val() !== self.uuid &&
                  !_.isNull(self.currentItemRef) &&
                  !_.isNull(self.currentItemListener)) {
                self.currentItemRef.child('_owner').off(
                  'value',
                  self.currentItemListener);
                self.currentItemRef = null;
                self.currentItemListener = null;
              }
            });
            setImmediate(
              self.processingFunction,
              snapshot.val(),
              self._updateProgress.bind(self),
              self._resolve.bind(self),
              self._reject.bind(self)
            );
          }
        }
      }
      deferred.resolve();
    }, false);
  } else {
    deferred.resolve();
  }

  return deferred.promise;
};

/**
 * Sets up timeouts to reclaim jobs that fail due to taking too long.
 */
QueueWorker.prototype._setUpTimeouts = function() {
  var self = this;

  if (!_.isNull(self.processingItemAddedListener)) {
    self.processingItemsRef.off(
      'child_added',
      self.processingItemAddedListener);
    self.processingItemAddedListener = null;
  }
  if (!_.isNull(self.processingItemRemovedListener)) {
    self.processingItemsRef.off(
      'child_removed',
      self.processingItemRemovedListener);
    self.processingItemRemovedListener = null;
  }

  _.forEach(self.expiryTimeouts, function(expiryTimeout) {
    clearTimeout(expiryTimeout);
  });
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
          self._resetItem.bind(self),
          expires,
          ref);
      }, /* istanbul ignore next */ function(error) {
        logger.warn(self._getLogEntry('errored listening to Firebase'), error);
      });
    self.processingItemRemovedListener = self.processingItemsRef.on(
      'child_removed',
      function(snapshot) {
        var queueItemName = snapshot.key();
        clearTimeout(self.expiryTimeouts[queueItemName]);
        delete self.expiryTimeouts[queueItemName];
      }, /* istanbul ignore next */ function(error) {
        logger.warn(self._getLogEntry('errored listening to Firebase'), error);
      });
  } else {
    self.processingItemsRef = null;
  }
};

/**
 * Validates a job spec contains meaningful parameters.
 */
QueueWorker.prototype._isValidJobSpec = function(jobSpec) {
  if (!_.isPlainObject(jobSpec)) {
    return false;
  }
  if (!_.isString(jobSpec.inProgressState)) {
    return false;
  }
  if (!_.isUndefined(jobSpec.finishedState) &&
      !_.isNull(jobSpec.finishedState) &&
      (
        !_.isString(jobSpec.finishedState) ||
        jobSpec.finishedState === jobSpec.inProgressState
      )) {
    return false;
  }
  if (!_.isUndefined(jobSpec.startState) &&
      !_.isNull(jobSpec.startState) &&
      (
        !_.isString(jobSpec.startState) ||
        jobSpec.startState === jobSpec.inProgressState ||
        jobSpec.startState === jobSpec.finishedState
      )) {
    return false;
  }
  if (!_.isUndefined(jobSpec.jobTimeout) &&
      !_.isNull(jobSpec.jobTimeout) &&
      (
        !_.isNumber(jobSpec.jobTimeout) ||
        jobSpec.jobTimeout <= 0 ||
        jobSpec.jobTimeout % 1 !== 0
      )) {
    return false;
  }
  return true;
};

/**
 * Sets up the listeners to claim jobs and reset them if they timeout. Called
 *   any time the job spec changes.
 * @param {Object} jobSpec The specification for the job.
 */
QueueWorker.prototype.setJob = function(jobSpec) {
  var self = this;

  // Reset the UUID so that jobs completing from before the change don't
  // continue to use incorrect data
  self.uuid = uuid.v4();

  if (!_.isNull(self.newItemListener)) {
    self.newItemRef.off('child_added', self.newItemListener);
  }

  if (!_.isNull(self.currentItemListener)) {
    self.currentItemRef.child('_owner').off(
      'value',
      self.currentItemListener);
    self.currentItemRef = null;
    self.currentItemListener = null;
  }

  if (self._isValidJobSpec(jobSpec)) {
    self.startState = jobSpec.startState || null;
    self.inProgressState = jobSpec.inProgressState;
    self.finishedState = jobSpec.finishedState || null;
    self.jobTimeout = jobSpec.jobTimeout || null;

    self.newItemRef = self.queueRef
                          .orderByChild('_state')
                          .equalTo(self.startState)
                          .limitToFirst(1);
    logger.info(self._getLogEntry('listening'));
    self.newItemListener = self.newItemRef.on('child_added', function(snapshot) {
      self.nextItemRef = snapshot.ref();
      self._tryToProcess(self.nextItemRef);
    }, /* istanbul ignore next */ function(error) {
      logger.warn(self._getLogEntry('errored listening to Firebase'), error);
    });
  } else {
    logger.error(self._getLogEntry('invalid job spec, no longer listening'));
    self.startState = null;
    self.inProgressState = null;
    self.finishedState = null;
    self.jobTimeout = null;

    self.newItemRef = null;
    self.newItemListener = null;
  }

  self._setUpTimeouts();
};

module.exports = QueueWorker;
