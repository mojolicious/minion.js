import {minionPlugin, minionAdminPlugin} from '../lib/minion.js';
import mojo from '@mojojs/core';
import Pg from '@mojojs/pg';
import t from 'tap';

const skip = process.env.TEST_ONLINE === undefined ? {skip: 'set TEST_ONLINE to enable this test'} : {};

t.test('Admin', skip, async t => {
  // Isolate tests
  const pg = new Pg(process.env.TEST_ONLINE, {searchPath: ['minion_admin_test']});
  await pg.query`DROP SCHEMA IF EXISTS minion_admin_test CASCADE`;
  await pg.query`CREATE SCHEMA minion_admin_test`;

  const app = mojo();
  app.plugin(minionPlugin, {config: pg});
  app.plugin(minionAdminPlugin);

  app.any('/home').name('test_home');

  app.log.level = 'debug';

  const ua = await app.newTestUserAgent({tap: t});

  const minion = app.models.minion;
  minion.addTask('test', () => {
    // Do nothing
  });
  const finished = await minion.enqueue('test');
  await minion.performJobs();
  const inactive = await minion.enqueue('test');

  await t.test('Dashboard', async () => {
    (await ua.getOk('/minion'))
      .statusIs(200)
      .bodyLike(/Dashboard/)
      .elementExists('a[href=/]');
  });

  await t.test('Stats', async () => {
    (await ua.getOk('/minion/stats'))
      .statusIs(200)
      .jsonIs(0, '/active_jobs')
      .jsonIs(0, '/active_locks')
      .jsonIs(0, '/active_workers')
      .jsonIs(0, '/delayed_jobs')
      .jsonIs(2, '/enqueued_jobs')
      .jsonIs(0, '/failed_jobs')
      .jsonIs(1, '/finished_jobs')
      .jsonIs(1, '/inactive_jobs')
      .jsonIs(0, '/inactive_workers')
      .jsonHas('/uptime');
  });

  await t.test('Jobs', async () => {
    (await ua.getOk('/minion/jobs?state=inactive'))
      .statusIs(200)
      .textLike('tbody td a', new RegExp(`${inactive}`))
      .textUnlike('tbody td a', new RegExp(`${finished}`));
    (await ua.getOk('/minion/jobs?state=finished'))
      .statusIs(200)
      .textLike('tbody td a', new RegExp(`${finished}`))
      .textUnlike('tbody td a', new RegExp(`${inactive}`));
  });

  await t.test('Workers', async () => {
    (await ua.getOk('/minion/workers')).statusIs(200).elementExistsNot('tbody td a');
    const worker = await minion.worker().register();
    (await ua.getOk('/minion/workers'))
      .statusIs(200)
      .elementExists('tbody td a')
      .textLike('tbody td a', new RegExp(`${worker.id}`));
    await worker.unregister();
    (await ua.getOk('/minion/workers')).statusIs(200).elementExistsNot('tbody td a');
  });

  await t.test('Locks', async () => {
    await minion.lock('foo', 3600000);
    await minion.lock('bar', 3600000);
    ua.maxRedirects = 5;
    (await ua.getOk('/minion/locks')).statusIs(200).textLike('tbody td a', /bar/);
    (await ua.getOk('/minion/locks?name=foo')).statusIs(200).textLike('tbody td a', /foo/);
    (await ua.postOk('/minion/locks?_method=DELETE&name=bar'))
      .statusIs(200)
      .textLike('tbody td a', /foo/)
      .textLike('.alert-success', /All selected named locks released/);
    (await ua.postOk('/minion/locks?_method=DELETE&name=foo'))
      .statusIs(200)
      .elementExistsNot('tbody td a')
      .textLike('.alert-success', /All selected named locks released/);
  });

  await t.test('Manage jobs', async () => {
    const job = await minion.job(finished);
    t.equal((await job.info()).state, 'finished');
    (await ua.postOk('/minion/jobs?_method=PATCH', {form: {id: finished, do: 'retry'}}))
      .statusIs(200)
      .textLike('.alert-success', /All selected jobs retried/);
    t.equal((await job.info()).state, 'inactive');

    (await ua.postOk('/minion/jobs?_method=PATCH', {form: {id: finished, do: 'stop'}}))
      .statusIs(200)
      .textLike('.alert-info', /Trying to stop all selected jobs/);

    (await ua.postOk('/minion/jobs?_method=PATCH', {form: {id: finished, do: 'remove'}}))
      .statusIs(200)
      .textLike('.alert-success', /All selected jobs removed/);
    t.same(await minion.job(finished), null);
  });

  await t.test('Bundled static files', async () => {
    (await ua.getOk('/static/minion/jquery/jquery.js')).statusIs(200);
    (await ua.getOk('/static/minion/bootstrap/bootstrap.js')).statusIs(200);
    (await ua.getOk('/static/minion/bootstrap/bootstrap.css')).statusIs(200);
    (await ua.getOk('/static/minion/d3/d3.js')).statusIs(200);
    (await ua.getOk('/static/minion/epoch/epoch.css')).statusIs(200);
    (await ua.getOk('/static/minion/fontawesome/fontawesome.css')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-brands-400.eot')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-brands-400.svg')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-brands-400.ttf')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-brands-400.woff')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-brands-400.woff2')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-regular-400.eot')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-regular-400.svg')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-regular-400.ttf')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-regular-400.woff')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-regular-400.woff2')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-solid-900.eot')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-solid-900.svg')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-solid-900.ttf')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-solid-900.woff')).statusIs(200);
    (await ua.getOk('/static/minion/webfonts/fa-solid-900.woff2')).statusIs(200);
    (await ua.getOk('/static/minion/moment/moment.js')).statusIs(200);
    (await ua.getOk('/static/minion/app.js')).statusIs(200);
    (await ua.getOk('/static/minion/app.css')).statusIs(200);
    (await ua.getOk('/static/minion/logo-black-2x.png')).statusIs(200);
    (await ua.getOk('/static/minion/logo-black.png')).statusIs(200);
  });

  await t.test('Different prefix and return route', async () => {
    app.plugin(minionAdminPlugin, {route: app.any('/also_minion'), returnTo: 'test_home'});
    (await ua.getOk('/also_minion'))
      .statusIs(200)
      .bodyLike(/Dashboard/)
      .elementExists('a[href=/home]');
  });

  await ua.stop();

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_admin_test CASCADE`;

  await pg.end();
});
