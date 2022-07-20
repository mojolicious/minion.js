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

    await t.test('Enqueue', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-e', 'test2', '-a', '["works", 23]', '-A', '3');
      });
      t.match(output.toString(), /4/s);
      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '4');
      });
      t.match(output2.toString(), /args:.+- works.+- 23.+attempts: 3.+task: test2/s);

      const output3 = await captureOutput(async () => {
        await app.cli.start('minion-job', '--enqueue', 'test3');
      });
      t.match(output3.toString(), /5/s);
      const output4 = await captureOutput(async () => {
        await app.cli.start('minion-job', '5');
      });
      t.match(output4.toString(), /args: \[\].+task: test3/s);

      const output5 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-e', 'test4', '-E', '300', '-d', '30');
      });
      t.match(output5.toString(), /6/s);
      const output6 = await captureOutput(async () => {
        await app.cli.start('minion-job', '6');
      });
      t.match(output6.toString(), /delayed: \d+-\d+-\d+T.+expires: \d+-\d+-\d+T.+task: test4/s);

      const output7 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-e', 'test5', '-n', '{"some_note":"works"}');
      });
      t.match(output7.toString(), /7/s);
      const output8 = await captureOutput(async () => {
        await app.cli.start('minion-job', '--notes', '["some_note"]');
      });
      t.match(output8.toString(), /7.+inactive.+default.+test5/s);
    });
  });

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_cli_test CASCADE`;

  await pg.end();
});
