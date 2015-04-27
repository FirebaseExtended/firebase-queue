var _ = require('lodash'),
    Helpers = require('../helpers.js'),
    chai = require('chai'),
    should = chai.should(),
    expect = chai.expect,
    sinon = require('sinon'),
    sinonChai = require('sinon-chai'),
    winston = require('winston'),
    chaiAsPromised = require('chai-as-promised');

winston.level = 'none';

chai.use(sinonChai);
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
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.startState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept an inProgressState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.inProgressState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a finishedState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.finishedState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a timeout that is not a positive integer as a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, -1, 1.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonPositiveIntigerObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.jobTimeout = nonPositiveIntigerObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should accept a valid job spec without a timeout', function() {
      expect(qw._isValidJobSpec(th.validBasicJobSpec)).to.be.true;
    });

    it('should accept a valid job spec with a startState', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithStartState)).to.be.true;
    });

    it('should accept a valid job spec with a startState and a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithStartStateAndTimeout)).to.be.true;
    });

    it('should accept a valid job spec with a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithTimeout)).to.be.true;
    });

    it('should not accept a jobSpec with the same startState and inProgressState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.startState = jobSpec.inProgressState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should not accept a jobSpec with the same startState and finishedState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.startState = jobSpec.finishedState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should not accept a jobSpec with the same inProgressState and finishedState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.inProgressState = jobSpec.finishedState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });
  });

  describe('#setJob', function() {
    var qw;

    afterEach(function(done) {
      qw.setJob();
      queueRef.set(null, done);
    });

    it('should reset the worker when called with an invalid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
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

    it('should reset the worker when called with an invalid job spec after a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.setJob(th.validBasicJobSpec);
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

    it('should reset the worker when called with an invalid job spec after a valid job spec with a timeout', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.setJob(th.validJobSpecWithTimeout);
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

    it('should reset a worker when called with a basic valid job spec', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validBasicJobSpec);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validBasicJobSpec.inProgressState);
      expect(qw.finishedState).to.equal(th.validBasicJobSpec.finishedState);
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a timeout', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithTimeout);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validJobSpecWithTimeout.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithTimeout.finishedState);
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithTimeout.jobTimeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a startState', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithStartState);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.equal(th.validJobSpecWithStartState.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithStartState.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithStartState.finishedState);
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a timeout and a startState', function() {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      var oldUUID = qw.uuid;
      qw.setJob(th.validJobSpecWithStartStateAndTimeout);
      expect(qw.uuid).to.not.equal(oldUUID);
      expect(qw.startState).to.equal(th.validJobSpecWithStartStateAndTimeout.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithStartStateAndTimeout.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithStartStateAndTimeout.finishedState);
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithStartStateAndTimeout.jobTimeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should not pick up items on the queue not for the current item', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      var spy = sinon.spy(qw, '_tryToProcess');
      queueRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.not.have.been.called;
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      queueRef.push({ '_state': 'other' });
    });

    it('should pick up items on the queue with no "_state" when a job is specified without a startState', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      var spy = sinon.spy(qw, '_tryToProcess');
      var ref = queueRef.push();
      queueRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.have.been.calledOnce.and.calledWith(ref);
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      ref.set({ 'foo': 'bar' });
    });

    it('should pick up items on the queue with the corresponding "_state" when a job is specifies a startState', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validJobSpecWithStartState);
      var spy = sinon.spy(qw, '_tryToProcess');
      var ref = queueRef.push();
      queueRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.have.been.calledOnce.and.calledWith(ref);
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      ref.set({ '_state': th.validJobSpecWithStartState.startState });
    });
  });

  describe('#_updateProgress', function() {
    var qw;

    ['', 'foo', NaN, Infinity, true, false, -1, 100.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidPercentageValue) {
      it('should ignore invalid input ' + invalidPercentageValue + ' to update the progress', function() {
        qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
        qw.currentItemRef = queueRef.push();
        return qw._updateProgress(invalidPercentageValue).should.eventually.be.rejectedWith('Invalid progress');
      });
    });

    it('should not update the progress of an item no longer owned by the current worker', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': 'someone_else' }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('Current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the worker is no longer processing it', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('No item currently being processed').notify(done);
      });
    });

    it('should not update the progress of an item if the item is no longer in progress', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicJobSpec.finishedState, '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('Current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the item has no _state', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.rejectedWith('Current item no longer owned by this process').notify(done);
      });
    });

    it('should update the progress of the current item', function(done) {
      qw = new th.RestrictedQueueWorker(queueRef, '0', _.noop);
      qw.setJob(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': qw.uuid }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(10).should.eventually.be.fulfilled.notify(done);
      });
    });
  });
});
