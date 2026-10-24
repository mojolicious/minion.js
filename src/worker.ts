import type Minion from './minion.ts';
import type {DequeueOptions, MinionCommand, MinionStatus, WorkerInfo, WorkerOptions} from './types.ts';
import {Job} from './job.ts';
import {desiredTasks} from './util.ts';

interface JobStatus {
  job: Job;
  promise: Promise<void>;
}

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
  status: MinionStatus;

  _active: JobStatus[] = [];
  _id: number | undefined = undefined;
  _lastCommand = 0;
  _lastDispatch = 0;
  _lastHeartbeat = 0;
  _lastRepair = 0;
  _minion: Minion;
  _running = false;
  _stop: Array<() => void> = [];

  constructor(minion: Minion, options: WorkerOptions = {}) {
    this.commands = {jobs: jobsCommand, spare: spareCommand, ...options.commands};
    this.status = {
      commandInterval: 10000,
      dequeueTimeout: 5000,
      dispatchInterval: 30000,
      heartbeatInterval: 300000,
      jobs: 4,
      limits: {},
      performed: 0,
      queues: ['default'],
      repairInterval: 21600000,
      spare: 1,
      spareMinPriority: 1,
      type: 'Node.js',
      ...options.status
    };

    this._minion = minion;
  }

  /**
   * Register a worker remote control command.
   */
  addCommand(name: string, fn: MinionCommand): void {
    this.commands[name] = fn;
  }

  /**
   * Wait a given amount of time in milliseconds for a job, dequeue job object and transition from `inactive` to
   * `active` state, or return `null` if queues were empty.
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
   * Check if worker is currently running.
   */
  get isRunning(): boolean {
    return this._running;
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
    let called = 0;
    for (const [command, ...args] of commands) {
      const fn = this.commands[command];
      if (fn === undefined) continue;
      await fn(this, ...args);
      called++;
    }

    // Make status changes visible right away
    if (called > 0) await this.register();
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
  async start(): Promise<this> {
    if (this.isRunning === true) return this;

    // Randomize to avoid congestion (after status has been customized)
    const status = this.status;
    status.repairInterval -= Math.ceil(Math.random() * (status.repairInterval / 2));

    this._mainLoop().catch(error => this.minion.app.log.error(error));
    this._running = true;

    return this;
  }

  /**
   * Stop worker.
   */
  async stop(): Promise<void> {
    if (this.isRunning === false) return;
    return new Promise(resolve => this._stop.push(resolve));
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

  async _mainLoop(): Promise<void> {
    const status = this.status;
    const stop = this._stop;

    while (stop.length === 0 || this._active.length > 0) {
      const options: DequeueOptions = {queues: status.queues};

      await this._maintenance(status);

      // Check if jobs are finished
      const before = this._active.length;
      const active = (this._active = this._active.filter(jobStatus => jobStatus.job.isFinished === false));
      status.performed += before - active.length;

      // Job limit has been reached
      const {jobs, spare} = status;
      if (active.length >= jobs + spare) await Promise.race(active.map(jobStatus => jobStatus.promise));
      if (active.length >= jobs) options.minPriority = status.spareMinPriority;

      // Worker is stopped
      if (stop.length > 0) continue;

      // Task limits have been reached (waiting for a job to finish, so the loop does not spin)
      const tasks = desiredTasks(
        status.limits,
        Object.keys(this.minion.tasks),
        active.map(jobStatus => jobStatus.job.task)
      );
      if (tasks.length === 0 && active.length > 0) {
        await Promise.race(active.map(jobStatus => jobStatus.promise));
        continue;
      }
      options.tasks = tasks;

      // Try to get more jobs
      const job = await this.dequeue(status.dequeueTimeout, options);
      if (job === null) continue;
      active.push({job, promise: job.perform()});
    }

    await this.unregister();
    this._stop = [];
    stop.forEach(resolve => resolve());
    this._running = false;
  }

  async _maintenance(status: MinionStatus): Promise<void> {
    // Send heartbeats in regular intervals
    if (this._lastHeartbeat + status.heartbeatInterval < Date.now()) {
      await this.register();
      this._lastHeartbeat = Date.now();
    }

    // Process worker remote control commands in regular intervals
    if (this._lastCommand + status.commandInterval < Date.now()) {
      await this.processCommands();
      this._lastCommand = Date.now();
    }

    // Repair in regular intervals (randomize to avoid congestion)
    if (this._lastRepair + status.repairInterval < Date.now()) {
      await this.minion.repair();
      this._lastRepair = Date.now();
    }

    // Dispatch schedules in regular intervals (database advisory lock prevents duplicates)
    if (status.dispatchInterval > 0 && this._lastDispatch + status.dispatchInterval < Date.now()) {
      await this.minion.dispatchSchedules();
      this._lastDispatch = Date.now();
    }
  }
}

// Remote control commands need to validate arguments carefully
async function jobsCommand(worker: Worker, num: any) {
  if (/^\d+$/.test(String(num)) === true) worker.status.jobs = parseInt(num);
}

async function spareCommand(worker: Worker, num: any) {
  if (/^\d+$/.test(String(num)) === true) worker.status.spare = parseInt(num);
}
