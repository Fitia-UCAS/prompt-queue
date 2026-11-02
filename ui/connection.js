import { providerFor } from '../shared/platforms.mjs';
const supported = (url) => !!providerFor(url);
let tab = null,
  ready = false,
  sequence = 0;
export async function target() {
  const run = (await chrome.storage.local.get('pfRun')).pfRun;
  const tabs = (await chrome.tabs.query({})).filter((item) => supported(item.url));
  if (run && PromptFlowModel.ACTIVE.has(run.status))
    return (
      tabs.find((item) => item.id === run.tabId) ||
      tabs.find((item) => PromptFlowModel.sameChat(run.targetUrl, item.url)) ||
      null
    );
  const active = (await chrome.tabs.query({ active: true, currentWindow: true })).find((item) =>
    supported(item.url)
  );
  return active || tabs.find((item) => item.id === tab?.id) || tabs[0] || null;
}
export async function connect(repair = false) {
  const request = ++sequence,
    next = await target();
  let ok = false;
  const run = (await chrome.storage.local.get('pfRun')).pfRun;
  const expected = run && PromptFlowModel.ACTIVE.has(run.status) ? run.targetUrl : '';
  if (repair && !next) {
    if (request === sequence) {
      tab = null;
      ready = false;
    }
    throw new Error(
      expected
        ? 'TARGET_TAB_CLOSED: The tab bound to this flow was closed'
        : '请先打开 ChatGPT、Gemini 或 DeepSeek 对话页'
    );
  }
  if (next)
    try {
      const response = repair
        ? await chrome.runtime.sendMessage({ type: 'PF_CONNECT', tabId: next.id })
        : await chrome.tabs.sendMessage(next.id, { type: 'PF_STATUS' });
      const snapshot = response?.snapshot;
      ok = !!(
        response?.ok &&
        snapshot?.hasComposer &&
        PromptFlowModel.sameChat(next.url, snapshot.url, true) &&
        (!expected || PromptFlowModel.sameChat(expected, snapshot.url))
      );
      if (repair && !ok)
        throw new Error(
          response?.error ||
            (expected && snapshot && !PromptFlowModel.sameChat(expected, snapshot.url)
              ? 'TARGET_CONVERSATION_LOST: The bound conversation is no longer open'
              : '尚未连接到聊天输入框')
        );
    } catch (error) {
      if (repair) {
        if (request === sequence) {
          tab = next;
          ready = false;
        }
        throw error;
      }
    }
  if (request === sequence) {
    tab = next;
    ready = ok;
  }
  return { tab, ready };
}
export const connection = () => ({ tab, ready });

import { callTab } from '../shared/rpc.js';

export function platformFor(url = '') {
  if (/^https?:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(url)) return 'chatgpt';
  if (/^https?:\/\/gemini\.google\.com\//.test(url)) return 'gemini';
  if (/^https?:\/\/chat\.deepseek\.com\//.test(url)) return 'deepseek';
  return 'other';
}
async function selectedTab() {
  const tab = await target();
  if (!tab?.id || !tab.url || platformFor(tab.url) === 'other')
    throw new Error('请先打开 ChatGPT、Gemini 或 DeepSeek。');
  return tab;
}
export async function compatibility() {
  const tab = await target();
  if (!tab?.id || !tab.url || platformFor(tab.url) === 'other') return false;
  try {
    return (await callTab(tab.id, 'COMPAT_CHECK', undefined)).ready;
  } catch {
    return false;
  }
}
export async function insertPrompt(prompt) {
  const tab = await selectedTab();
  try {
    const response = await callTab(tab.id, 'INJECT_PROMPT', {
      content: prompt.content,
      attachments: prompt.attachments || [],
      expectedHref: tab.url
    });
    if (!response.ok) throw new Error(response.reason || '无法插入提示词。');
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '无法插入提示词。');
  }
}
export async function sendPrompt(prompt) {
  const tab = await selectedTab();
  let response;
  try {
    response = await callTab(tab.id, 'INSERT_AND_SEND_PROMPT', {
      content: prompt.content,
      attachments: prompt.attachments || [],
      expectedHref: tab.url
    });
  } catch {
    throw new Error('消息可能已经发送，请先核对对话。');
  }
  if (!response.ok)
    throw new Error(
      response.sendAttempted ? '消息可能已经发送，请先核对对话。' : response.reason || '发送失败。'
    );
}
export async function downloadBackup(backup) {
  const filename = `prompt-queue-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const url =
    'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
  if (
    typeof chrome !== 'undefined' &&
    chrome.downloads &&
    typeof chrome.downloads.download === 'function'
  ) {
    await new Promise((resolve, reject) =>
      chrome.downloads.download({ url, filename, saveAs: false }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      })
    );
  } else {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
  }
}
