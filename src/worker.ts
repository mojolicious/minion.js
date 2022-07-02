import type Minion from './minion.js';
import type {DequeueOptions, WorkerInfo} from './types.js';
import {Job} from './job.js';

/**
 * Minion worker class.
 */
export class Worker {
  status: Record<string, any> = {};

  _id: number | undefined = undefined;
  _minion: Minion;

  constructor(minion: Minion) {
    this._minion = minion;
  }

  async dequeue(wait: number, options: DequeueOptions = {}): Promise<Job | null> {
    const id = this._id;
    if (id === undefined) return null;

    const job = await this.minion.backend.dequeue(id, wait, options);
    return job === null ? null : new Job(this.minion, job.id, job.args, job.retries, job.task);
  }

  get id(): number | null {
    return this._id ?? null;
  }

  async info(): Promise<WorkerInfo | null> {
    const id = this._id;
    if (id === undefined) return null;
    const list = await this.minion.backend.listWorkers(0, 1, {ids: [id]});
    return list.workers[0];
  }

  get minion(): Minion {
    return this._minion;
  }

  async register(): Promise<this> {
    const id = await this.minion.backend.registerWorker(this._id, this.status);
    if (this._id === undefined) this._id = id;
    return this;
  }

  async unregister(): Promise<this> {
    if (this._id === undefined) return this;
    await this.minion.backend.unregisterWorker(this._id);
    this._id = undefined;
    return this;
  }
}
