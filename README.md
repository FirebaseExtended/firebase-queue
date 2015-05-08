# Firebase Queue

A fault-tolerant, multi-worker, multi-stage job pipeline built on Firebase.


## The Queue in Firebase

The queue relies on having a Firebase reference to coordinate workers e.g. `https://<your-firebase>.firebaseio.com/location`. The queue will respond to items pushed onto the `queue` subtree and optionally read specifications from a `jobs` subtree
```
location
  -> jobs
  -> queue
```


## Queue Workers

Start a worker process by passing in a Firebase [`ref`](https://www.firebase.com/docs/web/guide/understanding-data.html#section-creating-references) along with a processing function ([described below](#the-processing-function)):

```js
// my_queue_worker.js

var Queue = require('firebase-queue'),
    Firebase = require('firebase');

var ref = new Firebase('https://<your-firebase>.firebaseio.com/location');
var queue = new Queue(ref, function(data, progress, resolve, reject) {
  // Read and process item data
  console.log(data);

  // Do some work
  progress(50);

  // Finish the job asynchronously
  setTimeout(function() {
    resolve();
  }, 1000);
});
```

```shell
node my_queue_worker.js
```

Multiple queue workers can be initialized on multiple machines and Firebase-Queue will ensure that only one worker is processing a single queue item at a time.


#### Queue Worker Options

Queue workers can take an optional options object to specify:
  - `jobId` - specifies the job type for this worker.
  - `numWorkers` - specifies the number of workers to run simultaneously for this node.js thread. Defaults to 1 worker.
  - `sanitize` - specifies whether the `data` object passed to the processing function is sanitized of internal keys reserved for use by the queue. Defaults to `true`.

```js
...

var options = {
  'jobId': 'job_1',
  'numWorkers': 5,
  'sanitize': false
};
var queue = new Queue(ref, options, function(data, progress, resolve, reject) {
  ...
});
```


## Pushing Items Onto the Queue

Using any Firebase client or the REST API, push an object with some data onto the `queue` subtree of your Firebase. Queue Workers listening on that subtree will automatically pick up and process the item.

```shell
# Using curl in shell
curl -X POST -d '{"foo": "bar"}' https://<your-firebase>.firebaseio.com/location/queue.json
```
or
```js
// Firebase Javascript Client
var Firebase = require('firebase');

var ref = new Firebase('https://<your-firebase>.firebaseio.com/location/queue');
ref.push({'foo':'bar'});
```


## The Processing Function

When defining a queue worker, a callback function to process a queue item must be provided. It should take the following four parameters

#### `data`

A plain JavaScript object containing the claimed item's data. By default the data is sanitized of the internal keys the queue uses to keep track of the data, but you can disable this behavior by setting `'sanitize': false` in the queue options.

The reserved keys are:
 - `_state` - The current state of the item. Will always be the job's `in_progress_state` when passed to the processing function.
 - `_state_changed` - The timestamp that the item changed into its current state. This will always be close to the time the processing function was called.
 - `_owner` - A unique ID for the worker and job number combination to ensure only one worker is responsible for the item at any time.
 - `_progress` - A number between 0 and 100, reset at the start of each job to 0.
 - `_error_details` - An object optionally present, containing the error details from a previous job. If present, it will contain a `previous_state` string capturing the state the item was in when it errored, and an optional `error` string from the `reject()` callback of the previous job.

#### `progress()`

A callback function for reporting the progress of the job. `progress()` takes a single parameter that must be a number between 0 and 100, and returns a [RSVP.Promise](https://github.com/tildeio/rsvp.js) that's fulfilled when successfully updated. If this promise is rejected, it's likely that the item is no longer owned by this process (perhaps it has timed out or the job specification has changed) or the worker has lost its connection to Firebase.

By catching when this call fails and cancelling the current job early, the worker can minimize the extra work it does and return to processing new queue items sooner:

```js
...
var queue = new Queue(ref, options, function(data, progress, resolve, reject) {
  ...
  function stopProcessing() {
    ...
  }
  ...
  // report current progress
  progress(currentProgress).catch(function(error) {
    // we've lost the current queue item, so stop processing
    stopProcessing();

    // and reject the item so that we can pick up new items
    reject(error);
  });
  ...
});
```

#### `resolve()`

A callback function for reporting that the current item has been completed and the worker is ready to process another item. If the current job specification has a `finished_state`, any plain JavaScript object passed into the `resolve()` function will be written to the queue item location and will be available to the next job if the jobs are chained.

#### `reject()`

A callback function for reporting that the current item failed and the worker is ready to process another item. Once this is called, the item will go into the `error_state` for the job with an additional `_error_details` object containing a `previous_state` key referencing this job's `in_progress_state`. If a string is passed into the `reject()` function, the `_error_details` will also contain an `error` key containing that string.

## Queue Security

Securing your queue is an important step in securely processing events that come in. Below is a sample set of security rules that can be tailored to your particular use case.

```json
{
  "rules": {
    "location": {
      "queue": {
        ".read": "auth.hasPrivilege",
        ".write": "auth.hasPrivilege",
        ".indexOn": "_state",
        "_state": {
          ".validate": "newData.isString()"
        },
        "_state_changed": {
          ".validate": "newData.isNumber()"
        },
        "_owner": {
          ".validate": "newData.isString()"
        },
        "_progress": {
          ".validate": "newData.isNumber() && newData >= 0 && newData <= 100"
        },
        "_error_details": {
          ".validate": "/* Insert custom error validation code here */"
        },
        "$data": {
          ".write": "auth!=null",
          ".validate": "/* Insert custom data validation code here */"
        },
      },
      "jobs" : {
        ".read": "auth.hasPrivilege",
        ".write": "auth.hasPrivilege",
        "$jobID": {
          "start_state": {
            ".validate": "newData.isString() || !newData.exists()"
          },
          "in_progress_state": {
            ".validate": "newData.isString()"
          },
          "finished_state": {
            ".validate": "newData.isString() || !newData.exists()"
          },
          "error_state": {
            ".validate": "newData.isString() || !newData.exists()"
          },
          "timeout": {
            ".validate": "(newData.isNumber() && newData.val() > 0) || !newData.exists()"
          },
          "$other": {
            ".validate": false
          }
        }
      }
    }
  }
}
```

In this example, there are two categories of users, regularly authenticated users and privileged users (tokens with `hasPrivilege == true` in this case). Regular users can write data to the queue, while privileged users can process that work and create new job specifications. In most cases, privileged users should be running on trusted servers. One can add an additional level of privilege to make job viewing and creation only available to a different group.

## Defining Jobs (Optional)

#### Default Job

A default job configuration is assumed if no jobs are specified in the `jobs` subtree in the Firebase. The default job has the following characteristics:

```js
{
  "default_job": {
    "start_state": null,
    "in_progress_state": "in_progress",
    "finished_state": null,
    "error_state": "error",
    "timeout": 300000 // 5 minutes
  }
}
```

- `start_state` - The default job has no `start_state`, which means any job pushed onto the `queue` subtree without a `_state` key will be picked up by default job workers. If `start_state` is specified, only jobs with that `_state` may be claimed by the worker.
- `in_progress_state` - When a worker picks up a job and begins processing it, it will change the job's `_state` to the value of `in_progress_state`. This is the only required job property, and it cannot equal the `start_state`, the `finished_state`, or the `error_state`.
- `finished_state` - The default job has no `finished_state` and so the worker will remove items from the queue upon successful completion. If `finished_state` is specified, then the job's `_state` value will be updated to the `finished_state` upon job completion. Setting this value to another job's `start_state` is useful for chaining jobs together.
- `error_state` - If the job gets rejected the `_state` will be updated to this value and an additional key `_error_details` will be populated with the `previousState` and an optional error message from the `reject()` callback. If this isn't specified, it defaults to "error". This can be useful for specifying different error states for different jobs, or chaining errors so that they can be logged.
- `timeout` - The default timeout is 5 minutes. When a job has been claimed by a worker but has not completed within `timeout` milliseconds, other jobs will report that job as timed out, and reset that job to be claimable once again. If this is not specified a job will be claimed at most once and never leave that state if the worker processing it fails during the process.

#### Custom Jobs and Job Chaining

In order to use a job specification other than the default, the specification must be defined in the Firebase under the `jobs` subtree. This allows us to coordinate job specification changes between workers and enforce expected behavior with Firebase security rules.

In this example, we're chaining three jobs. New items pushed onto the queue without a `_state` key will be picked up by "job_1" and go into the `job_1_in_progress` state. Once "job_1" completes and the item goes into the `job_1_finished` state, "job_2" takes over and puts it into the `job_2_in_progress` state. Again, once "job_2" completes and the item goes into the `job_2_finished` state, "job_3" takes over and puts it into the `job_3_in_progress` state. Finally, "job_3" removes it once complete. If, during any stage in the process there's an error, the item will end up in an "error" state.

```
location
  -> jobs
```
```json
{
  "job_1": {
    "in_progress_state": "job_1_in_progress",
    "finished_state": "job_1_finished",
    "timeout": 5000
  },
  "job_2": {
    "start_state": "job_1_finished",
    "in_progress_state": "job_2_in_progress",
    "finished_state": "job_2_finished",
    "timeout" : 20000
  },
  "job_3": {
    "start_state": "job_2_finished",
    "in_progress_state": "job_3_in_progress",
    "timeout": 3000
  }
}
```
