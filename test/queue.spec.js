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
    expect(function() {
      new th.Queue(th.testRef);
    }).to.throw('Queue must at least have the queueRef and processingFunction arguments.');
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonFirebaseObject) {
    it('should not create a Queue with a non-firebase object: ' + JSON.stringify(nonFirebaseObject), function() {
      expect(function() {
        new th.Queue(nonFirebaseObject, _.noop);
      }).to.throw;
    });
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }], function(nonFunctionObject) {
    it('should not create a Queue with a non-function callback: ' + JSON.stringify(nonFunctionObject), function() {
      expect(function() {
        new th.Queue(th.testRef, nonFunctionObject);
      }).to.throw('No processing function provided.');
    });
  });

  it('should create a default Queue with just a Firebase reference and a processing callback', function() {
    new th.Queue(th.testRef, _.noop);
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop], function(nonPlainObject) {
    it('should not create a Queue with a Firebase reference, a non-plain object options parameter (' + JSON.stringify(nonPlainObject) + '), and a processingCallback', function() {
      expect(function() {
        new th.Queue(th.testRef, nonPlainObject, _.noop);
      }).to.throw('Options parameter must be a plain object.');
    });
  });

  it('should create a default Queue with a Firebase reference, an empty options object, and a processing callback', function() {
    new th.Queue(th.testRef, {}, _.noop);
  });

  _.forEach([NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonStringObject) {
    it('should not create a Queue with a non-string specId specified', function() {
      expect(function() {
        new th.Queue(th.testRef, { specId: nonStringObject }, _.noop);
      }).to.throw('options.specId must be a String.');
    });
  });

  _.forEach(['', 'foo', NaN, Infinity, true, false, 0, -1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonPositiveIntigerObject) {
    it('should not create a Queue with a non-positive integer numWorkers specified', function() {
      expect(function() {
        new th.Queue(th.testRef, { numWorkers: nonPositiveIntigerObject }, _.noop);
      }).to.throw('options.numWorkers must be a positive integer.');
    });
  });

  _.forEach([NaN, Infinity, '', 'foo', 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop], function(nonBooleanObject) {
    it('should not create a Queue with a non-boolean sanitize option specified', function() {
      expect(function() {
        new th.Queue(th.testRef, { sanitize: nonBooleanObject }, _.noop);
      }).to.throw('options.sanitize must be a boolean.');
    });
  });

  _.forEach(_.range(1, 20), function(numWorkers) {
    it('should create a Queue with ' + numWorkers + ' workers when specified in options.numWorkers', function() {
      var q = new th.Queue(th.testRef, { numWorkers: numWorkers }, _.noop);
      expect(q.workers.length).to.equal(numWorkers);
    });
  });

  it('should create a Queue with a specific specId when specified', function(done) {
    var specId = 'test_task';
    var q = new th.Queue(th.testRef, { specId: specId }, _.noop);
    expect(q.specId).to.equal(specId);
    var interval = setInterval(function() {
      if (q.initialized) {
        clearInterval(interval);
        try {
          var specRegex = new RegExp('^' + specId + ':0:[a-f0-9\\-]{36}$');
          expect(q.workers[0].processId).to.match(specRegex);
          done();
        } catch(error) {
          done(error);
        }
      }
    }, 100);
  });

  [true, false].forEach(function(bool) {
    it('should create a Queue with a ' + bool + ' sanitize option when specified', function() {
      var q = new th.Queue(th.testRef, { sanitize: bool }, _.noop)
      expect(q.sanitize).to.equal(bool);
    });
  });

  it('should not create a Queue when initialized with 4 parameters', function() {
    expect(function() {
      new th.Queue(th.testRef, {}, _.noop, null);
    }).to.throw('Queue can only take at most three arguments - queueRef, options (optional), and processingFunction.');
  });
});
