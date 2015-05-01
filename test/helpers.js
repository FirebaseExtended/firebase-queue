var _ = require('lodash'),
    util = require('util'),
    Firebase = require('firebase');

module.exports = function() {
  var self = this;

  this.testRef = new Firebase('https://firebase-queue-test-' + _.random(1, 2 << 29) + '.firebaseio-demo.com');
  this.offset = 0;
  self.testRef.child('.info/serverTimeOffset').on('value', function(snapshot) {
    self.offset = snapshot.val();
  });
  this.Queue = require('../queue.js');
  this.QueueWorker = require('../lib/queue_worker.js');

  this.QueueWorkerWithoutProcessingOrTimeouts = function() {
    self.QueueWorker.apply(this, arguments);
  };
  util.inherits(this.QueueWorkerWithoutProcessingOrTimeouts, this.QueueWorker);
  this.QueueWorkerWithoutProcessingOrTimeouts.prototype._tryToProcess = _.noop;
  this.QueueWorkerWithoutProcessingOrTimeouts.prototype._setUpTimeouts = _.noop;

  this.QueueWorkerWithoutProcessing = function() {
    self.QueueWorker.apply(this, arguments);
  };
  util.inherits(this.QueueWorkerWithoutProcessing, this.QueueWorker);
  this.QueueWorkerWithoutProcessing.prototype._tryToProcess = _.noop;

  this.validBasicJobSpec = {
    inProgressState: 'in_progress'
  };
  this.validJobSpecWithStartState = {
    inProgressState: 'in_progress',
    startState: 'start_state'
  };
  this.validJobSpecWithFinishedState = {
    inProgressState: 'in_progress',
    finishedState: 'finished_state'
  };
  this.validJobSpecWithTimeout = {
    inProgressState: 'in_progress',
    timeout: 10
  };
  this.validJobSpecWithStartStateAndTimeout = {
    inProgressState: 'in_progress',
    startState: 'start_state',
    timeout: 10
  };
  this.validJobSpecWithStartStateAndFinishedState = {
    inProgressState: 'in_progress',
    startState: 'start_state',
    finishedState: 'finished_state'
  };
  this.validJobSpecWithFinishedStateAndTimeout = {
    inProgressState: 'in_progress',
    finishedState: 'finished_state',
    timeout: 10
  };
  this.validJobSpecWithEverything = {
    inProgressState: 'in_progress',
    startState: 'start_state',
    finishedState: 'finished_state',
    timeout: 10
  };

  return this;
}
