import type {MojoApp} from '@mojojs/core';
import {parseArgs} from 'node:util';

/**
 * Minion worker command.
 */
export default async function workerCommand(app: MojoApp, args: string[]): Promise<void> {
  const minion = app.models.minion;
  const worker = minion.worker();

  const {values} = parseArgs({
    args: args.slice(1),
    options: {
      'command-interval': {type: 'string', short: 'C'},
      'dequeue-timeout': {type: 'string', short: 'D'},
      'heartbeat-interval': {type: 'string', short: 'I'},
      jobs: {type: 'string', short: 'j'},
      queue: {type: 'string', short: 'q', multiple: true},
      'repair-interval': {type: 'string', short: 'R'},
      spare: {type: 'string', short: 's'},
      'spare-min-priority': {type: 'string', short: 'S'}
    },
    allowNegative: true
  });

  const status = worker.status;
  if (values['command-interval'] !== undefined) status.commandInterval = toNumber(values['command-interval']);
  if (values['dequeue-timeout'] !== undefined) status.dequeueTimeout = toNumber(values['dequeue-timeout']);
  if (values['heartbeat-interval'] !== undefined) status.heartbeatInterval = toNumber(values['heartbeat-interval']);
  if (values.jobs !== undefined) status.jobs = toNumber(values.jobs);
  if (values.queue !== undefined) status.queues = values.queue;
  if (values['repair-interval'] !== undefined) status.repairInterval = toNumber(values['repair-interval']);
  if (values.spare !== undefined) status.spare = toNumber(values.spare);
  if (values['spare-min-priority'] !== undefined) status.spareMinPriority = toNumber(values['spare-min-priority']);

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

function toNumber(value: string): number {
  const number = Number(value);
  if (value.trim() === '' || Number.isNaN(number)) throw new Error(`Invalid number "${value}"`);
  return number;
}
