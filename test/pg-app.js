import {minionPlugin} from '../lib/minion.js';
import mojo from '@mojojs/core';
import Pg from '@mojojs/pg';
import t from 'tap';

const skip = process.env.TEST_ONLINE === undefined ? {skip: 'set TEST_ONLINE to enable this test'} : {};

t.test('App', skip, async t => {
  // Isolate tests
  const pg = new Pg(process.env.TEST_ONLINE, {searchPath: ['minion_app_test']});
  await pg.query`DROP SCHEMA IF EXISTS minion_app_test CASCADE`;
  await pg.query`CREATE SCHEMA minion_app_test`;

  const app = mojo();
  app.plugin(minionPlugin, {config: pg});

  app.log.level = 'debug';

  app.models.minion.addTask('add', async (job, first, second) => {
    await job.finish(first + second);
  });

  app.get('/add', async ctx => {
    const params = await ctx.params();
    const first = parseInt(params.get('first'));
    const second = parseInt(params.get('second'));
    const id = await ctx.models.minion.enqueue('add', [first, second], {queue: 'test'});
    await ctx.render({text: `${id}`});
  });

  app.get('/result', async ctx => {
    const params = await ctx.params();
    const job = await ctx.models.minion.job(params.get('id'));
    const info = await job.info();
    await ctx.render({text: `${info.result}`});
  });

  const ua = await app.newTestUserAgent({tap: t});

  await t.test('Perform jobs automatically', async () => {
    (await ua.getOk('/add', {form: {first: 1, second: 2}})).statusIs(200);
    const id = ua.body.toString();
    await app.models.minion.performJobs({queues: ['test']});
    (await ua.getOk('/result', {form: {id}})).statusIs(200).bodyIs('3');

    (await ua.getOk('/add', {form: {first: 2, second: 3}})).statusIs(200);
    const first = ua.body.toString();
    (await ua.getOk('/add', {form: {first: 4, second: 5}})).statusIs(200);
    const second = ua.body.toString();
    await app.models.minion.performJobs({queues: ['test']});
    (await ua.getOk('/result', {form: {id: first}})).statusIs(200).bodyIs('5');
    (await ua.getOk('/result', {form: {id: second}})).statusIs(200).bodyIs('9');
  });

  await ua.stop();

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_app_test CASCADE`;

  await pg.end();
});
