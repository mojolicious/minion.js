import type Minion from '../../minion.ts';
import type {EnqueueOptions, ListJobsOptions, ListLocksOptions, MinionStates} from '../../types.ts';
import type {MojoApp} from '@mojojs/core';
import {parseArgs} from 'node:util';
import {tablify} from '@mojojs/util';
import * as yaml from 'js-yaml';

/**
 * Minion job command.
 */
export default async function jobCommand(app: MojoApp, args: string[]): Promise<void> {
  const {values, positionals} = parseArgs({
    args: args.slice(1),
    options: {
      args: {type: 'string', short: 'a'},
      attempts: {type: 'string', short: 'A'},
      broadcast: {type: 'string', short: 'b'},
      delay: {type: 'string', short: 'd'},
      expire: {type: 'string', short: 'E'},
      enqueue: {type: 'string', short: 'e'},
      foreground: {type: 'boolean', short: 'f'},
      history: {type: 'boolean', short: 'H'},
      lax: {type: 'boolean', short: 'x'},
      limit: {type: 'string', short: 'l'},
      locks: {type: 'boolean', short: 'L'},
      notes: {type: 'string', short: 'n'},
      offset: {type: 'string', short: 'o'},
      parent: {type: 'string', short: 'P', multiple: true},
      priority: {type: 'string', short: 'p'},
      queue: {type: 'string', short: 'q', multiple: true},
      remove: {type: 'boolean'},
      retry: {type: 'boolean', short: 'R'},
      'remove-failed': {type: 'boolean'},
      'retry-failed': {type: 'boolean'},
      state: {type: 'string', short: 'S', multiple: true},
      stats: {type: 'boolean', short: 's'},
      task: {type: 'string', short: 't', multiple: true},
      workers: {type: 'boolean', short: 'w'}
    },
    allowPositionals: true,
    allowNegative: true
  });

  const id = parseInt(positionals[0]);
  const minionArgs = [];
  if (values.args !== undefined) {
    const data = JSON.parse(values.args);
    if (Array.isArray(data)) minionArgs.push(...data);
  }
  const options: EnqueueOptions & ListJobsOptions = {};

  if (values.attempts !== undefined) options.attempts = toNumber(values.attempts);
  if (values.delay !== undefined) options.delay = toNumber(values.delay);
  if (values.expire !== undefined) options.expire = toNumber(values.expire);
  if (values.notes !== undefined) options.notes = JSON.parse(values.notes);
  if (values.parent !== undefined) options.parents = values.parent.map(toNumber);
  if (values.priority !== undefined) options.priority = toNumber(values.priority);
  if (values.queue !== undefined) {
    options.queue = values.queue[0];
    options.queues = values.queue;
  }
  if (values.state !== undefined) options.states = values.state as MinionStates[];
  if (values.task !== undefined) options.tasks = values.task;
  if (values.lax === true) options.lax = true;
  const limit = values.limit === undefined ? undefined : toNumber(values.limit);
  const offset = values.offset === undefined ? undefined : toNumber(values.offset);

  const minion = app.models.minion;
  const stdout = process.stdout;

  // Worker remote control command
  if (values.broadcast !== undefined) {
    await minion.broadcast(
      values.broadcast,
      minionArgs,
      positionals.map(id => parseInt(id))
    );
  }

  // History
  else if (values.history === true) {
    stdout.write(yaml.dump(await minion.history()));
  }

  // Stats
  else if (values.stats === true) {
    stdout.write(yaml.dump(await minion.stats()));
  }

  // Enqueue
  else if (values.enqueue !== undefined) {
    const id = await minion.enqueue(values.enqueue, minionArgs, options);
    stdout.write(`${id}\n`);
  }

  // List locks
  else if (values.locks === true) {
    const names = positionals;
    await listLocks(minion, limit, offset, {names: names.length > 0 ? names : undefined});
  }

  // List workers
  else if (values.workers === true) {
    if (isNaN(id) === false) {
      const worker = (await minion.backend.listWorkers(0, 1, {ids: [id]})).workers[0];
      if (worker === undefined) {
        stdout.write('Worker does not exist.\n');
      } else {
        stdout.write(yaml.dump(worker));
      }
    } else {
      await listWorkers(minion, limit, offset);
    }
  }

  // Retry all failed jobs
  else if (values['retry-failed'] === true) {
    for await (const job of minion.jobs({states: ['failed']})) {
      await minion.job(job.id).then(job => job?.retry(options));
    }
  }

  // Remove all failed jobs
  else if (values['remove-failed'] === true) {
    for await (const job of minion.jobs({states: ['failed']})) {
      await minion.job(job.id).then(job => job?.remove());
    }
  }

  // Job actions
  else if (isNaN(id) === false) {
    const job = await minion.job(id);
    if (job === null) {
      stdout.write('Job does not exist.\n');
    }

    // Retry
    else if (values.retry === true) {
      await job.retry(options);
    }

    // Remove
    else if (values.remove === true) {
      const removed = await job.remove();
      if (removed === false) stdout.write('Job is active.\n');
    }

    // Foreground
    else if (values.foreground === true) {
      await minion.foreground(id);
    }

    // Job info
    else {
      stdout.write(yaml.dump(await job.info()));
    }
  }

  // List jobs
  else {
    await listJobs(minion, limit, offset, options);
  }
}

async function listJobs(minion: Minion, limit = 100, offset = 0, options: ListJobsOptions = {}): Promise<void> {
  const jobs = (await minion.backend.listJobs(offset, limit, options)).jobs;
  process.stdout.write(tablify(jobs.map(job => [job.id.toString(), job.state, job.queue, job.task])));
}

async function listLocks(minion: Minion, limit = 100, offset = 0, options: ListLocksOptions): Promise<void> {
  const locks = (await minion.backend.listLocks(offset, limit, options)).locks;
  process.stdout.write(tablify(locks.map(lock => [lock.name, lock.expires.toISOString()])));
}

async function listWorkers(minion: Minion, limit = 100, offset = 0): Promise<void> {
  const workers = (await minion.backend.listWorkers(offset, limit)).workers;
  process.stdout.write(tablify(workers.map(worker => [worker.id.toString(), worker.host + ':' + worker.pid])));
}

jobCommand.description = 'Manage Minion job';
jobCommand.usage = `Usage: APPLICATION minion-job [OPTIONS] [IDS]

  node index.js minion-job
  node index.js minion-job 10023
  node index.js minion-job -w
  node index.js minion-job -w 23
  node index.js minion-job -s
  node index.js minion-job -f 10023
  node index.js minion-job -q important -t foo -t bar -S inactive
  node index.js minion-job -q 'host:localhost' -S inactive
  node index.js minion-job -e foo -a '[23, "bar"]'
  node index.js minion-job -e foo -x -P 10023 -P 10024 -p 5 -q important
  node index.js minion-job -e 'foo' -n '{"test":123}'
  node index.js minion-job -R -d 10000 -E 300000 10023
  node index.js minion-job --remove 10023
  node index.js minion-job --retry-failed
  node index.js minion-job -n '["test"]'
  node index.js minion-job -L
  node index.js minion-job -L some_lock some_other_lock
  node index.js minion-job -b jobs -a '[12]'
  node index.js minion-job -b jobs -a '[12]' 23 24 25

Options:
  -A, --attempts <number>       Number of times performing this new job will
                                be attempted, defaults to 1
  -a, --args <JSON array>       Arguments for new job or worker remote control
                                command in JSON format
  -b, --broadcast <command>     Broadcast remote control command to one or
                                more workers
  -d, --delay <milliseconds>    Delay new job for this many milliseconds
  -E, --expire <milliseconds>   New job is valid for this many milliseconds
                                before it expires
  -e, --enqueue <task>          New job to be enqueued
  -f, --foreground              Retry job in "minion_foreground" queue and
                                perform it right away in the foreground (very
                                useful for debugging)
  -H, --history                 Show queue history
  -h, --help                    Show this summary of available options
  -L, --locks                   List active named locks
  -l, --limit <number>          Number of jobs/workers to show when listing
                                them, defaults to 100
  -n, --notes <JSON>            Notes in JSON format for new job or list only
                                jobs with one of these notes
  -o, --offset <number>         Number of jobs/workers to skip when listing
                                them, defaults to 0
  -P, --parent <id>             One or more jobs the new job depends on
  -p, --priority <number>       Priority of new job, defaults to 0
  -q, --queue <name>            Queue to put new job in, defaults to
                                "default", or list only jobs in these queues
  -R, --retry                   Retry job
      --retry-failed            Retry all failed jobs at once
      --remove                  Remove job
      --remove-failed           Remove all failed jobs at once
  -S, --state <name>            List only jobs in these states
  -s, --stats                   Show queue statistics
  -t, --task <name>             List only jobs for these tasks
  -w, --workers                 List workers instead of jobs, or show
                                information for a specific worker
  -x, --lax                     Jobs this job depends on may also have failed
                                to allow for it to be processed
`;

function toNumber(value: string): number {
  const number = Number(value);
  if (value.trim() === '' || Number.isNaN(number)) throw new Error(`Invalid number "${value}"`);
  return number;
}
