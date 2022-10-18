import Minion from '../lib/minion.js';
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

  t.equal(worker.isRunning, true);
  await worker.stop();
  t.equal(worker.isRunning, false);

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_worker_test CASCADE`;

  await pg.end();
});
