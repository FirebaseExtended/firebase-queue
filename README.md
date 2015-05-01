# Firebase Queue

A fault-tolerant, multi-worker, multi-stage job pipeline based on Firebase.

## The Queue in Firebase

Provide a location in your Firebase for the queue to operate in e.g. `https://yourapp.firebaseio.com/location`.  This location will have a `queue` subtree and an optional `jobs` subtree
```
location
  -> jobs
  -> queue
```

## Queue Workers

Start a worker process by passing in a Firebase [`ref`](https://www.firebase.com/docs/web/guide/understanding-data.html#section-creating-references) along with a processing function that takes a snapshot of the queue item, and three callback functions:
  - `progress()` for reporting back job progress,
  - `resolve()` for reporting successful job completion,
  - `reject()` for reporting job error

```js
// queue-worker.js

var Queue = require('firebase-queue'),
    Firebase = require('firebase');

var ref = new Firebase('https://yourapp.firebaseio.com/location');
var queue = new Queue(ref, function(data, progress, resolve, reject) {
  // Read and process job data
  console.log(data);

  // Do some work
  progress(50);

  // Finish the job
  resolve({ 'foo': 'baz' });
});
```

```shell
node queue-worker.js
```


Multiple queue workers can be initialized on multiple machines and Firebase-Queue will ensure that only one worker is processing a single queue item at a time.

#### Queue Worker Options

Queue workers can take an optional options object to specify:
  - `jobId` - specifies the job type for this worker
  - `numWorkers` - specifies the number of workers to run simultaneously for this node.js thread.  Defaults to 1 worker.

```js
...

var options = {
  'jobId': 'job_1',
  'numWorkers': 5
};
var queue = new Queue(ref, options, function(data, progress, resolve, reject) {
  ...
});
```

## Pushing Jobs Onto the Queue

Using any Firebase client or the REST API, push an object with some metadata onto the `queue` subtree of your Firebase.  Queue Workers listening on that subtree will automatically pick up and process the job.

```shell
# Using curl in shell
curl -X POST -d '{"foo": "bar"}' https://yourapp.firebaseio.com/location/queue.json
```
or
```js
// Firebase Javascript Client
var Firebase = require('firebase');

var ref = new Firebase('https://yourapp.firebaseio.com/location/queue');
ref.push({'foo':'bar'});
```

## Defining Jobs (Optional)

#### Default Job

A default job configuration is assumed if no jobs are specified in the `jobs` subtree.  The default job has the following characteristics:

```json
{
  "default_job" : {
    "state_start" : null,
    "state_finished" : "finished",
    "state_in_progress" : "in_progress",
    "timeout" : 360000
  }
}
```

- `state_start` - The default job has no "state_start".  Which means any job pushed onto the `queue` subtree without a `_state` key will be picked up by default job workers.
- `state_in_progress` - When a worker picks up a job and begins processing it, it will change the job's `_state` to the value of `state_in_progress`
- `state_finished` - When a worker completes a job, it will change the job's `_state` to the value of `state_finished`
- `timeout` - When a job has been claimed by a worker and has not completed or errored after `timeout` milliseconds, other jobs will report that job as timed out, and reset that job to be claimable by other workers.  

#### Custom Jobs and Job Chaining

Custom jobs may be defined to coordinate different jobs for different workers.  In this jobs example, we're chaining jobs.  New jobs start in `job_1_ready` state, and on completion they become `job_1_finished` which is the start state for `job_2`.

```
location
  -> jobs
```
```json
{
  "job_1" : {
    "state_finished" : "job_1_finished",
    "state_in_progress" : "job_1_in_progress",
    "state_start" : "job_1_ready",
    "timeout" : 5000
  },
  "job_2" : {
    "state_finished" : "job_2_finished",
    "state_in_progress" : "job_2_in_progress",
    "state_start" : "job_1_finished",
    "timeout" : 9000
  }
}
```
