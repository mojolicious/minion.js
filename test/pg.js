import os from 'os';
import Minion from '../lib/minion.js';
import mojo, {util} from '@mojojs/core';
import Pg from '@mojojs/pg';
import t from 'tap';

const skip = process.env.TEST_ONLINE === undefined ? {skip: 'set TEST_ONLINE to enable this test'} : {};

t.test('PostgreSQL backend', skip, async t => {
  // Isolate tests
  const pg = new Pg(process.env.TEST_ONLINE, {searchPath: ['minion_backend_test']});
  await pg.query`DROP SCHEMA IF EXISTS minion_backend_test CASCADE`;
  await pg.query`CREATE SCHEMA minion_backend_test`;

  const minion = new Minion(pg);
  await minion.setup();

  await t.test('Nothing to repair', async t => {
    await minion.repair();
    t.ok(minion.backend !== undefined);
    t.ok(minion.app instanceof mojo().constructor);
  });

  await t.test('Migrate up and down', async t => {
    t.equal(await minion.backend.pg.migrations.active(), 23);
    await minion.backend.pg.migrations.migrate(0);
    t.equal(await minion.backend.pg.migrations.active(), 0);
    await minion.backend.pg.migrations.migrate();
    t.equal(await minion.backend.pg.migrations.active(), 23);
  });

  await t.test('Register and unregister', async t => {
    const worker = minion.worker();
    await worker.register();
    t.same((await worker.info()).started instanceof Date, true);
    const notified = (await worker.info()).notified;
    t.same(notified instanceof Date, true);
    const id = worker.id;
    await worker.register();
    await util.sleep(500);
    await worker.register();
    t.same((await worker.info()).notified > notified, true);
    await worker.unregister();
    t.same(await worker.info(), null);
    await worker.register();
    t.not(worker.id, id);
    t.equal((await worker.info()).host, os.hostname());
    await worker.unregister();
    t.same(await worker.info(), null);
  });

  await t.test('Job results', async t => {
    minion.addTask('test', async () => {
      return;
    });
    const worker = minion.worker();
    await worker.register();

    const id = await minion.enqueue('test');
    const promise = minion.result(id, {interval: 0});
    const job = await worker.dequeue(0);
    t.equal(job.id, id);
    t.same(await job.finish({just: 'works'}), true);
    t.same(await job.note({foo: 'bar'}), true);
    const info = await promise;
    t.same(info.result, {just: 'works'});
    t.same(info.notes, {foo: 'bar'});

    let failed;
    const id2 = await minion.enqueue('test');
    t.not(id2, id);
    const promise2 = minion.result(id2, {interval: 0}).catch(reason => (failed = reason));
    const job2 = await worker.dequeue(0);
    t.equal(job2.id, id2);
    t.not(job2.id, id);
    t.same(await job2.fail({just: 'works too'}), true);
    await promise2;
    t.same(failed.result, {just: 'works too'});

    const promise3 = minion.result(id, {interval: 0});
    const info2 = await promise3;
    t.same(info2.result, {just: 'works'});
    t.same(info2.notes, {foo: 'bar'});

    let finished;
    failed = undefined;
    const job3 = await minion.job(id);
    t.same(await job3.retry(), true);
    t.equal((await job3.info()).state, 'inactive');
    const ac = new AbortController();
    const signal = ac.signal;
    const promise4 = minion
      .result(id, {interval: 10, signal})
      .then(value => (failed = value))
      .catch(reason => (failed = reason));
    setTimeout(() => ac.abort(), 250);
    await promise4;
    t.same(finished, undefined);
    t.same(failed.name, 'AbortError');

    finished = undefined;
    failed = undefined;
    const job4 = await minion.job(id);
    t.same(await job4.remove(), true);
    const promise5 = minion
      .result(id, {interval: 10, signal})
      .then(value => (failed = value))
      .catch(reason => (failed = reason));
    await promise5;
    t.same(finished, null);
    t.same(failed, undefined);

    await worker.unregister();
  });

  await t.test('Wait for job', async t => {
    const worker = await minion.worker().register();
    setTimeout(() => minion.enqueue('test'), 500);
    const job = await worker.dequeue(10000);
    t.notSame(job, null);
    await job.finish({one: ['two', ['three']]});
    t.same((await job.info()).result, {one: ['two', ['three']]});
    await worker.unregister();
  });

  await t.test('Repair missing worker', async t => {
    const worker = await minion.worker().register();
    const worker2 = await minion.worker().register();
    t.not(worker.id, worker2.id);

    const id = await minion.enqueue('test');
    const job = await worker2.dequeue(0);
    t.equal(job.id, id);
    t.equal((await job.info()).state, 'active');
    const workerId = worker2.id;
    const missingAfter = minion.missingAfter + 1;
    t.ok(await worker2.info());
    await minion.backend.pg.query`
      UPDATE minion_workers SET notified = NOW() - INTERVAL '1 second' * ${missingAfter} WHERE id = ${workerId}
    `;

    await minion.repair();
    t.ok(!(await worker2.info()));
    const info = await job.info();
    t.equal(info.state, 'failed');
    t.equal(info.result, 'Worker went away');
    await worker.unregister();
  });

  await t.test('Repair abandoned job', async t => {
    const worker = await minion.worker().register();
    await minion.enqueue('test');
    const job = await worker.dequeue(0);
    await worker.unregister();
    await minion.repair();
    const info = await job.info();
    t.equal(info.state, 'failed');
    t.equal(info.result, 'Worker went away');
  });

  await t.test('Repair abandoned job in minion_foreground queue (have to be handled manually)', async t => {
    const worker = await minion.worker().register();
    const id = await minion.enqueue('test', [], {queue: 'minion_foreground'});
    const job = await worker.dequeue(0, {queues: ['minion_foreground']});
    t.equal(job.id, id);
    await worker.unregister();
    await minion.repair();
    const info = await job.info();
    t.equal(info.state, 'active');
    t.equal(info.queue, 'minion_foreground');
    t.same(info.result, null);
  });

  await t.test('Repair old jobs', async t => {
    t.equal(minion.removeAfter, 172800);

    const worker = await minion.worker().register();
    const id = await minion.enqueue('test');
    const id2 = await minion.enqueue('test');
    const id3 = await minion.enqueue('test');

    await worker.dequeue(0).then(job => job.perform());
    await worker.dequeue(0).then(job => job.perform());
    await worker.dequeue(0).then(job => job.perform());

    const pg = minion.backend.pg;
    const finished = (
      await pg.query`SELECT EXTRACT(EPOCH FROM finished) AS finished FROM minion_jobs WHERE id = ${id2}`
    ).first.finished;
    await pg.query`UPDATE minion_jobs SET finished = TO_TIMESTAMP(${
      finished - (minion.removeAfter + 1)
    }) WHERE id = ${id2}`;
    const finished2 = (
      await pg.query`SELECT EXTRACT(EPOCH FROM finished) AS finished FROM minion_jobs WHERE id = ${id3}`
    ).first.finished;
    await pg.query`UPDATE minion_jobs SET finished = TO_TIMESTAMP(${
      finished2 - (minion.removeAfter + 1)
    }) WHERE id = ${id3}`;

    await worker.unregister();
    await minion.repair();
    t.ok(await minion.job(id));
    t.ok(!(await minion.job(id2)));
    t.ok(!(await minion.job(id3)));
  });

  await t.test('Repair stuck jobs', async t => {
    t.equal(minion.stuckAfter, 172800);

    const worker = await minion.worker().register();
    const id = await minion.enqueue('test');
    const id2 = await minion.enqueue('test');
    const id3 = await minion.enqueue('test');
    const id4 = await minion.enqueue('test');

    const pg = minion.backend.pg;
    const stuck = minion.stuckAfter + 1;
    await pg.query`UPDATE minion_jobs SET delayed = NOW() - ${stuck} * INTERVAL '1 second' WHERE id = ${id}`;
    await pg.query`UPDATE minion_jobs SET delayed = NOW() - ${stuck} * INTERVAL '1 second' WHERE id = ${id2}`;
    await pg.query`UPDATE minion_jobs SET delayed = NOW() - ${stuck} * INTERVAL '1 second' WHERE id = ${id3}`;
    await pg.query`UPDATE minion_jobs SET delayed = NOW() - ${stuck} * INTERVAL '1 second' WHERE id = ${id4}`;

    const job = await worker.dequeue(0, {id: id4});
    await job.finish('Works!');
    const job2 = await worker.dequeue(0, {id: id2});
    await minion.repair();

    t.equal((await job2.info()).state, 'active');
    t.ok(await job2.finish());
    const job3 = await minion.job(id);
    t.equal((await job3.info()).state, 'failed');
    t.equal((await job3.info()).result, 'Job appears stuck in queue');
    const job4 = await minion.job(id3);
    t.equal((await job4.info()).state, 'failed');
    t.equal((await job4.info()).result, 'Job appears stuck in queue');
    const job5 = await minion.job(id4);
    t.equal((await job5.info()).state, 'finished');
    t.equal((await job5.info()).result, 'Works!');
    await worker.unregister();
  });

  await t.test('Exclusive lock', async t => {
    t.ok(await minion.lock('foo', 3600));
    t.ok(!(await minion.lock('foo', 3600)));
    t.ok(await minion.unlock('foo'));
    t.ok(!(await minion.unlock('foo')));
    t.ok(await minion.lock('foo', -3600));
    t.ok(await minion.lock('foo', 0));
    t.ok(!(await minion.isLocked('foo')));
    t.ok(await minion.lock('foo', 3600));
    t.ok(await minion.isLocked('foo'));
    t.ok(!(await minion.lock('foo', -3600)));
    t.ok(!(await minion.lock('foo', 3600)));
    t.ok(await minion.unlock('foo'));
    t.ok(!(await minion.unlock('foo')));
    t.ok(await minion.lock('foo', 3600, {limit: 1}));
    t.ok(!(await minion.lock('foo', 3600, {limit: 1})));
  });

  await t.test('Shared lock', async t => {
    t.ok(await minion.lock('bar', 3600, {limit: 3}));
    t.ok(await minion.lock('bar', 3600, {limit: 3}));
    t.ok(await minion.isLocked('bar'));
    t.ok(await minion.lock('bar', -3600, {limit: 3}));
    t.ok(await minion.lock('bar', 3600, {limit: 3}));
    t.ok(!(await minion.lock('bar', 3600, {limit: 3})));
    t.ok(await minion.lock('baz', 3600, {limit: 3}));
    t.ok(await minion.unlock('bar'));
    t.ok(await minion.lock('bar', 3600, {limit: 3}));
    t.ok(await minion.unlock('bar'));
    t.ok(await minion.unlock('bar'));
    t.ok(await minion.unlock('bar'));
    t.ok(!(await minion.unlock('bar')));
    t.ok(!(await minion.isLocked('bar')));
    t.ok(await minion.unlock('baz'));
    t.ok(!(await minion.unlock('baz')));
  });

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_backend_test CASCADE`;

  await pg.end();
});
