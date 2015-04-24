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
      expect(qw._getLogEntry('informative message')).to.equal('QueueWorker 0 (' + qw.uuid + ') informative message');
    });

    it('should construct a log entry given a non-string', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._getLogEntry(nonStringObject)).to.equal('QueueWorker 0 (' + qw.uuid + ') ' + nonStringObject);
      });
    });
  });

  describe('#_isValidJobSpec', function() {
    var qw;

    before(function() {
      qw = new th.QueueWorker(queueRef, '0', _.noop);
    });

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
        var jobSpec = _.clone(th.validJobSpec);
        jobSpec.startState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept an inProgressState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validJobSpec);
        jobSpec.inProgressState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a finishedState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validJobSpec);
        jobSpec.finishedState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a timeout that is not a positive integer as a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, -1, 1.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonPositiveIntigerObject) {
        var jobSpec = _.clone(th.validJobSpec);
        jobSpec.jobTimeout = nonPositiveIntigerObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should accept a valid job spec without a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpec)).to.be.true;
    });

    it('should accept a valid job spec with a timeout', function() {
      var jobSpec = _.clone(th.validJobSpec);
      jobSpec.jobTimeout = 1;
      expect(qw._isValidJobSpec(jobSpec)).to.be.true;
    });

    it('should not accept a jobSpec with the same startState and inProgressState', function() {
      var jobSpec = _.clone(th.validJobSpec);
      jobSpec.startState = jobSpec.inProgressState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should not accept a jobSpec with the same startState and finishedState', function() {
      var jobSpec = _.clone(th.validJobSpec);
      jobSpec.startState = jobSpec.finishedState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should not accept a jobSpec with the same inProgressState and finishedState', function() {
      var jobSpec = _.clone(th.validJobSpec);
      jobSpec.inProgressState = jobSpec.finishedState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });
  });

  describe('#setJob', function() {
    var qw;

    before(function() {
      qw = new th.QueueWorker(queueRef, '0', _.noop);
    });

    it('should reset the worker when called with an invalid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        var oldUUID = qw.uuid;
        qw.setJob(invalidJobSpec);
        expect(qw.uuid).to.not.equal(oldUUID);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.jobTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });
  });

});
