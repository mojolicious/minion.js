import type {ListJobsOptions, ListLocksOptions, ListWorkersOptions, MinionStates} from '../types.js';
import type {MojoApp, MojoContext, MojoRoute} from '@mojojs/core';
import {version} from '../minion.js';
import Path from '@mojojs/path';
import yaml from 'js-yaml';

export function minionAdminPlugin(app: MojoApp, options: {returnTo?: string; route?: MojoRoute}): void {
  // Config
  const prefix = options.route ?? app.router.any('/minion');
  prefix.to({returnTo: options.returnTo ?? '/', minionVersion: version});

  // Static files
  app.static.publicPaths.push(Path.currentFile().dirname().dirname().sibling('vendor', 'public').toString());

  // Templates
  app.renderer.viewPaths.push(Path.currentFile().dirname().dirname().sibling('vendor', 'views').toString());

  // Helpers
  app.addHelper('yamlDump', (ctx, data) => yaml.dump(data));

  // Routes
  prefix.get('/', dashboard).name('minion_dashboard');
  prefix.get('/stats', stats).name('minion_stats');
  prefix.get('/history', history).name('minion_history');
  prefix.get('/jobs', listJobs).name('minion_jobs');
  prefix.patch('/jobs', manageJobs).name('minion_manage_jobs');
  prefix.get('/locks', listLocks).name('minion_locks');
  prefix.delete('/locks', unlock).name('minion_unlock');
  prefix.get('/workers', listWorkers).name('minion_workers');
}

async function dashboard(ctx: MojoContext): Promise<void> {
  const history = await ctx.models.minion.history();
  await ctx.render({view: 'minion/dashboard'}, {history});
}

async function history(ctx: MojoContext): Promise<void> {
  await ctx.render({json: await ctx.models.minion.history()});
}

async function listJobs(ctx: MojoContext): Promise<any> {
  const validate = ctx.schema({
    type: 'object',
    properties: {
      id: {type: 'number'},
      limit: {type: 'number'},
      note: {type: 'string'},
      offset: {type: 'number'},
      queue: {type: 'string'},
      state: {
        type: 'string',
        enum: ['active', 'failed', 'finished', 'inactive']
      },
      task: {type: 'string'}
    }
  });

  const params = await ctx.params({notEmpty: true});
  const result = validate(params.toObject());
  if (result.isValid === false) return await ctx.render({text: 'Validation failed', status: 400});

  const limit = parseInt(params.get('limit') ?? '10');
  const offset = parseInt(params.get('offset') ?? '0');

  const options: ListJobsOptions = {};
  if (params.has('id') === true) options.ids = params.getAll('id').map(id => parseInt(id));
  if (params.has('note') === true) options.notes = params.getAll('note');
  if (params.has('queue') === true) options.queues = params.getAll('queue');
  if (params.has('state') === true) options.states = params.getAll('state') as MinionStates[];
  if (params.has('task') === true) options.tasks = params.getAll('task');

  const results = await ctx.models.minion.backend.listJobs(offset, limit, options);
  await ctx.render({view: 'minion/jobs'}, {jobs: results.jobs, total: results.total, limit, offset});
}

async function listLocks(ctx: MojoContext): Promise<any> {
  const validate = ctx.schema({
    type: 'object',
    properties: {
      limit: {type: 'number'},
      offset: {type: 'number'},
      name: {type: 'string'}
    }
  });

  const params = await ctx.params({notEmpty: true});
  const result = validate(params.toObject());
  if (result.isValid === false) return await ctx.render({text: 'Validation failed', status: 400});

  const limit = parseInt(params.get('limit') ?? '10');
  const offset = parseInt(params.get('offset') ?? '0');

  const options: ListLocksOptions = {};
  if (params.has('name')) options.names = params.getAll('name');

  const results = await ctx.models.minion.backend.listLocks(offset, limit, options);
  await ctx.render({view: 'minion/locks'}, {locks: results.locks, total: results.total, limit, offset});
}

async function listWorkers(ctx: MojoContext): Promise<any> {
  const validate = ctx.schema({
    type: 'object',
    properties: {
      id: {type: 'number'},
      limit: {type: 'number'},
      offset: {type: 'number'}
    }
  });

  const params = await ctx.params({notEmpty: true});
  const result = validate(params.toObject());
  if (result.isValid === false) return await ctx.render({text: 'Validation failed', status: 400});

  const limit = parseInt(params.get('limit') ?? '10');
  const offset = parseInt(params.get('offset') ?? '0');

  const options: ListWorkersOptions = {};
  if (params.has('id')) options.ids = params.getAll('id').map(id => parseInt(id));

  const results = await ctx.models.minion.backend.listWorkers(offset, limit, options);
  await ctx.render({view: 'minion/workers'}, {workers: results.workers, total: results.total, limit, offset});
}

async function manageJobs(ctx: MojoContext): Promise<any> {
  const validate = ctx.schema({
    type: 'object',
    properties: {
      do: {type: 'string', enum: ['remove', 'retry', 'sig_int', 'sig_term', 'sig_usr1', 'sig_usr2', 'stop']},
      id: {type: 'number'}
    },
    required: ['do', 'id']
  });

  const params = await ctx.params({notEmpty: true});
  const result = validate(params.toObject());
  if (result.isValid === false) return await ctx.render({text: 'Validation failed', status: 400});

  const minion = ctx.models.minion;
  const ids = params.getAll('id').map(id => parseInt(id));
  const action = params.get('do');
  const flash = await ctx.flash();

  // Retry
  if (action === 'retry') {
    let fail = 0;
    for (const id of ids) {
      const job = await minion.job(id);
      if (job === null || (await job.retry()) === false) fail++;
    }
    if (fail > 0) {
      flash.danger = "Couldn't retry all jobs.";
    } else {
      flash.success = 'All selected jobs retried.';
    }
  }

  // Remove
  else if (action === 'remove') {
    let fail = 0;
    for (const id of ids) {
      const job = await minion.job(id);
      if (job === null || (await job.remove()) === false) fail++;
    }
    if (fail > 0) {
      flash.danger = "Couldn't remove all jobs.";
    } else {
      flash.success = 'All selected jobs removed.';
    }
  }

  // Stop
  else if (action === 'stop') {
    for (const id of ids) {
      await minion.broadcast('stop', [id]);
    }
    flash.info = 'Trying to stop all selected jobs.';
  }

  // Signal
  else if (typeof action === 'string') {
    const match = action.match(/sig_(.+)/);
    if (match !== null) {
      const signal = match[1].toUpperCase();
      for (const id of ids) {
        await minion.broadcast('kill', [signal, id]);
      }
      flash.info = `Trying to send ${signal} signal to all selected jobs.`;
    }
  }

  await ctx.redirectTo('minion_jobs', {query: {id: ids.map(String)}});
}

async function stats(ctx: MojoContext): Promise<void> {
  await ctx.render({json: await ctx.models.minion.stats()});
}

async function unlock(ctx: MojoContext): Promise<any> {
  const validate = ctx.schema({
    type: 'object',
    properties: {
      name: {type: 'string'}
    },
    required: ['name']
  });

  const params = await ctx.params({notEmpty: true});
  const result = validate(params.toObject());
  if (result.isValid === false) return await ctx.render({text: 'Validation failed', status: 400});

  for (const name of params.getAll('name')) {
    await ctx.models.minion.backend.unlock(name);
  }

  const flash = await ctx.flash();
  flash.success = 'All selected named locks released.';
  await ctx.redirectTo('minion_locks');
}
