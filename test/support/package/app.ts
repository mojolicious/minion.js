import assert from 'node:assert/strict';
import Minion, {type MinionJob, util} from '@minionjs/core';

const minion = new Minion('postgres://127.0.0.1:5432/typescript');
minion.addTask('test', async (job: MinionJob) => {
  await job.finish('TypeScript');
});
assert.ok(minion.tasks.test !== undefined);
await assert.rejects(minion.schedule('bad', 'not a cron', 'test'), /Invalid cron expression/);
await minion.end();

const next: Date = util.nextCronTime('0 9 * * MON-FRI', new Date(Date.UTC(2026, 4, 12, 12)));
assert.equal(next.toISOString(), '2026-05-13T09:00:00.000Z');

console.log('TypeScript consumer works');
