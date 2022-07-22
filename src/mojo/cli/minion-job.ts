import type Minion from '../../minion.js';
import type {EnqueueOptions, ListJobsOptions, ListLocksOptions} from '../../types.js';
import type {MojoApp} from '@mojojs/core';
import {tablify} from '@mojojs/util';
import yaml from 'js-yaml';
import nopt from 'nopt';

/**
 * Minion job command.
 */
export default async function jobCommand(app: MojoApp, args: string[]): Promise<void> {
  const parsed = nopt(
    {
      args: String,
      attempts: Number,
      delay: Number,
      expire: Number,
      enqueue: String,
      foreground: Boolean,
      lax: Boolean,
      limit: Number,
      locks: Boolean,
      notes: String,
      offset: Number,
      parent: [Number, Array],
      priority: Number,
      queue: [String, Array],
      state: [String, Array],
      stats: Boolean,
      task: [String, Array],
      workers: Boolean
    },
    {
      A: '--attempts',
      a: '--args',
      d: '--delay',
      E: '--expire',
      e: '--enqueue',
      f: '--foreground',
      L: '--locks',
      l: '--limit',
      n: '--notes',
      o: '--offset',
      P: '--parent',
      p: '--priority',
      q: '--queue',
      S: '--state',
      s: '--stats',
      t: '--task',
      x: '--lax',
      w: '--workers'
    },
    args,
    1
  );

  const id = parseInt(parsed.argv.remain[0]);
  const minionArgs = [];
  if (parsed.args !== undefined) {
    const data = JSON.parse(parsed.args);
    if (Array.isArray(data)) minionArgs.push(...data);
  }
  const options: EnqueueOptions & ListJobsOptions = {};

  if (typeof parsed.attempts === 'number') options.attempts = parsed.attempts;
  if (typeof parsed.delay === 'number') options.delay = parsed.delay;
  if (typeof parsed.expire === 'number') options.expire = parsed.expire;
  if (typeof parsed.notes === 'string') options.notes = JSON.parse(parsed.notes);
  if (Array.isArray(parsed.parent)) options.parents = parsed.parent;
  if (typeof parsed.priority === 'number') options.priority = parsed.priority;
  if (Array.isArray(parsed.queue)) {
    options.queue = parsed.queue[0];
    options.queues = parsed.queue;
  }
  if (Array.isArray(parsed.state)) options.states = parsed.state;
  if (Array.isArray(parsed.task)) options.tasks = parsed.task;
  if (parsed.lax === true) options.lax = true;

  const minion = app.models.minion;
  const stdout = process.stdout;

  // Stats
  if (parsed.stats === true) {
    stdout.write(yaml.dump(await minion.stats()));
  }

  // Enqueue
  else if (parsed.enqueue !== undefined) {
    const id = await minion.enqueue(parsed.enqueue, minionArgs, options);
    stdout.write(`${id}\n`);
  }

  // List locks
  else if (parsed.locks === true) {
    const names = parsed.argv.remain;
    await listLocks(minion, parsed.limit, parsed.offset, {names: names.length > 0 ? names : undefined});
  }

  // List workers
  else if (parsed.workers === true) {
    if (isNaN(id) === false) {
      const worker = (await minion.backend.listWorkers(0, 1, {ids: [id]})).workers[0];
      if (worker === undefined) {
        stdout.write('Worker does not exist.\n');
      } else {
        stdout.write(yaml.dump(worker));
      }
    } else {
      await listWorkers(minion, parsed.limit, parsed.offset);
    }
  }

  // Job info
  else if (isNaN(id) === false) {
    const job = await minion.job(id);
    if (job === null) {
      stdout.write('Job does not exist.\n');
    }

    // Foreground
    else if (parsed.foreground === true) {
      await minion.foreground(id);
    }

    // Job info
    else {
      stdout.write(yaml.dump(await job.info()));
    }
  }

  // List jobs
  else {
    await listJobs(minion, parsed.limit, parsed.offset, options);
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
  node index.js minion-job -L
  node index.js minion-job -L some_lock some_other_lock

Options:
  -A, --attempts <number>   Number of times performing this new job will be
                            attempted, defaults to 1
  -a, --args <JSON array>   Arguments for new job or worker remote control
                            command in JSON format
  -d, --delay <seconds>     Delay new job for this many seconds
  -E, --expire <seconds>    New job is valid for this many seconds before
                            it expires
  -e, --enqueue <task>      New job to be enqueued
  -f, --foreground          Retry job in "minion_foreground" queue and
                            perform it right away in the foreground (very
                            useful for debugging)
  -h, --help                Show this summary of available options
  -L, --locks               List active named locks
  -l, --limit <number>      Number of jobs/workers to show when listing
                            them, defaults to 100
  -n, --notes <JSON>        Notes in JSON format for new job or list only
                            jobs with one of these notes
  -o, --offset <number>     Number of jobs/workers to skip when listing
                            them, defaults to 0
  -P, --parent <id>         One or more jobs the new job depends on
  -p, --priority <number>   Priority of new job, defaults to 0
  -q, --queue <name>        Queue to put new job in, defaults to "default",
                            or list only jobs in these queues
  -S, --state <name>        List only jobs in these states
  -s, --stats               Show queue statistics
  -t, --task <name>         List only jobs for these tasks
  -w, --workers             List workers instead of jobs, or show
                            information for a specific worker
  -x, --lax                 Jobs this job depends on may also have failed
                            to allow for it to be processed
`;
