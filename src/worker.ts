import type Minion from './minion.js';
import type {DequeueOptions, MinionCommand, WorkerInfo, WorkerOptions} from './types.js';
import {Job} from './job.js';

/**
 * Minion worker class.
 */
export class Worker {
  commands: Record<string, MinionCommand>;
  status: Record<string, any>;

  _id: number | undefined = undefined;
  _minion: Minion;

  constructor(minion: Minion, options: WorkerOptions = {}) {
    this._minion = minion;
    this.commands = options.commands ?? {};
    this.status = options.status ?? {};
  }

  addCommand(name: string, fn: MinionCommand): void {
    this.commands[name] = fn;
  }

  async dequeue(wait = 0, options: DequeueOptions = {}): Promise<Job | null> {
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

  async processCommands(): Promise<void> {
    const id = this._id;
    if (id === undefined) return;

    const commands = await this.minion.backend.receive(id);
    for (const [command, ...args] of commands) {
      const fn = this.commands[command];
      if (fn !== undefined) await fn(this, ...args);
    }
  }

  async register(): Promise<this> {
    const id = await this.minion.backend.registerWorker(this._id, {status: this.status});
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
