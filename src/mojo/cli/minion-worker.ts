import type {MojoApp} from '@mojojs/core';
import nopt from 'nopt';

/**
 * Minion worker command.
 */
export default async function workerCommand(app: MojoApp, args: string[]): Promise<void> {
  const minion = app.models.minion;
  const worker = minion.worker();

  const parsed = nopt(
    {
      'command-interval': Number,
      'dequeue-timeout': Number,
      'heartbeat-interval': Number,
      jobs: Number,
      queue: [String, Array],
      'repair-interval': Number,
      spare: Number,
      'spare-min-priority': Number
    },
    {
      C: '--command-interval',
      D: '--dequeue-timeout',
      I: '--heartbeat-interval',
      j: '--jobs',
      q: '--queue',
      R: '--repair-interval',
      s: '--spare',
      S: '--spare-min-priority'
    },
    args,
    1
  );

  const status = worker.status;
  if (typeof parsed['command-interval'] === 'number') status.commandInterval = parsed['command-interval'];
  if (typeof parsed['dequeue-timeout'] === 'number') status.dequeueTimeout = parsed['dequeue-timeout'];
  if (typeof parsed['heartbeat-interval'] === 'number') status.heartbeatInterval = parsed['heartbeat-interval'];
  if (typeof parsed.jobs === 'number') status.jobs = parsed.jobs;
  if (Array.isArray(parsed.queue)) status.queues = parsed.queue;
  if (typeof parsed['repair-interval'] === 'number') status.repairInterval = parsed['repair-interval'];
  if (typeof parsed.spare === 'number') status.spare = parsed.spare;
  if (typeof parsed['spare-min-priority'] === 'number') status.spareMinPriority = parsed['spare-min-priority'];

  minion.addJobHook('job:before', (minion, job) => {
    minion.app.log.trace(`Performing job "${job.id}" with task "${job.task}"`);
  });

  process.on('SIGINT', () => worker.stop());

  await worker.start();
}

workerCommand.description = 'Start Minion worker';
workerCommand.usage = `Usage: APPLICATION minion-worker [OPTIONS]

  node index.js minion-worker
  node index.js minion-worker -I15 -C 5 -R 3600 -j 10
  node index.js minion-worker -q important -q default

Options:
  -C, --command-interval <seconds>     Worker remote control command interval,
                                       defaults to 10
  -D, --dequeue-timeout <seconds>      Maximum amount of time to wait for
                                       jobs, defaults to 5
  -h, --help                           Show this summary of available options
  -I, --heartbeat-interval <seconds>   Heartbeat interval, defaults to 300
  -j, --jobs <number>                  Maximum number of jobs to perform
                                       concurrently (not including spare
                                       slots), defaults to 4
  -q, --queue <name>                   One or more queues to get jobs from,
                                       defaults to "default"
  -R, --repair-interval <seconds>      Repair interval, up to half of this
                                       value can be subtracted randomly to
                                       make sure not all workers repair at the
                                       same time, defaults to 21600 (6 hours)
  -s, --spare <number>                 Number of spare slots to reserve for
                                       high priority jobs, defaults to 1
  -S, --spare-min-priority <number>    Minimum priority of jobs to use spare
                                       slots for, defaults to 1
`;
