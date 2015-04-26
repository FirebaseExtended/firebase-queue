var _ = require('lodash'),
    Firebase = require('firebase');

module.exports = function() {

  this.testRef = new Firebase('https://firebase-queue-test-' + _.random(1, 2 << 29) + '.firebaseio-demo.com');
  this.Queue = require('../queue.js');
  this.QueueWorker = require('../lib/queue_worker.js');
  this.validBasicJobSpec = {
    inProgressState: 'in_progress',
    finishedState: 'finished_state'
  };
  this.validJobSpecWithStartState = _.assign({
    startState: 'start_state'
  }, this.validBasicJobSpec);
  this.validJobSpecWithTimeout = _.assign({
    jobTimeout: 10
  }, this.validBasicJobSpec);
  this.validJobSpecWithStartStateAndTimeout = _.assign({
    startState: 'start_state',
    jobTimeout: 10
  }, this.validBasicJobSpec);

  return this;
}
