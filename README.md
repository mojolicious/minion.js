
![Screenshot](https://raw.github.com/mojolicious/minion.js/main/examples/admin.png?raw=true)

<div align="center">
  <p>
    <a href="#features"><strong>Features</strong></a> ·
    <a href="#examples"><strong>Examples</strong></a> ·
    <a href="#api"><strong>API</strong></a> ·
    <a href="#deployment"><strong>Deployment</strong></a> ·
    <a href="#installation"><strong>Installation</strong></a> ·
    <a href="#support"><strong>Support</strong></a>
  </p>
  <br/>
</div>

[![](https://github.com/mojolicious/minion.js/workflows/test/badge.svg)](https://github.com/mojolicious/minion.js/actions)
[![Coverage Status](https://coveralls.io/repos/github/mojolicious/minion.js/badge.svg?branch=main)](https://coveralls.io/github/mojolicious/minion.js?branch=main)
[![npm](https://img.shields.io/npm/v/@minionjs/core.svg)](https://www.npmjs.com/package/@minionjs/core)

A high performance job queue for Node.js and PostgreSQL. With support for alternative database backends. Written in
TypeScript. Also available for [Perl](https://github.com/mojolicious/minion).

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

## Features

- Multiple named queues
- Priorities
- High priority fast lane
- Delayed jobs
- Cron style recurring jobs
- Job dependencies
- Job progress
- Job results
- Retries with backoff
- Rate limiting
- Unique jobs
- Expiring jobs
- Statistics
- Distributed workers
- Parallel processing
- Task limits
- Remote control
- Multiple backends (such as [PostgreSQL](https://www.postgresql.org))
- [mojo.js admin ui](#mojojs)

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

They are not to be confused with time based job schedulers, such as cron or systemd timers, but Minion has built in
support for cron style [recurring jobs](#recurring-jobs) when you want a task to run on a wall clock schedule.

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

  // Amount of time in milliseconds after which jobs that have reached the state finished and have no unresolved
  // dependencies will be removed automatically by "repair", defaults to 2 days (it is not recommended to set this
  // value below 2 days)
  removeAfter: 172800000,

  // Amount of time in milliseconds after which jobs that have not been processed will be considered stuck and
  // transition to the failed state, defaults to 2 days
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

  // Number of times performing this job will be attempted (defaults to 1), with a computed increasing delay
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
  const result = num1 + num2;
  await job.finish(result);
});
```

### Job Dependencies

The `parents` option of `minion.enqueue()` can be used to make a new job depend on one or more existing jobs, which all
need to have reached the state `finished` before it can be processed.

```js
// Second job will not be processed until first job has finished
const first = await minion.enqueue('stepOne');
await minion.enqueue('stepTwo', [], {parents: [first]});
```

This is commonly used to build workflows where tasks need to run in a specific order.

```js
const a = await minion.enqueue('prepare');
const b = await minion.enqueue('process', [], {parents: [a]});
const c = await minion.enqueue('cleanup', [], {parents: [b]});
```

If a parent job transitions to the `failed` state, all dependent jobs will remain `inactive` and wait until it has been
retried successfully or removed. You can use the `lax` option to allow a job to be processed even if its parents have
`failed`.

```js
// Job will be processed even if parent jobs have failed
await minion.enqueue('cleanup', [], {parents: [id], lax: true});
```

### Automatic Retries

The `attempts` option of `minion.enqueue()` can be used to allow a job to be retried automatically if it fails, up to
the specified number of attempts.

```js
// Job will be attempted up to five times
await minion.enqueue('checkLinks', ['https://mojolicious.org'], {attempts: 5});
```

The delay between retries is determined by `minion.backoff()`, which defaults to `((retries ** 4) + 15) * 1000`
milliseconds (15, 16, 31, 96, 271, 640... seconds), allowing roughly 25 attempts to be made over 21 days. You can
change the formula by providing your own method.

```js
// Add some randomness to spread retry load
minion.backoff = retries => (retries ** 4 + 15 + Math.floor(Math.random() * 30)) * 1000;
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

This is commonly used to build custom monitoring or to perform bulk operations on jobs.

```js
// Retry all failed jobs in a queue
for await (const info of minion.jobs({states: ['failed'], queues: ['important']})) {
  const job = await minion.job(info.id);
  await job?.retry();
}
```

And `minion.result()` can be used to wait for the result of a job, it returns a promise that will be fulfilled when the
job reaches the state `finished`, or rejected when it reaches the state `failed`.

```js
// Enqueue job and receive the result at some point in the future
const id = await minion.enqueue('foo');
try {
  const info = await minion.result(id, {interval: 1000});
  console.log(`Finished: ${info.result}`);
} catch (info) {
  console.log(`Failed: ${info.result}`);
}
```

### Locks

Named locks are a tool that can be used for many things, inside and outside of task functions. They expire
automatically after a certain amount of time in milliseconds. You can release the lock manually with `minion.unlock()`
to limit concurrency, or let it expire for rate limiting.

```js
// Acquire a named lock
const success = await minion.lock('fragile_backend_service', 5000, {

  // Number of shared locks with the same name that can be active at the same time (defaults to "1")
  limit: 5
});

// Check if a named lock currently exists
const success = await minion.isLocked('fragile_backend_service');

// Release a named lock
const success = await minion.unlock('fragile_backend_service');
```

The most common use for named locks is limiting access to shared resources.

```js
// Only one job should run at a time (unique job)
minion.addTask('do_unique_stuff', async job => {
  if (await minion.lock('fragile_web_service', 7200000) !== true) {
    await job.finish('Previous job still active');
    return;
  }
  ...
  await minion.unlock('fragile_web_service');
});

// Only five jobs should run at a time and we wait for our turn
minion.addTask('do_concurrent_stuff', async job => {
  while (await minion.lock('some_web_service', 60000, {limit: 5}) !== true) {
    await sleep(1000);
  }
  ...
  await minion.unlock('some_web_service');
});

// Only a hundred jobs should run per hour and we try again later if necessary
minion.addTask('do_rate_limit_stuff', async job => {
  if (await minion.lock('another_web_service', 3600000, {limit: 100}) !== true) {
    await job.retry({delay: 3600000});
    return;
  }
  ...
});
```

Each lock acquired for rate limiting will count against the limit for the duration of its expiration time, effectively
capping throughput to `limit` jobs per expiration period.

An expiration time of `0` can be used to check if a named lock could have been acquired without creating one.

```js
// Check if the lock "foo" could have been acquired
const success = await minion.lock('foo', 0);
```

### Recurring Jobs

For jobs that should run on a wall clock schedule, use `minion.schedule()` with a cron expression. Schedules are stored
in the database as the source of truth, so they survive restarts and only fire once per interval no matter how many
workers are running.

```js
// Daily cleanup at 4am
await minion.schedule('daily_cleanup', '0 4 * * *', 'cleanup');

// Every five minutes, with arguments and options
await minion.schedule('refresh', '*/5 * * * *', 'refreshCache', ['users'], {
  // Number of times performing each enqueued job will be attempted (defaults to 1)
  attempts: 3,

  // Each enqueued job is valid for this many milliseconds before it expires (stored with a precision of seconds)
  expire: 300000,

  // Existing jobs each enqueued job depends on may also have transitioned to the "failed" state
  lax: false,

  // Object with arbitrary metadata applied to each enqueued job
  notes: {foo: 'bar'},

  // Priority of each enqueued job (defaults to 0)
  priority: 5,

  // Queue to put each enqueued job in (defaults to "default")
  queue: 'important'
});
```

A cron expression is five fields separated by spaces, one for each part of the wall clock. All times are interpreted in
**UTC**, not local time.

```
* * * * *
| | | | |
| | | | +---- day of week  (0-6, 0=Sun; or SUN-SAT; 7 also means Sun)
| | | +------ month        (1-12; or JAN-DEC)
| | +-------- day of month (1-31)
| +---------- hour         (0-23)
+------------ minute       (0-59)
```

A `*` means "every value", so `* * * * *` reads as "every minute of every hour, every day". Pin a field to a specific
number to fix that part of the clock.

```
0 4 * * *       # 04:00 every day
30 9 * * 1      # 09:30 every Monday
0 0 1 1 *       # midnight on January 1st (once a year)
```

Use `/N` for "every Nth value", `a-b` for ranges, and commas for lists.

```
*/15 * * * *    # every 15 minutes
0 9-17 * * *    # at the top of every hour from 09:00 to 17:00
0 9 * * 1-5     # 09:00 every weekday
0 0,12 * * *    # midnight and noon
```

Common patterns also have nicknames that expand to one of the forms above.

```
@hourly         # 0 * * * *
@daily          # 0 0 * * *
@midnight       # 0 0 * * *
@weekly         # 0 0 * * 0
@monthly        # 0 0 1 * *
@yearly         # 0 0 1 1 *
```

When both day-of-month and day-of-week are restricted, the job fires when **either** matches, following the standard
Vixie cron behavior. So `0 0 1 * 0` means "midnight on the 1st of the month **and** every Sunday at midnight".

Adding a schedule with an existing name updates it, reusing the same cron expression preserves the next firing time,
changing it recomputes it. Invalid expressions are rejected immediately.

```js
// Pause and resume schedules without removing them
const success = await minion.pauseSchedule('daily_cleanup');
const success = await minion.resumeSchedule('daily_cleanup');

// Remove a schedule
const success = await minion.unschedule('daily_cleanup');

// List schedules
const {schedules, total} = await minion.listSchedules(0, 10, {names: ['daily_cleanup']});
for (const {name, cron, last_job, last_run, next_run, paused} of schedules) {
  console.log(`${name} (${cron}) runs next at ${next_run.toISOString()}`);
}

// Manually enqueue jobs for all due schedules
for (const {name, job} of await minion.dispatchSchedules()) {
  console.log(`Schedule "${name}" enqueued job ${job}.`);
}
```

Running workers call `minion.dispatchSchedules()` every `dispatchInterval` milliseconds (defaults to 30 seconds) to
enqueue any due jobs, coordinated through a PostgreSQL advisory lock so a single dispatch cycle never fires the same
schedule twice. If no worker has been running, missed runs will not be caught up, the next firing time is always the
next match after the current time. Schedules are compatible with Perl Minion, so both can share the same database.

### Workers

Workers can be started with `minion.worker()`, and customized with a variety of status options.

```js
const worker = minion.worker({
  status: {
    // Worker remote control command interval, defaults to 10 seconds
    commandInterval: 10000,

    // Maximum amount of time to wait for jobs, defaults to 5 seconds
    dequeueTimeout: 5000,

    // Schedule dispatch interval (0 disables dispatching schedules), defaults to 30 seconds
    dispatchInterval: 30000,

    // Heartbeat interval, defaults to 300 seconds
    heartbeatInterval: 300000,

    // Maximum number of jobs to perform concurrently (not including spare slots), defaults to 4
    jobs: 4,

    // Limit the number of concurrent jobs for specific tasks (0 disables the task for this worker)
    limits: {resizeImage: 2, sendMail: 5},

    // One or more queues to get jobs from, defaults to "default"
    queues: ['important', 'default'],

    // Repair interval, up to half of this value can be subtracted randomly to make sure not all workers repair at the
    // same time, defaults to 6 hours
    repairInterval: 21600000,

    // Number of spare slots to reserve for high priority jobs, defaults to 1
    spare: 1,

    // Minimum priority of jobs to use spare slots for, defaults to 1
    spareMinPriority: 1
  }
});
await worker.start();

// Stop gracefully after finishing the current jobs
await worker.stop();
```

Task limits allow workers to perform more jobs concurrently without letting a single slow task use up all the slots.
Jobs for other tasks will continue to be dequeued while a task is at its limit.

Running workers can be controlled with remote control commands, which are broadcast with `minion.broadcast()`. The
built-in commands are `jobs`, to change how many jobs a worker performs concurrently, and `spare`, to change the number
of spare slots reserved for high priority jobs. Setting both to `0` pauses a worker, all current jobs will be finished,
but no new ones accepted, until the numbers are increased again.

```js
// Reduce concurrency of worker 23 to two jobs
await minion.broadcast('jobs', [2], [23]);

// Pause all workers
await minion.broadcast('jobs', [0]);
await minion.broadcast('spare', [0]);

// Add your own command
worker.addCommand('my_command', async (worker, ...args) => {
  ...
});
```

### Testing

`minion.performJobs()` can be used to perform all jobs in the queue with a temporary worker, making it very easy to test
background tasks without having to start a real worker process.

```js
import Minion from '@minionjs/core';
import t from 'tap';

const minion = new Minion('postgres://user:password@localhost:5432/test');
await minion.update();

minion.addTask('add', async (job, a, b) => {
  await job.finish(a + b);
});

const id = await minion.enqueue('add', [1, 1]);
await minion.performJobs();
t.equal((await (await minion.job(id)).info()).result, 2);
```

### Utilities

```js
// Retry job in "minion_foreground" queue, then perform it right away with a temporary worker in this process, very
// useful for debugging
const success = await minion.foreground(23);

// Broadcast "jobs" command to pause worker 23
const success = await minion.broadcast('jobs', [0], [23]);

// Reset job queue
await minion.reset({

  // Reset everything (including schedules)
  all: true,

  // Reset only locks
  locks: true
});

// Cron expression helpers (times are in UTC)
import {util} from '@minionjs/core';
const next = util.nextCronTime('0 9 * * MON-FRI', new Date());
const parsed = util.parseCron('*/5 * * * *');
```

### mojo.js

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
$ node index.js minion-worker -j 12 -q important -q default
$ node index.js minion-worker -L resizeImage=2 -L sendMail=5
```

Jobs can be managed right from the command line with the `minion-job` command.

```
$ node index.js minion-job
$ node index.js minion-job 10023
$ node index.js minion-job -e foo -a '[23, "bar"]'

# Retry job in the foreground and perform it right away (very useful for debugging)
$ node index.js minion-job -f 10023

# Reduce concurrency of worker 23 to two jobs
$ node index.js minion-job -b jobs -a '[2]' 23
```

And recurring jobs with the `minion-schedule` command.

```
$ node index.js minion-schedule
$ node index.js minion-schedule daily_cleanup
$ node index.js minion-schedule -e daily_cleanup -c '0 4 * * *' -t cleanup
$ node index.js minion-schedule -e refresh -c '*/5 * * * *' -t refreshCache -a '["users"]' -p 5
$ node index.js minion-schedule -P daily_cleanup
$ node index.js minion-schedule -r daily_cleanup
$ node index.js minion-schedule -R daily_cleanup
```

Worker processes started with `minion-worker` stop gracefully after finishing their current jobs when they receive an
`INT` signal.

You can also add an admin ui to your application by loading `minionAdminPlugin`, to manage jobs, locks, schedules and
workers. Just make sure to secure access before making your application publicly accessible.

```js
import {minionPlugin, minionAdminPlugin} from '@minionjs/core';
import mojo from '@mojojs/core';

export const app = mojo();

const minionPrefix = app.any('/minion');

app.plugin(minionPlugin, {config: 'postgres://user:password@localhost:5432/database'});
app.plugin(minionAdminPlugin, {route: minionPrefix});

app.start();
```

## Deployment

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

All you need is Node.js 22.18.0 (or newer).

```
$ npm install @minionjs/core
```

## Support

If you have any questions the documentation might not yet answer, don't hesitate to ask in the
[Forum](https://github.com/mojolicious/mojo.js/discussions), on [Matrix](https://matrix.to/#/#mojo:matrix.org), or
[IRC](https://web.libera.chat/#mojo).
