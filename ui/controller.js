import { listFlows, ensureSelfTest, reorder } from '../shared/library.js';
import { connect, connection, target } from './connection.js';
import { recentOrder } from './state.js';
import { h } from './dom.js';

const M = PromptFlowModel,
  S = PromptFlowStore;
const listeners = new Set();
let chains = [],
  run = null,
  activeTarget,
  toastTimer;
export async function rpc(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '操作失败');
  return result;
}
export function notify(text) {
  clearTimeout(toastTimer);
  let element = document.getElementById('pc-toast');
  if (!element) {
    element = h('div', { id: 'pc-toast', className: 'pc-toast' });
    document.body.append(element);
  }
  element.replaceChildren(
    document.createTextNode(text),
    h('button', { 'aria-label': '关闭提示', onClick: () => element.remove() }, '×')
  );
  toastTimer = setTimeout(() => element.remove(), 5000);
}
export const action =
  (callback) =>
  async (...args) => {
    try {
      await callback(...args);
    } catch (error) {
      if (error.name !== 'AbortError') notify(error.message);
    }
  };
export const panelState = () => ({ chains, run, ...connection() });
export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function publish() {
  for (const listener of listeners) listener(panelState());
}
export async function refresh() {
  chains = await listFlows();
  run = (await chrome.storage.local.get('pfRun')).pfRun || null;
  await connect();
  publish();
}
export async function repairConnection() {
  await connect(true);
  await refresh();
}
export async function editFlow(chainId) {
  location.href = chrome.runtime.getURL('workflow.html?flow=' + encodeURIComponent(chainId));
}
export async function runFlow(chainId) {
  const current = run && M.ACTIVE.has(run.status) && run.flow.id === chainId;
  if (current) {
    location.href = chrome.runtime.getURL(
      'workflow.html?monitor=1' +
        (run.status === 'paused' ? '&resume=' + encodeURIComponent(run.id) : '')
    );
    return;
  }
  const selected = await target();
  if (!selected) throw new Error('请先打开 ChatGPT、Gemini 或 DeepSeek。');
  await rpc('PC_RUN_NATIVE', {
    tabId: selected.id,
    payload: { chainId, expectedHref: selected.url }
  });
  location.href = chrome.runtime.getURL('workflow.html?monitor=1');
}
export async function stopFlow() {
  await rpc('PF_STOP');
  await refresh();
}
export async function exportDom() {
  await rpc('PF_EXPORT_DOM');
}

export function markSelected() {
  for (const card of document.querySelectorAll('[data-pc-selected]'))
    card.removeAttribute('data-pc-selected');
  if (!activeTarget?.id) return;
  const selector =
    activeTarget.kind === 'chain'
      ? '.chain-card[data-chain-id="' + CSS.escape(activeTarget.id) + '"]'
      : '[data-prompt-id="' + CSS.escape(activeTarget.id) + '"]';
  document.querySelector(selector)?.setAttribute('data-pc-selected', 'true');
}
function setupCardReorder() {
  const cardOf = (node) => node?.closest?.('.prompt-card,.chain-card');
  const identity = (card) =>
    card.matches('.chain-card')
      ? { kind: 'chain', id: card.dataset.chainId || '' }
      : { kind: 'prompt', id: card.dataset.promptId || '' };
  const remember = (node) => {
    const card = cardOf(node);
    if (card) {
      const found = identity(card);
      if (found.id) {
        activeTarget = found;
        markSelected();
      }
    }
  };
  document.addEventListener('pointerdown', (event) => remember(event.target), true);
  document.addEventListener('focusin', (event) => remember(event.target));
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        !event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !['ArrowUp', 'ArrowDown'].includes(event.key)
      )
        return;
      if (event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const selected =
        activeTarget &&
        document.querySelector(
          activeTarget.kind === 'chain'
            ? '.chain-card[data-chain-id="' + CSS.escape(activeTarget.id) + '"]'
            : '[data-prompt-id="' + CSS.escape(activeTarget.id) + '"]'
        );
      const card = cardOf(document.activeElement) || selected;
      if (!card) return;
      event.preventDefault();
      event.stopPropagation();
      action(async () => {
        const own = identity(card),
          siblings = [...card.parentElement.children].filter((node) =>
            node.matches('.prompt-card,.chain-card')
          );
        const neighbor = siblings[siblings.indexOf(card) + (event.key === 'ArrowUp' ? -1 : 1)];
        if (!neighbor) return;
        const other = identity(neighbor);
        if (!own.id || !other.id || own.kind !== other.kind) return;
        const promptOrder = (await S.readLibrary()).prompts
          .sort(recentOrder)
          .map((prompt) => prompt.id);
        await reorder(own.kind, own.id, other.id, promptOrder);
        activeTarget = own;
        await rpc('PC_PANEL_REFRESH').catch(() => {});
      })();
    },
    true
  );
}

export async function init() {
  globalThis.PromptChainResolveTarget = target;
  globalThis.PromptChainNotify = notify;
  globalThis.PromptChainStepTitle = (step, index) =>
    '第 ' + (index + 1) + ' 步 · ' + M.firstSentence(step.text, step.attachments?.[0]?.name);
  globalThis.PromptChainBeforeDelete = async (chain) => {
    const active = (await chrome.storage.local.get('pfRun')).pfRun;
    if (active?.flow.id === chain.id && M.ACTIVE.has(active.status)) await rpc('PF_STOP');
  };
  await ensureSelfTest().catch((error) => notify(error.message));
  setupCardReorder();
  await refresh();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.pqLibrary || changes.pfRun)) refresh().catch(() => {});
  });
  const reconnect = () =>
    connect()
      .then(publish)
      .catch(() => {});
  chrome.tabs.onActivated.addListener(reconnect);
  chrome.tabs.onUpdated.addListener(reconnect);
  setInterval(reconnect, 2500);
}
