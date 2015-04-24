var _ = require('lodash'),
    Helpers = require('../helpers.js'),
    chai = require('chai'),
    should = chai.should(),
    expect = chai.expect,
    winston = require('winston'),
    chaiAsPromised = require('chai-as-promised');

winston.level = 'none';

chai.use(chaiAsPromised);

var th = new Helpers(),
    queueRef = th.testRef.child('queue');

describe('QueueWorker', function() {

  it('should not create a QueueWorker with no parameters', function() {
    expect(function() {
      new th.QueueWorker();
    }).to.throw('No queue reference provided.');
  });

  it('should not create a QueueWorker with only a queueRef', function() {
    expect(function() {
      new th.QueueWorker(queueRef);
    }).to.throw('Invalid process ID provided.');
  });

  it('should not create a QueueWorker with only a queueRef and a process ID', function() {
    expect(function() {
      new th.QueueWorker(queueRef, '0');
    }).to.throw('No processing function provided.');
  });

  it('should not create a QueueWorker with a queueRef, processId and an invalid processing function', function() {
    ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }].forEach(function(nonFunctionObject) {
      expect(function() {
        new th.QueueWorker(queueRef, '0', nonFunctionObject);
      }).to.throw('No processing function provided.');
    });
  });

  it('should create a QueueWorker with a queueRef, processId and a processing function', function() {
    new th.QueueWorker(queueRef, '0', _.noop);
  });

  it('should not create a QueueWorker with a non-string processId specified', function() {
    [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
      expect(function() {
        new th.QueueWorker(queueRef, nonStringObject, _.noop);
      }).to.throw('Invalid process ID provided.');
    });
  });

  describe('#_getLogEntry', function() {
    var qw = new th.QueueWorker(queueRef, '0', _.noop);

    it('should construct a log entry given a string', function() {
      expect(qw._getLogEntry('informative message')).to.equal('QueueWorker 0 (null) informative message');
    });

    it('should construct a log entry given a non-string', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._getLogEntry(nonStringObject)).to.equal('QueueWorker 0 (null) ' + nonStringObject);
      });
    });
  });

  describe('#_isValidJobSpec', function() {
    var qw = new th.QueueWorker(queueRef, '0', _.noop);

    it('should not accept a non-plain object as a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop].forEach(function(nonPlainObject) {
        expect(qw._isValidJobSpec(nonPlainObject)).to.be.false;
      });
    });

    it('should not accept an empty object as a valid job spec', function() {
      expect(qw._isValidJobSpec({})).to.be.false;
    });

    it('should not accept a non-empty object without the required keys as a valid job spec', function() {
      expect(qw._isValidJobSpec({ foo: 'bar' })).to.be.false;
    });

    it('should not accept a startState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._isValidJobSpec({ startState: nonStringObject, inProgressState: 'valid', finishedState: 'valid' })).to.be.false;
      });
    });

    it('should not accept an inProgressState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._isValidJobSpec({ inProgressState: nonStringObject, finishedState: 'valid' })).to.be.false;
      });
    });

    it('should not accept a finishedState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._isValidJobSpec({ inProgressState: 'valid', finishedState: nonStringObject })).to.be.false;
      });
    });

    it('should not accept a timeout that is not a positive integer as a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, -1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonPositiveIntigerObject) {
        expect(qw._isValidJobSpec({ inProgressState: 'valid', finishedState: 'valid', jobTimeout: nonPositiveIntigerObject })).to.be.false;
      });
    });

    it('should accept a valid job spec without a timeout', function() {
      expect(qw._isValidJobSpec({ inProgressState: 'valid', finishedState: 'valid' })).to.be.true;
    });

    it('should accept a valid job spec with a timeout', function() {
      expect(qw._isValidJobSpec({ inProgressState: 'valid', finishedState: 'valid', jobTimeout: 1 })).to.be.true;
    });
  });

});
