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

  const minion = app.models.minion;

  await t.test('Help', async t => {
    const output = await captureOutput(async () => {
      await app.cli.start();
    });
    t.match(output.toString(), /minion-job.*minion-worker/s);
  });

  await t.test('minion-job', async t => {
    await minion.enqueue('test');
    await minion.enqueue('test');
    await minion.enqueue('test', [], {queue: 'important'});

    await t.test('List jobs', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job');
      });
      t.match(output.toString(), /3.+inactive.+important.+test.+2.+inactive.+default.+test.+inactive.+default.+test/s);

      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-l', '1');
      });
      t.match(output2.toString(), /3.+inactive.+important.+test/s);
      t.notMatch(output2.toString(), /2/s);
      t.notMatch(output2.toString(), /1/s);

      const output3 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-l', '1', '-o', '1');
      });
      t.match(output3.toString(), /2.+inactive.+default.+test/s);
      t.notMatch(output3.toString(), /3/s);
      t.notMatch(output3.toString(), /1/s);
    });

    await t.test('Job info', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '1');
      });
      t.match(output.toString(), /task: test/s);

      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '1000');
      });
      t.match(output2.toString(), /Job does not exist/s);
    });
  });

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_cli_test CASCADE`;

  await pg.end();
});
