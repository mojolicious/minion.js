import Minion from '../lib/minion.js';

const ENQUEUE = 10000;
const DEQUEUE = 1000;
const WORKERS = 4;
const INFO = 100;
const STATS = 100;

const minion = new Minion('postgresql://postgres@127.0.0.1:5432/postgres');
minion.addTask('foo', async () => {
  // Do nothing
});
minion.addTask('bar', async () => {
  // Do nothing
});
await minion.reset({all: true});

// Enqueue
console.log(`Clean start with ${ENQUEUE} jobs`);
const parents = [];
for (let i = 1; i <= 5; i++) {
  parents.push(await minion.enqueue('foo'));
}
console.time('Enqueue');
for (let i = 1; i <= ENQUEUE; i++) {
  await minion.enqueue(i % 1 === 1 ? 'foo' : 'bar', [], {parents});
}
console.timeEnd('Enqueue');

// Dequeue
async function dequeue(num) {
  const worker = await minion.worker().register();
  console.log(`Worker ${num} will finish ${DEQUEUE} jobs`);
  console.time(`Worker${num}`);
  for (let i = 1; i <= DEQUEUE; i++) {
    const job = await worker.dequeue(500);
    await job.finish();
  }
  console.timeEnd(`Worker${num}`);
  await worker.unregister();
}
const workers = [];
for (let i = 1; i <= WORKERS; i++) {
  workers.push(dequeue(i));
}
console.time('Dequeue');
await Promise.all(workers);
console.timeEnd('Dequeue');

// Job info
console.log(`Requesting job info ${INFO} times`);
console.time('JobInfo');
for (let i = 1; i <= INFO; i++) {
  await minion.backend.listJobs(0, 1, {ids: [i]});
}
console.timeEnd('JobInfo');

// Stats
console.log(`Requesting stats ${STATS} times`);
console.time('Stats');
for (let i = 1; i <= STATS; i++) {
  await minion.stats();
}
console.timeEnd('Stats');
