export function createSendLock() {
  let owner = null,
    pending = 0;
  const listeners = new Set();
  return {
    tryAcquire(nextOwner) {
      if (owner || (nextOwner !== 'queue' && pending > 0)) return false;
      owner = nextOwner;
      return true;
    },
    release() {
      owner = null;
      for (const listener of listeners) listener();
    },
    setQueuePending(count) {
      pending = count;
    },
    getOwner: () => owner,
    isBusy: () => owner !== null || pending > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
