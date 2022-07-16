import type {
  EnqueueOptions,
  DequeueOptions,
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
  /**
   * `@mojojs/core` app this job queue belongs to.
   */
  app: MojoApp = mojo();
  /**
   * Backend, usually a PostgreSQL backend.
   */
  backend: MinionBackend;
  /**
   * Amount of time in seconds after which workers without a heartbeat will be considered missing and removed from
   * the registry by `minion.repair()`, defaults to `1800` (30 minutes).
   */
  missingAfter = 1800;
  /**
   * Amount of time in seconds after which jobs that have reached the state `finished` and have no unresolved
   * dependencies will be removed automatically by `minion.repair()`, defaults to `172800` (2 days). It is not
   * recommended to set this value below 2 days.
   */
  removeAfter = 172800;
  /**
   * Amount of time in seconds after which jobs that have not been processed will be considered stuck by
   * `minion.repair()` and transition to the `failed` state, defaults to `172800` (2 days).
   */
  stuckAfter = 172800;
  /**
   * Registered tasks.
   */
  tasks: Record<string, MinionTask> = {};

  constructor(config: any, options: MinionOptions = {backendClass: PgBackend}) {
    this.backend = new options.backendClass(this, config);
    if (options.missingAfter !== undefined) this.missingAfter = options.missingAfter;
    if (options.removeAfter !== undefined) this.removeAfter = options.removeAfter;
    if (options.stuckAfter !== undefined) this.stuckAfter = options.stuckAfter;
  }

  /**
   * Register a task.
   */
  addTask(name: string, fn: MinionTask): void {
    this.tasks[name] = fn;
  }

  /**
   * Used to calculate the delay for automatically retried jobs, defaults to `(retries ** 4) + 15` (15, 16, 31, 96,
   * 271, 640...), which means that roughly `25` attempts can be made in `21` days.
   */
  backoff(retries: number): number {
    return retries ** 4 + 15;
  }

  /**
   * Broadcast remote control command to one or more workers.
   */
  async broadcast(command: string, args?: any[], ids?: number[]): Promise<boolean> {
    return await this.backend.broadcast(command, args, ids);
  }

  /**
   * Stop using the queue.
   */
  async end(): Promise<void> {
    await this.backend.end();
  }

  /**
   * Enqueue a new job with `inactive` state. Arguments get serialized by the backend as JSON, so you shouldn't send
   * objects that cannot be serialized, nested data structures are fine though.
   * @param options.attempts - Number of times performing this job will be attempted, with a delay based on
   *                           `minion.backoff()` after the first attempt, defaults to `1`.
   * @param options.delay - Delay job for this many seconds (from now), defaults to `0`.
   * @param options.expire - Job is valid for this many seconds (from now) before it expires.
   * @param options.lax - Existing jobs this job depends on may also have transitioned to the `failed` state to allow
   *                      for it to be processed, defaults to `false`.
   * @param options.notes - Object with arbitrary metadata for this job that gets serialized as JSON.
   * @param options.parents - One or more existing jobs this job depends on, and that need to have transitioned to the
   *                          state `finished` before it can be processed.
   * @param options.priority - Job priority, defaults to `0`. Jobs with a higher priority get performed first.
   *                           Priorities can be positive or negative, but should be in the range between `100` and
   *                           `-100`.
   * @param options.queue - Queue to put job in, defaults to `default`.
   */
  async enqueue(task: string, args?: MinionArgs, options?: EnqueueOptions): Promise<MinionJobId> {
    return await this.backend.enqueue(task, args, options);
  }

  /**
   * Retry job in `minion_foreground` queue, then perform it right away with a temporary worker in this process,
   * very useful for debugging.
   */
  async foreground(id: number): Promise<boolean> {
    const job = await this.job(id);
    if (job === null) return false;
    if ((await job.retry({attempts: 1, queue: 'minion_foreground'})) !== true) return false;

    const worker = await this.worker().register();
    try {
      const job = await worker.dequeue(0, {id, queues: ['minion_foreground']});
      if (job === null) return false;
      const error = await job.execute();
      if (error === null) {
        await job.finish();
        return true;
      } else {
        await job.fail(error);
        throw error;
      }
    } finally {
      await worker.unregister();
    }
  }

  /**
   * Get history information for job queue.
   */
  async history(): Promise<MinionHistory> {
    return await this.backend.history();
  }

  /**
   * Check if a lock with that name is currently active.
   */
  async isLocked(name: string): Promise<boolean> {
    return !(await this.backend.lock(name, 0));
  }

  /**
   * Get job object without making any changes to the actual job or return `null` if job does not exist.
   */
  async job(id: MinionJobId): Promise<Job | null> {
    const info = (await this.backend.listJobs(0, 1, {ids: [id]})).jobs[0];
    return info === undefined ? null : new Job(this, info.id, info.args, info.retries, info.task);
  }

  /**
   * Return iterator object to safely iterate through job information.
   */
  jobs(options: ListJobsOptions = {}): BackendIterator<JobInfo> {
    return new BackendIterator<JobInfo>(this, 'jobs', options);
  }

  /**
   * Try to acquire a named lock that will expire automatically after the given amount of time in seconds. You can
   * release the lock manually with `minion.unlock()` to limit concurrency, or let it expire for rate limiting.
   */
  async lock(name: string, duration: number, options: LockOptions): Promise<boolean> {
    return await this.backend.lock(name, duration, options);
  }

  /**
   * Perform all jobs with a temporary worker, very useful for testing.
   */
  async performJobs(options?: DequeueOptions): Promise<void> {
    const worker = await this.worker().register();
    try {
      let job;
      while ((job = await worker.register().then(worker => worker.dequeue(0, options)))) {
        await job.perform();
      }
    } finally {
      await worker.unregister();
    }
  }

  /**
   * Repair worker registry and job queue if necessary.
   */
  async repair(): Promise<void> {
    await this.backend.repair();
  }

  /**
   * Reset job queue.
   */
  async reset(options: ResetOptions): Promise<void> {
    await this.backend.reset(options);
  }

  /**
   * Return a promise for the future result of a job. The state `finished` will result in the promise being
   * `fullfilled`, and the state `failed` in the promise being `rejected`.
   */
  async result(id: MinionJobId, options: ResultOptions = {}): Promise<JobInfo | null> {
    const interval = options.interval ?? 3000;
    const signal = options.signal ?? null;
    return new Promise((resolve, reject) =>
      setTimeout(() => this._result(id, interval, signal, resolve, reject), interval)
    );
  }

  /**
   * Get statistics for the job queue.
   */
  async stats(): Promise<MinionStats> {
    return await this.backend.stats();
  }

  /**
   * Release a named lock that has been previously acquired with `minion.lock()`.
   */
  async unlock(name: string): Promise<boolean> {
    return await this.backend.unlock(name);
  }

  /**
   * Update backend database schema to the latest version.
   */
  async update(): Promise<void> {
    await this.backend.update();
  }

  /**
   * Build worker object. Note that this method should only be used to implement custom workers.
   */
  worker(options?: WorkerOptions): Worker {
    return new Worker(this, options);
  }

  /**
   * Return iterator object to safely iterate through worker information.
   */
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

/**
 * Iterator object.
 */
class BackendIterator<T> {
  /**
   * Number of results to fetch at once.
   */
  fetch = 10;
  /**
   * List options.
   */
  options: ListWorkersOptions | ListJobsOptions;

  _cache: T[] = [];
  _count = 0;
  _minion: Minion;
  _name: string;
  _total = 0;

  constructor(minion: Minion, name: string, options: ListWorkersOptions | ListJobsOptions) {
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

  /**
   * Get next result.
   */
  async next(): Promise<T | undefined> {
    const cache = this._cache;
    if (cache.length < 1) await this._fetch();
    return cache.shift();
  }

  /**
   * Total number of results.
   */
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
