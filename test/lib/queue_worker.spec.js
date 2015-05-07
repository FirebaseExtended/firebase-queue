var _ = require('lodash'),
    Helpers = require('../helpers.js'),
    util = require('util'),
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

  describe('initialize', function() {
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

    it('should not create a QueueWorker with only a queueRef, process ID and sanitize option', function() {
      expect(function() {
        new th.QueueWorker(queueRef, '0', true);
      }).to.throw('No processing function provided.');
    });

    it('should not create a QueueWorker with a queueRef, processId, sanitize option and an invalid processing function', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }].forEach(function(nonFunctionObject) {
        expect(function() {
          new th.QueueWorker(queueRef, '0', true, nonFunctionObject);
        }).to.throw('No processing function provided.');
      });
    });

    it('should create a QueueWorker with a queueRef, processId, sanitize option and a processing function', function() {
      new th.QueueWorker(queueRef, '0', true, _.noop);
    });

    it('should not create a QueueWorker with a non-string processId specified', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(function() {
          new th.QueueWorker(queueRef, nonStringObject, true, _.noop);
        }).to.throw('Invalid process ID provided.');
      });
    });

    it('should not create a QueueWorker with a non-string processId specified', function() {
      [NaN, Infinity, '', 'foo', 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonBooleanObject) {
        expect(function() {
          new th.QueueWorker(queueRef, '0', nonBooleanObject, _.noop);
        }).to.throw('Invalid sanitize option.');
      });
    });
  });

  describe('#_getLogEntry', function() {
    var qw = new th.QueueWorker(queueRef, '0', true, _.noop);

    it('should construct a log entry given a string', function() {
      expect(qw._getLogEntry('informative message')).to.equal('QueueWorker ' + qw.processId + ' informative message');
    });

    it('should construct a log entry given a non-string', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, null, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        expect(qw._getLogEntry(nonStringObject)).to.equal('QueueWorker ' + qw.processId + ' ' + nonStringObject);
      });
    });
  });

  describe('#_resetItem', function() {
    var qw, testRef;

    afterEach(function(done) {
      qw.setTaskSpec();
      testRef.off();
      queueRef.set(null, done);
    });

    it('should reset an item that is currently in progress', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = queueRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'someone',
        '_progress': 10
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resetItem(testRef);
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state_changed']);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should not reset an item that no longer exists', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);

      testRef = queueRef.push();
      qw.currentItemRef = testRef;
      qw._resetItem(testRef).then(function() {
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

    it('should not reset an item if it is has already changed state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._resetItem(testRef).then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reset an item if it is has no state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._resetItem(testRef).then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
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
    var qw, testRef;

    afterEach(function(done) {
      qw.setTaskSpec();
      testRef.off();
      queueRef.set(null, done);
    });

    it('should resolve an item owned by the current worker and remove it when no finishedState is specified', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = queueRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
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

    it('should resolve an item owned by the current worker and change the state when a finishedState is specified and no object passed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)();
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_state_changed', '_progress']);
              expect(item['_progress']).to.equal(100);
              expect(item['_state']).to.equal(th.validTaskSpecWithFinishedState.finishedState);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    ['', 'foo', NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], null, _.noop].forEach(function(nonPlainObject) {
      it('should resolve an item owned by the current worker and change the state when a finishedState is specified and an invalid object ' + nonPlainObject + ' passed', function(done) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        qw.setTaskSpec(th.validTaskSpecWithFinishedState);
        testRef = queueRef.push({
          '_state': th.validTaskSpecWithFinishedState.inProgressState,
          '_state_changed': new Date().getTime(),
          '_owner': qw.processId + ':' + qw.taskNumber,
          '_progress': 0
        }, function(errorA) {
          if (errorA) {
            return done(errorA);
          }
          qw.currentItemRef = testRef;
          var initial = true;
          testRef.on('value', function(snapshot) {
            if (initial) {
              initial = false;
              qw._resolve(qw.taskNumber)(nonPlainObject);
            } else {
              try {
                var item = snapshot.val();
                expect(item).to.have.all.keys(['_state', '_state_changed', '_progress']);
                expect(item['_progress']).to.equal(100);
                expect(item['_state']).to.equal(th.validTaskSpecWithFinishedState.finishedState);
                expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
                done();
              } catch (errorB) {
                done(errorB);
              }
            }
          });
        });
      });
    });

    it('should resolve an item owned by the current worker and change the state when a finishedState is specified and a plain object passed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push({
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._resolve(qw.taskNumber)({ foo: 'bar' });
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_state_changed', '_progress', 'foo']);
              expect(item['_progress']).to.equal(100);
              expect(item['_state']).to.equal(th.validTaskSpecWithFinishedState.finishedState);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(item.foo).to.equal('bar');
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should not resolve an item that no longer exists', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);

      testRef = queueRef.push();
      qw.currentItemRef = testRef;
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

    it('should not resolve an item if it is no longer owned by the current worker', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve an item if it is has already changed state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve an item if it is has no state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve an item if it is no longer being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId  + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._resolve(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not resolve an item if a new task is being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var resolve = qw._resolve(qw.taskNumber);
        qw.taskNumber += 1;
        resolve().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
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
    var qw, testRef;

    afterEach(function(done) {
      qw.setTaskSpec();
      testRef.off();
      queueRef.set(null, done);
    });

    it('should reject an item owned by the current worker', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = queueRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)();
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(item['_state']).to.equal('error');
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(item['_progress']).to.equal(0);
              expect(item['_error_details']).to.have.all.keys(['previous_state']);
              expect(item['_error_details'].previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should reject an item owned by the current worker and a non-standard error state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithErrorState);
      testRef = queueRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)();
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(item['_state']).to.equal(th.validTaskSpecWithErrorState.errorState);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(item['_progress']).to.equal(0);
              expect(item['_error_details']).to.have.all.keys(['previous_state']);
              expect(item['_error_details'].previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
      it('should reject an item owned by the current worker and not add report the error if not a string: ' + nonStringObject, function(done) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        qw.setTaskSpec(th.validBasicTaskSpec);
        testRef = queueRef.push({
          '_state': th.validBasicTaskSpec.inProgressState,
          '_state_changed': new Date().getTime(),
          '_owner': qw.processId + ':' + qw.taskNumber,
          '_progress': 0
        }, function(errorA) {
          if (errorA) {
            return done(errorA);
          }
          qw.currentItemRef = testRef;
          var initial = true;
          testRef.on('value', function(snapshot) {
            if (initial) {
              initial = false;
              qw._reject(qw.taskNumber)(nonStringObject);
            } else {
              try {
                var item = snapshot.val();
                expect(item).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
                expect(item['_state']).to.equal('error');
                expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
                expect(item['_progress']).to.equal(0);
                expect(item['_error_details']).to.have.all.keys(['previous_state']);
                expect(item['_error_details'].previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
                done();
              } catch (errorB) {
                done(errorB);
              }
            }
          });
        });
      });
    });

    it('should reject an item owned by the current worker and append the error string to the _error_details', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var error = 'My error message';
      qw.setTaskSpec(th.validBasicTaskSpec);
      testRef = queueRef.push({
        '_state': th.validBasicTaskSpec.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var initial = true;
        testRef.on('value', function(snapshot) {
          if (initial) {
            initial = false;
            qw._reject(qw.taskNumber)(error);
          } else {
            try {
              var item = snapshot.val();
              expect(item).to.have.all.keys(['_state', '_progress', '_state_changed', '_error_details']);
              expect(item['_state']).to.equal('error');
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(item['_progress']).to.equal(0);
              expect(item['_error_details']).to.have.all.keys(['previous_state', 'error']);
              expect(item['_error_details'].previous_state).to.equal(th.validBasicTaskSpec.inProgressState);
              expect(item['_error_details'].error).to.equal(error);
              done();
            } catch (errorB) {
              done(errorB);
            }
          }
        });
      });
    });

    it('should not reject an item that no longer exists', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push();
      qw.currentItemRef = testRef;
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

    it('should not reject an item if it is no longer owned by the current worker', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject an item if it is has already changed state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject an item if it is has no state', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject an item if it is no longer being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._reject(qw.taskNumber)().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
              done();
            } catch (errorB) {
              done(errorB);
            }
          });
        }).catch(done);
      });
    });

    it('should not reject an item if a new task is being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validTaskSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      testRef = queueRef.push(originalItem, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw.currentItemRef = testRef;
        var reject = qw._reject(qw.taskNumber);
        qw.taskNumber += 1;
        reject().then(function() {
          testRef.once('value', function(snapshot) {
            try {
              expect(snapshot.val()).to.deep.equal(originalItem);
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
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw._tryToProcess = _.noop;
    });

    afterEach(function(done) {
      qw.setTaskSpec();
      queueRef.set(null, done);
    });

    ['', 'foo', NaN, Infinity, true, false, -1, 100.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidPercentageValue) {
      it('should ignore invalid input ' + invalidPercentageValue + ' to update the progress', function() {
        qw.currentItemRef = queueRef.push();
        return qw._updateProgress(qw.taskNumber)(invalidPercentageValue).should.eventually.be.rejectedWith('Invalid progress');
      });
    });

    it('should not update the progress of an item no longer owned by the current worker', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicTaskSpec.inProgressState, '_owner': 'someone_else' }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the worker is no longer processing it', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      queueRef.push({ '_state': th.validBasicTaskSpec.inProgressState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - no item currently being processed').notify(done);
      });
    });

    it('should not update the progress of an item if the item is no longer in progress', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      qw.currentItemRef = queueRef.push({ '_state': th.validTaskSpecWithFinishedState.finishedState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the item has no _state', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentItemRef = queueRef.push({ '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current item no longer owned by this process').notify(done);
      });
    });

    it('should update the progress of the current item', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicTaskSpec.inProgressState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.fulfilled.notify(done);
      });
    });

    it('should not update the progress of an item if a new item is being processed', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      qw.currentItemRef = queueRef.push({ '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        var updateProgress = qw._updateProgress(qw.taskNumber);
        qw.taskNumber += 1;
        updateProgress(10).should.eventually.be.rejectedWith('Can\'t update progress - no item currently being processed').notify(done);
      });
    });
  });

  describe('#_tryToProcess', function() {
    var qw;

    beforeEach(function() {
      qw = new th.QueueWorker(queueRef, '0', true, _.noop);
    });

    afterEach(function() {
      qw.setTaskSpec();
    });

    it('should not try and process an item if busy', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      qw.busy = true;
      var testRef = queueRef.push({
        '_state': th.validTaskSpecWithStartState.startState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._tryToProcess(testRef).then(function() {
          try {
            expect(qw.currentItemRef).to.be.null;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should try and process an item if not busy', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      var testRef = queueRef.push({
        '_state': th.validTaskSpecWithStartState.startState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._tryToProcess(testRef).then(function() {
          try {
            expect(qw.currentItemRef).to.not.be.null;
            expect(qw.busy).to.be.true;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should try and process an item without a _state if not busy', function(done) {
      qw.startState = null;
      qw.inProgressState = th.validBasicTaskSpec.inProgressState;
      var testRef = queueRef.push({
        foo: 'bar'
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._tryToProcess(testRef).then(function() {
          try {
            expect(qw.currentItemRef).to.not.be.null;
            expect(qw.busy).to.be.true;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should not try and process an item if not a plain object', function(done) {
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      var testRef = queueRef.push('invalid', function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._tryToProcess(testRef).then(function() {
          try {
            expect(qw.currentItemRef).to.be.null;
            expect(qw.busy).to.be.false;
            testRef.once('value', function(snapshot) {
              try {
                var item = snapshot.val();
                expect(item).to.have.all.keys(['_error_details', '_state', '_state_changed', '_queue_item']);
                expect(item['_error_details']).to.have.all.keys(['error']);
                expect(item['_error_details']['error']).to.equal('Queue item was malformed');
                expect(item['_state']).to.equal('error');
                expect(item['_queue_item']).to.equal('invalid');
                expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
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

    it('should not try and process an item if no longer in correct startState', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      var testRef = queueRef.push({
        '_state': th.validTaskSpecWithStartState.inProgressState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._tryToProcess(testRef).then(function() {
          try {
            expect(qw.currentItemRef).to.be.null;
            done();
          } catch (errorB) {
            done(errorB);
          }
        }).catch(done);
      });
    });

    it('should invalidate callbacks if another process times the item out', function(done) {
      qw.startState = th.validTaskSpecWithStartState.startState;
      qw.inProgressState = th.validTaskSpecWithStartState.inProgressState;
      var testRef = queueRef.push({
        '_state': th.validTaskSpecWithStartState.startState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        qw._tryToProcess(testRef).then(function() {
          try {
            expect(qw.currentItemRef).to.not.be.null;
            expect(qw.busy).to.be.true;
            testRef.update({
              '_owner': null
            }, function(errorB) {
              if (errorB) {
                return done(errorB);
              }
              try {
                expect(qw.currentItemRef).to.be.null;
                done();
              } catch (errorC) {
                done(errorC);
              }
            });
          } catch (errorD) {
            done(errorD);
          }
        }).catch(done);
      });
    });

    it('should sanitize data passed to the processing function when specified', function(done) {
      qw = new th.QueueWorker(queueRef, '0', true, function(data, progress, resolve, reject) {
        try {
          expect(data).to.have.all.keys(['foo']);
          done();
        } catch (error) {
          done(error);
        }
      });
      qw.setTaskSpec(th.validBasicTaskSpec);
      queueRef.push({ foo: 'bar' });
    })

    it('should not sanitize data passed to the processing function when specified', function(done) {
      qw = new th.QueueWorker(queueRef, '0', false, function(data, progress, resolve, reject) {
        try {
          expect(data).to.have.all.keys(['foo', '_owner', '_progress', '_state', '_state_changed']);
          done();
        } catch (error) {
          done(error);
        }
      });
      qw.setTaskSpec(th.validBasicTaskSpec);
      queueRef.push({ foo: 'bar' });
    })
  });

  describe('#_setUpTimeouts', function() {
    var qw,
        clock;

    beforeEach(function() {
      clock = sinon.useFakeTimers(new Date().getTime());
      qw = new th.QueueWorkerWithoutProcessing(queueRef, '0', true, _.noop);
    });

    afterEach(function(done) {
      qw.setTaskSpec();
      clock.restore();
      queueRef.set(null, done);
    });

    it('should not set up timeouts when no task timeout is set', function(done) {
      qw.setTaskSpec(th.validBasicTaskSpec);
      queueRef.push({
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
      });
    });

    it('should not set up timeouts when an item not in progress is added and a task timeout is set', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      queueRef.push({
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
      });
    });

    it('should set up timeout listeners when a task timeout is set', function() {
      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.be.null;
      expect(qw.processingItemAddedListener).to.be.null;
      expect(qw.processingItemRemovedListener).to.be.null;

      qw.setTaskSpec(th.validTaskSpecWithTimeout);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.not.be.null;
      expect(qw.processingItemAddedListener).to.not.be.null;
      expect(qw.processingItemRemovedListener).to.not.be.null;
    });

    it('should remove timeout listeners when a task timeout is not specified after a previous task specified a timeout', function() {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.not.be.null;
      expect(qw.processingItemAddedListener).to.not.be.null;
      expect(qw.processingItemRemovedListener).to.not.be.null;

      qw.setTaskSpec(th.validBasicTaskSpec);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.be.null;
      expect(qw.processingItemAddedListener).to.be.null;
      expect(qw.processingItemRemovedListener).to.be.null;
    });

    it('should set up a timeout when a task timeout is set and an item added', function(done) {
      var spy = sinon.spy(global, 'setTimeout');
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = queueRef.push({
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime() - 5
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          expect(setTimeout.getCall(0).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout - 5);
          spy.restore();
          done();
        } catch (errorB) {
          spy.restore();
          done(errorB);
        }
      });
    });

    it('should set up a timeout when a task timeout is set and an item owner changed', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = queueRef.push({
        '_owner': qw.processId + ':0',
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime() - 10
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          var spy = sinon.spy(global, 'setTimeout');
          testRef.update({
            '_owner': qw.processId + ':1',
            '_state_changed': new Date().getTime() - 5
          }, function(errorB) {
            if (errorB) {
              return done(errorB);
            }
            try {
              expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
              expect(setTimeout.getCall(setTimeout.callCount - 1).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout - 5);
              spy.restore();
              done();
            } catch (errorC) {
              spy.restore();
              done(errorC);
            }
          });
        } catch (errorB) {
          done(errorB);
        }
      });
    });

    it('should not set up a timeout when a task timeout is set and an item updated', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var spy = sinon.spy(global, 'setTimeout');
      var testRef = queueRef.push({
        '_owner': qw.processId + ':0',
        '_progress': 0,
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime() - 5
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          testRef.update({
            '_progress': 1
          }, function(errorB) {
            if (errorB) {
              return done(errorB);
            }
            try {
              expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
              expect(setTimeout.getCall(0).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout - 5);
              spy.restore();
              done();
            } catch (errorC) {
              spy.restore();
              done(errorC);
            }
          });
        } catch (errorB) {
          done(errorB);
        }
      });
    });

    it('should set up a timeout when a task timeout is set and an item added without a _state_changed time', function(done) {
      var spy = sinon.spy(global, 'setTimeout');
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = queueRef.push({
        '_state': th.validTaskSpecWithTimeout.inProgressState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          expect(setTimeout.getCall(0).args[1]).to.equal(th.validTaskSpecWithTimeout.timeout);
          spy.restore();
          done();
        } catch (errorB) {
          spy.restore();
          done(errorB);
        }
      });
    });

    it('should clear timeouts when a task timeout is not set and a timeout exists', function(done) {
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      var testRef = queueRef.push({
        '_state': th.validTaskSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime()
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          qw.setTaskSpec();
          expect(qw.expiryTimeouts).to.deep.equal({});
          done();
        } catch (errorB) {
          done(errorB);
        }
      });
    });

    it('should clear a timeout when an item is completed', function(done) {
      var spy = sinon.spy(qw, '_resetItem');
      var taskSpec = _.clone(th.validTaskSpecWithTimeout);
      taskSpec.finishedState = th.validTaskSpecWithFinishedState.finishedState;
      qw.setTaskSpec(taskSpec);
      var testRef = queueRef.push({
        '_state': taskSpec.inProgressState,
        '_state_changed': new Date().getTime()
      }, function(errorA) {
        if (errorA) {
          spy.restore();
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          testRef.update({
            '_state': taskSpec.finishedState
          }, function(errorB) {
            if (errorB) {
              return done(errorB);
            }
            try {
              expect(qw.expiryTimeouts).to.deep.equal({});
              expect(qw._resetItem).to.not.have.been.called;
              spy.restore();
              done();
            } catch (errorC) {
              spy.restore();
              done(errorC);
            }
          });
        } catch (errorD) {
          spy.restore();
          done(errorD);
        }
      });
    });
  });

  describe('#_isValidTaskSpec', function() {
    var qw;

    before(function() {
      qw = new th.QueueWorker(queueRef, '0', true, _.noop);
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

    it('should accept a valid task spec with a startState, a finishedState, an errorState, and a timeout', function() {
      expect(qw._isValidTaskSpec(th.validTaskSpecWithEverything)).to.be.true;
    });

    it('should accept a valid basic task spec with null parameters for everything else', function() {
      var taskSpec = _.clone(th.validBasicTaskSpec);
      taskSpec = _.assign(taskSpec, {
        startState: null,
        finishedState: null,
        errorState: null,
        timeout: null
      });
      expect(qw._isValidTaskSpec(taskSpec)).to.be.true;
    });

  });

  describe('#setTaskSpec', function() {
    var qw;

    afterEach(function(done) {
      qw.setTaskSpec();
      queueRef.set(null, done);
    });

    it('should reset the worker when called with an invalid task spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidTaskSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidTaskSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.taskTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset the worker when called with an invalid task spec after a valid task spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidTaskSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        qw.setTaskSpec(th.validBasicTaskSpec);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidTaskSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.taskTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset the worker when called with an invalid task spec after a valid task spec with everythin', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidTaskSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        qw.setTaskSpec(th.validTaskSpecWithEverything);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidTaskSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.taskTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset a worker when called with a basic valid task spec', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validBasicTaskSpec);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validBasicTaskSpec.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.taskTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with a startState', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithStartState);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.equal(th.validTaskSpecWithStartState.startState);
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithStartState.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.taskTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with a finishedState', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithFinishedState);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithFinishedState.inProgressState);
      expect(qw.finishedState).to.equal(th.validTaskSpecWithFinishedState.finishedState);
      expect(qw.taskTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with a timeout', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithTimeout);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithTimeout.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.taskTimeout).to.equal(th.validTaskSpecWithTimeout.timeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid task spec with everything', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validTaskSpecWithEverything);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.equal(th.validTaskSpecWithEverything.startState);
      expect(qw.inProgressState).to.equal(th.validTaskSpecWithEverything.inProgressState);
      expect(qw.finishedState).to.equal(th.validTaskSpecWithEverything.finishedState);
      expect(qw.taskTimeout).to.equal(th.validTaskSpecWithEverything.timeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should not pick up items on the queue not for the current item', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
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
      queueRef.push({ '_state': 'other' }, function(error) {
        if (error) {
          return done(error);
        }
      });
    });

    it('should pick up items on the queue with no "_state" when a task is specified without a startState', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicTaskSpec);
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

    it('should pick up items on the queue with the corresponding "_state" when a task is specifies a startState', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validTaskSpecWithStartState);
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
      ref.set({ '_state': th.validTaskSpecWithStartState.startState });
    });
  });
});
