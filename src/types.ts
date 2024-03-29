import type {Job} from './job.js';
import type {Worker} from './worker.js';

export interface MinionBackend {
  broadcast: (command: string, args?: any[], ids?: MinionJobId[]) => Promise<boolean>;
  dequeue: (id: MinionWorkerId, wait?: number, options?: DequeueOptions) => Promise<DequeuedJob | null>;
  end: () => Promise<void>;
  enqueue: (task: string, args?: MinionArgs, options?: EnqueueOptions) => Promise<MinionJobId>;
  failJob: (id: MinionJobId, retries: number, result?: any) => Promise<boolean>;
  finishJob: (id: MinionJobId, retries: number, result?: any) => Promise<boolean>;
  history: () => Promise<any>;
  listJobs: (offset: number, limit: number, options?: ListJobsOptions) => Promise<JobList>;
  listLocks: (offset: number, limit: number, options?: ListLocksOptions) => Promise<LockList>;
  listWorkers: (offset: number, limit: number, options?: ListWorkersOptions) => Promise<WorkerList>;
  lock: (name: string, duration: number, options?: LockOptions) => Promise<boolean>;
  name: string;
  note: (id: MinionJobId, merge: Record<string, any>) => Promise<boolean>;
  receive: (id: MinionWorkerId) => Promise<Array<[string, ...any[]]>>;
  registerWorker: (id?: MinionWorkerId, options?: RegisterWorkerOptions) => Promise<number>;
  removeJob: (id: MinionJobId) => Promise<boolean>;
  repair: () => Promise<void>;
  reset: (options: ResetOptions) => Promise<void>;
  retryJob: (id: MinionJobId, retries: number, options: RetryOptions) => Promise<boolean>;
  stats: () => Promise<any>;
  unlock: (name: string) => Promise<boolean>;
  unregisterWorker: (id: MinionWorkerId) => Promise<void>;
  update: () => Promise<void>;
}

export type MinionArgs = any[];
export type MinionCommand = (worker: MinionWorker, ...args: any[]) => Promise<void>;
export type MinionStates = 'inactive' | 'active' | 'failed' | 'finished';
export type MinionJob = Job;
export type MinionJobId = number;
export type MinionWorkerId = number;
export type MinionTask = (job: MinionJob, ...args: MinionArgs) => Promise<void>;
export type MinionWorker = Worker;

export interface MinionHistory {
  daily: DailyHistory[];
}

export interface MinionStats {
  active_locks: number;
  active_jobs: number;
  active_workers: number;
  delayed_jobs: number;
  enqueued_jobs: number;
  failed_jobs: number;
  finished_jobs: number;
  inactive_jobs: number;
  inactive_workers: number;
  uptime: number;
  workers: number;
}

export interface MinionStatus {
  commandInterval: number;
  dequeueTimeout: number;
  heartbeatInterval: number;
  jobs: number;
  performed: number;
  queues: string[];
  repairInterval: number;
  spare: number;
  spareMinPriority: number;
  [key: string]: any;
}

export interface DequeueOptions {
  id?: MinionJobId;
  minPriority?: number;
  queues?: string[];
}

export interface EnqueueOptions {
  attempts?: number;
  delay?: number;
  expire?: number;
  lax?: boolean;
  notes?: Record<string, any>;
  parents?: MinionJobId[];
  priority?: number;
  queue?: string;
}

export interface ListJobsOptions {
  before?: number;
  ids?: MinionJobId[];
  notes?: string[];
  queues?: string[];
  states?: MinionStates[];
  tasks?: string[];
}

export interface ListLocksOptions {
  names?: string[];
}

export interface ListWorkersOptions {
  before?: number;
  ids?: MinionWorkerId[];
}

export interface LockOptions {
  limit?: number;
}

export interface RegisterWorkerOptions {
  status?: Record<string, any>;
}

export interface ResetOptions {
  all?: boolean;
  locks?: boolean;
}

export interface RetryOptions {
  attempts?: number;
  delay?: number;
  expire?: number;
  lax?: boolean;
  parents?: MinionJobId[];
  priority?: number;
  queue?: string;
}

export interface WorkerOptions {
  commands?: Record<string, MinionCommand>;
  status?: Record<string, any>;
}

export interface DailyHistory {
  epoch: number;
  failed_jobs: number;
  finished_jobs: number;
}

export interface DequeuedJob {
  id: MinionJobId;
  args: MinionArgs;
  retries: number;
  task: string;
}

export interface JobInfo {
  args: MinionArgs;
  attempts: number;
  children: MinionJobId[];
  created: Date;
  delayed: Date;
  expires: Date;
  finished: Date;
  id: MinionJobId;
  lax: boolean;
  notes: Record<string, any>;
  parents: MinionJobId[];
  priority: number;
  queue: string;
  result: any;
  retried: Date;
  retries: number;
  started: Date;
  state: MinionStates;
  task: string;
  time: Date;
  worker: MinionWorkerId;
}

export interface JobList {
  jobs: JobInfo[];
  total: number;
}

export interface LockInfo {
  expires: Date;
  name: string;
}

export interface LockList {
  locks: LockInfo[];
  total: number;
}

export interface WorkerInfo {
  id: MinionWorkerId;
  host: string;
  jobs: MinionJobId[];
  notified?: Date;
  pid: number;
  started: Date;
  status: Record<string, any>;
}

export interface WorkerList {
  workers: WorkerInfo[];
  total: number;
}
