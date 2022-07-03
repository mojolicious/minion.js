import type Minion from './minion.js';
import type {
  DequeueOptions,
  DequeuedJob,
  EnqueueOptions,
  JobInfo,
  JobList,
  ListJobsOptions,
  ListLocksOptions,
  ListWorkersOptions,
  LockInfo,
  LockOptions,
  LockList,
  MinionArgs,
  MinionJobId,
  MinionWorkerId,
  RegisterWorkerOptions,
  ResetOptions,
  RetryOptions,
  WorkerInfo,
  WorkerList
} from './types.js';
import type {PgConfig} from '@mojojs/pg';
import os from 'os';
import Path from '@mojojs/path';
import Pg from '@mojojs/pg';

interface DequeueResult {
  id: MinionJobId;
  args: MinionArgs;
  retries: number;
  task: string;
}

interface EnqueueResult {
  id: MinionJobId;
}

interface JobWithMissingWorkerResult {
  id: MinionJobId;
  retries: number;
}

interface ListJobsResult extends JobInfo {
  total: number;
}

interface ListLockResult extends LockInfo {
  total: number;
}

interface ListWorkersResult extends WorkerInfo {
  total: number;
}

interface LockResult {
  minion_lock: boolean;
}

interface ReceiveResult {
  inbox: Array<[string, ...any[]]>;
}

interface RegisterWorkerResult {
  id: MinionWorkerId;
}

interface ServerVersionResult {
  server_version_num: number;
}

interface UpdateResult {
  attempts: number;
}

/**
 * Minion PostgreSQL backend class.
 */
export class PgBackend {
  minion: Minion;
  pg: Pg;

  _hostname = os.hostname();

  constructor(minion: Minion, config: PgConfig) {
    this.minion = minion;
    this.pg = new Pg(config);
  }

  async broadcast(command: string, args: any[] = [], ids: MinionWorkerId[] = []): Promise<boolean> {
    const results = await this.pg.query`
      UPDATE minion_workers SET inbox = inbox || ${[command, ...args]}::JSONB
      WHERE (id = ANY (${ids}) OR ${ids} = '{}')
    `;
    return (results.count ?? 0) > 0;
  }

  async dequeue(id: MinionWorkerId, wait: number, options: DequeueOptions): Promise<DequeuedJob | null> {
    const job = await this._try(id, options);
    if (job !== null) return job;

    const db = await this.pg.db();
    try {
      await db.listen('minion.job');
      let timer;
      await Promise.race([
        new Promise(resolve => db.on('notification', resolve)),
        new Promise(resolve => (timer = setTimeout(resolve, wait)))
      ]);
      clearTimeout(timer);
    } finally {
      await db.release();
    }

    return await this._try(id, options);
  }

  async end(): Promise<void> {
    await this.pg.end();
  }

  async enqueue(task: string, args: MinionArgs = [], options: EnqueueOptions = {}): Promise<MinionJobId> {
    const attempts = options.attempts ?? 1;
    const delay = options.delay ?? 0;
    const expire = options.expire;
    const lax = options.lax ?? false;
    const notes = options.notes ?? {};
    const parents = options.parents ?? [];
    const priority = options.priority ?? 0;
    const queue = options.queue ?? 'default';

    const jsonArgs = JSON.stringify(args);
    const results = await this.pg.query<EnqueueResult>`
      INSERT INTO minion_jobs (args, attempts, delayed, expires, lax, notes, parents, priority, queue, task)
      VALUES (${jsonArgs}, ${attempts}, (NOW() + (INTERVAL '1 second' * ${delay})),
        CASE WHEN ${expire}::BIGINT IS NOT NULL THEN NOW() + (INTERVAL '1 second' * ${expire}::BIGINT) END,
        ${lax}, ${notes}, ${parents}, ${priority}, ${queue}, ${task}
      )
      RETURNING id
    `;

    return results.first?.id ?? 0;
  }

  async failJob(id: MinionJobId, retries: number, result?: any): Promise<boolean> {
    return await this._update('failed', id, retries, result);
  }

  async finishJob(id: MinionJobId, retries: number, result?: any): Promise<boolean> {
    return await this._update('finished', id, retries, result);
  }

  async history(): Promise<any> {
    const results = await this.pg.query`
      SELECT EXTRACT(EPOCH FROM ts) AS epoch, COALESCE(failed_jobs, 0) AS failed_jobs,
        COALESCE(finished_jobs, 0) AS finished_jobs
      FROM (
        SELECT EXTRACT (DAY FROM finished) AS day, EXTRACT(HOUR FROM finished) AS hour,
          COUNT(*) FILTER (WHERE state = 'failed') AS failed_jobs,
          COUNT(*) FILTER (WHERE state = 'finished') AS finished_jobs
        FROM minion_jobs
        WHERE finished > NOW() - INTERVAL '23 hours'
        GROUP BY day, hour
      ) AS j RIGHT OUTER JOIN (
        SELECT *
        FROM GENERATE_SERIES(NOW() - INTERVAL '23 hour', NOW(), '1 hour') AS ts
      ) AS s ON EXTRACT(HOUR FROM ts) = j.hour AND EXTRACT(DAY FROM ts) = j.day
      ORDER BY epoch ASC
    `;
    return {daily: results};
  }

  async listJobs(offset: number, limit: number, options: ListJobsOptions = {}): Promise<JobList> {
    const before = options.before;
    const ids = options.ids ?? [];
    const notes = options.notes;
    const queues = options.queues;
    const states = options.states;
    const tasks = options.tasks;

    const results = await this.pg.query<ListJobsResult>`
      SELECT id, args, attempts,
          ARRAY(SELECT id FROM minion_jobs WHERE parents @> ARRAY[j.id]) AS children,
          EXTRACT(epoch FROM created) AS created, EXTRACT(EPOCH FROM delayed) AS delayed,
          EXTRACT(EPOCH FROM expires) AS expires, EXTRACT(EPOCH FROM finished) AS finished, lax, notes, parents, priority,
          queue, result, EXTRACT(EPOCH FROM retried) AS retried, retries, EXTRACT(EPOCH FROM started) AS started, state,
          task, EXTRACT(EPOCH FROM now()) AS time, COUNT(*) OVER() AS total, worker
        FROM minion_jobs AS j
        WHERE (id < ${before} OR ${before}::BIGINT IS NULL) AND (id = ANY (${ids}) OR ${ids}::BIGINT[] IS NULL)
          AND (notes \? ANY (${notes}) OR ${notes}::JSONB IS NULL)
          AND (queue = ANY (${queues}) OR ${queues}::TEXT[] IS null)
          AND (state = ANY (${states}) OR ${states}::TEXT[] IS NULL)
          AND (task = ANY (${tasks}) OR ${tasks}::TEXT[] IS NULL)
          AND (state != 'inactive' OR expires IS NULL OR expires > NOW())
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}
    `;

    return {total: _removeTotal(results), jobs: results};
  }

  async listLocks(offset: number, limit: number, options: ListLocksOptions = {}): Promise<LockList> {
    const names = options.names;

    const results = await this.pg.query<ListLockResult>`
      SELECT name, EXTRACT(EPOCH FROM expires) AS expires, COUNT(*) OVER() AS total FROM minion_locks
      WHERE expires > NOW() AND (name = ANY (${names}) OR ${names}::TEXT[] IS NULL)
      ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}
    `;

    return {total: _removeTotal(results), locks: results};
  }

  async listWorkers(offset: number, limit: number, options: ListWorkersOptions = {}): Promise<WorkerList> {
    const before = options.before;
    const ids = options.ids ?? [];

    const results = await this.pg.query<ListWorkersResult>`
      SELECT id, notified, ARRAY(
          SELECT id FROM minion_jobs WHERE state = 'active' AND worker = minion_workers.id
        ) AS jobs, host, pid, status, started, COUNT(*) OVER() AS total
      FROM minion_workers
      WHERE (id < ${before} OR ${before}::BIGINT IS NULL) AND (id = ANY (${ids}) OR ${ids}::BIGINT[] IS NULL)
      ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}
    `;

    return {total: _removeTotal(results), workers: results};
  }

  async lock(name: string, duration: number, options: LockOptions = {}): Promise<boolean> {
    const limit = options.limit ?? 1;
    const results = await this.pg.query<LockResult>`SELECT * FROM minion_lock(${name}, ${duration}, ${limit})`;
    return results[0].minion_lock;
  }

  async note(id: MinionJobId, merge: Record<string, any>): Promise<boolean> {
    const results = await this.pg
      .query`UPDATE minion_jobs SET notes = JSONB_STRIP_NULLS(notes || ${merge}) WHERE id = ${id}`;
    return (results.count ?? 0) > 0;
  }

  async receive(id: MinionWorkerId): Promise<Array<[string, ...any[]]>> {
    const results = await this.pg.query<ReceiveResult>`
      UPDATE minion_workers AS new SET inbox = '[]'
      FROM (SELECT id, inbox FROM minion_workers WHERE id = ${id} FOR UPDATE) AS old
      WHERE new.id = old.id AND old.inbox != '[]'
      RETURNING old.inbox AS inbox
    `;
    return results[0]?.inbox ?? [];
  }

  async registerWorker(id?: MinionWorkerId, options: RegisterWorkerOptions = {}): Promise<MinionWorkerId> {
    const status = options.status ?? {};
    const results = await this.pg.query<RegisterWorkerResult>`
      INSERT INTO minion_workers (id, host, pid, status)
        VALUES (COALESCE(${id}, NEXTVAL('minion_workers_id_seq')), ${this._hostname}, ${process.pid}, ${status})
        ON CONFLICT(id) DO UPDATE SET notified = now(), status = ${status}
        RETURNING id
    `;
    return results.first?.id ?? 0;
  }

  async removeJob(id: MinionJobId): Promise<boolean> {
    const results = await this.pg
      .query`DELETE FROM minion_jobs WHERE id = ${id} AND state IN ('inactive', 'failed', 'finished')`;
    return (results.count ?? 0) > 0 ? true : false;
  }

  async repair(): Promise<void> {
    const pg = this.pg;
    const minion = this.minion;

    // Workers without heartbeat
    await pg.query`DELETE FROM minion_workers WHERE notified < NOW() - INTERVAL '1 second' * ${minion.missingAfter}`;

    // Old jobs with no unresolved dependencies and expired jobs
    await pg.query`
      DELETE FROM minion_jobs WHERE id IN (
        SELECT j.id FROM minion_jobs AS j LEFT JOIN minion_jobs AS children
          ON children.state != 'finished' AND ARRAY_LENGTH(children.parents, 1) > 0 AND j.id = ANY(children.parents)
        WHERE j.state = 'finished' AND j.finished <= NOW() - INTERVAL '1 second' * ${minion.removeAfter}
          AND children.id IS NULL
        UNION ALL
        SELECT id FROM minion_jobs WHERE state = 'inactive' AND expires <= NOW()
      )
    `;

    // Jobs with missing worker (can be retried)
    const jobs = await pg.query<JobWithMissingWorkerResult>`
      SELECT id, retries FROM minion_jobs AS j
      WHERE state = 'active' AND queue != 'minion_foreground'
        AND NOT EXISTS (SELECT 1 FROM minion_workers WHERE id = j.worker)
    `;
    for (const job of jobs) {
      await this.failJob(job.id, job.retries, 'Worker went away');
    }

    // Jobs in queue without workers or not enough workers (cannot be retried and requires admin attention)
    await pg.query`
      UPDATE minion_jobs SET state = 'failed', result = '"Job appears stuck in queue"'
          WHERE state = 'inactive' AND delayed + ${minion.stuckAfter} * INTERVAL '1 second' < NOW()
    `;
  }

  async reset(options: ResetOptions): Promise<void> {
    if (options.all === true) this.pg.query`TRUNCATE minion_jobs, minion_locks, minion_workers RESTART IDENTITY`;
    if (options.locks === true) this.pg.query`TRUNCATE minion_locks`;
  }

  async retryJob(id: MinionJobId, retries: number, options: RetryOptions = {}): Promise<boolean> {
    const attempts = options.attempts;
    const delay = options.delay ?? 0;
    const expire = options.expire;
    const lax = options.lax;
    const parents = options.parents;
    const priority = options.priority;
    const queue = options.queue;

    const results = await this.pg.query`
      UPDATE minion_jobs SET attempts = COALESCE(${attempts}, attempts),
        delayed = (NOW() + (INTERVAL '1 second' * ${delay})),
        expires = CASE WHEN ${expire}::BIGINT IS NOT NULL THEN NOW() + (INTERVAL '1 second' * ${expire}::BIGINT)
                       ELSE expires END, lax = COALESCE(${lax}, lax), parents = COALESCE(${parents}, parents),
        priority = COALESCE(${priority}, priority), queue = COALESCE(${queue}, queue), retried = NOW(),
        retries = retries + 1, state = 'inactive'
      WHERE id = ${id} AND retries = ${retries}
    `;

    return (results.count ?? 0) > 0 ? true : false;
  }

  async setup(): Promise<void> {
    const pg = this.pg;

    const version = (await pg.query<ServerVersionResult>`SHOW server_version_num`).first?.server_version_num;
    if (version == null || version < 90500) throw new Error('PostgreSQL 9.5 or later is required');

    const migrations = pg.migrations;
    await migrations.fromFile(Path.currentFile().dirname().sibling('migrations', 'minion.sql'), {name: 'minion'});
    await migrations.migrate();
  }

  async stats(): Promise<any> {
    const results = await this.pg.query`
      SELECT COUNT(*) FILTER (WHERE state = 'inactive' AND (expires IS NULL OR expires > NOW())) AS inactive_jobs,
        COUNT(*) FILTER (WHERE state = 'active') AS active_jobs,
        COUNT(*) FILTER (WHERE state = 'failed') AS failed_jobs,
        COUNT(*) FILTER (WHERE state = 'finished') AS finished_jobs,
        COUNT(*) FILTER (WHERE state = 'inactive' AND delayed > NOW()) AS delayed_jobs,
        (SELECT COUNT(*) FROM minion_locks WHERE expires > NOW()) AS active_locks,
        COUNT(DISTINCT worker) FILTER (WHERE state = 'active') AS active_workers,
        (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM minion_jobs_id_seq) AS enqueued_jobs,
        (SELECT COUNT(*) FROM minion_workers) AS workers,
        EXTRACT(EPOCH FROM NOW() - PG_POSTMASTER_START_TIME()) AS uptime
      FROM minion_jobs
    `;

    const stats = results[0];
    stats.inactive_workers = stats.workers - stats.active_workers;
    return stats;
  }

  async unlock(name: string): Promise<boolean> {
    const results = await this.pg.query`
      DELETE FROM minion_locks WHERE id = (
        SELECT id FROM minion_locks WHERE expires > NOW() AND name = ${name} ORDER BY expires LIMIT 1 FOR UPDATE
      )
    `;
    return (results.count ?? 0) > 0 ? true : false;
  }

  async unregisterWorker(id: MinionWorkerId): Promise<void> {
    await this.pg.query`DELETE FROM minion_workers WHERE id = ${id}`;
  }

  async _try(id: MinionWorkerId, options: DequeueOptions): Promise<DequeuedJob | null> {
    const jobId = options.id;
    const minPriority = options.minPriority;
    const queues = options.queues ?? ['default'];
    const tasks = Object.keys(this.minion.tasks);

    const results = await this.pg.query<DequeueResult>`
      UPDATE minion_jobs SET started = NOW(), state = 'active', worker = ${id}
      WHERE id = (
        SELECT id FROM minion_jobs AS j
        WHERE delayed <= NOW() AND id = COALESCE(${jobId}, id) AND (parents = '{}' OR NOT EXISTS (
          SELECT 1 FROM minion_jobs WHERE id = ANY (j.parents) AND (
            state = 'active' OR (state = 'failed' AND NOT j.lax)
            OR (state = 'inactive' AND (expires IS NULL OR expires > NOW())))
        )) AND priority >= COALESCE(${minPriority}, priority) AND queue = ANY (${queues}) AND state = 'inactive'
          AND task = ANY (${tasks}) AND (EXPIRES IS NULL OR expires > NOW())
        ORDER BY priority DESC, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, args, retries, task
    `;

    return results.first;
  }

  async _update(state: 'finished' | 'failed', id: MinionJobId, retries: number, result?: any): Promise<boolean> {
    const jsonResult = JSON.stringify(result);
    const results = await this.pg.query<UpdateResult>`
      UPDATE minion_jobs SET finished = NOW(), result = ${jsonResult}, state = ${state}
      WHERE id = ${id} AND retries = ${retries} AND state = 'active'
      RETURNING attempts
    `;
    return (results.count ?? 0) > 0 ? true : false;
  }
}

function _removeTotal<T extends Array<{total?: number}>>(results: T): number {
  let total = 0;
  for (const result of results) {
    if (result.total !== undefined) total = result.total;
    delete result.total;
  }
  return total;
}
