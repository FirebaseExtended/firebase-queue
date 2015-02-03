# Firebase Queue

A fault-tolerant, multi-worker, multi-stage job pipeline based on Firebase.

## The Queue

The queue itself will be a location in a Firebase of your choosing that the
items will be pushed to. e.g. `https://yourapp.firebaseio.com/`

## Defining Jobs

To get started first you'll need to define your jobs. The job definitions should
be placed in an object with the name `jobs` in the Firebase as a sibling to
your queue location. e.g. assuming the queue location of
`https://yourapp.firebaseio.com/queue`, the job definition should be defined at
`https://yourapp.firebaseio.com/jobs` and have the form:

```json
{
  "job_1" : {
    "state" : {
      "finished" : "job_1_finished",
      "inProgress" : "job_1_in_progress",
      "start" : "job_1_ready"
    },
    "timeout" : 5000
  },
  "job_2" : {
    "state" : {
      "finished" : "job_2_finished",
      "inProgress" : "job_2_in_progress",
      "start" : "job_1_finished"
    },
    "timeout" : 9000
  }
}
```

`state/inProgress` and `state/finished` are required for each job, but
`state/start` and `timeout` are optional. If the start state of the job is
omitted, the workers will match any item in the list without a `_state`
parameter, and if `timeout` is omitted, each job will only ever be attempted
once.

Currently omitting `state/start` is broken, but a fix to the client should be
coming soon.

Here we're chaining jobs by specifying the same `state/start` for `job_2` as
`state/finished` for `job_1`. If any job errors, the `_state` parameter is set
to `error`.

## Custom Tokens

In order for a worker to know which job it is acting as, it must be passed an
access token to the Firebase with the `uid` set to the job ID matching the
job definition. See our [Custom Authentication Guide](https://www.firebase.com/docs/web/guide/login/custom.html)

## Creating Workers

Initializing the workers is fairly simple, simply specify the location of the
queue, give it an access token, number of processes to run, and a processing
function that takes a snapshot of the queue item, and three callback functions -
one for reporting back progress, one if the function completes successfully, and
one for if it errors

```js
var Q = require('firebase-queue');

var queue = new Q(
  'https://yourapp.firebaseio.com/',
  '<token>', // JWT for https://yourapp.firebaseio.com with the job ID as the 'uid'
  5, // number of workers
  function(data, progress, resolve, reject) {
  	// The processing function
    setTimeout(resolve, 2000, {some: "calculated result"});
  });
```

Multiple worker queues can be initialized for different jobs in the same file,
or the same job can be initialized on multiple machines and the queue will
ensure that only one worker is processing a single queue item at a time.

## Pushing Items onto the Queue

The final stage is pushing items onto the queue. Because we're using Firebase
this is the easy bit. From any Firebase client, simply push an object with some
metadata to pass to the first job to the queue location, with the `_state` key
matching the `state/start` of the first job.
