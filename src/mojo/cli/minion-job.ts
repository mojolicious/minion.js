import type Minion from '../../minion.js';
import type {ListJobsOptions} from '../../types.js';
import type {MojoApp} from '@mojojs/core';
import {tablify} from '@mojojs/util';
import yaml from 'js-yaml';
import nopt from 'nopt';

/**
 * Minion job command.
 */
export default async function jobCommand(app: MojoApp, args: string[]): Promise<void> {
  const parsed = nopt({limit: Number, offset: Number}, {l: '--limit', o: '--offset'}, args, 1);

  const options = {};
  const minion = app.models.minion;
  const id = parseInt(parsed.argv.remain[0]);

  const stdout = process.stdout;

  // Job info
  if (isNaN(id) === false) {
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
  -h, --help              Show this summary of available options
  -l, --limit <number>    Number of jobs/workers to show when listing
                          them, defaults to 100
  -o, --offset <number>   Number of jobs/workers to skip when listing
                          them, defaults to 0
`;
