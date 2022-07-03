import type {
  EnqueueOptions,
  JobInfo,
  LockOptions,
  MinionArgs,
  MinionBackend,
  MinionJobId,
  MinionTask,
  ResetOptions
} from './types.js';
import type {MojoApp} from '@mojojs/core';
import {Job} from './job.js';
import {PgBackend} from './pg-backend.js';
import {Worker} from './worker.js';
import mojo from '@mojojs/core';
import {AbortError} from '@mojojs/util';

export interface MinionOptions {
  backendClass?: any;
  missingAfter?: number;
  removeAfter?: number;
  stuckAfter?: number;
}

interface ResultOptions {
  interval?: number;
  signal?: AbortSignal;
}

/**
 * Minion job queue class.
 */
export default class Minion {
  app: MojoApp = mojo();
  backend: MinionBackend;
  missingAfter = 1800;
  removeAfter = 172800;
  stuckAfter = 172800;
  tasks: Record<string, MinionTask> = {};

  constructor(config: any, options: MinionOptions = {backendClass: PgBackend}) {
    this.backend = new options.backendClass(this, config);
    if (options.missingAfter !== undefined) this.missingAfter = options.missingAfter;
    if (options.removeAfter !== undefined) this.removeAfter = options.removeAfter;
    if (options.stuckAfter !== undefined) this.stuckAfter = options.stuckAfter;
  }

  addTask(name: string, fn: MinionTask): void {
    this.tasks[name] = fn;
  }

  async end(): Promise<void> {
    await this.backend.end();
  }

  async enqueue(task: string, args?: MinionArgs, options?: EnqueueOptions): Promise<MinionJobId> {
    return await this.backend.enqueue(task, args, options);
  }

  async isLocked(name: string): Promise<boolean> {
    return !(await this.backend.lock(name, 0));
  }

  async job(id: MinionJobId): Promise<Job | null> {
    const info = (await this.backend.listJobs(0, 1, {ids: [id]})).jobs[0];
    return info === undefined ? null : new Job(this, id, info.args, info.retries, info.task);
  }

  async lock(name: string, duration: number, options: LockOptions): Promise<boolean> {
    return await this.backend.lock(name, duration, options);
  }

  async repair(): Promise<void> {
    await this.backend.repair();
  }

  async reset(options: ResetOptions): Promise<void> {
    await this.backend.reset(options);
  }

  async result(id: MinionJobId, options: ResultOptions = {}): Promise<JobInfo | null> {
    const interval = options.interval ?? 3000;
    const signal = options.signal ?? null;
    return new Promise((resolve, reject) =>
      setTimeout(() => this._result(id, interval, signal, resolve, reject), interval)
    );
  }

  async setup(): Promise<void> {
    await this.backend.setup();
  }

  async unlock(name: string): Promise<boolean> {
    return await this.backend.unlock(name);
  }

  worker(): Worker {
    return new Worker(this);
  }

  async _result(
    id: MinionJobId,
    interval: number,
    signal: AbortSignal | null,
    resolve: (value?: any) => void,
    reject: (reason?: any) => void
  ) {
    const info = (await this.backend.listJobs(0, 1, {ids: [id]})).jobs[0];
    if (info === undefined) {
      resolve(null);
    } else if (info.state === 'finished') {
      resolve(info);
    } else if (info.state === 'failed') {
      reject(info);
    } else if (signal !== null && signal.aborted === true) {
      reject(new AbortError());
    } else {
      setTimeout(() => this._result(id, interval, signal, resolve, reject), interval);
    }
  }
}
