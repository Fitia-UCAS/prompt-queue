const assert = require('node:assert/strict');

async function verifyQueue(createQueue) {
  const trace = [];
  const queue = createQueue({ maxAttempts: 2 });
  queue.add('job-A', async ({ id, attempt }) => {
    trace.push(id + '#' + attempt);
    if (attempt === 1) throw Object.assign(new Error('try again'), { code: 'E_TEMP' });
  });
  queue.add('job-B', async ({ id, attempt }) => {
    trace.push(id + '#' + attempt);
  });
  await queue.drain();
  assert.deepEqual(trace, ['job-A#1', 'job-B#1', 'job-A#2']);

  let attempts = 0;
  const failing = createQueue({ maxAttempts: 2 });
  failing.add('job-C', async () => {
    attempts += 1;
    throw Object.assign(new Error('still failing'), { code: 'E_TEMP' });
  });
  await assert.rejects(failing.drain(), /still failing/);
  assert.equal(attempts, 2);

  let fatalAttempts = 0;
  const fatal = createQueue();
  fatal.add('job-D', async () => {
    fatalAttempts += 1;
    throw new Error('invalid input');
  });
  await assert.rejects(fatal.drain(), /invalid input/);
  assert.equal(fatalAttempts, 1);

  let release;
  let active = 0;
  let maximum = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const serial = createQueue();
  serial.add('job-E', async () => {
    maximum = Math.max(maximum, ++active);
    await gate;
    active -= 1;
  });
  serial.add('job-F', async () => {
    maximum = Math.max(maximum, ++active);
    active -= 1;
  });
  const first = serial.drain();
  const second = serial.drain();
  release();
  await Promise.all([first, second]);
  assert.equal(maximum, 1);
}

if (require.main === module) {
  const { createQueue } = require(process.argv[2] || './02-task-queue.cjs');
  verifyQueue(createQueue).then(
    () => console.log('4 cases passed'),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}

module.exports = { verifyQueue };
