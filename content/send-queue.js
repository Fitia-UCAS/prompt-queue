import { createSendLock } from './send-lock.js';
import { executeQueued, conversationUrl, currentUrl } from './composer-send.js';

export function createSendQueue(adapter, composer, lock = createSendLock()) {
  const items = [],
    listeners = new Set();
  let running = false,
    version = 0,
    status = 'idle',
    error = null,
    controller = null;
  function snapshot() {
    return {
      status,
      running,
      items: items.map((item) => ({ ...item })),
      error,
      canRetry:
        !running &&
        status === 'failed' &&
        !!items.length &&
        !items[0].sent &&
        !items[0].attachmentAttempted &&
        items[0].href === currentUrl()
    };
  }
  function publish() {
    lock.setQueuePending(items.length);
    for (const listener of listeners) listener(snapshot());
  }
  async function flush() {
    if (running || !items.length || status === 'failed' || status === 'cancelled') return;
    if (!lock.tryAcquire('queue')) {
      status = 'waiting';
      publish();
      return;
    }
    running = true;
    controller = new AbortController();
    try {
      while (items.length) {
        const item = items[0];
        await executeQueued(
          adapter,
          composer,
          item,
          'overwrite',
          controller.signal,
          (phase) => {
            status = phase;
            if (phase === 'uploading') item.attachmentAttempted = true;
            if (phase === 'sending') item.preparedContent = item.content;
            publish();
          },
          () => {
            item.sent = true;
          },
          { timeoutMs: 1800000, startTimeoutMs: 15000, pollMs: 200 },
          item.preparedContent,
          item.href
        );
        items.shift();
        publish();
      }
      status = 'idle';
    } catch (reason) {
      const navigation = reason instanceof Error && reason.message === 'CONVERSATION_CHANGED';
      status = controller.signal.aborted && !navigation ? 'cancelled' : 'failed';
      error = navigation
        ? 'CONVERSATION_CHANGED'
        : controller.signal.aborted
          ? 'QUEUE_CANCELLED'
          : reason instanceof Error
            ? reason.message
            : 'EXECUTION_FAILED';
      if (error === 'SEND_FAILED' && items[0]) items[0].sent = false;
      if (
        controller.signal.aborted &&
        !navigation &&
        !items[0]?.sent &&
        items.shift()?.attachmentAttempted
      )
        error = 'QUEUE_CANCELLED_ATTACHMENTS';
    } finally {
      running = false;
      controller = null;
      publish();
      lock.release();
    }
  }
  function enqueue(item) {
    if (!conversationUrl()) {
      error = 'CONVERSATION_REQUIRED';
      if (!running) status = 'failed';
      publish();
      return false;
    }
    if (controller?.signal.aborted) return false;
    items.push({
      ...item,
      id: crypto.randomUUID(),
      sent: false,
      attachmentAttempted: false,
      preparedContent: '',
      href: currentUrl()
    });
    if ((status === 'cancelled' || status === 'failed') && items.length === 1) {
      status = 'idle';
      error = null;
    }
    publish();
    flush();
    return true;
  }
  function remove(id) {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0 || (running && index === 0)) return;
    items.splice(index, 1);
    if (!items.length || index === 0) {
      status = 'idle';
      error = null;
    }
    publish();
    flush();
  }
  function retry() {
    if (snapshot().canRetry) {
      status = 'idle';
      error = null;
      flush();
    }
  }
  function cancel() {
    version++;
    controller?.abort();
    items.splice(running ? 1 : 0);
    status = 'cancelled';
    error = 'QUEUE_CANCELLED';
    publish();
  }
  function stopForNavigation() {
    version++;
    controller?.abort(new Error('CONVERSATION_CHANGED'));
    if (items.length) {
      status = 'failed';
      error = 'CONVERSATION_CHANGED';
    }
    publish();
  }
  function clearError() {
    if (!running && !items.length) {
      error = null;
      status = 'idle';
      publish();
    }
  }
  lock.subscribe(flush);
  return {
    enqueue,
    flush,
    size: () => items.length,
    getSnapshot: snapshot,
    getCancellationVersion: () => version,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    remove,
    retry,
    cancel,
    stopForNavigation,
    clearError
  };
}
