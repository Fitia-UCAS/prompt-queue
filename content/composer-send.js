import {
  readComposer,
  writeComposer,
  appendComposer,
  sameText,
  enabledComposer
} from './composer.js';
import { attachmentFiles } from './site-api.js';

export const currentUrl = () => globalThis.location?.href ?? '';
export function conversationUrl(url = currentUrl()) {
  if (!url) return false;
  const { hostname, pathname } = new URL(url);
  if (/(^|\.)chatgpt\.com$/.test(hostname) || /(^|\.)chat\.openai\.com$/.test(hostname))
    return /^\/(?:g\/[^/]+\/)?c\/(?!local-chatgpt(?::|%3A))[^/]+\/?$/i.test(pathname);
  if (/(^|\.)chat\.deepseek\.com$/.test(hostname))
    return /^\/(?:a\/)?chat\/s\/[^/]+\/?$/.test(pathname);
  if (/(^|\.)gemini\.google\.com$/.test(hostname))
    return /^\/(?:u\/\d+\/)?(?:app|gem\/[^/]+)\/[^/]+\/?$/.test(pathname);
  return false;
}
function guardConversation(signal, url) {
  signal.throwIfAborted();
  if (currentUrl() !== url) throw new Error('CONVERSATION_CHANGED');
  if (!conversationUrl(url)) throw new Error('CONVERSATION_REQUIRED');
}
export async function abortableDelay(milliseconds, signal) {
  signal.throwIfAborted();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    function abort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
  });
}
export async function clickWhenReady(
  adapter,
  input,
  text,
  url,
  attempted,
  signal = new AbortController().signal,
  timing = { timeoutMs: 5000, pollMs: 200 }
) {
  const start = Date.now();
  function guard() {
    signal.throwIfAborted();
    if (currentUrl() !== url) throw new Error('CONVERSATION_CHANGED');
    if (!input.isConnected || adapter.getInputElement() !== input)
      throw new Error('COMPOSER_CHANGED: 输入框已变化，请先核对草稿。');
    if (!sameText(readComposer(input), text))
      throw new Error('COMPOSER_CHANGED: 请保存或清空草稿后重试。');
    if (adapter.isGenerating()) throw new Error('发送前模型已开始回答，请检查对话后重试。');
  }
  for (;;) {
    await abortableDelay(timing.pollMs, signal);
    guard();
    if (adapter.getSendButton(input)) {
      guard();
      attempted();
      let clicked;
      try {
        clicked = adapter.clickSend(input);
      } catch {
        throw new Error('SEND_UNCERTAIN: 提示词可能已经发送。');
      }
      if (!clicked) throw new Error('SEND_FAILED');
      return;
    }
    if (Date.now() - start >= timing.timeoutMs) throw new Error('SEND_FAILED');
  }
}
export async function executeQueued(
  adapter,
  composer,
  item,
  mode,
  signal,
  publish,
  attempted,
  timing = { timeoutMs: 120000, startTimeoutMs: 15000, pollMs: 200 },
  prepared,
  url = currentUrl()
) {
  guardConversation(signal, url);
  const initial = readComposer(composer() || adapter.getInputElement());
  publish('waiting');
  if (prepared !== undefined && initial !== '' && !sameText(initial, prepared))
    throw new Error('COMPOSER_CHANGED: 请保存或清空草稿后重试。');
  let start = Date.now();
  while (adapter.isGenerating() || !enabledComposer(adapter.getInputElement())) {
    guardConversation(signal, url);
    if (Date.now() - start >= timing.timeoutMs) throw new Error('MODEL_IDLE_TIMEOUT');
    await abortableDelay(timing.pollMs, signal);
  }
  guardConversation(signal, url);
  if (item.attachments?.length) {
    publish('uploading');
    const files = await attachmentFiles(item.attachments);
    guardConversation(signal, url);
    const attached = await adapter.attachFiles(files);
    if (!attached.ok) throw new Error(attached.error || 'ATTACHMENT_UPLOAD_FAILED');
    const uploaded = await adapter.waitForUploadsComplete({
      timeoutMs: 120000,
      pollMs: timing.pollMs,
      files
    });
    guardConversation(signal, url);
    if (!uploaded) throw new Error('ATTACHMENT_UPLOAD_TIMEOUT');
  }
  guardConversation(signal, url);
  const input = composer() || adapter.getInputElement();
  if (!input) throw new Error('INPUT_NOT_FOUND');
  const draft = readComposer(input);
  if (draft !== initial || (prepared !== undefined && draft !== '' && !sameText(draft, prepared)))
    throw new Error('COMPOSER_CHANGED: 请保存或清空草稿后重试。');
  if (mode === 'append') appendComposer(input, item.content);
  else writeComposer(input, item.content);
  const expected = (
    mode === 'append' && draft ? `${draft}\n${item.content}` : item.content
  ).replace(/\r\n|\r/g, '\n');
  guardConversation(signal, url);
  publish('sending');
  await clickWhenReady(adapter, input, expected, url, attempted, signal, {
    timeoutMs: Math.min(5000, timing.startTimeoutMs),
    pollMs: timing.pollMs
  });
  publish('awaiting_response');
  start = Date.now();
  while (!adapter.isGenerating()) {
    guardConversation(signal, url);
    if (Date.now() - start >= timing.startTimeoutMs) throw new Error('GENERATION_START_TIMEOUT');
    await abortableDelay(timing.pollMs, signal);
  }
  start = Date.now();
  while (adapter.isGenerating() || !enabledComposer(adapter.getInputElement())) {
    guardConversation(signal, url);
    if (Date.now() - start >= timing.timeoutMs) throw new Error('RESPONSE_TIMEOUT');
    await abortableDelay(timing.pollMs, signal);
  }
  guardConversation(signal, url);
}

export async function insertManual(adapter, lock, text, attachments, mode, send, url) {
  if (!text.trim() && !attachments.length)
    return { ok: false, sendAttempted: false, reason: '这条提示词只有附件，请在设置中开启附件。' };
  if (!lock.tryAcquire('manual'))
    return {
      ok: false,
      sendAttempted: false,
      reason: '已有队列或流程在运行，请等待完成或先取消。'
    };
  let input = null,
    changed = false,
    sendAttempted = false;
  const onInput = () => {
    changed = true;
  };
  try {
    input = adapter.getInputElement();
    if (!input) throw new Error('请先打开对话，再重试。');
    const composer = input,
      draft = readComposer(input);
    function guard() {
      if (currentUrl() !== url) throw new Error('对话已切换，未插入内容。');
      if (!composer.isConnected || adapter.getInputElement() !== composer)
        throw new Error('输入框已重新加载，请重试。');
      if (changed || readComposer(composer) !== draft) throw new Error('草稿已变化，未插入内容。');
      if (send && adapter.isGenerating()) throw new Error('请等待当前回答完成。');
    }
    guard();
    input.addEventListener('input', onInput);
    if (attachments.length) {
      const files = await attachmentFiles(attachments);
      guard();
      const attached = await adapter.attachFiles(files);
      if (!attached.ok) throw new Error(attached.error || '附件上传失败，请检查输入框。');
      const uploaded = await adapter.waitForUploadsComplete({
        timeoutMs: 120000,
        pollMs: 250,
        files
      });
      guard();
      if (!uploaded) throw new Error('无法确认附件上传，请检查输入框。');
    }
    guard();
    input.removeEventListener('input', onInput);
    if (mode === 'append') {
      if (text) appendComposer(input, text);
    } else writeComposer(input, text);
    if (send) {
      const expected = (
        mode === 'append' ? (text ? (draft ? `${draft}\n${text}` : text) : draft) : text
      ).replace(/\r\n|\r/g, '\n');
      await clickWhenReady(adapter, input, expected, url, () => {
        sendAttempted = true;
      });
    }
    return { ok: true, sendAttempted };
  } catch (error) {
    if (error instanceof Error && error.message === 'SEND_FAILED')
      return { ok: false, sendAttempted: false, reason: '未能点击发送，提示词保留在输入框中。' };
    const message = error instanceof Error ? error.message : '';
    const reason = message.startsWith('CONVERSATION_CHANGED')
      ? '发送前对话已切换。'
      : message.startsWith('COMPOSER_CHANGED')
        ? '发送前输入框已变化，请核对后手动发送。'
        : message === 'ATTACHMENT_NOT_FOUND'
          ? '提示词缺少附件，请重新添加。'
          : message || '无法插入提示词。';
    return { ok: false, sendAttempted, reason };
  } finally {
    input?.removeEventListener('input', onInput);
    lock.release();
  }
}
