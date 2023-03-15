
![Screenshot](https://raw.github.com/mojolicious/minion.js/main/examples/admin.png?raw=true)

[![](https://github.com/mojolicious/minion.js/workflows/test/badge.svg)](https://github.com/mojolicious/minion.js/actions)
[![Coverage Status](https://coveralls.io/repos/github/mojolicious/minion.js/badge.svg?branch=main)](https://coveralls.io/github/mojolicious/minion.js?branch=main)
[![npm](https://img.shields.io/npm/v/@minionjs/core.svg)](https://www.npmjs.com/package/@minionjs/core)

***Preview Release*** A high performance job queue for Node.js. Written in TypeScript. Also available for
[Perl](https://github.com/mojolicious/minion).

Minion.js comes with support for multiple named queues, priorities, high priority fast lane, delayed jobs,
job dependencies, job progress, job results, retries with backoff, rate limiting, unique jobs, expiring jobs,
statistics, distributed workers, parallel processing, remote control, [mojo.js](https://mojojs.org) admin ui and
multiple backends (such as [PostgreSQL](https://www.postgresql.org)).

```js
import Minion from '@minionjs/core';

// Use the default high performance PostgreSQL backend
const minion = new Minion('postgres://user:password@localhost:5432/database');

// Update the database schema to the latest version
await minion.update();

// Add tasks
minion.addTask('somethingSlow', async (job, ...args) => {
  console.log('This is a background worker process.');
});

// Enqueue jobs
await minion.enqueue('somethingSlow', ['foo', 'bar']);
await minion.enqueue('somethingSlow', [1, 2, 3], {priority: 5});

// Perform jobs for testing
await minion.enqueue('somethingSlow', ['foo', 'bar']);
await minion.performJobs();

// Start a worker to perform up to 12 jobs concurrently
const worker = minion.worker();
worker.status.jobs = 12;
await worker.start();
```

### Job Queue

Job queues allow you to process time and/or computationally intensive tasks in background processes, outside of the
request/response lifecycle of web applications. Among those tasks you'll commonly find image resizing, spam filtering,
HTTP downloads, building tarballs, warming caches and basically everything else you can imagine that's not super fast.

```
Web Applications                      +--------------+                     Minion
|- Node.js [1]       enqueue job ->   |              |   -> dequeue job    |- Worker [1]
|- Node.js [2]                        |  PostgreSQL  |                     |- Worker [2]
|- Node.js [3]   retrieve result <-   |              |   <- store result   |- Worker [3]
+- Node.js [4]                        +--------------+                     |- Worker [4]
                                                                           +- Worker [5]
```

They are not to be confused with time based job schedulers, such as cron or systemd timers. Both serve very different
purposes, and cron jobs are in fact commonly used to enqueue Minion jobs that need to follow a schedule. For example
to perform regular maintenance tasks.

### Consistency

Every new job starts out as `inactive`, then progresses to `active` when it is dequeued by a worker, and finally ends
up as `finished` or `failed`, depending on its result. Every `failed` job can then be retried to progress back to the
`inactive` state and start all over again.

```
                                                   +----------+
                                                   |          |
                                          +----->  | finished |
+----------+            +--------+        |        |          |
|          |            |        |        |        +----------+
| inactive |  ------->  | active |  ------+
|          |            |        |        |        +----------+
+----------+            +--------+        |        |          |
                                          +----->  |  failed  |  -----+
     ^                                             |          |       |
     |                                             +----------+       |
     |                                                                |
     +----------------------------------------------------------------+
```

The system is eventually consistent and will preserve job results for as long as you like, depending on the value of
the `minion.removeAfter` property. But be aware that `failed` results are preserved indefinitely, and need to be
manually removed by an administrator if they are out of automatic retries.

While individual workers can fail in the middle of processing a job, the system will detect this and ensure that no job
is left in an uncertain state, depending on the value of the `minion.missingAfter` property. Jobs that do not get
processed after a certain amount of time, will be considered stuck and fail automatically, depending on the value of
the `minion.stuckAfter` property. So an admin can take a look and resolve the issue.

## Examples

This distribution also contains a great example application you can use for inspiration. The
[link checker](https://github.com/mojolicious/minion.js/tree/main/examples/linkcheck) will show you how to integrate
background jobs into well-structured [mojo.js](https://mojojs.org) applications.

## API

Minion uses a PostgreSQL backend by default, but allows for 3rd party implementations of alternative backends. See the
[PgBackend](https://github.com/mojolicious/minion.js/blob/main/src/pg-backend.ts) class and its
[tests](https://github.com/mojolicious/minion.js/blob/main/test/pg.js) for inspiration.

```js
// Default PostgreSQL backend
const minion = new Minion('postgres://user:password@localhost:5432/database', {
  // Amount of time in milliseconds after which workers without a heartbeat will be considered missing and removed from
  // the registry, defaults to 30 minutes
  missingAfter: 1800000,

  // Amount of time in seconds after which jobs that have reached the state finished and have no unresolved
  // dependencies will be removed automatically by "repair", defaults to 2 days (it is not recommended to set this
  // value below 2 days)
  removeAfter: 172800000,

  // Amount of time in seconds after which jobs that have not been processed will be considered stuck and transition to
  // the failed state, defaults to 2 days
  stuckAfter: 172800000
});

// Custom 3rd party backend
const minion = new Minion('sqlite:test.db', {backendClass: SQLiteBackend});
```

### Enqueue

New jobs are created with the `minion.enqueue()` method, which requires a task name to tell the worker what kind of
workload the job represents, an array with job arguments, and an object with optional features to use for processing
this job. Every newly created job has a unique id that can be used to check its current status.

```js
const jobId = await minion.enqueue('task', ['arg1', 'arg2', 'arg3'], {

  // Number of times performing this job will be attempted (defaults to 0), with a computed increasing delay
  attempts: 5,

  // Delay job for this many milliseconds (from now)
  delay: 5000,

  // Job is valid for this many milliseconds (from now) before it expires
  expire: 10000,

  // Existing jobs this job depends on may also have transitioned to the "failed" state to allow for it to be processed
  lax: true,

  // Object with arbitrary metadata for this job that gets serialized as JSON
  notes: {foo: 'bar'},

  // One or more existing jobs this job depends on, and that need to have transitioned to the state "finished" before
  // it can be processed
  parents: [23, 24, 25],

  // Job priority (defaults to 0), jobs with a higher priority get performed first, priorities can be positive or
  // negative, but should be in the range between 100 and -100
  priority: 9,

  // Queue to put job in (defaults to "default")
  queue: 'important'
});
```

### Tasks

Tasks are created with `minion.addTask()`, and are async functions that represent the individual workloads workers can
perform. Not all workers need to have the same tasks, but it is recommended for easier to maintain code. If you want to
route individual jobs to specific workers it is better to use named queues for that.

```js
// Task without result
minion.addTask('somethingSlow', async job => {
  console.log('This is a background worker process.');
});

// Task with result
minion.addTask('somethingWithResult', async (job, num1, num2) => {
  const rersult = num1 + num2;
  await job.finish(result);
});
```

### Jobs

Individual jobs are represented as instances of the `Job` class, which are the first argument passed to all task
functions. To check the current status of a specific job you can use the `minion.job()` method.

```js
// Request a specific job (this does not prevent workers from processing the job)
const job = await minion.job(23);

// Job properties
const jobId   = job.id;
const task    = job.task;
const args    = job.args;
const retries = job.retries;

// Request current state of the job
const info     = await job.info();
const attempts = info.attempts;
const children = info.children;
const created  = info.created;
const delayed  = info.delayed;
const expires  = info.expires;
const finished = info.finished;
const lax      = info.lax;
const notes    = info.notes;
const parents  = info.parents;
const priority = info.priority;
const queue    = info.queue;
const result   = info.result;
const retried  = info.retried;
const started  = info.started;
const state    = info.state;
const time     = info.time;
const worker   = info.worker;

// Merge notes (remove a note by setting it to "null")
const success = await job.note({just: 'a note', another: ['note'], foo: null});

// Remove job from database
const success = await job.remove();

// Manually finish/fail the job (the result is an arbitrary data structure that will be serialized as JSON)
const success = await job.finish('Huge success!');
const success = await job.fail('Something went wrong!');
```

Every job still in the database can be retried at any time, this is also the only way to change most of the available
processing options. A worker already processing this job will not be able to assign a result afterwards, but it will
not stop processing.

```js
const success = await job.retry({

  // Number of times performing this job will be attempted
  attempts: 3,

  // Delay job for this many milliseconds (from now)
  delay: 3000,

  // Job is valid for this many milliseconds (from now) before it expires
  expire: 5000,

  // Existing jobs this job depends on may also have transitioned to the "failed" state to allow for it to be processed
  lax: false,

  // One or more existing jobs this job depends on, and that need to have transitioned to the state "finished" before
  // it can be processed
  parents: [23, 25],

  // Job priority (defaults to 0), jobs with a higher priority get performed first, priorities can be positive or
  // negative, but should be in the range between 100 and -100
  priority: 5,

  // Queue to put job in
  queue: 'unimportant'
});
```

The iterator API allows you to search through all jobs currently in the database.

```js
const jobs = minion.jobs({

  // List only jobs with these ids
  ids: [23, 24],

  // List only jobs with one of these notes
  notes: ['foo', 'bar'],

  // List only jobs in these queues
  queues: ['important', 'unimportant'],

  // List only jobs in these states
  states: ['inactive', 'active'],

  // List only jobs for these tasks
  tasks: ['foo', 'bar']
});

// Total number of results
const total = await jobs.total();

// Iterate current job states
for await (const info of jobs) {
  const {id, state} = info;
  console.log(`${id}: ${state}`);
}
```

## mojo.js

You can use Minion as a standalone job queue, or integrate it into [mojo.js](https://mojojs.org) applications with
`minionPlugin`.

```js
import {minionPlugin} from '@minionjs/core';
import mojo from '@mojojs/core';

export const app = mojo();

app.plugin(minionPlugin, {config: 'postgres://user:password@localhost:5432/database'});

// Slow task
app.models.minion.addTask('poke_mojo', async job => {
  await job.app.ua.get('mojolicious.org');
  job.app.log.debug('We have poked mojolicious.org for a visitor');
});

// Perform job in a background worker process
app.get('/', async ctx => {
  await ctx.models.minion.enqueue('poke_mojo');
  await ctx.render({text: 'We will poke mojolicious.org for you soon.'});
});

app.start();
```

Background worker processes are usually started with the `minion-worker` command, which becomes automatically available
when an application loads `minionPlugin`.

```
$ node index.js minion-worker
```

Jobs can be managed right from the command line with the `minion-job` command.

```
$ node index.js minion-job
```

You can also add an admin ui to your application by loading `minionAdminPlugin`. Just make sure to secure access before
making your application publicly accessible.

```js
import {minionPlugin, minionAdminPlugin} from '@minionjs/core';
import mojo from '@mojojs/core';

export const app = mojo();

const minionPrefix = app.any('/minion');

app.plugin(minionPlugin, {config: 'postgres://user:password@localhost:5432/database'});
app.plugin(minionAdminPlugin, {route: minionPrefix});

app.start();
```

### Deployment

To manage background worker processes with systemd, you can use a unit configuration file like this.

```
[Unit]
Description=My mojo.js application worker
After=postgresql.service

[Service]
Type=simple
ExecStart=NODE_ENV=production node /home/sri/myapp/myapp.js minion-worker
KillMode=process

[Install]
WantedBy=multi-user.target
```

## Installation

All you need is Node.js 16.0.0 (or newer).

```
$ npm install @minionjs/core
```

## Support

If you have any questions the documentation might not yet answer, don't hesitate to ask in the
[Forum](https://github.com/mojolicious/mojo.js/discussions), on [Matrix](https://matrix.to/#/#mojo:matrix.org), or
[IRC](https://web.libera.chat/#mojo).
