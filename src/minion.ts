import type {
  EnqueueOptions,
  JobInfo,
  ListJobsOptions,
  ListWorkersOptions,
  LockOptions,
  MinionArgs,
  MinionBackend,
  MinionHistory,
  MinionJobId,
  MinionStats,
  MinionTask,
  ResetOptions,
  WorkerInfo,
  WorkerOptions
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

  backoff(retries: number): number {
    return retries ** 4 + 15;
  }

  async end(): Promise<void> {
    await this.backend.end();
  }

  async enqueue(task: string, args?: MinionArgs, options?: EnqueueOptions): Promise<MinionJobId> {
    return await this.backend.enqueue(task, args, options);
  }

  async history(): Promise<MinionHistory> {
    return await this.backend.history();
  }

  async isLocked(name: string): Promise<boolean> {
    return !(await this.backend.lock(name, 0));
  }

  async job(id: MinionJobId): Promise<Job | null> {
    const info = (await this.backend.listJobs(0, 1, {ids: [id]})).jobs[0];
    return info === undefined ? null : new Job(this, id, info.args, info.retries, info.task);
  }

  jobs(options: ListJobsOptions = {}): BackendIterator<JobInfo> {
    return new BackendIterator<JobInfo>(this, 'jobs', options);
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

  async stats(): Promise<MinionStats> {
    return await this.backend.stats();
  }

  async unlock(name: string): Promise<boolean> {
    return await this.backend.unlock(name);
  }

  async update(): Promise<void> {
    await this.backend.update();
  }

  worker(options?: WorkerOptions): Worker {
    return new Worker(this, options);
  }

  workers(options: ListWorkersOptions = {}): BackendIterator<WorkerInfo> {
    return new BackendIterator<WorkerInfo>(this, 'workers', options);
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

class BackendIterator<T> {
  fetch = 10;
  options: ListWorkersOptions;

  _cache: T[] = [];
  _count = 0;
  _minion: Minion;
  _name: string;
  _total = 0;

  constructor(minion: Minion, name: string, options: ListWorkersOptions) {
    this.options = options;

    this._minion = minion;
    this._name = name;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const backendIterator = this;
    return {
      async next(): Promise<IteratorResult<T>> {
        const value = (await backendIterator.next()) as any;
        return {value, done: value === undefined};
      }
    };
  }

  async next(): Promise<T | undefined> {
    const cache = this._cache;
    if (cache.length < 1) await this._fetch();
    return cache.shift();
  }

  async total(): Promise<number> {
    if (this._total === 0) await this._fetch();
    return this._total;
  }

  async _fetch(): Promise<void> {
    const name = this._name;
    const methodName = name === 'workers' ? 'listWorkers' : 'listJobs';
    const results = (await this._minion.backend[methodName](0, this.fetch, this.options)) as any;
    const batch = results[name];

    const len = batch.length;
    if (len > 0) {
      this._total = results.total + this._count;
      this._count += len;
      this._cache.push(...batch);
      this.options.before = batch[batch.length - 1].id;
    }
  }
}
