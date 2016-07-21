'use strict';

var _ = require('lodash');
var Helpers = require('../helpers.js');
var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var sinonChai = require('sinon-chai');
var winston = require('winston');
var chaiAsPromised = require('chai-as-promised');

winston.level = 'none';

chai.should();
chai.use(sinonChai);
chai.use(chaiAsPromised);

var th = new Helpers();
var tasksRef = th.testRef.child('tasks');

describe('QueueWorker', function() {
  describe('initialize', function() {
    it('should not create a QueueWorker with no parameters', function() {
      expect(function() {
        new th.QueueWorker();
      }).to.throw('No tasks reference provided.');
    });

    it('should not create a QueueWorker with only a tasksRef', function() {
      expect(function() {
        new th.QueueWorker(tasksRef);
      }).to.throw('Invalid process ID provided.');
    });

    it('should not create a QueueWorker with only a tasksRef, process ID, sanitize and suppressStack option', function() {
      expect(function() {
        new th.QueueWorker(tasksRef, '0', true, false);
      }).to.throw('No processing function provided.');
    });

    it('should not create a QueueWorker with a tasksRef, processId, sanitize option and an invalid processing function', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }].forEach(function(nonFunctionObject) {
        expect(function() {
          new th.QueueWorker(tasksRef, '0', true, false, nonFunctionObject);
        }).to.throw('No processing function provided.');
      });
    });

    it('should create a QueueWorker with a tasksRef, processId, sanitize option and a processing function', function() {
      new th.QueueWorker(tasksRef, '0', true, false, _.noop);
    });

    it('should not create a QueueWorker with a non-string processId specified', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(function() {
          new th.QueueWorker(tasksRef, nonStringObject, true, false, _.noop);
        }).to.throw('Invalid process ID provided.');
      });
    });

    it('should not create a QueueWorker with a non-boolean sanitize option specified', function() {
      [NaN, Infinity, '', 'foo', 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonBooleanObject) {
        expect(function() {
          new th.QueueWorker(tasksRef, '0', nonBooleanObject, false, _.noop);
        }).to.throw('Invalid sanitize option.');
      });
    });

    it('should not create a QueueWorker with a non-boolean suppressStack option specified', function() {
      [NaN, Infinity, '', 'foo', 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonBooleanObject) {
        expect(function() {
          new th.QueueWorker(tasksRef, '0', true, nonBooleanObject, _.noop);
        }).to.throw('Invalid suppressStack option.');
      });
    });
  });

  describe('#_getLogEntry', function() {
    var qw = new th.QueueWorker(tasksRef, '0', true, false, _.noop);

    it('should construct a log entry given a string', function() {
      expect(qw._getLogEntry('informative message')).to.equal('QueueWorker ' + qw.processId + ' informative message');
    });

    it('should construct a log entry given a non-string', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._getLogEntry(nonStringObject)).to.equal('QueueWorker ' + qw.processId + ' ' + nonStringObject);
      });
    });
  });

  describe('#_resetTask', function() {
    var qw;
    var testRef;

    afterEach(function(done) {
      qw.setTaskSpec();
      testRef.off();
      tasksRef.set(null, done);
    });

    it('should reset a task that is currently in progress', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'someone',
        '_progress': 10
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resetTask(testRef);
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state_changed']);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should not reset a task that no longer exists', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);

      testRef = tasksRef.push();
      qw.currentTaskRef = testRef;
      qw._resetTask(testRef).then(function() {
        testRef.once('value', function(snapshot) {
          try {
            expect(snapshot.val()).to.be.null;
            done();
          } catch (error) {
            done(error);
          }
        });
      }).catch(done);
    });

    it('should not reset a task if it is has already changed state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._resetTask(testRef).then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reset a task if it is has no state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._resetTask(testRef).then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });
  });

  describe('#_resolve', function() {
    var qw;
    var testRef;

    afterEach(function(done) {
      qw.setTaskSpec();
      testRef.off();
      tasksRef.set(null, done);
    });

    it('should resolve a task owned by the current worker and remove it when no finishedState is specified', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)();
          } else {
            try {
              expect(snapshot.val()).to.be.null;
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should resolve a task owned by the current worker and change the state when a finishedState is specified and no object passed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)();
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_state_changed', '_progress']);
              expect(task._progress).to.equal(100);
              expect(task._state).to.equal(th.validTaskSpecWithFinishedState.finishedState);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop].forEach(function(nonPlainObject) {
      it('should resolve an task owned by the current worker and change the state when a finishedState is specified and an invalid object ' + nonPlainObject + ' passed', function(done) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
        qw.setTaskSpec(th.validTaskSpecWithFinishedState);
        testRef = tasksRef.push({
          '_state': th.validTaskSpecWithFinishedState.inProgressState,
          '_state_changed': new Date().getTime(),
          '_owner': qw.processId + ':' + qw.taskNumber,
          '_progress': 0
        }, function(errorA) {
          if (errorA) {
            return done(errorA);
          }
          qw.currentTaskRef = testRef;
          var initial = true;
          return testRef.on('value', function(snapshot) {
            if (initial) {
              initial = false;
              qw._resolve(qw.taskNumber)(nonPlainObject);
            } else {
              try {
                var task = snapshot.val();
                expect(task).to.have.all.keys(['_state', '_state_changed', '_progress']);
                expect(task._progress).to.equal(100);
                expect(task._state).to.equal(th.validTaskSpecWithFinishedState.finishedState);
                expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
                done();
              } catch (errorB) {
                done(errorB);
              }
            }
          });
        });
      });
    });

    it('should resolve a task owned by the current worker and change the state when a finishedState is specified and a plain object passed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)({ foo: 'bar' });
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_state_changed', '_progress', 'foo']);
              expect(task._progress).to.equal(100);
              expect(task._state).to.equal(th.validTaskSpecWithFinishedState.finishedState);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task.foo).to.equal('bar');
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should resolve a task owned by the current worker and change the state to a provided valid string _new_state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)({
              foo: 'bar',
              _new_state: 'valid_new_state'
            });
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_state_changed', '_progress', 'foo']);
              expect(task._progress).to.equal(100);
              expect(task._state).to.equal('valid_new_state');
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task.foo).to.equal('bar');
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should resolve a task owned by the current worker and change the state to a provided valid null _new_state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)({
              foo: 'bar',
              _new_state: null
            });
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state_changed', '_progress', 'foo']);
              expect(task._progress).to.equal(100);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task.foo).to.equal('bar');
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should resolve a task owned by the current worker and remove the task when provided _new_state = false', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)({
              foo: 'bar',
              _new_state: false
            });
          } else {
            try {
              expect(snapshot.val()).to.be.null;
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should resolve a task owned by the current worker and change the state to finishedState when provided an invalid _new_state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)({
              foo: 'bar',
              _new_state: {
                state: 'object_is_an_invalid_new_state'
              }
            });
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_state_changed', '_progress', 'foo']);
              expect(task._progress).to.equal(100);
              expect(task._state).to.equal(th.validTaskSpecWithFinishedState.finishedState);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task.foo).to.equal('bar');
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should not resolve a task that no longer exists', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);

      testRef = tasksRef.push();
      qw.currentTaskRef = testRef;
      qw._resolve(qw.taskNumber)().then(function() {
        testRef.once('value', function(snapshot) {
          try {
            expect(snapshot.val()).to.be.null;
            done();
          } catch (error) {
            done(error);
          }
        });
      }).catch(done);
    });

    it('should not resolve a task if it is no longer owned by the current worker', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve a task if it is has already changed state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve a task if it is has no state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve a task if it is no longer being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId  + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve a task if a new task is being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var resolve = qw._resolve(qw.taskNumber);
        qw.taskNumber += 1;
        return resolve().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });
  });

  describe('#_reject', function() {
    var qw;
    var testRef;

    afterEach(function(done) {
      qw.setTaskSpec();
      testRef.off();
      tasksRef.set(null, done);
    });

    it('should reject a task owned by the current worker', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)();
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(task._state).to.equal('error');
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task._progress).to.equal(0);
              expect(task._error_details).to.have.all.keys(['previous_state', 'attempts']);
              expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(task._error_details.attempts).to.equal(1);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should reject a task owned by the current worker and reset if more retries are specified', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithRetries);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithRetries.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0,
        '_error_details': {
          'previous_state': th.validTaskSpecWithRetries.inProgressState,
          'attempts': 1
        }
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)();
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_progress', '_state_changed', '_error_details']);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task._progress).to.equal(0);
              expect(task._error_details).to.have.all.keys(['previous_state', 'attempts']);
              expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(task._error_details.attempts).to.equal(2);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should reject a task owned by the current worker and reset the attempts count if chaning error handlers', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithRetries);
      testRef = tasksRef.push({
        '_state': th.validTaskSpecWithRetries.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0,
        '_error_details': {
          'previous_state': 'other_in_progress_state',
          'attempts': 1
        }
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)();
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_progress', '_state_changed', '_error_details']);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task._progress).to.equal(0);
              expect(task._error_details).to.have.all.keys(['previous_state', 'attempts']);
              expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(task._error_details.attempts).to.equal(1);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should reject a task owned by the current worker and a non-standard error state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithErrorState);
      testRef = tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)();
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(task._state).to.equal(th.validTaskSpecWithErrorState.errorState);
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task._progress).to.equal(0);
              expect(task._error_details).to.have.all.keys(['previous_state', 'attempts']);
              expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(task._error_details.attempts).to.equal(1);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
      it('should reject a task owned by the current worker and convert the error to a string if not a string: ' + nonStringObject, function(done) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
        qw.setTaskSpec(th.validBasicTaskSpec);
        testRef = tasksRef.push({
          '_state': th.validBasicTaskSpec.inProgressState,
          '_state_changed': new Date().getTime(),
          '_owner': qw.processId + ':' + qw.taskNumber,
          '_progress': 0
        }, function(errorA) {
          if (errorA) {
            return done(errorA);
          }
          qw.currentTaskRef = testRef;
          var initial = true;
          return testRef.on('value', function(snapshot) {
            if (initial) {
              initial = false;
              qw._reject(qw.taskNumber)(nonStringObject);
            } else {
              try {
                var task = snapshot.val();
                expect(task).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
                expect(task._state).to.equal('error');
                expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
                expect(task._progress).to.equal(0);
                expect(task._error_details).to.have.all.keys(['previous_state', 'error', 'attempts']);
                expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
                expect(task._error_details.error).to.equal(nonStringObject.toString());
                expect(task._error_details.attempts).to.equal(1);
                done();
              } catch (errorB) {
                done(errorB);
              }
            }
          });
        });
      });
    });

    it('should reject a task owned by the current worker and append the error string to the _error_details', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var error = 'My error message';
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)(error);
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(task._state).to.equal('error');
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task._progress).to.equal(0);
              expect(task._error_details).to.have.all.keys(['previous_state', 'error', 'attempts']);
              expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(task._error_details.attempts).to.equal(1);
              expect(task._error_details.error).to.equal(error);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should reject a task owned by the current worker and append the error string and stack to the _error_details', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var error = new Error('My error message');
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)(error);
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(task._state).to.equal('error');
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task._progress).to.equal(0);
              expect(task._error_details).to.have.all.keys(['previous_state', 'error', 'attempts', 'error_stack']);
              expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(task._error_details.attempts).to.equal(1);
              expect(task._error_details.error).to.equal(error.message);
              expect(task._error_details.error_stack).to.be.a.string;
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should reject a task owned by the current worker and append the error string to the _error_details', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.suppressStack = true;
      var error = new Error('My error message');
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var initial = true;
        return testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)(error);
          } else {
            try {
              var task = snapshot.val();
              expect(task).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(task._state).to.equal('error');
              expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(task._progress).to.equal(0);
              expect(task._error_details).to.have.all.keys(['previous_state', 'error', 'attempts']);
              expect(task._error_details.previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(task._error_details.attempts).to.equal(1);
              expect(task._error_details.error).to.equal(error.message);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should not reject a task that no longer exists', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push();
      qw.currentTaskRef = testRef;
      qw._reject(qw.taskNumber)().then(function() {
        testRef.once('value', function(snapshot) {
          try {
            expect(snapshot.val()).to.be.null;
            done();
          } catch (error) {
            done(error);
          }
        });
      }).catch(done);
    });

    it('should not reject a task if it is no longer owned by the current worker', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject a task if it is has already changed state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject a task if it is has no state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        return qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject a task if it is no longer being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject a task if a new task is being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var originalTask = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = tasksRef.push(originalTask, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentTaskRef = testRef;
        var reject = qw._reject(qw.taskNumber);
        qw.taskNumber += 1;
        return reject().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalTask);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });
  });

  describe('#_updateProgress', function() {
    var qw;

    beforeEach(function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw._tryToProcess = _.noop;
    });

    afterEach(function(done) {
      qw.setTaskSpec();
      tasksRef.set(null, done);
    });

    ['', 'foo', NaN, Infinity, true, false, -1, 100.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidPercentageValue) {
      it('should ignore invalid input ' + invalidPercentageValue + ' to update the progress', function() {
        qw.currentTaskRef = tasksRef.push();
        return qw._updateProgress(qw.taskNumber)(invalidPercentageValue).should.eventually.be.rejectedWith('Invalid progress');
      });
    });

    it('should not update the progress of a task no longer owned by the current worker', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentTaskRef = tasksRef.push({ '_state': th.validBasicTaskSpec.inProgressState, '_owner': 'someone_else' }, function(error) {
        if (error) {
          return done(error);
        }
        return qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current task no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of a task if the worker is no longer processing it', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      tasksRef.push({ '_state': th.validBasicTaskSpec.inProgressState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        return qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - no task currently being processed').notify(done);
      });
    });

    it('should not update the progress of a task if the task is no longer in progress', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      qw.currentTaskRef = tasksRef.push({ '_state': th.validTaskSpecWithFinishedState.finishedState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        return qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current task no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of a task if the task has no _state', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentTaskRef = tasksRef.push({ '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        return qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current task no longer owned by this process').notify(done);
      });
    });

    it('should update the progress of the current task', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentTaskRef = tasksRef.push({ '_state': th.validBasicTaskSpec.inProgressState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        return qw._updateProgress(qw.taskNumber)(10).should.eventually.be.fulfilled.notify(done);
      });
    });

    it('should not update the progress of a task if a new task is being processed', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentTaskRef = tasksRef.push({ '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        var updateProgress = qw._updateProgress(qw.taskNumber);
        qw.taskNumber += 1;
        return updateProgress(10).should.eventually.be.rejectedWith('Can\'t update progress - no task currently being processed').notify(done);
      });
    });
  });

  describe('#_tryToProcess', function() {
    var qw;

    beforeEach(function() {
      qw = new th.QueueWorker(tasksRef, '0', true, false, _.noop);
    });

    afterEach(function(done) {
      qw.setTaskSpec();
      tasksRef.set(null, done);
    });

    it('should not try and process a task if busy', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.busy = true;
      qw.newTaskRef = tasksRef;
      tasksRef.push({
        '_state': th.validTaskSpecWithStartState.startState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.be.null;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should try and process a task if not busy', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.newTaskRef = tasksRef;
      tasksRef.push({
        '_state': th.validTaskSpecWithStartState.startState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.not.be.null;
            expect(qw.busy).to.be.true;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should try and process a task if not busy, rejecting it if it throws', function(done) {
      qw = new th.QueueWorker(tasksRef, '0', true, false, function() {
        throw new Error('Error thrown in processingFunction');
      });
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.finishedState = th.validTaskSpecWithFinishedState.finishedState;
      qw.taskRetries = 0;
      qw.newTaskRef = tasksRef;
      var testRef = tasksRef.push({
        '_state': th.validTaskSpecWithStartState.startState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.not.be.null;
            expect(qw.busy).to.be.true;
            var initial = true;
            testRef.on('value', function(snapshot) {
              if (initial) {
                initial = false;
              } else {
                try {
                  testRef.off();
                  var task = snapshot.val();
                  expect(task).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
                  expect(task._state).to.equal('error');
                  expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
                  expect(task._progress).to.equal(0);
                  expect(task._error_details).to.have.all.keys(['previous_state', 'attempts', 'error', 'error_stack']);
                  expect(task._error_details.previous_state).to.equal(th.validTaskSpecWithStartState.inProgressState);
                  expect(task._error_details.attempts).to.equal(1);
                  expect(task._error_details.error).to.equal('Error thrown in processingFunction');
                  expect(task._error_details.error_stack).to.be.a.string;
                  done();
                } catch (errorC) {
                  done(errorC);
                }
              }
            });
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should try and process a task without a _state if not busy', function(done) {
      qw.startState = null;
      qw.inProgressState = th.validBasicTaskSpec.inProgressState;
      qw.newTaskRef = tasksRef;
      tasksRef.push({
        foo: 'bar'
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.not.be.null;
            expect(qw.busy).to.be.true;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should not try and process a task if not a plain object [1]', function(done) {
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.suppressStack = true;
      qw.newTaskRef = tasksRef;
      var testRef = tasksRef.push('invalid', function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.be.null;
            expect(qw.busy).to.be.false;
            testRef.once('value', function(snapshot) {
              try {
                var task = snapshot.val();
                expect(task).to.have.all.keys(['_error_details', '_state', '_state_changed']);
                expect(task._error_details).to.have.all.keys(['error', 'original_task']);
                expect(task._error_details.error).to.equal('Task was malformed');
                expect(task._error_details.original_task).to.equal('invalid');
                expect(task._state).to.equal('error');
                expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
                done();
              } catch (errorB) {
                done(errorB);
              }
            });
          } catch (errorC) {
            done(errorC);
          }
        }).catch(done);
      });
    });

    it('should not try and process a task if not a plain object [2]', function(done) {
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.newTaskRef = tasksRef;
      var testRef = tasksRef.push('invalid', function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.be.null;
            expect(qw.busy).to.be.false;
            testRef.once('value', function(snapshot) {
              try {
                var task = snapshot.val();
                expect(task).to.have.all.keys(['_error_details', '_state', '_state_changed']);
                expect(task._error_details).to.have.all.keys(['error', 'original_task', 'error_stack']);
                expect(task._error_details.error).to.equal('Task was malformed');
                expect(task._error_details.original_task).to.equal('invalid');
                expect(task._error_details.error_stack).to.be.a.string;
                expect(task._state).to.equal('error');
                expect(task._state_changed).to.be.closeTo(new Date().getTime() + th.offset, 250);
                done();
              } catch (errorB) {
                done(errorB);
              }
            });
          } catch (errorC) {
            done(errorC);
          }
        }).catch(done);
      });
    });

    it('should not try and process a task if no longer in correct startState', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.newTaskRef = tasksRef;
      tasksRef.push({
        '_state': th.validTaskSpecWithStartState.inProgressState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.be.null;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should not try and process a task if no task to process', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.newTaskRef = tasksRef;
      qw._tryToProcess().then(function() {
        try {
          expect(qw.currentTaskRef).to.be.null;
          done();
        } catch (errorB) {
          done(errorB);
        }
      }).catch(done);
    });

    it('should invalidate callbacks if another process times the task out', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.newTaskRef = tasksRef;
      var testRef = tasksRef.push({
        '_state': th.validTaskSpecWithStartState.startState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return qw._tryToProcess().then(function() {
          try {
            expect(qw.currentTaskRef).to.not.be.null;
            expect(qw.busy).to.be.true;
            testRef.update({
              '_owner': null
            }, function(errorB) {
              if (errorB) {
                return done(errorB);
              }
              try {
                expect(qw.currentTaskRef).to.be.null;
                done();
              } catch (errorC) {
                done(errorC);
              }
              return undefined;
            });
          } catch (errorD) {
            done(errorD);
          }
        }).catch(done);
      });
    });

    it('should sanitize data passed to the processing function when specified', function(done) {
      qw = new th.QueueWorker(tasksRef, '0', true, false, function(data) {
        try {
          expect(data).to.have.all.keys(['foo']);
          done();
        } catch (error) {
          done(error);
        }
      });
      qw.setTaskSpec(th.validBasicTaskSpec);
      tasksRef.push({ foo: 'bar' });
    });

    it('should not sanitize data passed to the processing function when specified', function(done) {
      qw = new th.QueueWorker(tasksRef, '0', false, false, function(data) {
        try {
          expect(data).to.have.all.keys(['foo', '_owner', '_progress', '_state', '_state_changed', '_id']);
          done();
        } catch (error) {
          done(error);
        }
      });
      qw.setTaskSpec(th.validBasicTaskSpec);
      tasksRef.push({ foo: 'bar' });
    });
  });

  describe('#_setUpTimeouts', function() {
    var qw;
    var clock;

    beforeEach(function() {
      clock = sinon.useFakeTimers(new Date().getTime());
      qw = new th.QueueWorkerWithoutProcessing(tasksRef, '0', true, false, _.noop);
    });

    afterEach(function(done) {
      qw.setTaskSpec();
      clock.restore();
      tasksRef.set(null, done);
    });

    it('should not set up timeouts when no task timeout is set', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      tasksRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime()
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.deep.equal({});
          done();
        } catch (errorB) {
          done(errorB);
        }
        return undefined;
      });
    });

    it('should not set up timeouts when a task not in progress is added and a task timeout is set', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      tasksRef.push({
        '_state': th.validTaskSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime()
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.deep.equal({});
          done();
        } catch (errorB) {
          done(errorB);
        }
        return undefined;
      });
    });

    it('should set up timeout listeners when a task timeout is set', function() {
      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingTasksRef).to.be.null;
      expect(qw.processingTaskAddedListener).to.be.null;
      expect(qw.processingTaskRemovedListener).to.be.null;

      qw.setTaskSpec(th.validTaskSpecWithTimeout);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingTasksRef).to.not.be.null;
      expect(qw.processingTaskAddedListener).to.not.be.null;
      expect(qw.processingTaskRemovedListener).to.not.be.null;
    });

    it('should remove timeout listeners when a task timeout is not specified after a previous task specified a timeout', function() {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingTasksRef).to.not.be.null;
      expect(qw.processingTaskAddedListener).to.not.be.null;
      expect(qw.processingTaskRemovedListener).to.not.be.null;

      qw.setTaskSpec(th.validBasicTaskSpec);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingTasksRef).to.be.null;
      expect(qw.processingTaskAddedListener).to.be.null;
      expect(qw.processingTaskRemovedListener).to.be.null;
    });

    it('should set up a timeout when a task timeout is set and a task added', function(done) {
      var spy = sinon.spy(global, 'setTimeout');
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = tasksRef.push({
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime() - 5
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
          expect(setTimeout.getCall(0).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout - 5);
          spy.restore();
          done();
        } catch (errorB) {
          spy.restore();
          done(errorB);
        }
        return undefined;
      });
    });

    it('should set up a timeout when a task timeout is set and a task owner changed', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = tasksRef.push({
        '_owner': qw.processId + ':0',
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime() - 10
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
          var spy = sinon.spy(global, 'setTimeout');
          testRef.update({
            '_owner': qw.processId + ':1',
            '_state_changed': new Date().getTime() - 5
          }, function(errorB) {
            if (errorB) {
              return done(errorB);
            }
            try {
              expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
              expect(setTimeout.getCall(setTimeout.callCount - 1).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout - 5);
              spy.restore();
              done();
            } catch (errorC) {
              spy.restore();
              done(errorC);
            }
            return undefined;
          });
        } catch (errorB) {
          done(errorB);
        }
        return undefined;
      });
    });

    it('should not set up a timeout when a task timeout is set and a task updated', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var spy = sinon.spy(global, 'setTimeout');
      var testRef = tasksRef.push({
        '_owner': qw.processId + ':0',
        '_progress': 0,
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime() - 5
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
          testRef.update({
            '_progress': 1
          }, function(errorB) {
            if (errorB) {
              return done(errorB);
            }
            try {
              expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
              expect(setTimeout.getCall(0).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout - 5);
              spy.restore();
              done();
            } catch (errorC) {
              spy.restore();
              done(errorC);
            }
            return undefined;
          });
        } catch (errorB) {
          done(errorB);
        }
        return undefined;
      });
    });

    it('should set up a timeout when a task timeout is set and a task added without a _state_changed time', function(done) {
      var spy = sinon.spy(global, 'setTimeout');
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = tasksRef.push({
        '_state': th.validTaskSpecWithTimeout.inProgressState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
          expect(setTimeout.getCall(0).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout);
          spy.restore();
          done();
        } catch (errorB) {
          spy.restore();
          done(errorB);
        }
        return undefined;
      });
    });

    it('should clear timeouts when a task timeout is not set and a timeout exists', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = tasksRef.push({
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime()
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
          qw.setTaskSpec();
          expect(qw.expiryTimeouts).to.deep.equal({});
          done();
        } catch (errorB) {
          done(errorB);
        }
        return undefined;
      });
    });

    it('should clear a timeout when a task is completed', function(done) {
      var spy = sinon.spy(qw, '_resetTask');
      var taskSpec = _.clone(th.validTaskSpecWithTimeout);
      taskSpec.finishedState = th.validTaskSpecWithFinishedState.finishedState;
      qw.setTaskSpec(taskSpec);
      var testRef = tasksRef.push({
        '_state': taskSpec.inProgressState,
        '_state_changed': new Date().getTime()
      }, function(errorA) {
        if (errorA) {
          spy.restore();
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key]);
          testRef.update({
            '_state': taskSpec.finishedState
          }, function(errorB) {
            if (errorB) {
              return done(errorB);
            }
            try {
              expect(qw.expiryTimeouts).to.deep.equal({});
              expect(qw._resetTask).to.not.have.been.called;
              spy.restore();
              done();
            } catch (errorC) {
              spy.restore();
              done(errorC);
            }
            return undefined;
          });
        } catch (errorD) {
          spy.restore();
          done(errorD);
        }
        return undefined;
      });
    });
  });

  describe('#_isValidTaskSpec', function() {
    var qw;

    before(function() {
      qw = new th.QueueWorker(tasksRef, '0', true, false, _.noop);
    });

    it('should not accept a non-plain object as a valid task spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop].forEach(function(nonPlainObject) {
        expect(qw._isValidTaskSpec(nonPlainObject)).to.be.false;
      });
    });

    it('should not accept an empty object as a valid task spec', function() {
      expect(qw._isValidTaskSpec({})).to.be.false;
    });

    it('should not accept a non-empty object without the required keys as a valid task spec', function() {
      expect(qw._isValidTaskSpec({ foo: 'bar' })).to.be.false;
    });

    it('should not accept a startState that is not a string as a valid task spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var taskSpec = _.clone(th.validBasicTaskSpec);
        taskSpec.startState = nonStringObject;
        expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
      });
    });

    it('should not accept an inProgressState that is not a string as a valid task spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var taskSpec = _.clone(th.validBasicTaskSpec);
        taskSpec.inProgressState = nonStringObject;
        expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
      });
    });

    it('should not accept a finishedState that is not a string as a valid task spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var taskSpec = _.clone(th.validBasicTaskSpec);
        taskSpec.finishedState = nonStringObject;
        expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
      });
    });

    it('should not accept a finishedState that is not a string as a valid task spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var taskSpec = _.clone(th.validBasicTaskSpec);
        taskSpec.errorState = nonStringObject;
        expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
      });
    });

    it('should not accept a timeout that is not a positive integer as a valid task spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, -1, 1.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonPositiveIntigerObject) {
        var taskSpec = _.clone(th.validBasicTaskSpec);
        taskSpec.timeout = nonPositiveIntigerObject;
        expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
      });
    });

    it('should not accept a retries that is not a positive or 0 integer as a valid task spec', function() {
      ['', 'foo', NaN, Infinity, true, false, -1, 1.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonPositiveIntigerObject) {
        var taskSpec = _.clone(th.validBasicTaskSpec);
        taskSpec.retries = nonPositiveIntigerObject;
        expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
      });
    });

    it('should accept a valid task spec without a timeout', function() {
      expect(qw._isValidTaskSpec(th.validBasicTaskSpec)).to.be.true;
    });

    it('should accept a valid task spec with a startState', function() {
      expect(qw._isValidTaskSpec(th.validTaskSpecWithStartState)).to.be.true;
    });

    it('should not accept a taskSpec with the same startState and inProgressState', function() {
      var taskSpec = _.clone(th.validBasicTaskSpec);
      taskSpec.startState = taskSpec.inProgressState;
      expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
    });

    it('should accept a valid task spec with a finishedState', function() {
      expect(qw._isValidTaskSpec(th.validTaskSpecWithFinishedState)).to.be.true;
    });

    it('should not accept a taskSpec with the same finishedState and inProgressState', function() {
      var taskSpec = _.clone(th.validBasicTaskSpec);
      taskSpec.finishedState = taskSpec.inProgressState;
      expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
    });

    it('should accept a valid task spec with a errorState', function() {
      expect(qw._isValidTaskSpec(th.validTaskSpecWithErrorState)).to.be.true;
    });

    it('should not accept a taskSpec with the same errorState and inProgressState', function() {
      var taskSpec = _.clone(th.validBasicTaskSpec);
      taskSpec.errorState = taskSpec.inProgressState;
      expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
    });

    it('should accept a valid task spec with a timeout', function() {
      expect(qw._isValidTaskSpec(th.validTaskSpecWithTimeout)).to.be.true;
    });

    it('should accept a valid task spec with retries', function() {
      expect(qw._isValidTaskSpec(th.validTaskSpecWithRetries)).to.be.true;
    });

    it('should accept a valid task spec with 0 retries', function() {
      var taskSpec = _.clone(th.validBasicTaskSpec);
      taskSpec.retries = 0;
      expect(qw._isValidTaskSpec(taskSpec)).to.be.true;
    });

    it('should not accept a taskSpec with the same startState and finishedState', function() {
      var taskSpec = _.clone(th.validTaskSpecWithFinishedState);
      taskSpec.startState = taskSpec.finishedState;
      expect(qw._isValidTaskSpec(taskSpec)).to.be.false;
    });

    it('should accept a taskSpec with the same errorState and startState', function() {
      var taskSpec = _.clone(th.validTaskSpecWithStartState);
      taskSpec.errorState = taskSpec.startState;
      expect(qw._isValidTaskSpec(taskSpec)).to.be.true;
    });

    it('should accept a taskSpec with the same errorState and finishedState', function() {
      var taskSpec = _.clone(th.validTaskSpecWithFinishedState);
      taskSpec.errorState = taskSpec.finishedState;
      expect(qw._isValidTaskSpec(taskSpec)).to.be.true;
    });

    it('should accept a valid task spec with a startState, a finishedState, an errorState, a timeout, and retries', function() {
      expect(qw._isValidTaskSpec(th.validTaskSpecWithEverything)).to.be.true;
    });

    it('should accept a valid basic task spec with null parameters for everything else', function() {
      var taskSpec = _.clone(th.validBasicTaskSpec);
      taskSpec = _.assign(taskSpec, {
        startState: null,
        finishedState: null,
        errorState: null,
        timeout: null,
        retries: null
      });
      expect(qw._isValidTaskSpec(taskSpec)).to.be.true;
    });
  });

  describe('#setTaskSpec', function() {
    var qw;

    afterEach(function(done) {
      qw.setTaskSpec();
      tasksRef.set(null, done);
    });

    it('should reset the worker when called with an invalid task spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidTaskSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidTaskSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.taskTimeout).to.be.null;
        expect(qw.newTaskRef).to.be.null;
        expect(qw.newTaskListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset the worker when called with an invalid task spec after a valid task spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidTaskSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
        qw.setTaskSpec(th.validBasicTaskSpec);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidTaskSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.taskTimeout).to.be.null;
        expect(qw.newTaskRef).to.be.null;
        expect(qw.newTaskListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset the worker when called with an invalid task spec after a valid task spec with everythin', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidTaskSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
        qw.setTaskSpec(th.validTaskSpecWithEverything);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidTaskSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.taskTimeout).to.be.null;
        expect(qw.newTaskRef).to.be.null;
        expect(qw.newTaskListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset a worker when called with a basic valid task spec', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validBasicTaskSpec);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validBasicTaskSpec.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.taskTimeout).to.be.null;
      expect(qw.newTaskRef).to.have.property('on').and.be.a('function');
      expect(qw.newTaskListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with a startState', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithStartState);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.equal(th.validTaskSpecWithStartState.startState);
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithStartState.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.taskTimeout).to.be.null;
      expect(qw.newTaskRef).to.have.property('on').and.be.a('function');
      expect(qw.newTaskListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with a finishedState', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithFinishedState.inProgressState);
      expect(qw.finishedState).to.equal(th.validTaskSpecWithFinishedState.finishedState);
      expect(qw.taskTimeout).to.be.null;
      expect(qw.newTaskRef).to.have.property('on').and.be.a('function');
      expect(qw.newTaskListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with a timeout', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithTimeout.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.taskTimeout).to.equal(th.validTaskSpecWithTimeout.timeout);
      expect(qw.newTaskRef).to.have.property('on').and.be.a('function');
      expect(qw.newTaskListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with everything', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithEverything);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.equal(th.validTaskSpecWithEverything.startState);
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithEverything.inProgressState);
      expect(qw.finishedState).to.equal(th.validTaskSpecWithEverything.finishedState);
      expect(qw.taskTimeout).to.equal(th.validTaskSpecWithEverything.timeout);
      expect(qw.newTaskRef).to.have.property('on').and.be.a('function');
      expect(qw.newTaskListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should not pick up tasks on the queue not for the current task', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      var spy = sinon.spy(qw, '_tryToProcess');
      tasksRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.not.have.been.called;
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      tasksRef.push({ '_state': 'other' }, function(error) {
        if (error) {
          return done(error);
        }
        return undefined;
      });
    });

    it('should pick up tasks on the queue with no "_state" when a task is specified without a startState', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      var spy = sinon.spy(qw, '_tryToProcess');
      var ref = tasksRef.push();
      tasksRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.have.been.calledOnce;
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      ref.set({ 'foo': 'bar' });
    });

    it('should pick up tasks on the queue with the corresponding "_state" when a task is specifies a startState', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(tasksRef, '0', true, false, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithStartState);
      var spy = sinon.spy(qw, '_tryToProcess');
      var ref = tasksRef.push();
      tasksRef.once('child_added', function() {
        try {
          expect(qw._tryToProcess).to.have.been.calledOnce;
          spy.restore();
          done();
        } catch (error) {
          spy.restore();
          done(error);
        }
      });
      ref.set({ '_state': th.validTaskSpecWithStartState.startState });
    });
  });

  describe('#shutdown', function() {
    var qw;
    var callbackStarted;
    var callbackComplete;

    beforeEach(function() {
      callbackStarted = false;
      callbackComplete = false;
      qw = new th.QueueWorker(tasksRef, '0', true, false, function(data, progress, resolve) {
        callbackStarted = true;
        setTimeout(function() {
          callbackComplete = true;
          resolve();
        }, 250);
      });
    });

    afterEach(function() {
      qw.setTaskSpec();
    });

    it('should shutdown a worker not processing any tasks', function() {
      return qw.shutdown().should.eventually.be.fulfilled;
    });

    it('should shutdown a worker after the current task has finished', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      tasksRef.push({
        foo: 'bar'
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        return setTimeout(function() {
          try {
            expect(callbackStarted).to.be.true;
            expect(callbackComplete).to.be.false;
            qw.shutdown().then(function() {
              expect(callbackComplete).to.be.true;
            }).should.eventually.be.fulfilled.notify(done);
          } catch (errorB) {
            done(errorB);
          }
        }, 300);
      });
    });
  });
});
