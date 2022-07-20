import type Minion from '../../minion.js';
import type {EnqueueOptions, ListJobsOptions} from '../../types.js';
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
      limit: Number,
      notes: String,
      offset: Number
    },
    {
      A: '--attempts',
      a: '--args',
      d: '--delay',
      E: '--expire',
      e: '--enqueue',
      l: '--limit',
      n: '--notes',
      o: '--offset'
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

  const minion = app.models.minion;
  const stdout = process.stdout;

  // Enqueue
  if (parsed.enqueue !== undefined) {
    const id = await minion.enqueue(parsed.enqueue, minionArgs, options);
    stdout.write(`${id}\n`);
  }

  // Job info
  else if (isNaN(id) === false) {
    const job = await minion.job(id);
    if (job === null) {
      stdout.write('Job does not exist.\n');
    } else {
      stdout.write(yaml.dump(await job.info()));
    }
  }

  // List jobs
  else {
    await listJobs(minion, parsed.limit, parsed.offset, options);
  }
}

async function listJobs(minion: Minion, limit = 10, offset = 0, options: ListJobsOptions = {}): Promise<void> {
  const jobs = (await minion.backend.listJobs(offset, limit, options)).jobs;
  process.stdout.write(tablify(jobs.map(job => [job.id.toString(), job.state, job.queue, job.task])));
}

jobCommand.description = 'Manage Minion job';
jobCommand.usage = `Usage: APPLICATION minion-job [OPTIONS] [IDS]

  node index.js minion-job
  node index.js minion-job 10023

Options:
  -A, --attempts <number>   Number of times performing this new job will be
                            attempted, defaults to 1
  -a, --args <JSON array>   Arguments for new job or worker remote control
                            command in JSON format
  -d, --delay <seconds>     Delay new job for this many seconds
  -E, --expire <seconds>    New job is valid for this many seconds before
                            it expires
  -e, --enqueue <task>      New job to be enqueued
  -h, --help                Show this summary of available options
  -l, --limit <number>      Number of jobs/workers to show when listing
                            them, defaults to 100
  -n, --notes <JSON>        Notes in JSON format for new job or list only
                            jobs with one of these notes
  -o, --offset <number>     Number of jobs/workers to skip when listing
                            them, defaults to 0
`;
