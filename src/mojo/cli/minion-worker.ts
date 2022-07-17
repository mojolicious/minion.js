import type {MojoApp} from '@mojojs/core';

/**
 * Minion worker command.
 */
export default async function workerCommand(app: MojoApp): Promise<void> {
  const minion = app.models.minion;
  const worker = minion.worker();
  await worker.start();
}

workerCommand.description = 'Start Minion worker';
workerCommand.usage = `Usage: APPLICATION minion-worker [OPTIONS]

  node index.js minion-worker

Options:
  -h, --help   Show this summary of available options
`;
