'use strict';

var Firebase = require('firebase'),
    logger = require('winston'),
    uuid = require('node-uuid'),
    RSVP = require('rsvp'),
    _ = require('lodash');

var MAX_TRANSACTION_ATTEMPTS = 10,
    DEFAULT_ERROR_STATE = 'error';

/**
 * @param {Firebase} tasksRef the Firebase reference for queue tasks.
 * @param {String} processId the ID of the current worker process.
 * @param {Function} processingFunction the function to be called each time a
 *   task is claimed.
 * @return {Object}
 */
function QueueWorker(tasksRef, processId, sanitize, processingFunction) {
  var self = this,
      error;
  if (_.isUndefined(tasksRef)) {
    error = 'No tasks reference provided.';
    logger.error('QueueWorker(): ' + error);
    throw new Error(error);
  }
  if (!_.isString(processId)) {
    error = 'Invalid process ID provided.';
    logger.error('QueueWorker(): ' + error);
    throw new Error(error);
  }
  if (!_.isBoolean(sanitize)) {
    error = 'Invalid sanitize option.';
    logger.error('QueueWorker(): ' + error);
    throw new Error(error);
  }
  if (!_.isFunction(processingFunction)) {
    error = 'No processing function provided.';
    logger.error('QueueWorker(): ' + error);
    throw new Error(error);
  }

  self.processId = processId + ':' + uuid.v4();

  self.processingFunction = processingFunction;
  self.expiryTimeouts = {};
  self.owners = {};

  self.tasksRef = tasksRef;
  self.processingTasksRef = null;
  self.currentTaskRef = null;
  self.newTaskRef = null;

  self.currentTaskListener = null;
  self.newTaskListener = null;
  self.processingTaskAddedListener = null;
  self.processingTaskRemovedListener = null;

  self.busy = false;
  self.taskNumber = 0;
  self.errorState = DEFAULT_ERROR_STATE;
  self.sanitize = sanitize;

  return self;
}

/**
 * Logs an info message with a worker-specific prefix.
 * @param {String} message The message to log.
 */
QueueWorker.prototype._getLogEntry = function(message) {
  return 'QueueWorker ' + this.processId + ' ' + message;
};

/**
 * Returns the state of an item to the start state.
 * @param {Firebase} itemRef Reference to the Firebase location of the queue
 *   item that's timed out.
 * @returns {RSVP.Promise} Whether the task was able to be reset.
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
        var errorMsg = 'reset item errored too many times, no longer retrying';
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
 * Resolves the current task item and changes the state to the finished state.
 * @param {Object} newQueueItem The new data to be stored at the location. If
 *   resolve is called without an object argument, the queue entry will be
 *   deleted.
 * @returns {RSVP.Promise} Whether the task was able to be resolved.
 */
QueueWorker.prototype._resolve = function(taskNumber) {
  var self = this,
      retries = 0,
      deferred = RSVP.defer();

  var resolve = function(newQueueItem) {

    if ((taskNumber !== self.taskNumber) || _.isNull(self.currentTaskRef)) {
      if (_.isNull(self.currentTaskRef)) {
        logger.warn(self._getLogEntry('Can\'t resolve item - no item ' +
          'currently being processed'));
      } else {
        logger.warn(self._getLogEntry('Can\'t resolve item - no longer ' +
          'processing current item'));
      }
      deferred.resolve();
      self.busy = false;
      self._tryToProcess(self.nextItemRef);
    } else {
      var existedBefore;
      self.currentTaskRef.transaction(function(queueItem) {
        existedBefore = true;
        if (_.isNull(queueItem)) {
          existedBefore = false;
          return queueItem;
        }
        if (queueItem._state === self.inProgressState &&
            queueItem._owner === self.processId + ':' + self.taskNumber) {
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
            logger.warn(self._getLogEntry('resolve item errored, retrying'),
              error);
            setImmediate(resolve, newQueueItem);
          } else {
            var errorMsg = 'resolve item errored too many times, no longer ' +
              'retrying';
            logger.error(self._getLogEntry(errorMsg), error);
            deferred.reject(errorMsg);
          }
        } else {
          if (committed && existedBefore) {
            logger.info(self._getLogEntry('completed ' + snapshot.key()));
          } else {
            logger.warn(self._getLogEntry('Can\'t resolve item - current item' +
                ' no longer owned by this process'));
          }
          deferred.resolve();
          self.busy = false;
          self._tryToProcess(self.nextItemRef);
        }
      }, false);
    }

    return deferred.promise;
  };

  return resolve;
};

/**
 * Rejects the current task item and changes the state to self.errorState, adding
 * additional data to the '_error_details' sub key.
 * @param {Object} error The error message or object to be logged.
 * @returns {RSVP.Promise} Whether the task was able to be rejected.
 */
QueueWorker.prototype._reject = function(taskNumber) {
  var self = this,
      retries = 0,
      errorString = null,
      deferred = RSVP.defer();

  var reject = function(error) {

    if ((taskNumber !== self.taskNumber) || _.isNull(self.currentTaskRef)) {
      if (_.isNull(self.currentTaskRef)) {
        logger.warn(self._getLogEntry('Can\'t reject item - no item currently' +
          ' being processed'));
      } else {
        logger.warn(self._getLogEntry('Can\'t reject item - no longer ' +
          'processing current item'));
      }
      deferred.resolve();
      self.busy = false;
      self._tryToProcess(self.nextItemRef);
    } else {
      if (_.isString(error)) {
        errorString = error;
      }
      var existedBefore;
      self.currentTaskRef.transaction(function(queueItem) {
        existedBefore = true;
        if (_.isNull(queueItem)) {
          existedBefore = false;
          return queueItem;
        }
        if (queueItem._state === self.inProgressState &&
            queueItem._owner === self.processId + ':' + self.taskNumber) {
          queueItem._state = self.errorState;
          queueItem._state_changed = Firebase.ServerValue.TIMESTAMP;
          queueItem._owner = null;
          queueItem._error_details = {
            previous_state: self.inProgressState,
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
            logger.warn(self._getLogEntry('reject item errored, retrying'),
              error);
            setImmediate(reject, error);
          } else {
            var errorMsg = 'reject item errored too many times, no longer ' +
              'retrying';
            logger.error(self._getLogEntry(errorMsg), error);
            deferred.reject(errorMsg);
          }
        } else {
          if (committed && existedBefore) {
            logger.error(self._getLogEntry('errored while attempting to ' +
              'complete ' + snapshot.key()));
          } else {
            logger.warn(self._getLogEntry('Can\'t reject item - current item ' +
              'no longer owned by this process'));
          }
          deferred.resolve();
          self.busy = false;
          self._tryToProcess(self.nextItemRef);
        }
      }, false);
    }
    return deferred.promise;
  };

  return reject;
};

/**
 * Updates the progress state of the item.
 * @param {Number} progress The progress to report.
 * @returns {RSVP.Promise} Whether the progress was updated.
 */
QueueWorker.prototype._updateProgress = function(taskNumber) {
  var self = this,
      errorMsg;

  var updateProgress = function(progress) {
    if (!_.isNumber(progress) ||
        _.isNaN(progress) ||
        progress < 0 ||
        progress > 100) {
      return RSVP.reject('Invalid progress');
    }
    if ((taskNumber !== self.taskNumber)  || _.isNull(self.currentTaskRef)) {
      errorMsg = 'Can\'t update progress - no item currently being processed';
      logger.warn(self._getLogEntry(errorMsg));
      return RSVP.reject(errorMsg);
    }
    return new RSVP.Promise(function(resolve, reject) {
      self.currentTaskRef.transaction(function(queueItem) {
        /* istanbul ignore if */
        if (_.isNull(queueItem)) {
          return queueItem;
        }
        if (queueItem._state === self.inProgressState &&
            queueItem._owner === self.processId + ':' + self.taskNumber) {
          queueItem._progress = progress;
          return queueItem;
        } else {
          return;
        }
      }, function(error, committed, snapshot) {
        /* istanbul ignore if */
        if (error) {
          errorMsg = 'errored while attempting to update progress';
          logger.error(self._getLogEntry(errorMsg), error);
          return reject(errorMsg);
        }
        if (committed && snapshot.exists()) {
          resolve();
        } else {
          errorMsg = 'Can\'t update progress - current item no longer owned ' +
            'by this process';
          logger.warn(self._getLogEntry(errorMsg));
          return reject(errorMsg);
        }
      }, false);
    });
  };

  return updateProgress;
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
          _state: self.errorState,
          _state_changed: Firebase.ServerValue.TIMESTAMP,
          _error_details: {
            error: 'Queue item was malformed'
          }
        };
      }
      if (_.isUndefined(queueItem._state)) {
        queueItem._state = null;
      }
      if (queueItem._state === self.startState) {
        queueItem._state = self.inProgressState;
        queueItem._state_changed = Firebase.ServerValue.TIMESTAMP;
        queueItem._owner = self.processId + ':' + (self.taskNumber + 1);
        queueItem._progress = 0;
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
          return setImmediate(self._tryToProcess.bind(self), nextItemRef,
            deferred);
        } else {
          var errorMsg = 'errored while attempting to claim a new item too ' +
            'many times, no longer retrying';
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
            // give up the task for now so another worker can claim it
            self._resetItem(nextItemRef);
          } else {
            self.busy = true;
            self.taskNumber += 1;
            logger.info(self._getLogEntry('claimed ' + snapshot.key()));
            self.currentTaskRef = snapshot.ref();
            self.currentTaskListener = self.currentTaskRef
                .child('_owner').on('value', function(snapshot) {
              /* istanbul ignore else */
              if (snapshot.val() !== self.processId + ':' + self.taskNumber &&
                  !_.isNull(self.currentTaskRef) &&
                  !_.isNull(self.currentTaskListener)) {
                self.currentTaskRef.child('_owner').off(
                  'value',
                  self.currentTaskListener);
                self.currentTaskRef = null;
                self.currentTaskListener = null;
              }
            });
            var data = snapshot.val();
            if (self.sanitize) {
              [
                '_state',
                '_state_changed',
                '_owner',
                '_progress',
                '_error_details'
              ].forEach(function(reserved) {
                if (snapshot.hasChild(reserved)) {
                  delete data[reserved];
                }
              });
            }
            setImmediate(
              self.processingFunction,
              data,
              self._updateProgress(self.taskNumber),
              self._resolve(self.taskNumber),
              self._reject(self.taskNumber)
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
 * Sets up timeouts to reclaim tasks that fail due to taking too long.
 */
QueueWorker.prototype._setUpTimeouts = function() {
  var self = this;

  if (!_.isNull(self.processingTaskAddedListener)) {
    self.processingTasksRef.off(
      'child_added',
      self.processingTaskAddedListener);
    self.processingTaskAddedListener = null;
  }
  if (!_.isNull(self.processingTaskRemovedListener)) {
    self.processingTasksRef.off(
      'child_removed',
      self.processingTaskRemovedListener);
    self.processingTaskRemovedListener = null;
  }

  _.forEach(self.expiryTimeouts, function(expiryTimeout) {
    clearTimeout(expiryTimeout);
  });
  self.expiryTimeouts = {};
  self.owners = {};

  if (self.taskTimeout) {
    self.processingTasksRef = self.tasksRef.orderByChild('_state')
      .equalTo(self.inProgressState);

    var setUpTimeout = function(snapshot) {
      var queueItemName = snapshot.key();
      var now = new Date().getTime();
      var startTime = (snapshot.child('_state_changed').val() || now);
      var expires = Math.max(0, startTime - now + self.taskTimeout);
      var ref = snapshot.ref();
      self.owners[queueItemName] = snapshot.child('_owner').val();
      self.expiryTimeouts[queueItemName] = setTimeout(
        self._resetItem.bind(self),
        expires,
        ref);
    };

    self.processingTaskAddedListener = self.processingTasksRef.on('child_added',
      setUpTimeout,
      /* istanbul ignore next */ function(error) {
        logger.warn(self._getLogEntry('errored listening to Firebase'), error);
      });
    self.processingTaskRemovedListener = self.processingTasksRef.on(
      'child_removed',
      function(snapshot) {
        var queueItemName = snapshot.key();
        clearTimeout(self.expiryTimeouts[queueItemName]);
        delete self.expiryTimeouts[queueItemName];
        delete self.owners[queueItemName];
      }, /* istanbul ignore next */ function(error) {
        logger.warn(self._getLogEntry('errored listening to Firebase'), error);
      });
    self.processingTasksRef.on('child_changed', function(snapshot) {
      // This catches de-duped events from the server - if the item was removed
      // and added in quick succession, the server may squash them into a
      // single update
      var queueItemName = snapshot.key();
      if (snapshot.child('_owner').val() !== self.owners[queueItemName]) {
        setUpTimeout(snapshot);
      }
    }, /* istanbul ignore next */ function(error) {
      logger.warn(self._getLogEntry('errored listening to Firebase'), error);
    });
  } else {
    self.processingTasksRef = null;
  }
};

/**
 * Validates a task spec contains meaningful parameters.
 * @param {Object} taskSpec The specification for the task.
 * @returns {Boolean} Whether the taskSpec is valid.
 */
QueueWorker.prototype._isValidTaskSpec = function(taskSpec) {
  if (!_.isPlainObject(taskSpec)) {
    return false;
  }
  if (!_.isString(taskSpec.inProgressState)) {
    return false;
  }
  if (!_.isUndefined(taskSpec.startState) &&
      !_.isNull(taskSpec.startState) &&
      (
        !_.isString(taskSpec.startState) ||
        taskSpec.startState === taskSpec.inProgressState
      )) {
    return false;
  }
  if (!_.isUndefined(taskSpec.finishedState) &&
      !_.isNull(taskSpec.finishedState) &&
      (
        !_.isString(taskSpec.finishedState) ||
        taskSpec.finishedState === taskSpec.inProgressState ||
        taskSpec.finishedState === taskSpec.startState
      )) {
    return false;
  }
  if (!_.isUndefined(taskSpec.errorState) &&
      !_.isNull(taskSpec.errorState) &&
      (
        !_.isString(taskSpec.errorState) ||
        taskSpec.errorState === taskSpec.inProgressState
      )) {
    return false;
  }
  if (!_.isUndefined(taskSpec.timeout) &&
      !_.isNull(taskSpec.timeout) &&
      (
        !_.isNumber(taskSpec.timeout) ||
        taskSpec.timeout <= 0 ||
        taskSpec.timeout % 1 !== 0
      )) {
    return false;
  }
  return true;
};

/**
 * Sets up the listeners to claim tasks and reset them if they timeout. Called
 *   any time the task spec changes.
 * @param {Object} taskSpec The specification for the task.
 */
QueueWorker.prototype.setTaskSpec = function(taskSpec) {
  var self = this;

  // Increment the taskNumber so that a task being processed before the change
  // doesn't continue to use incorrect data
  self.taskNumber += 1;

  if (!_.isNull(self.newTaskListener)) {
    self.newTaskRef.off('child_added', self.newTaskListener);
  }

  if (!_.isNull(self.currentTaskListener)) {
    self.currentTaskRef.child('_owner').off(
      'value',
      self.currentTaskListener);
    self._resetItem(self.currentTaskRef);
    self.currentTaskRef = null;
    self.currentTaskListener = null;
  }

  if (self._isValidTaskSpec(taskSpec)) {
    self.startState = taskSpec.startState || null;
    self.inProgressState = taskSpec.inProgressState;
    self.finishedState = taskSpec.finishedState || null;
    self.errorState = taskSpec.errorState || DEFAULT_ERROR_STATE;
    self.taskTimeout = taskSpec.timeout || null;

    self.newTaskRef = self.tasksRef
                          .orderByChild('_state')
                          .equalTo(self.startState)
                          .limitToFirst(1);
    logger.info(self._getLogEntry('listening'));
    self.newTaskListener = self.newTaskRef.on(
      'child_added',
      function(snapshot) {
        self.nextItemRef = snapshot.ref();
        self._tryToProcess(self.nextItemRef);
      }, /* istanbul ignore next */ function(error) {
        logger.warn(self._getLogEntry('errored listening to Firebase'), error);
      });
  } else {
    logger.error(self._getLogEntry('invalid task spec, not listening for new ' +
      'items'));
    self.startState = null;
    self.inProgressState = null;
    self.finishedState = null;
    self.errorState = DEFAULT_ERROR_STATE;
    self.taskTimeout = null;

    self.newTaskRef = null;
    self.newTaskListener = null;
  }

  self._setUpTimeouts();
};

module.exports = QueueWorker;
