import type Minion from './minion.js';
import type {JobInfo, MinionArgs, MinionJobId, RetryOptions} from './types.js';

/**
 * Minion job class.
 */
export class Job {
  args: MinionArgs;
  id: MinionJobId;
  retries: number;
  task: string;

  _minion: Minion;

  constructor(minion: Minion, id: MinionJobId, args: MinionArgs, retries: number, task: string) {
    this._minion = minion;
    this.id = id;
    this.args = args;
    this.retries = retries;
    this.task = task;
  }

  async fail(result: any = 'Unknown error'): Promise<boolean> {
    return await this.minion.backend.failJob(this.id, this.retries, result);
  }

  async finish(result?: any): Promise<boolean> {
    return await this.minion.backend.finishJob(this.id, this.retries, result);
  }

  async info(): Promise<JobInfo | null> {
    const info = (await this.minion.backend.listJobs(0, 1, {ids: [this.id]})).jobs[0];
    return info === null ? null : info;
  }

  async note(merge: Record<string, any>): Promise<boolean> {
    return await this.minion.backend.note(this.id, merge);
  }

  async parents(): Promise<Job[]> {
    const results: Job[] = [];

    const info = await this.info();
    if (info === null) return results;

    const minion = this.minion;
    for (const parent of info.parents) {
      const job = await minion.job(parent);
      if (job !== null) results.push(job);
    }

    return results;
  }

  async perform(): Promise<void> {
    try {
      const task = this.minion.tasks[this.task];
      await task(this, ...this.args);
      await this.finish();
    } catch (error) {
      await this.fail(error instanceof Error ? {name: error.name, message: error.message, stack: error.stack} : error);
    }
  }

  async remove(): Promise<boolean> {
    return await this.minion.backend.removeJob(this.id);
  }

  async retry(options: RetryOptions) {
    return await this.minion.backend.retryJob(this.id, this.retries, options);
  }

  get minion(): Minion {
    return this._minion;
  }
}
