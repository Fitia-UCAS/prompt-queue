import { statusCss } from './site-styles.js';

const labels = {
  idle: '就绪',
  waiting: '等待中',
  uploading: '正在上传',
  sending: '正在发送',
  awaiting_response: '正在回答',
  failed: '已停止',
  cancelled: '已取消',
  starting: '正在启动',
  delayed: '等待中',
  completed: '已完成',
  error: '已停止'
};
const errors = {
  QUEUE_CANCELLED: '',
  CHAIN_CANCELLED: '',
  QUEUE_CANCELLED_ATTACHMENTS: '聊天框中可能仍有附件。',
  CONVERSATION_REQUIRED: '请先发送第一条消息，再运行流程。',
  CONVERSATION_CHANGED: '请回到该流程原来的对话后重试。',
  COMPOSER_CHANGED: '请先清空草稿，再重试。',
  COMPOSER_BUSY: '请先完成或取消当前队列。',
  INPUT_NOT_FOUND: '找不到聊天输入框。',
  SEND_FAILED: '发送失败。',
  SEND_UNCERTAIN: '消息可能已经发送，请先核对对话。',
  MODEL_IDLE_TIMEOUT: '等待对话空闲已超过 30 分钟。',
  RESPONSE_TIMEOUT: '回答超过 30 分钟仍未完成。',
  GENERATION_START_TIMEOUT: '没有检测到回答，请先核对消息是否已发送。',
  ATTACHMENT_UPLOAD_TIMEOUT: '无法确认上传，请检查输入框中的附件。',
  ATTACHMENT_UPLOAD_FAILED: '上传失败。',
  ATTACHMENT_NOT_FOUND: '提示词缺少附件，请重新添加。',
  EXECUTION_FAILED: '执行失败。'
};

export function createStatusPanel(queue, chain) {
  const host = document.createElement('div');
  host.id = 'promptchain-execution';
  const shadow = host.attachShadow({ mode: 'closed' }),
    style = document.createElement('style');
  style.textContent = statusCss;
  shadow.append(style);
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'PromptQueue 执行状态');
  section.innerHTML =
    '<header><span class="title">PromptQueue</span><button type="button" class="toggle" aria-expanded="true">收起</button></header><div class="body"><div class="status" role="status" aria-live="polite"><span class="kind"></span><span class="count"></span><span class="state"></span></div><p class="message" role="alert"></p><ol></ol><div class="actions"><button type="button" class="retry">重试</button><button type="button" class="cancel">取消队列</button><button type="button" class="cancel-chain">取消流程</button><button type="button" class="dismiss">关闭</button></div></div>';
  shadow.append(section);
  document.documentElement.append(host);
  const status = section.querySelector('.status'),
    kind = section.querySelector('.kind'),
    count = section.querySelector('.count'),
    state = section.querySelector('.state');
  const message = section.querySelector('.message'),
    list = section.querySelector('ol'),
    retry = section.querySelector('.retry'),
    cancel = section.querySelector('.cancel');
  const cancelChain = section.querySelector('.cancel-chain'),
    dismiss = section.querySelector('.dismiss'),
    toggle = section.querySelector('.toggle'),
    body = section.querySelector('.body');
  let note = '';
  function render() {
    const queued = queue.getSnapshot(),
      queueError = queued.error === 'QUEUE_CANCELLED' && !queued.items.length ? null : queued.error;
    const snapshot = chain.getSnapshot(),
      flow = snapshot.totalSteps && snapshot.error !== 'CHAIN_CANCELLED' ? snapshot : null,
      running = chain.isRunning();
    host.hidden = !queued.items.length && !note && !flow && !queueError;
    const current =
      running && flow
        ? { kind: '流程', count: `${flow.stepIndex + 1} / ${flow.totalSteps}`, state: flow.status }
        : queued.items.length
          ? { kind: '队列', count: String(queued.items.length), state: queued.status }
          : queueError
            ? { kind: '队列', count: '', state: queued.status }
            : flow
              ? { kind: '流程', count: '', state: flow.status }
              : null;
    status.hidden = !current;
    kind.textContent = current?.kind ?? '';
    count.textContent = current?.count ?? '';
    state.textContent = current ? labels[current.state] || current.state : '';
    state.dataset.tone = current
      ? ['failed', 'error'].includes(current.state)
        ? 'error'
        : current.state === 'completed'
          ? 'done'
          : ['starting', 'uploading', 'sending', 'awaiting_response'].includes(current.state)
            ? 'active'
            : ''
      : '';
    const failure = queueError || (queued.items.length ? undefined : flow?.error),
      code = failure?.split(/[: ]/, 1)[0];
    const explanation = failure ? (errors[code || ''] ?? failure.replaceAll('_', ' ')) : '';
    const attachmentWarning =
      queued.items[0]?.attachmentAttempted && !queued.items[0].sent && queued.status === 'failed'
        ? '请清除输入框中的附件，移除此项后重新加入队列。'
        : failure?.includes('可能已经发送') && !explanation.includes('可能已经发送')
          ? '上一条提示词可能已经发送。'
          : '';
    message.textContent = note || [explanation, attachmentWarning].filter(Boolean).join(' ');
    message.dataset.tone =
      !note && (queued.status === 'failed' || flow?.status === 'error') ? 'error' : '';
    message.hidden = !message.textContent;
    list.replaceChildren();
    for (const item of queued.items) {
      const row = document.createElement('li');
      row.dataset.current = String(queued.running && item.id === queued.items[0]?.id);
      const text = document.createElement('p');
      text.textContent = item.content || '附件';
      text.title = item.content;
      row.append(text);
      if (item.sent) {
        const sent = document.createElement('span');
        sent.className = 'sent';
        sent.textContent = queued.running ? '已发送' : '移除此项后继续';
        row.append(sent);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.disabled = queued.running && item.id === queued.items[0]?.id;
      remove.setAttribute('aria-label', `移除排队提示词：${item.content.slice(0, 80)}`);
      remove.addEventListener('click', (event) => {
        if (event.isTrusted) queue.remove(item.id);
      });
      row.append(remove);
      list.append(row);
    }
    list.hidden = !queued.items.length;
    retry.hidden = !queued.canRetry;
    cancel.hidden = !queued.items.length;
    cancelChain.hidden = !running;
    dismiss.hidden = queued.items.length > 0 || running;
  }
  retry.addEventListener('click', (event) => {
    if (event.isTrusted) {
      note = '';
      queue.retry();
    }
  });
  cancel.addEventListener('click', (event) => {
    if (event.isTrusted) {
      note = '';
      queue.cancel();
    }
  });
  cancelChain.addEventListener('click', (event) => {
    if (event.isTrusted) {
      note = '正在取消…';
      chain.cancel();
      render();
    }
  });
  dismiss.addEventListener('click', (event) => {
    if (event.isTrusted) {
      note = '';
      queue.clearError();
      host.hidden = true;
    }
  });
  toggle.addEventListener('click', (event) => {
    if (event.isTrusted) {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? '展开' : '收起';
      toggle.setAttribute('aria-expanded', String(!body.hidden));
    }
  });
  queue.subscribe(render);
  chain.subscribe((snapshot) => {
    if (['completed', 'error', 'cancelled'].includes(snapshot.status)) note = '';
    render();
  });
  return {
    showMessage(text) {
      note = text;
      body.hidden = false;
      toggle.textContent = '收起';
      toggle.setAttribute('aria-expanded', 'true');
      render();
    }
  };
}
