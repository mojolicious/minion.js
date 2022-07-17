import {app} from '../index.js';
import Pg from '@mojojs/pg';
import t from 'tap';

const skip = process.env.TEST_ONLINE === undefined ? {skip: 'set TEST_ONLINE to enable this test'} : {};

t.test('Linkcheck', skip, async t => {
  // Isolate tests
  const pg = new Pg(process.env.TEST_ONLINE, {searchPath: ['linkcheck_test']});
  await pg.query`DROP SCHEMA IF EXISTS linkcheck_test CASCADE`;
  await pg.query`CREATE SCHEMA linkcheck_test`;

  app.models.pg = pg;

  const ua = await app.newTestUserAgent({tap: t, maxRedirects: 10});

  await t.test('Enqueue a background job', async () => {
    (await ua.getOk('/')).statusIs(200).elementExists('form input[type=url]');
    (await ua.postOk('/links', {form: {url: 'https://mojolicious.org'}}))
      .statusIs(200)
      .textLike('title', /Result/)
      .textLike('p', /Waiting for result.../)
      .elementExistsNot('table');
  });

  await t.test('Perform background jobs', async () => {
    (await ua.getOk('/links/1'))
      .statusIs(200)
      .textLike('title', /Result/)
      .textLike('p', /Waiting for result.../)
      .elementExistsNot('table');
    await app.models.minion.performJobs();
    (await ua.getOk('/links/1'))
      .statusIs(200)
      .textLike('title', /Result/)
      .elementExistsNot('p')
      .elementExists('table');
  });

  await ua.stop();

  // Clean up once we are done
  await pg.query`DROP SCHEMA linkcheck_test CASCADE`;

  await pg.end();
});
