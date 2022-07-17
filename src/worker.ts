import type Minion from './minion.js';
import type {DequeueOptions, MinionCommand, WorkerInfo, WorkerOptions} from './types.js';
import {Job} from './job.js';

/**
 * Minion worker class.
 */
export class Worker {
  /**
   * Registered commands.
   */
  commands: Record<string, MinionCommand>;
  /**
   * Worker status.
   */
  status: Record<string, any>;

  _id: number | undefined = undefined;
  _minion: Minion;

  constructor(minion: Minion, options: WorkerOptions = {}) {
    this._minion = minion;
    this.commands = options.commands ?? {};
    this.status = options.status ?? {};
  }

  /**
   * Register a worker remote control command.
   */
  addCommand(name: string, fn: MinionCommand): void {
    this.commands[name] = fn;
  }

  /**
   * Wait a given amount of time in seconds for a job, dequeue job object and transition from `inactive` to `active`
   * state, or return `null` if queues were empty.
   */
  async dequeue(wait = 0, options: DequeueOptions = {}): Promise<Job | null> {
    const id = this._id;
    if (id === undefined) return null;

    const job = await this.minion.backend.dequeue(id, wait, options);
    return job === null ? null : new Job(this.minion, job.id, job.args, job.retries, job.task);
  }

  /**
   * Worker id.
   */
  get id(): number | null {
    return this._id ?? null;
  }

  /**
   * Get worker information.
   */
  async info(): Promise<WorkerInfo | null> {
    const id = this._id;
    if (id === undefined) return null;
    const list = await this.minion.backend.listWorkers(0, 1, {ids: [id]});
    return list.workers[0];
  }

  /**
   * Minion instance this worker belongs to.
   */
  get minion(): Minion {
    return this._minion;
  }

  /**
   * Process worker remote control commands.
   */
  async processCommands(): Promise<void> {
    const id = this._id;
    if (id === undefined) return;

    const commands = await this.minion.backend.receive(id);
    for (const [command, ...args] of commands) {
      const fn = this.commands[command];
      if (fn !== undefined) await fn(this, ...args);
    }
  }

  /**
   * Register worker or send heartbeat to show that this worker is still alive.
   */
  async register(): Promise<this> {
    const id = await this.minion.backend.registerWorker(this._id, {status: this.status});
    if (this._id === undefined) this._id = id;
    return this;
  }

  /**
   * Start worker.
   */
  async start(): Promise<void> {
    throw new Error('Not yet implemented');
  }

  /**
   * Unregister worker.
   */
  async unregister(): Promise<this> {
    if (this._id === undefined) return this;
    await this.minion.backend.unregisterWorker(this._id);
    this._id = undefined;
    return this;
  }
}
