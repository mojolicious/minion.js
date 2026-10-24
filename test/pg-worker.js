import {setTimeout} from 'node:timers/promises';
import Minion from '../src/minion.ts';
import Pg from '@mojojs/pg';
import t from 'tap';

const skip = process.env.TEST_ONLINE === undefined ? {skip: 'set TEST_ONLINE to enable this test'} : {};

t.test('Worker', skip, async t => {
  // Isolate tests
  const pg = new Pg(process.env.TEST_ONLINE, {searchPath: ['minion_worker_test']});
  await pg.query`DROP SCHEMA IF EXISTS minion_worker_test CASCADE`;
  await pg.query`CREATE SCHEMA minion_worker_test`;

  const minion = new Minion(pg);
  await minion.update();

  minion.addTask('test', async job => {
    await job.note({test: 'pass'});
  });

  const worker = await minion.worker().start();
  t.equal(worker.isRunning, true);

  await t.test('Wait for jobs', async t => {
    const id = await minion.enqueue('test');
    const result = await minion.result(id, {interval: 500});
    t.equal(result.state, 'finished');
    t.same(result.notes, {test: 'pass'});
  });

  await t.test('Task limits', async t => {
    let running = 0;
    let maxRunning = 0;
    const releases = [];
    minion.addTask('slow', async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(resolve => releases.push(resolve));
      running--;
    });
    minion.addTask('fast', async () => {});
    minion.addTask('disabled', async () => {});

    const status = {dequeueTimeout: 100, limits: {slow: 1, disabled: 0}, queues: ['limits']};
    const limited = await minion.worker({status}).start();
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await minion.enqueue('slow', [], {queue: 'limits'}));
    const disabled = await minion.enqueue('disabled', [], {queue: 'limits'});
    const fast = await minion.enqueue('fast', [], {queue: 'limits'});

    // Other tasks are not blocked by the limit
    t.equal((await minion.result(fast, {interval: 100})).state, 'finished');

    // Only one slow job at a time (and the event loop keeps running while the limit is reached)
    for (let i = 0; i < 3; i++) {
      while (releases.length === 0) await setTimeout(50);
      await setTimeout(300);
      t.equal(running, 1);
      releases.shift()();
    }
    for (const id of ids) t.equal((await minion.result(id, {interval: 100})).state, 'finished');
    t.equal(maxRunning, 1);
    t.equal((await (await minion.job(disabled)).info()).state, 'inactive');
    await limited.stop();

    // All tasks have reached their limits (worker must wait without blocking the event loop)
    const limits = Object.fromEntries(Object.keys(minion.tasks).map(task => [task, task === 'slow' ? 1 : 0]));
    const allLimited = await minion.worker({status: {dequeueTimeout: 100, limits, queues: ['limits']}}).start();
    const id = await minion.enqueue('slow', [], {queue: 'limits'});
    const id2 = await minion.enqueue('slow', [], {queue: 'limits'});
    while (releases.length === 0) await setTimeout(50);
    await setTimeout(300);
    t.equal(running, 1);
    releases.shift()();
    while (releases.length === 0) await setTimeout(50);
    releases.shift()();
    t.equal((await minion.result(id, {interval: 100})).state, 'finished');
    t.equal((await minion.result(id2, {interval: 100})).state, 'finished');
    await allLimited.stop();
  });

  await t.test('Dispatch schedules', async t => {
    const status = {dequeueTimeout: 100, dispatchInterval: 100, queues: ['scheduled']};
    const dispatcher = await minion.worker({status}).start();
    const id = await minion.schedule('every_minute', '* * * * *', 'test', [], {queue: 'scheduled'});
    await pg.query`UPDATE minion_schedules SET next_run = NOW() - INTERVAL '1 minute' WHERE id = ${id}`;

    let info;
    while ((info = (await minion.listSchedules(0, 1, {ids: [id]})).schedules[0]).last_job === null) {
      await setTimeout(50);
    }
    const result = await minion.result(info.last_job, {interval: 100});
    t.equal(result.state, 'finished');
    t.equal(result.queue, 'scheduled');
    t.same(result.notes, {test: 'pass'});
    t.ok(info.next_run > info.last_run);

    await dispatcher.stop();
  });

  t.equal(worker.isRunning, true);
  await worker.stop();
  t.equal(worker.isRunning, false);

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_worker_test CASCADE`;

  await pg.end();
});
