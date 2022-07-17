import type Minion from '../../minion.js';
import type {ListJobsOptions} from '../../types.js';
import type {MojoApp} from '@mojojs/core';
import {tablify} from '@mojojs/util';
import nopt from 'nopt';

/**
 * Minion jobs command.
 */
export default async function jobsCommand(app: MojoApp, args: string[]): Promise<void> {
  const parsed = nopt({limit: Number, offset: Number}, {l: '--limit', o: '--offset'}, args, 1);

  const options = {};
  const minion = app.models.minion;

  await listJobs(minion, parsed.limit, parsed.offset, options);
}

async function listJobs(minion: Minion, limit = 10, offset = 0, options: ListJobsOptions = {}): Promise<void> {
  const jobs = (await minion.backend.listJobs(offset, limit, options)).jobs;
  process.stdout.write(tablify(jobs.map(job => [job.id.toString(), job.state, job.queue, job.task])));
}

jobsCommand.description = 'Manage Minion jobs';
jobsCommand.usage = `Usage: APPLICATION minion-jobs [OPTIONS]

  node index.js minion-jobs

Options:
  -h, --help              Show this summary of available options
  -l, --limit <number>    Number of jobs/workers to show when listing
                          them, defaults to 100
  -o, --offset <number>   Number of jobs/workers to skip when listing
                          them, defaults to 0
`;
