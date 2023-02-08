
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

Job queues allow you to process time and/or computationally intensive tasks in background processes, outside of the
request/response lifecycle of web applications. Among those tasks you'll commonly find image resizing, spam filtering,
HTTP downloads, building tarballs, warming caches and basically everything else you can imagine that's not super fast.

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

## Documentation

TODO: While minion.js itself is pretty much feature complete, the documentation still needs to be added for the 1.0
release.

## Installation

All you need is Node.js 16.0.0 (or newer).

```
$ npm install @minionjs/core
```

## Support

If you have any questions the documentation might not yet answer, don't hesitate to ask in the
[Forum](https://github.com/mojolicious/mojo.js/discussions), on [Matrix](https://matrix.to/#/#mojo:matrix.org), or
[IRC](https://web.libera.chat/#mojo).
