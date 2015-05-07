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
      qw.setTaskSpec(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
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
      qw.setTaskSpec(th.validBasicJobSpec);

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
        '_state': th.validJobSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
      qw.setTaskSpec(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
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
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
      testRef = queueRef.push({
        '_state': th.validJobSpecWithFinishedState.inProgressState,
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
              expect(item['_state']).to.equal(th.validJobSpecWithFinishedState.finishedState);
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
        qw.setTaskSpec(th.validJobSpecWithFinishedState);
        testRef = queueRef.push({
          '_state': th.validJobSpecWithFinishedState.inProgressState,
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
                expect(item['_state']).to.equal(th.validJobSpecWithFinishedState.finishedState);
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
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
      testRef = queueRef.push({
        '_state': th.validJobSpecWithFinishedState.inProgressState,
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
              expect(item['_state']).to.equal(th.validJobSpecWithFinishedState.finishedState);
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
      qw.setTaskSpec(th.validJobSpecWithFinishedState);

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
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
        '_state': th.validJobSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId  + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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

    it('should not resolve an item if a new job is being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
      qw.setTaskSpec(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
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
              expect(item['_error_details'].previous_state).to.equal(th.validBasicJobSpec.inProgressState);
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
      qw.setTaskSpec(th.validJobSpecWithErrorState);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
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
              expect(item['_state']).to.equal(th.validJobSpecWithErrorState.errorState);
              expect(item['_state_changed']).to.be.closeTo(new Date().getTime() + th.offset, 250);
              expect(item['_progress']).to.equal(0);
              expect(item['_error_details']).to.have.all.keys(['previous_state']);
              expect(item['_error_details'].previous_state).to.equal(th.validBasicJobSpec.inProgressState);
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
        qw.setTaskSpec(th.validBasicJobSpec);
        testRef = queueRef.push({
          '_state': th.validBasicJobSpec.inProgressState,
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
                expect(item['_error_details'].previous_state).to.equal(th.validBasicJobSpec.inProgressState);
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
      qw.setTaskSpec(th.validBasicJobSpec);
      testRef = queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
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
              expect(item['_error_details'].previous_state).to.equal(th.validBasicJobSpec.inProgressState);
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
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': 'other_worker',
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
        '_state': th.validJobSpecWithFinishedState.finishedState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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

    it('should not reject an item if a new job is being processed', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var originalItem = {
        '_state': th.validJobSpecWithFinishedState.inProgressState,
        '_state_changed': new Date().getTime(),
        '_owner': qw.processId + ':' + qw.taskNumber,
        '_progress': 0
      };
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
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
      qw.setTaskSpec(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': 'someone_else' }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the worker is no longer processing it', function(done) {
      qw.setTaskSpec(th.validBasicJobSpec);
      queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - no item currently being processed').notify(done);
      });
    });

    it('should not update the progress of an item if the item is no longer in progress', function(done) {
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
      qw.currentItemRef = queueRef.push({ '_state': th.validJobSpecWithFinishedState.finishedState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current item no longer owned by this process').notify(done);
      });
    });

    it('should not update the progress of an item if the item has no _state', function(done) {
      qw.setTaskSpec(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.rejectedWith('Can\'t update progress - current item no longer owned by this process').notify(done);
      });
    });

    it('should update the progress of the current item', function(done) {
      qw.setTaskSpec(th.validBasicJobSpec);
      qw.currentItemRef = queueRef.push({ '_state': th.validBasicJobSpec.inProgressState, '_owner': qw.processId + ':' + qw.taskNumber }, function(error) {
        if (error) {
          return done(error);
        }
        qw._updateProgress(qw.taskNumber)(10).should.eventually.be.fulfilled.notify(done);
      });
    });

    it('should not update the progress of an item if a new item is being processed', function(done) {
      qw.setTaskSpec(th.validBasicJobSpec);
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
      qw.startState = th.validJobSpecWithStartState.startState;
      qw.inProgressState = th.validJobSpecWithStartState.inProgressState;
      qw.busy = true;
      var testRef = queueRef.push({
        '_state': th.validJobSpecWithStartState.startState
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
      qw.startState = th.validJobSpecWithStartState.startState;
      qw.inProgressState = th.validJobSpecWithStartState.inProgressState;
      var testRef = queueRef.push({
        '_state': th.validJobSpecWithStartState.startState
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
      qw.inProgressState = th.validBasicJobSpec.inProgressState;
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
      qw.inProgressState = th.validJobSpecWithStartState.inProgressState;
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
      qw.startState = th.validJobSpecWithStartState.startState;
      qw.inProgressState = th.validJobSpecWithStartState.inProgressState;
      var testRef = queueRef.push({
        '_state': th.validJobSpecWithStartState.inProgressState
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
      qw.startState = th.validJobSpecWithStartState.startState;
      qw.inProgressState = th.validJobSpecWithStartState.inProgressState;
      var testRef = queueRef.push({
        '_state': th.validJobSpecWithStartState.startState
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
      qw.setTaskSpec(th.validBasicJobSpec);
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
      qw.setTaskSpec(th.validBasicJobSpec);
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

    it('should not set up timeouts when no job timeout is set', function(done) {
      qw.setTaskSpec(th.validBasicJobSpec);
      queueRef.push({
        '_state': th.validBasicJobSpec.inProgressState,
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

    it('should not set up timeouts when an item not in progress is added and a job timeout is set', function(done) {
      qw.setTaskSpec(th.validJobSpecWithTimeout);
      queueRef.push({
        '_state': th.validJobSpecWithFinishedState.finishedState,
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

    it('should set up timeout listeners when a job timeout is set', function() {
      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.be.null;
      expect(qw.processingItemAddedListener).to.be.null;
      expect(qw.processingItemRemovedListener).to.be.null;

      qw.setTaskSpec(th.validJobSpecWithTimeout);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.not.be.null;
      expect(qw.processingItemAddedListener).to.not.be.null;
      expect(qw.processingItemRemovedListener).to.not.be.null;
    });

    it('should remove timeout listeners when a job timeout is not specified after a previous job specified a timeout', function() {
      qw.setTaskSpec(th.validJobSpecWithTimeout);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.not.be.null;
      expect(qw.processingItemAddedListener).to.not.be.null;
      expect(qw.processingItemRemovedListener).to.not.be.null;

      qw.setTaskSpec(th.validBasicJobSpec);

      expect(qw.expiryTimeouts).to.deep.equal({});
      expect(qw.processingItemsRef).to.be.null;
      expect(qw.processingItemAddedListener).to.be.null;
      expect(qw.processingItemRemovedListener).to.be.null;
    });

    it('should set up a timeout when a job timeout is set and an item added', function(done) {
      var spy = sinon.spy(global, 'setTimeout');
      qw.setTaskSpec(th.validJobSpecWithTimeout);
      var testRef = queueRef.push({
        '_state': th.validJobSpecWithTimeout.inProgressState,
        '_state_changed': new Date().getTime() - 5
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          expect(setTimeout.getCall(0).args[1]).to.equal(th.validJobSpecWithTimeout.timeout - 5);
          spy.restore();
          done();
        } catch (errorB) {
          spy.restore();
          done(errorB);
        }
      });
    });

    it('should set up a timeout when a job timeout is set and an item owner changed', function(done) {
      qw.setTaskSpec(th.validJobSpecWithTimeout);
      var testRef = queueRef.push({
        '_owner': qw.processId + ':0',
        '_state': th.validJobSpecWithTimeout.inProgressState,
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
              expect(setTimeout.getCall(setTimeout.callCount - 1).args[1]).to.equal(th.validJobSpecWithTimeout.timeout - 5);
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

    it('should not set up a timeout when a job timeout is set and an item updated', function(done) {
      qw.setTaskSpec(th.validJobSpecWithTimeout);
      var spy = sinon.spy(global, 'setTimeout');
      var testRef = queueRef.push({
        '_owner': qw.processId + ':0',
        '_progress': 0,
        '_state': th.validJobSpecWithTimeout.inProgressState,
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
              expect(setTimeout.getCall(0).args[1]).to.equal(th.validJobSpecWithTimeout.timeout - 5);
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

    it('should set up a timeout when a job timeout is set and an item added without a _state_changed time', function(done) {
      var spy = sinon.spy(global, 'setTimeout');
      qw.setTaskSpec(th.validJobSpecWithTimeout);
      var testRef = queueRef.push({
        '_state': th.validJobSpecWithTimeout.inProgressState
      }, function(errorA) {
        if (errorA) {
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          expect(setTimeout.getCall(0).args[1]).to.equal(th.validJobSpecWithTimeout.timeout);
          spy.restore();
          done();
        } catch (errorB) {
          spy.restore();
          done(errorB);
        }
      });
    });

    it('should clear timeouts when a job timeout is not set and a timeout exists', function(done) {
      qw.setTaskSpec(th.validJobSpecWithTimeout);
      var testRef = queueRef.push({
        '_state': th.validJobSpecWithTimeout.inProgressState,
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
      var jobSpec = _.clone(th.validJobSpecWithTimeout);
      jobSpec.finishedState = th.validJobSpecWithFinishedState.finishedState;
      qw.setTaskSpec(jobSpec);
      var testRef = queueRef.push({
        '_state': jobSpec.inProgressState,
        '_state_changed': new Date().getTime()
      }, function(errorA) {
        if (errorA) {
          spy.restore();
          return done(errorA);
        }
        try {
          expect(qw.expiryTimeouts).to.have.all.keys([testRef.key()]);
          testRef.update({
            '_state': jobSpec.finishedState
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

  describe('#_isValidJobSpec', function() {
    var qw;

    before(function() {
      qw = new th.QueueWorker(queueRef, '0', true, _.noop);
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
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.finishedState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a finishedState that is not a string as a valid job spec', function() {
      [NaN, Infinity, true, false, 0, 1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonStringObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.errorState = nonStringObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should not accept a timeout that is not a positive integer as a valid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, 0, -1, 1.1, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(nonPositiveIntigerObject) {
        var jobSpec = _.clone(th.validBasicJobSpec);
        jobSpec.timeout = nonPositiveIntigerObject;
        expect(qw._isValidJobSpec(jobSpec)).to.be.false;
      });
    });

    it('should accept a valid job spec without a timeout', function() {
      expect(qw._isValidJobSpec(th.validBasicJobSpec)).to.be.true;
    });

    it('should accept a valid job spec with a startState', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithStartState)).to.be.true;
    });

    it('should not accept a jobSpec with the same startState and inProgressState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.startState = jobSpec.inProgressState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should accept a valid job spec with a finishedState', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithFinishedState)).to.be.true;
    });

    it('should not accept a jobSpec with the same finishedState and inProgressState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.finishedState = jobSpec.inProgressState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should accept a valid job spec with a errorState', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithErrorState)).to.be.true;
    });

    it('should not accept a jobSpec with the same errorState and inProgressState', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec.errorState = jobSpec.inProgressState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should accept a valid job spec with a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithTimeout)).to.be.true;
    });

    it('should not accept a jobSpec with the same startState and finishedState', function() {
      var jobSpec = _.clone(th.validJobSpecWithFinishedState);
      jobSpec.startState = jobSpec.finishedState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.false;
    });

    it('should accept a jobSpec with the same errorState and startState', function() {
      var jobSpec = _.clone(th.validJobSpecWithStartState);
      jobSpec.errorState = jobSpec.startState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.true;
    });

    it('should accept a jobSpec with the same errorState and finishedState', function() {
      var jobSpec = _.clone(th.validJobSpecWithFinishedState);
      jobSpec.errorState = jobSpec.finishedState;
      expect(qw._isValidJobSpec(jobSpec)).to.be.true;
    });

    it('should accept a valid job spec with a startState, a finishedState, an errorState, and a timeout', function() {
      expect(qw._isValidJobSpec(th.validJobSpecWithEverything)).to.be.true;
    });

    it('should accept a valid basic job spec with null parameters for everything else', function() {
      var jobSpec = _.clone(th.validBasicJobSpec);
      jobSpec = _.assign(jobSpec, {
        startState: null,
        finishedState: null,
        errorState: null,
        timeout: null
      });
      expect(qw._isValidJobSpec(jobSpec)).to.be.true;
    });

  });

  describe('#setTaskSpec', function() {
    var qw;

    afterEach(function(done) {
      qw.setTaskSpec();
      queueRef.set(null, done);
    });

    it('should reset the worker when called with an invalid job spec', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidJobSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
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
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        qw.setTaskSpec(th.validBasicJobSpec);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidJobSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
        expect(qw.startState).to.be.null;
        expect(qw.inProgressState).to.be.null;
        expect(qw.finishedState).to.be.null;
        expect(qw.jobTimeout).to.be.null;
        expect(qw.newItemRef).to.be.null;
        expect(qw.newItemListener).to.be.null;
        expect(qw.expiryTimeouts).to.deep.equal({});
      });
    });

    it('should reset the worker when called with an invalid job spec after a valid job spec with everythin', function() {
      ['', 'foo', NaN, Infinity, true, false, null, undefined, 0, -1, 10, ['foo', 'bar'], { foo: 'bar' }, { foo: 'bar' }, { foo: { bar: { baz: true } } }, _.noop].forEach(function(invalidJobSpec) {
        qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
        qw.setTaskSpec(th.validJobSpecWithEverything);
        var oldTaskNumber = qw.taskNumber;
        qw.setTaskSpec(invalidJobSpec);
        expect(qw.taskNumber).to.not.equal(oldTaskNumber);
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
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validBasicJobSpec);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validBasicJobSpec.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a startState', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validJobSpecWithStartState);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.equal(th.validJobSpecWithStartState.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithStartState.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a finishedState', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validJobSpecWithFinishedState);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validJobSpecWithFinishedState.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithFinishedState.finishedState);
      expect(qw.jobTimeout).to.be.null;
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with a timeout', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validJobSpecWithTimeout);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.be.null;
      expect(qw.inProgressState).to.equal(th.validJobSpecWithTimeout.inProgressState);
      expect(qw.finishedState).to.be.null;
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithTimeout.timeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should reset a worker when called with a valid job spec with everything', function() {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      var oldTaskNumber = qw.taskNumber;
      qw.setTaskSpec(th.validJobSpecWithEverything);
      expect(qw.taskNumber).to.not.equal(oldTaskNumber);
      expect(qw.startState).to.equal(th.validJobSpecWithEverything.startState);
      expect(qw.inProgressState).to.equal(th.validJobSpecWithEverything.inProgressState);
      expect(qw.finishedState).to.equal(th.validJobSpecWithEverything.finishedState);
      expect(qw.jobTimeout).to.equal(th.validJobSpecWithEverything.timeout);
      expect(qw.newItemRef).to.have.property('on').and.be.a('function');
      expect(qw.newItemListener).to.be.a('function');
      expect(qw.expiryTimeouts).to.deep.equal({});
    });

    it('should not pick up items on the queue not for the current item', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicJobSpec);
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

    it('should pick up items on the queue with no "_state" when a job is specified without a startState', function(done) {
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validBasicJobSpec);
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
      qw = new th.QueueWorkerWithoutProcessingOrTimeouts(queueRef, '0', true, _.noop);
      qw.setTaskSpec(th.validJobSpecWithStartState);
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
});
