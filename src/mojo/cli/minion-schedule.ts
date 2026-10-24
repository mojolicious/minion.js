import type Minion from '../../minion.ts';
import type {ScheduleOptions} from '../../types.ts';
import type {MojoApp} from '@mojojs/core';
import {parseArgs} from 'node:util';
import {tablify} from '@mojojs/util';
import * as yaml from 'js-yaml';

/**
 * Minion schedule command.
 */
export default async function scheduleCommand(app: MojoApp, args: string[]): Promise<void> {
  const {values, positionals} = parseArgs({
    args: args.slice(1),
    options: {
      args: {type: 'string', short: 'a'},
      attempts: {type: 'string', short: 'A'},
      cron: {type: 'string', short: 'c'},
      dispatch: {type: 'boolean', short: 'd'},
      enqueue: {type: 'string', short: 'e'},
      expire: {type: 'string', short: 'E'},
      lax: {type: 'boolean', short: 'x'},
      limit: {type: 'string', short: 'l'},
      notes: {type: 'string', short: 'n'},
      offset: {type: 'string', short: 'o'},
      pause: {type: 'string', short: 'P'},
      priority: {type: 'string', short: 'p'},
      queue: {type: 'string', short: 'q'},
      remove: {type: 'string', short: 'R'},
      resume: {type: 'string', short: 'r'},
      task: {type: 'string', short: 't'}
    },
    allowPositionals: true,
    allowNegative: true
  });

  const minionArgs = [];
  if (values.args !== undefined) {
    const data = JSON.parse(values.args);
    if (Array.isArray(data)) minionArgs.push(...data);
  }
  const options: ScheduleOptions = {};

  if (values.attempts !== undefined) options.attempts = toNumber(values.attempts);
  if (values.expire !== undefined) options.expire = toNumber(values.expire);
  if (values.notes !== undefined) options.notes = JSON.parse(values.notes);
  if (values.priority !== undefined) options.priority = toNumber(values.priority);
  if (values.queue !== undefined) options.queue = values.queue;
  if (values.lax === true) options.lax = true;
  const limit = values.limit === undefined ? undefined : toNumber(values.limit);
  const offset = values.offset === undefined ? undefined : toNumber(values.offset);

  const minion = app.models.minion;
  const stdout = process.stdout;

  // Add or update a schedule
  if (values.enqueue !== undefined) {
    if (values.cron === undefined) throw new Error('Cron expression is required (-c).');
    if (values.task === undefined) throw new Error('Task is required (-t).');
    const id = await minion.schedule(values.enqueue, values.cron, values.task, minionArgs, options);
    stdout.write(`${id}\n`);
  }

  // Pause
  else if (values.pause !== undefined) {
    if ((await minion.pauseSchedule(values.pause)) === false) throw new Error('Schedule does not exist.');
  }

  // Resume
  else if (values.resume !== undefined) {
    if ((await minion.resumeSchedule(values.resume)) === false) throw new Error('Schedule does not exist.');
  }

  // Remove
  else if (values.remove !== undefined) {
    if ((await minion.unschedule(values.remove)) === false) throw new Error('Schedule does not exist.');
  }

  // Manually dispatch any due schedules
  else if (values.dispatch === true) {
    stdout.write(yaml.dump(await minion.dispatchSchedules()));
  }

  // Schedule info
  else if (positionals.length > 0) {
    const info = (await minion.listSchedules(0, 1, {names: [positionals[0]]})).schedules[0];
    if (info === undefined) throw new Error('Schedule does not exist.');
    stdout.write(yaml.dump(info));
  }

  // List schedules
  else {
    await listSchedules(minion, limit, offset);
  }
}

async function listSchedules(minion: Minion, limit = 100, offset = 0): Promise<void> {
  const schedules = (await minion.listSchedules(offset, limit)).schedules;
  process.stdout.write(
    tablify(
      schedules.map(schedule => [
        schedule.id.toString(),
        schedule.name,
        schedule.task,
        schedule.cron,
        schedule.next_run.toISOString(),
        schedule.paused ? '1' : '0'
      ])
    )
  );
}

scheduleCommand.description = 'Manage Minion schedules';
scheduleCommand.usage = `Usage: APPLICATION minion-schedule [OPTIONS] [NAME]

  node index.js minion-schedule
  node index.js minion-schedule daily
  node index.js minion-schedule -e daily -c '0 4 * * *' -t cleanup
  node index.js minion-schedule -e foo -c '*/5 * * * *' -t bar -a '[1, 2, 3]' -p 5 -q important
  node index.js minion-schedule -e weekday_report -c '0 9 * * 1-5' -t report -A 3
  node index.js minion-schedule -P daily
  node index.js minion-schedule -r daily
  node index.js minion-schedule -R daily
  node index.js minion-schedule -d

Options:
  -A, --attempts <number>         Number of times each enqueued job will be
                                  attempted, defaults to 1
  -a, --args <JSON array>         Arguments for the new schedule in JSON format
  -c, --cron <expression>         Cron expression for new schedule (in UTC)
  -d, --dispatch                  Manually dispatch any due schedules
  -E, --expire <milliseconds>     Each enqueued job is valid for this many
                                  milliseconds before it expires
  -e, --enqueue <name>            Add or replace a schedule with this name
                                  (requires -c and -t)
  -h, --help                      Show this summary of available options
  -l, --limit <number>            Number of schedules to show when listing
                                  them, defaults to 100
  -n, --notes <JSON>              Notes in JSON format for the new schedule
  -o, --offset <number>           Number of schedules to skip when listing
                                  them, defaults to 0
  -P, --pause <name>              Pause a schedule
  -p, --priority <number>         Priority of each enqueued job, defaults to 0
  -q, --queue <name>              Queue to put each enqueued job in, defaults
                                  to "default"
  -R, --remove <name>             Remove a schedule
  -r, --resume <name>             Resume a paused schedule
  -t, --task <name>               Task name for the new schedule
  -x, --lax                       Existing jobs each enqueued job depends on
                                  may also have failed to allow for it to be
                                  processed
`;

function toNumber(value: string): number {
  const number = Number(value);
  if (value.trim() === '' || Number.isNaN(number)) throw new Error(`Invalid number "${value}"`);
  return number;
}
