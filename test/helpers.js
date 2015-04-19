var _ = require('lodash'),
    Firebase = require('firebase');

module.exports = function() {

  this.testRef = new Firebase('https://firebase-queue-test-' + _.random(1, 2 << 29) + '.firebaseio-demo.com');
  this.Queue = require('../queue.js');

  return this;
}
