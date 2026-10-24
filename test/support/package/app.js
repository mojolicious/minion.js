import assert from 'node:assert/strict';
import Minion from '@minionjs/core';

const minion = new Minion('postgres://127.0.0.1:5432/javascript');
minion.addTask('test', async job => {
  await job.finish('JavaScript');
});
assert.ok(minion.tasks.test !== undefined);
await minion.end();

console.log('JavaScript consumer works');
