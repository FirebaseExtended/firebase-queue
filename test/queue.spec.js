var _ = require('lodash'),
    Helpers = require('./helpers.js'),
    chai = require('chai'),
    should = chai.should(),
    expect = chai.expect,
    winston = require('winston'),
    chaiAsPromised = require('chai-as-promised');

winston.level = 'none';

chai.use(chaiAsPromised);

var th = new Helpers();

describe('Queue', function() {
  it('should not create a Queue with only a queue reference', function() {
    return new th.Queue(th.testRef).should.eventually.be.rejectedWith('Queue must at least have the queueRef and processingFunction arguments.');
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonFirebaseObject) {
    it('should not create a Queue with a non-firebase object: ' + JSON.stringify(nonFirebaseObject), function() {
      return new th.Queue(nonFirebaseObject, _.noop).should.eventually.be.rejected;
    });
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }], function(nonFunctionObject) {
    it('should not create a Queue with a non-function callback: ' + JSON.stringify(nonFunctionObject), function() {
      return new th.Queue(th.testRef, nonFunctionObject).should.eventually.be.rejectedWith('No processing function provided.');
    });
  });

  it('should create a default Queue with just a Firebase reference and a processing callback', function() {
    return new th.Queue(th.testRef, _.noop).should.eventually.be.fulfilled;
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop], function(nonPlainObject) {
    it('should not create a Queue with a Firebase reference, a non-plain object options parameter (' + JSON.stringify(nonPlainObject) + '), and a processingCallback', function() {
      return new th.Queue(th.testRef, nonPlainObject, _.noop).should.eventually.be.rejectedWith('Options parameter must be a plain object.');
    });
  });

  it('should create a default Queue with a Firebase reference, an empty options object, and a processing callback', function() {
    return new th.Queue(th.testRef, {}, _.noop).should.eventually.be.fulfilled;
  });

  _.forEach([NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonStringObject) {
    it('should not create a Queue with a non-string specId specified', function() {
      return new th.Queue(th.testRef, { specId: nonStringObject }, _.noop).should.eventually.be.rejectedWith('options.specId must be a String.');
    });
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, -1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonPositiveIntigerObject) {
    it('should not create a Queue with a non-positive integer numWorkers specified', function() {
      return new th.Queue(th.testRef, { numWorkers: nonPositiveIntigerObject }, _.noop).should.eventually.be.rejectedWith('options.numWorkers must be a positive integer.');
    });
  });

  _.forEach([NaN, Infinity, '', 'foo', 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonBooleanObject) {
    it('should not create a Queue with a non-boolean sanitize option specified', function() {
      return new th.Queue(th.testRef, { sanitize: nonBooleanObject }, _.noop).should.eventually.be.rejectedWith('options.sanitize must be a boolean.');
    });
  });

  _.forEach(_.range(1, 20), function(numWorkers) {
    it('should create a Queue with ' + numWorkers + ' workers when specified in options.numWorkers', function() {
      return new th.Queue(th.testRef, { numWorkers: numWorkers }, _.noop).then(function(q) {
        expect(q.workers.length).to.equal(numWorkers);
      }).should.eventually.be.fulfilled;
    });
  });

  it('should create a Queue with a specific specId when specified', function() {
    var specId = 'test_task';
    return new th.Queue(th.testRef, { specId: specId }, _.noop).then(function(q) {
      expect(q.specId).to.equal(specId);
    }).should.eventually.be.fulfilled;
  });

  [true, false].forEach(function(bool) {
    it('should create a Queue with a ' + bool + ' sanitize option when specified', function() {
      return new th.Queue(th.testRef, { sanitize: bool }, _.noop).then(function(q) {
        expect(q.sanitize).to.equal(bool);
      }).should.eventually.be.fulfilled;
    });
  });

  it('should not create a Queue when initialized with 4 parameters', function() {
    return new th.Queue(th.testRef, {}, _.noop, null).should.eventually.be.rejectedWith('Queue can only take at most three arguments - queueRef, options (optional), and processingFunction.');
  });
});
