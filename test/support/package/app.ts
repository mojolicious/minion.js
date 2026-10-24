import assert from 'node:assert/strict';
import Minion, {type MinionJob} from '@minionjs/core';

const minion = new Minion('postgres://127.0.0.1:5432/typescript');
minion.addTask('test', async (job: MinionJob) => {
  await job.finish('TypeScript');
});
assert.ok(minion.tasks.test !== undefined);
await minion.end();

console.log('TypeScript consumer works');
