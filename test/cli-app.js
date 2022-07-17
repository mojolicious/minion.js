import {minionPlugin} from '../lib/minion.js';
import mojo from '@mojojs/core';
import Pg from '@mojojs/pg';
import {captureOutput} from '@mojojs/util';
import t from 'tap';

const skip = process.env.TEST_ONLINE === undefined ? {skip: 'set TEST_ONLINE to enable this test'} : {};

t.test('Command app', skip, async t => {
  // Isolate tests
  const pg = new Pg(process.env.TEST_ONLINE, {searchPath: ['minion_cli_test']});
  await pg.query`DROP SCHEMA IF EXISTS minion_cli_test CASCADE`;
  await pg.query`CREATE SCHEMA minion_cli_test`;

  const app = mojo();
  app.plugin(minionPlugin, {config: pg});

  await t.test('Help', async t => {
    const output = await captureOutput(async () => {
      await app.cli.start();
    });
    t.match(output.toString(), /minion-jobs.*minion-worker/s);
  });

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_cli_test CASCADE`;

  await pg.end();
});
