import {minionPlugin} from '../src/minion.ts';
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
  app.log.level = 'info';
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
    const worker2 = await minion.worker().register();
    await worker.dequeue(0, {id});
    await minion.lock('foo', 36000);
    await minion.lock('bar', 36000);
    await minion.lock('baz', 36000);

    await t.test('List locks', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-L');
      });
      t.match(output.toString(), /baz.+\d+-\d+-\d+T.+bar.+\d+-\d+-\d+T.+foo.+\d+-\d+-\d+T/s);

      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '--locks', '-l', '1');
      });
      t.match(output2.toString(), /baz.+\d+-\d+-\d+T/s);
      t.notMatch(output2.toString(), /bar/s);

      const output3 = await captureOutput(async () => {
        await app.cli.start('minion-job', '--locks', '-o', '1');
      });
      t.match(output3.toString(), /bar.+\d+-\d+-\d+T/s);
      t.notMatch(output3.toString(), /baz/s);

      const output4 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-L', 'baz', 'foo');
      });
      t.match(output4.toString(), /baz.+\d+-\d+-\d+T.+foo.+\d+-\d+-\d+T/s);
      t.notMatch(output4.toString(), /bar/s);
    });

    await t.test('List workers', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-w');
      });
      t.match(output.toString(), new RegExp(`2 {2}.+:${process.pid}.+1 {2}.+:${process.pid}`, 's'));

      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '--workers', '--limit', '1');
      });
      t.match(output2.toString(), /2 {2}/s);
      t.notMatch(output2.toString(), /1 {2}/s);

      const output3 = await captureOutput(async () => {
        await app.cli.start('minion-job', '-w', '--offset', '1');
      });
      t.match(output3.toString(), /1 {2}/s);
      t.notMatch(output3.toString(), /2 {2}/s);
    });

    await t.test('Worker info', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-w', '1');
      });
      t.match(output.toString(), /id: 1.+jobs:.+- '1'/s);

      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '--workers', '1000');
      });
      t.match(output2.toString(), /Worker does not exist/s);
    });

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

    await t.test('History', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-H');
      });
      t.match(output.toString(), /daily:.+failed_jobs: 0.+finished_jobs: 0/s);
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
        await app.cli.start('minion-job', '-e', 'test4', '-E', '300000', '-d', '30000');
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

    await t.test('Retry job', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-R', '2', '-q', 'unimportant');
      });
      t.equal(output.toString(), '');
      const info = await minion.job(2).then(job => job.info());
      t.equal(info.queue, 'unimportant');
    });

    await t.test('Remove job', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '--remove', '3');
      });
      t.equal(output.toString(), '');
      t.same(await minion.job(3), null);

      const id = await minion.enqueue('test');
      const job = await worker.dequeue(0, {id});
      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-job', '--remove', job.id.toString());
      });
      t.match(output2.toString(), /Job is active/s);
    });

    await t.test('Retry failed jobs', async t => {
      const id = await minion.enqueue('test');
      const id2 = await minion.enqueue('test');
      const id3 = await minion.enqueue('test');
      const job = await worker.dequeue(0, {id});
      const job2 = await worker.dequeue(0, {id: id2});
      const job3 = await worker.dequeue(0, {id: id3});
      await job.fail();
      await job2.fail();
      await job3.finish();

      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '--retry-failed');
      });
      t.equal(output.toString(), '');
      t.equal((await job.info()).state, 'inactive');
      t.equal((await job2.info()).state, 'inactive');
      t.equal((await job3.info()).state, 'finished');
    });

    await t.test('Remove failed jobs', async t => {
      const id = await minion.enqueue('test');
      const id2 = await minion.enqueue('test');
      const id3 = await minion.enqueue('test');
      const job = await worker.dequeue(0, {id});
      const job2 = await worker.dequeue(0, {id: id2});
      const job3 = await worker.dequeue(0, {id: id3});
      await job.fail();
      await job2.fail();
      await job3.finish();

      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '--remove-failed');
      });
      t.equal(output.toString(), '');
      t.same(await job.info(), null);
      t.same(await job2.info(), null);
      t.equal((await job3.info()).state, 'finished');
    });

    await t.test('Worker remote control commands', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-job', '-b', 'one');
      });
      t.equal(output.toString(), '');
      let results = [];
      worker.addCommand('one', async (worker, ...args) => results.push(['one:1', ...args]));
      worker2.addCommand('one', async (worker, ...args) => results.push(['one:2', ...args]));
      worker2.addCommand('two', async (worker, ...args) => results.push(['two:2', ...args]));
      await worker.processCommands();
      await worker2.processCommands();
      t.same(results, [['one:1'], ['one:2']]);

      results = [];
      await app.cli.start('minion-job', '-b', 'one', '1');
      await worker.processCommands();
      await worker2.processCommands();
      t.same(results, [['one:1']]);

      results = [];
      await app.cli.start('minion-job', '-b', 'one', '1', '2');
      await worker.processCommands();
      await worker2.processCommands();
      t.same(results, [['one:1'], ['one:2']]);

      results = [];
      await app.cli.start('minion-job', '-b', 'two');
      await worker.processCommands();
      await worker2.processCommands();
      t.same(results, [['two:2']]);

      results = [];
      await app.cli.start('minion-job', '-b', 'one', '-a', '["foo", {"bar": 23}]');
      await worker.processCommands();
      await worker2.processCommands();
      t.same(results, [
        ['one:1', 'foo', {bar: 23}],
        ['one:2', 'foo', {bar: 23}]
      ]);
    });

    await worker.unregister();
    await worker2.unregister();
  });

  await app.models.minion.reset({all: true});

  await t.test('minion-schedule', async t => {
    await t.test('Empty list', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-schedule');
      });
      t.notMatch(output.toString(), /\S/);
    });

    await t.test('Add schedules', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-schedule', '-e', 'daily', '-c', '0 4 * * *', '-t', 'test');
      });
      t.match(output.toString(), /^\d+\n$/);

      await captureOutput(async () => {
        await app.cli.start(
          'minion-schedule',
          '-e',
          'every5',
          '-c',
          '*/5 * * * *',
          '-t',
          'test',
          '-a',
          '[1, 2, 3]',
          '-A',
          '3',
          '-E',
          '60000',
          '-n',
          '{"foo":"bar"}',
          '-p',
          '5',
          '-q',
          'important',
          '-x'
        );
      });
      const info = (await minion.listSchedules(0, 1, {names: ['every5']})).schedules[0];
      t.same(info.args, [1, 2, 3]);
      t.equal(info.attempts, 3);
      t.equal(info.expire, 60000);
      t.same(info.notes, {foo: 'bar'});
      t.equal(info.priority, 5);
      t.equal(info.queue, 'important');
      t.equal(info.lax, true);
    });

    await t.test('Missing options', async t => {
      await t.rejects(
        app.cli.start('minion-schedule', '-e', 'bad', '-t', 'test'),
        /Cron expression is required \(-c\)/
      );
      await t.rejects(app.cli.start('minion-schedule', '-e', 'bad', '-c', '@daily'), /Task is required \(-t\)/);
      await t.rejects(app.cli.start('minion-schedule', '-e', 'bad', '-c', '61 * * * *', '-t', 'test'), /out of range/);
      await t.rejects(
        app.cli.start('minion-schedule', '-e', 'bad', '-c', '@daily', '-t', 'test', '-p', 'x'),
        /Invalid/
      );
    });

    await t.test('List and info', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-schedule');
      });
      t.match(output.toString(), /\d+\s+every5\s+test\s+\*\/5 \* \* \* \*\s+\S+Z\s+0\n/);
      t.match(output.toString(), /\d+\s+daily\s+test\s+0 4 \* \* \*\s+\S+T04:00:00\.000Z\s+0\n/);

      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-schedule', '-l', '1');
      });
      t.match(output2.toString(), /every5/);
      t.notMatch(output2.toString(), /daily/);

      const output3 = await captureOutput(async () => {
        await app.cli.start('minion-schedule', '-o', '1');
      });
      t.match(output3.toString(), /daily/);
      t.notMatch(output3.toString(), /every5/);

      const output4 = await captureOutput(async () => {
        await app.cli.start('minion-schedule', 'daily');
      });
      t.match(output4.toString(), /cron: 0 4 \* \* \*/);
      t.match(output4.toString(), /name: daily/);
      t.match(output4.toString(), /paused: false/);

      await t.rejects(app.cli.start('minion-schedule', 'missing'), /Schedule does not exist/);
    });

    await t.test('Pause, resume and remove', async t => {
      await app.cli.start('minion-schedule', '-P', 'daily');
      t.equal((await minion.listSchedules(0, 1, {names: ['daily']})).schedules[0].paused, true);
      await app.cli.start('minion-schedule', '-r', 'daily');
      t.equal((await minion.listSchedules(0, 1, {names: ['daily']})).schedules[0].paused, false);
      await t.rejects(app.cli.start('minion-schedule', '-P', 'missing'), /Schedule does not exist/);
      await t.rejects(app.cli.start('minion-schedule', '-r', 'missing'), /Schedule does not exist/);
      await t.rejects(app.cli.start('minion-schedule', '-R', 'missing'), /Schedule does not exist/);
    });

    await t.test('Dispatch', async t => {
      const output = await captureOutput(async () => {
        await app.cli.start('minion-schedule', '-d');
      });
      t.equal(output.toString(), '[]\n');

      const id = (await minion.listSchedules(0, 1, {names: ['daily']})).schedules[0].id;
      await pg.query`UPDATE minion_schedules SET next_run = NOW() - INTERVAL '1 minute' WHERE id = ${id}`;
      const output2 = await captureOutput(async () => {
        await app.cli.start('minion-schedule', '-d');
      });
      t.match(output2.toString(), /name: daily/);
      t.match(output2.toString(), /job: \d+/);
    });

    await app.cli.start('minion-schedule', '-R', 'daily');
    await app.cli.start('minion-schedule', '-R', 'every5');
    t.equal((await minion.listSchedules(0, 1)).total, 0);
  });

  await app.models.minion.reset({all: true});

  await t.test('minion-worker', async t => {
    await t.test('Signals', async t => {
      const id = await minion.enqueue('test');

      const output = await captureOutput(async () => {
        await app.cli.start(
          'minion-worker',
          '--heartbeat-interval',
          '0',
          '--jobs',
          '2',
          '--spare',
          '3',
          '--queue',
          'important',
          '--queue',
          'default',
          '--dequeue-timeout',
          '3',
          '--command-interval',
          '5',
          '--dispatch-interval',
          '0',
          '--repair-interval',
          '7200',
          '-L',
          'test=1',
          '--limit',
          'test2=0',
          '--spare-min-priority',
          '3'
        );
      });
      t.equal(output.toString(), '');

      const result = await minion.result(id);
      t.equal(result.state, 'finished');

      t.equal(await minion.workers().total(), 1);
      const worker = await minion.workers().next();
      const status = worker.status;
      t.equal(status.jobs, 2);
      t.equal(status.spare, 3);
      t.equal(status.type, 'Node.js');
      t.same(status.queues, ['important', 'default']);
      t.ok(status.performed >= 0);
      t.equal(status.dequeueTimeout, 3000);
      t.equal(status.heartbeatInterval, 0);
      t.equal(status.commandInterval, 5000);
      t.equal(status.dispatchInterval, 0);
      t.ok(status.repairInterval >= 3600000 && status.repairInterval < 7200000);
      t.same(status.limits, {test: 1, test2: 0});
      t.equal(status.spareMinPriority, 3);

      // Windows has no signals
      if (process.platform === 'win32') {
        process.emit('SIGINT');
      } else {
        process.kill(process.pid, 'SIGINT');
      }

      while ((await minion.workers().total()) > 0) {
        // Just wait for the worker to stop
      }
    });
  });

  await t.test('Invalid options', async t => {
    await t.rejects(app.cli.start('minion-job', '-l', 'ten'), /Invalid number "ten"/);
    await t.rejects(app.cli.start('minion-job', '-e', 'test', '-P', '1x'), /Invalid number "1x"/);
    await t.rejects(app.cli.start('minion-job', '--worker'), /Unknown option '--worker'/);
    await t.rejects(app.cli.start('minion-worker', '-j', ''), /Invalid number ""/);
    await t.rejects(app.cli.start('minion-worker', '--job', '2'), /Unknown option '--job'/);
    await t.rejects(app.cli.start('minion-worker', '-L', 'test'), /Invalid limit "test"/);
    await t.rejects(app.cli.start('minion-worker', '-L', 'test=-1'), /Invalid limit "test=-1"/);
  });

  // Clean up once we are done
  await pg.query`DROP SCHEMA minion_cli_test CASCADE`;

  await pg.end();
});
