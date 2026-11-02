import { state } from './state.js';
import { init, subscribe, markSelected } from './controller.js';
import {
  listPrompts,
  listFlows,
  getStats,
  getPrompt,
  deletePrompt,
  deleteFlow,
  logUsage,
  exportBackup
} from '../shared/library.js';
import {
  target,
  compatibility,
  platformFor,
  insertPrompt,
  sendPrompt,
  downloadBackup
} from './connection.js';
import { libraryView } from './library.js';
import { settingsView } from './settings.js';
import { openEditor } from './editor.js';
import { confirmDelete } from './dialog.js';
import { toastContainer, showToast } from './toast.js';

const root = document.getElementById('root');
let view,
  editor,
  queuedEditor,
  promptBusy = false,
  loadingRequest = 0;
const toastError = (error, fallback) =>
  showToast({ variant: 'error', message: error instanceof Error ? error.message : fallback });

async function reload() {
  const request = ++loadingRequest;
  const [prompts, chains, stats] = await Promise.all([listPrompts(), listFlows(), getStats()]);
  if (request !== loadingRequest) return;
  Object.assign(state, { prompts, chains, stats, loading: false });
  if (state.view === 'main') view?.renderContent();
}
function edit(prompt) {
  if (state.view !== 'main') {
    queuedEditor = { prompt };
    return;
  }
  if (editor && document.querySelector('[role="dialog"]')) return;
  editor = openEditor(view.element, prompt, async () => {
    await reload();
  });
}
async function openById(id) {
  const prompt = await getPrompt(id);
  if (prompt) edit(prompt);
}
async function exportLibrary(button) {
  if (button.disabled) return;
  button.disabled = true;
  const label = button.lastChild;
  const text = label?.nodeType === Node.TEXT_NODE ? label.textContent : null;
  if (text !== null) label.textContent = '正在导出';
  try {
    await downloadBackup(await exportBackup());
    showToast({ variant: 'success', message: '已导出到下载文件夹' });
  } catch (error) {
    toastError(error, '导出失败');
  } finally {
    button.disabled = false;
    if (text !== null) label.textContent = text;
  }
}
const handlers = {
  edit,
  settings: () => showView('settings'),
  rendered: markSelected,
  export: exportLibrary,
  deletePrompt: (prompt) =>
    confirmDelete(view.element, {
      title: '删除提示词？',
      description: '删除后无法恢复。',
      onConfirm: async () => {
        await deletePrompt(prompt.id);
        state.prompts = state.prompts.filter((item) => item.id !== prompt.id);
        await reload().catch(() => {});
      },
      onError: (error) => toastError(error, '删除提示词失败。')
    }),
  deleteChain: (chain) =>
    confirmDelete(view.element, {
      title: '删除流程？',
      description: `确定删除「${chain.title}」？`,
      onConfirm: async () => {
        await globalThis.PromptChainBeforeDelete?.(chain);
        await deleteFlow(chain.id);
        state.chains = state.chains.filter((item) => item.id !== chain.id);
        await reload().catch(() => {});
      },
      onError: (error) => toastError(error, '删除流程失败。')
    }),
  insert: async (prompt) => {
    if (promptBusy) return;
    promptBusy = true;
    try {
      try {
        await insertPrompt(prompt);
      } catch (error) {
        toastError(error, '无法插入提示词。');
        return;
      }
      await logUsage({
        timestamp: Date.now(),
        platform: state.ready ? state.platform : 'other',
        promptId: prompt.id
      }).catch(() => {});
    } finally {
      promptBusy = false;
    }
  },
  send: async (prompt) => {
    if (promptBusy) return;
    promptBusy = true;
    try {
      await sendPrompt(prompt);
    } catch (error) {
      toastError(error, '发送失败。');
    } finally {
      promptBusy = false;
    }
  }
};

function showView(name) {
  view?.dispose();
  state.view = name;
  view =
    name === 'main'
      ? libraryView(state, handlers)
      : settingsView({
          back: () => {
            showView('main');
            reload();
          },
          exportLibrary
        });
  root.replaceChildren(view.element, toastContainer);
  if (name === 'main' && queuedEditor) {
    const pending = queuedEditor;
    queuedEditor = null;
    edit(pending.prompt);
  }
}

await init();
showView('main');
document.getElementById('preloader')?.remove();
const initialLoad = reload().catch((error) => {
  console.error('无法读取提示词和使用记录', error);
  state.loading = false;
  if (state.view === 'main') view.renderContent();
});
subscribe((current) => {
  const changed =
    JSON.stringify(state.chains) !== JSON.stringify(current.chains) ||
    JSON.stringify(state.run) !== JSON.stringify(current.run);
  state.chains = current.chains;
  state.run = current.run;
  if (state.view !== 'main') return;
  view.updateConnection();
  if (changed) view.renderContent();
});
chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') return;
  const type = message.type;
  if (type === 'OPEN_NEW_PROMPT') edit();
  if (type === 'OPEN_EDIT_PROMPT' && message.payload?.promptId) openById(message.payload.promptId);
  if (type === 'FOCUS_SEARCH' && state.view === 'main') view.focusSearch();
  if (type === 'TEXTAREA_READY') {
    state.ready = true;
    if (state.view === 'main') {
      view.renderContent();
      view.updateConnection();
    }
  }
  if (type === 'DB_CLEARED' || type === 'PROMPTS_IMPORTED') {
    if (state.view !== 'main') showView('main');
    reload();
  }
  if (type === 'CHAIN_PROGRESS') {
    const { stepIndex, totalSteps, status } = message.payload || {};
    if (!status || typeof stepIndex !== 'number' || typeof totalSteps !== 'number') return;
    if (status === 'sending')
      showToast({ message: `正在发送第 ${stepIndex + 1}/${totalSteps} 步` });
    if (status === 'completed' && stepIndex === totalSteps - 1)
      showToast({ variant: 'success', message: '流程已完成' });
    if (status === 'error')
      showToast({ variant: 'error', message: '流程已停止，请检查目标对话。' });
    if (status === 'cancelled') showToast({ variant: 'info', message: '流程已取消' });
  }
});
state.ready = await compatibility();
state.platform = platformFor((await target())?.url);
await initialLoad;
if (state.view === 'main') {
  view.renderContent();
  view.updateConnection();
}
const pending = await new Promise((resolve) =>
  chrome.storage.local.get(['pqPendingAction'], (result) => resolve(result.pqPendingAction))
);
const pendingType = typeof pending === 'string' ? pending : pending?.type;
if (pendingType === 'OPEN_NEW_PROMPT') edit();
if (pendingType === 'FOCUS_SEARCH') view.focusSearch();
if (pendingType === 'OPEN_EDIT_PROMPT' && pending.promptId) await openById(pending.promptId);
if (['OPEN_NEW_PROMPT', 'FOCUS_SEARCH', 'OPEN_EDIT_PROMPT'].includes(pendingType))
  chrome.storage.local.remove(['pqPendingAction']);
document.getElementById('preloader')?.remove();
