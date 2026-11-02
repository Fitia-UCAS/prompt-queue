const { shouldRetry } = require('./03-retry-policy.cjs');

function createQueue({ maxAttempts = 2 } = {}) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1)
    throw new RangeError('maxAttempts must be a positive integer');
  const pending = [];
  let draining = false;

  function add(id, run) {
    pending.push({ id, run, attempt: 0 });
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (pending.length) {
        const task = pending.shift();
        task.attempt += 1;
        try {
          await task.run({ id: task.id, attempt: task.attempt });
        } catch (error) {
          if (!shouldRetry(error, task.attempt, maxAttempts)) throw error;
          pending.push(task);
        }
      }
    } finally {
      draining = false;
    }
  }

  return { add, drain };
}

module.exports = { createQueue };
