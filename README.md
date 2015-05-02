# Firebase Queue

A fault-tolerant, multi-worker, multi-stage job pipeline based on Firebase.

## The Queue in Firebase

Provide a location in your Firebase for the queue to operate in e.g. `https://yourapp.firebaseio.com/location`. This location will have a `queue` subtree and an optional `jobs` subtree
```
location
  -> jobs
  -> queue
```

## Queue Workers

Start a worker process by passing in a Firebase [`ref`](https://www.firebase.com/docs/web/guide/understanding-data.html#section-creating-references) along with a processing function that takes four parameters:
  - `data` a plain JavaScript object containing the claimed item's data,
  - `progress()` a callback function for reporting back job progress,
  - `resolve()` a callback function for reporting successful job completion,
  - `reject()` a callback for reporting a job error

```js
// my_queue_worker.js

var Queue = require('firebase-queue'),
    Firebase = require('firebase');

var ref = new Firebase('https://yourapp.firebaseio.com/location');
var queue = new Queue(ref, function(data, progress, resolve, reject) {
  // Read and process item data
  console.log(data);

  // Do some work
  progress(50);

  setTimeout(function() {
    // Finish the job asynchronously
    resolve({ 'foo': 'baz' });
  }, 1000);
});
```

```shell
node my_queue_worker.js
```


Multiple queue workers can be initialized on multiple machines and Firebase-Queue will ensure that only one worker is processing a single queue item at a time.

#### Queue Worker Options

Queue workers can take an optional options object to specify:
  - `jobId` - specifies the job type for this worker
  - `numWorkers` - specifies the number of workers to run simultaneously for this node.js thread. Defaults to 1 worker.

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

## Pushing Items Onto the Queue

Using any Firebase client or the REST API, push an object with some metadata onto the `queue` subtree of your Firebase. Queue Workers listening on that subtree will automatically pick up and process the item.

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

A default job configuration is assumed if no jobs are specified in the `jobs` subtree in the Firebase. The default job has the following characteristics:

```json
{
  "default_job" : {
    "start_state" : null,
    "in_progress_state" : "in_progress",
    "finished_state" : null,
    "error_state": "error",
    "timeout" : 300000
  }
}
```

- `start_state` - The default job has no "start_state", which means any job pushed onto the `queue` subtree without a `_state` key will be picked up by default job workers. If it is specified, only jobs with that `_state` may be claimed by the worker.
- `in_progress_state` - When a worker picks up a job and begins processing it, it will change the job's `_state` to the value of `in_progress_state`. This is the only required job property, and it cannot equal the `start_state` or the `finished_state`.
- `finished_state` - The default job has no "finished_state" and so will remove items from the queue if they complete successfully. If it is specified, when a job completes successfully the job's `_state` value will be updated to this option. This can be useful for chaining jobs by setting this to the same as another job's "start_state".
- `error_state` - If the job gets rejected the `_state` will be updated to this value and an additional key `_error_details` will be populated with the `previousState` and an optional error message from the `reject()` callback. If this isn't specified, it defaults to "error". This can be useful for specifying different error states for different jobs, or chaining errors so that they can be logged.
- `timeout` - The default timeout is 5 minutes. When a job has been claimed by a worker but has not completed within `timeout` milliseconds, other jobs will report that job as timed out, and reset that job to be claimable once again. If this is not specified a job will be claimed at most once and never leave that state if the worker processing it fails during the process.

#### Custom Jobs and Job Chaining

In order to use a job specification other than the default, the specification must be defined in the Firebase under the `jobs` subtree. This allows us to coordinate job specification changes between workers and enforce expected behavior with Firebase security rules.

In this example, we're chaining three jobs. New items pushed onto the queue without a `_state` key will be picked up by "job_1" and go into the `job_1_in_progress` state. Once "job_1" completes and the item goes into the `job_1_finished` state, "job_2" takes over and puts it into the `job_2_in_progress` state. Again, once "job_2" completes and the item goes into the `job_2_finished` state, "job_3" takes over and puts it into the `job_3_in_progress` state and finally removes it once completed. If, during any stage in the process there's an error, the item will end up in an `error` state.

```
location
  -> jobs
```
```json
{
  "job_1" : {
    "in_progress_state" : "job_1_in_progress",
    "finished_state" : "job_1_finished",
    "timeout" : 5000
  },
  "job_2" : {
    "start_state" : "job_1_finished",
    "in_progress_state" : "job_2_in_progress",
    "finished_state" : "job_2_finished",
    "timeout" : 20000
  },
  "job_3" : {
    "start_state" : "job_2_finished",
    "in_progress_state" : "job_3_in_progress",
    "timeout" : 3000
  }
}
```
