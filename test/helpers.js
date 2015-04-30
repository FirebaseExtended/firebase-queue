var _ = require('lodash'),
    util = require('util'),
    Firebase = require('firebase');

module.exports = function() {
  var self = this;

  this.testRef = new Firebase('https://firebase-queue-test-' + _.random(1, 2 << 29) + '.firebaseio-demo.com');
  this.Queue = require('../queue.js');
  this.QueueWorker = require('../lib/queue_worker.js');

  this.RestrictedQueueWorker = function() {
    self.QueueWorker.apply(this, arguments);
  };
  util.inherits(this.RestrictedQueueWorker, this.QueueWorker);
  this.RestrictedQueueWorker.prototype._tryToProcess = _.noop;
  this.RestrictedQueueWorker.prototype._setUpTimeouts = _.noop;

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
    jobTimeout: 10
  };
  this.validJobSpecWithStartStateAndTimeout = {
    inProgressState: 'in_progress',
    startState: 'start_state',
    jobTimeout: 10
  };
  this.validJobSpecWithStartStateAndFinishedState = {
    inProgressState: 'in_progress',
    startState: 'start_state',
    finishedState: 'finished_state'
  };
  this.validJobSpecWithFinishedStateAndTimeout = {
    inProgressState: 'in_progress',
    finishedState: 'finished_state',
    jobTimeout: 10
  };
  this.validJobSpecWithEverything = {
    inProgressState: 'in_progress',
    startState: 'start_state',
    finishedState: 'finished_state',
    jobTimeout: 10
  };

  return this;
}
