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
  minion.addTask('test', async job => {
    await job.finish('pass');
  });

  await t.test('Help', async t => {
    const output = await captureOutput(async () => {
      await app.cli.start();
    });
    t.match(output.toString(), /minion-job.*minion-worker/s);
  });

  await t.test('minion-job', async t => {
    const id = await minion.enqueue('test');
    await minion.enqueue('test2');
    await minion.enqueue('test', [], {queue: 'important'});
    const worker = await minion.worker().register();
    await worker.dequeue(0, {id});

    await t.test('List jobs', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job');
      });
      t.match(output.toString(), /3.+inactive.+important.+test.+2.+inactive.+default.+test2.+active.+default.+test/s);

      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-l', '1');
      });
      t.match(output2.toString(), /3.+inactive.+important.+test/s);
      t.notMatch(output2.toString(), /2/s);
      t.notMatch(output2.toString(), /1/s);

      const output3 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-l', '1', '-o', '1');
      });
      t.match(output3.toString(), /2.+inactive.+default.+test2/s);
      t.notMatch(output3.toString(), /3/s);
      t.notMatch(output3.toString(), /1/s);

      const output4 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-t', 'test2');
      });
      t.match(output4.toString(), /2.+inactive.+default.+test2/s);
      t.notMatch(output4.toString(), /3/s);
      t.notMatch(output4.toString(), /1/s);
      const output5 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-t', 'test2', '--task', 'test');
      });
      t.match(output5.toString(), /3.+inactive.+2.+inactive.+1.+active/s);

      const output6 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-S', 'active');
      });
      t.match(output6.toString(), /1.+active.+default.+test/s);
      t.notMatch(output6.toString(), /2/s);
      t.notMatch(output6.toString(), /3/s);
    });

    await t.test('Foreground', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-f', '1');
      });
      t.equal(output.toString(), '');
      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '1');
      });
      t.match(output2.toString(), /queue: minion_foreground.+result: pass.+state: finished.task: test/s);
    });

    await t.test('Stats', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-s');
      });
      t.match(output.toString(), /inactive_jobs: 2/s);
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
        await app.cli.start('minion-job', '-e', 'test2', '-a', '["works", 23]', '-x', '-A', '3');
      });
      t.match(output.toString(), /4/s);
      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '4');
      });
      t.match(output2.toString(), /args:.+- works.+- 23.+attempts: 3.+lax: true.+task: test2/s);

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

      const output9 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-e', 'test6', '-P', '6', '--parent', '7', '-p', '8', '-q', 'important');
      });
      t.match(output9.toString(), /8/s);
      const output10 = await captureOutput(async () => {
        await app.cli.start('minion-job', '8');
      });
      t.match(output10.toString(), /parents:.+- '6'.+- '7'.+priority: 8.+queue: important.+task: test6/s);
      const output11 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-q', 'important');
      });
      t.match(output11.toString(), /8.+inactive.+3.+inactive/s);
      t.notMatch(output11.toString(), /7/s);
      const output12 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-q', 'important', '-q', 'default');
      });
      t.match(output12.toString(), /8.+inactive.+7.+inactive.+3.+inactive/s);
    });
  });

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_cli_test CASCADE`;

  await pg.end();
});
