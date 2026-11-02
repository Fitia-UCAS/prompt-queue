import {
  getSettings,
  saveSettings,
  searchPrompts,
  searchFlows,
  savePrompt,
  updatePrompt,
  deletePrompt,
  logUsage,
  getAttachmentMeta,
  readAttachmentChunk
} from '../shared/library.js';
import { createMessageListener } from '../shared/rpc.js';

export const handlers = {
  GET_SETTINGS: () => getSettings(),
  SAVE_SETTINGS: ({ settings }) => saveSettings(settings),
  PROMPT_SEARCH: async ({ query, limit }) => {
    const prompts = await searchPrompts(query);
    return (typeof limit === 'number' ? prompts.slice(0, Math.max(0, limit)) : prompts).map(
      (prompt) => ({
        id: prompt.id,
        title: prompt.title,
        content: prompt.content,
        attachments: prompt.attachments || []
      })
    );
  },
  CHAIN_SEARCH: async ({ query, limit }) => {
    const chains = await searchFlows(query);
    return (typeof limit === 'number' ? chains.slice(0, Math.max(0, limit)) : chains).map(
      (chain) => ({ id: chain.id, title: chain.title, steps: chain.steps })
    );
  },
  PROMPT_CREATE: async ({ title, content, attachments = [] }) => {
    const now = Date.now(),
      id = `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await savePrompt({
      id,
      title,
      content,
      attachments,
      usageCount: 0,
      createdAt: now,
      updatedAt: now
    });
    return { id };
  },
  PROMPT_UPDATE: ({ id, title, content, attachments }) =>
    updatePrompt(id, { title, content, ...(attachments ? { attachments } : {}) }),
  PROMPT_DELETE: ({ id }) => deletePrompt(id),
  LOG_USAGE: ({ promptId, platform }) => logUsage({ timestamp: Date.now(), platform, promptId }),
  OPEN_PROMPT_EDITOR: async ({ promptId }) => {
    await new Promise((resolve) =>
      chrome.storage.local.set({ pqPendingAction: { type: 'OPEN_EDIT_PROMPT', promptId } }, () =>
        resolve()
      )
    );
    try {
      const opening = chrome.action.openPopup?.();
      if (opening && typeof opening.then === 'function') opening.catch(() => {});
    } catch {}
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'OPEN_EDIT_PROMPT', payload: { promptId } });
    }, 600);
  },
  ATTACHMENT_GET_META: async ({ ids }) => {
    const attachments = (await Promise.all(ids.map((id) => getAttachmentMeta(id)))).filter(Boolean);
    const found = new Set(attachments.map((ref) => ref.id));
    return { attachments, missingIds: ids.filter((id) => !found.has(id)) };
  },
  ATTACHMENT_GET_CHUNK: async ({ id, offset, length }) => {
    const chunk = await readAttachmentChunk(id, offset, length);
    if (!chunk) throw new Error('ATTACHMENT_NOT_FOUND');
    return chunk;
  }
};

chrome.runtime.onMessage.addListener(createMessageListener(handlers));

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'OPEN_PROMPT_EDITOR' && sender.tab?.id)
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
});
