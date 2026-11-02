import { createMessageListener } from '../shared/rpc.js';
import { readComposer, writeComposer, readShortcut } from './composer.js';
import {
  readSettings,
  searchPrompts,
  searchChains,
  recordUsage,
  updatePrompt,
  createPrompt,
  deletePrompt
} from './site-api.js';
import { currentUrl, insertManual } from './composer-send.js';
import { createSendLock } from './send-lock.js';
import { createSendQueue } from './send-queue.js';
import { createChainRunner } from './chain-runner.mjs';
import { createPalette } from './palette.js';
import { createPromptEditor } from './prompt-editor.js';
import { createStatusPanel } from './status-panel.js';

export function createSiteHost(adapter) {
  globalThis.PromptChainSiteAdapter = adapter;
  let settingsReady = false,
    settingsRequest = null,
    settingsVersion = 0,
    settingsError = false,
    searchError = false;
  let input = null,
    searchVersion = 0,
    announcedInput = false,
    href = currentUrl();
  const editor = createPromptEditor({
    onSave: (prompt) =>
      prompt.id
        ? updatePrompt(prompt.id, prompt.title, prompt.content)
        : createPrompt(prompt.title, prompt.content),
    onDelete: deletePrompt
  });
  const palette = createPalette({
    onSelect(item) {
      const version = item.kind === 'chain' ? chain.getCancellationVersion() : null;
      (async () => {
        const url = currentUrl(),
          previous = adapter.getInputElement(),
          draft = previous ? readComposer(previous) : null;
        if (
          !(await ensureSettings()) ||
          (version !== null && version !== chain.getCancellationVersion())
        )
          return;
        if (url !== currentUrl()) {
          status.showMessage('对话已切换，请重新选择提示词。');
          return;
        }
        const composer = adapter.getInputElement();
        if (!composer || composer !== previous || readComposer(composer) !== draft) {
          status.showMessage('草稿已变化，请重新选择提示词。');
          return;
        }
        if (item.kind === 'prompt') {
          const result = await insertManual(
            adapter,
            lock,
            item.content,
            item.attachments || [],
            'append',
            false,
            url
          );
          if (!result.ok) {
            status.showMessage(result.reason || '无法插入提示词。');
            return;
          }
          palette.hide();
          recordUsage(
            item.id,
            ['chatgpt', 'deepseek', 'gemini'].includes(adapter.id) ? adapter.id : 'other'
          ).catch(() => {});
          return;
        }
        palette.hide();
        if (!chain.isRunning())
          chrome.runtime
            .sendMessage({
              type: 'PC_RUN_NATIVE',
              payload: { steps: item.steps, chainId: item.id, expectedHref: currentUrl() }
            })
            .then((response) => {
              if (!response?.ok) status.showMessage(response?.error || '无法启动流程');
            });
      })();
    },
    onEdit(item) {
      palette.hide();
      if (item.kind === 'prompt')
        editor.open({
          id: item.id,
          title: item.title,
          content: item.content,
          attachmentCount: item.attachments.length
        });
    },
    onCreate() {
      palette.hide();
      editor.open({ title: '', content: '' });
    },
    onClose() {
      searchVersion++;
    }
  });
  const lock = createSendLock(),
    queue = createSendQueue(adapter, () => adapter.getInputElement(), lock);
  const chain = createChainRunner({
    readUrl: currentUrl,
    publish(snapshot) {
      try {
        chrome.runtime.sendMessage({ type: 'CHAIN_PROGRESS', payload: snapshot }).catch(() => {});
      } catch {}
    }
  });
  const status = createStatusPanel(queue, chain);

  function scanPage() {
    const nextHref = currentUrl();
    if (nextHref !== href) {
      href = nextHref;
      queue.stopForNavigation();
      chain.stopForNavigation();
      palette.hide();
      searchVersion++;
    }
    const next = adapter.getInputElement();
    if (next !== input) {
      input = next;
      if (next && !announcedInput) {
        announcedInput = true;
        chrome.runtime.sendMessage({ type: 'TEXTAREA_READY' });
      }
    }
  }
  function ensureSettings() {
    if (settingsReady) return Promise.resolve(true);
    if (settingsRequest) return settingsRequest;
    const version = settingsVersion;
    settingsRequest = (async () => {
      try {
        await readSettings();
        if (version !== settingsVersion) return settingsReady;
        settingsReady = true;
        if (settingsError) status.showMessage('');
        settingsError = false;
        return true;
      } catch {
        if (version === settingsVersion) {
          settingsReady = false;
          settingsError = true;
          status.showMessage('连接失败，请重试或刷新页面。');
        }
        return false;
      } finally {
        if (version === settingsVersion) settingsRequest = null;
      }
    })();
    return settingsRequest;
  }
  async function search() {
    const composer = input || adapter.getInputElement();
    if (!composer) {
      searchVersion++;
      palette.hide();
      return;
    }
    const context = readShortcut(composer);
    if (!context) {
      searchVersion++;
      palette.hide();
      return;
    }
    const query = context.query || '',
      version = ++searchVersion;
    try {
      const [prompts, chains] = await Promise.all([searchPrompts(query), searchChains(query)]);
      if (version !== searchVersion) return;
      const items = [
        ...prompts.map((prompt) => ({
          kind: 'prompt',
          id: prompt.id,
          title: prompt.title,
          content: prompt.content,
          attachments: prompt.attachments || []
        })),
        ...chains.map((flow) => ({
          kind: 'chain',
          id: flow.id,
          title: flow.title,
          steps: flow.steps
        }))
      ];
      palette.show(
        { x: context.rect.left, top: context.rect.top, bottom: context.rect.bottom },
        items,
        query ? '$' + query : ''
      );
      if (searchError) status.showMessage('');
      searchError = false;
    } catch {
      if (version !== searchVersion) return;
      palette.hide();
      searchError = true;
      status.showMessage('连接失败，请重试或刷新页面。');
    }
  }
  function eventComposer(event) {
    if (!event.target) return null;
    const composer = input || adapter.getInputElement();
    return composer &&
      (event.target === composer ||
        (composer instanceof HTMLElement && composer.contains(event.target)))
      ? composer
      : null;
  }
  function keydown(event) {
    if (!event.isTrusted) return;
    if (
      palette.isOpen() &&
      !event.isComposing &&
      event.keyCode !== 229 &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        palette.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if ((event.key === 'Tab' || event.key === 'Enter') && palette.getSelected()) {
        palette.selectCurrent();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key === 'Escape') {
        palette.hide();
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key === 'Enter') palette.hide();
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      const composer = eventComposer(event);
      if (!composer || !adapter.isGenerating()) return;
      const draft = readComposer(composer);
      if (!draft.trim()) return;
      event.preventDefault();
      const url = currentUrl(),
        version = queue.getCancellationVersion();
      ensureSettings().then((ready) => {
        if (!ready || version !== queue.getCancellationVersion()) return;
        if (
          currentUrl() !== url ||
          adapter.getInputElement() !== composer ||
          readComposer(composer) !== draft
        ) {
          status.showMessage('草稿已变化，请再次按 Enter 加入队列。');
          return;
        }
        writeComposer(composer, '');
        if (!queue.enqueue({ content: draft })) {
          writeComposer(composer, draft);
          status.showMessage(
            queue.getSnapshot().error === 'CONVERSATION_REQUIRED'
              ? '请先发送第一条消息，再运行流程。'
              : '正在取消，请稍后重试。'
          );
        }
      });
    }
  }
  function onInput(event) {
    if (event.isTrusted && eventComposer(event)) search();
  }
  function outsideClick(event) {
    if (!event.isTrusted || !palette.isOpen()) return;
    const composer = input || adapter.getInputElement();
    if (
      (composer instanceof HTMLElement && event.target && composer.contains(event.target)) ||
      palette.isEventInside(event)
    )
      return;
    palette.hide();
  }
  function composerFocused() {
    const composer = input || adapter.getInputElement(),
      active = document.activeElement;
    return (
      !!composer &&
      !!active &&
      (active === composer || (composer instanceof HTMLElement && composer.contains(active)))
    );
  }
  function focusout(event) {
    if (!palette.isOpen() || palette.isNodeInside(event.relatedTarget)) return;
    setTimeout(() => {
      if (palette.isOpen() && !composerFocused() && !palette.isNodeInside(document.activeElement))
        palette.hide();
    }, 0);
  }
  async function inject({ content, attachments = [], expectedHref }, send) {
    if (!content && !attachments.length)
      return { ok: false, sendAttempted: false, reason: '没有提示词文字或附件。' };
    const previous = adapter.getInputElement(),
      draft = previous ? readComposer(previous) : null;
    if (!(await ensureSettings()))
      return { ok: false, sendAttempted: false, reason: '页面连接失败，请刷新后重试。' };
    const composer = adapter.getInputElement();
    if (composer !== previous || (composer && readComposer(composer) !== draft))
      return { ok: false, sendAttempted: false, reason: '草稿已变化，请重试。' };
    const text = !content || content.endsWith('\n') ? content || '' : content + '\n';
    return insertManual(adapter, lock, text, attachments, 'append', send, expectedHref);
  }
  const handlers = {
    PC_ACQUIRE: async () => ({
      acquired: lock.getOwner() === 'supervisor' || lock.tryAcquire('supervisor')
    }),
    PC_RELEASE: async () => {
      if (lock.getOwner() === 'supervisor') lock.release();
      return {};
    },
    COMPAT_CHECK: async () => ({ ready: !!adapter.getInputElement() }),
    INJECT_PROMPT: (payload) => inject(payload, false),
    INSERT_AND_SEND_PROMPT: (payload) => inject(payload, true),
    RUN_CHAIN: async ({ chainId, expectedHref }) => {
      const response = await chrome.runtime.sendMessage({
        type: 'PC_RUN_NATIVE',
        payload: { chainId, expectedHref }
      });
      return response?.ok ? { ok: true } : { ok: false, reason: response?.error || '无法启动流程' };
    },
    CANCEL_CHAIN: async () => {
      chain.cancel();
    }
  };
  new MutationObserver(scanPage).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  window.addEventListener('popstate', scanPage);
  window.addEventListener('hashchange', scanPage);
  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('focusin', scanPage, true);
  document.addEventListener('focusout', focusout, true);
  document.addEventListener('mousedown', outsideClick, true);
  chrome.runtime.onMessage.addListener(createMessageListener(handlers));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.pqLibrary) {
      settingsVersion++;
      settingsReady = false;
      settingsRequest = null;
      ensureSettings();
    }
  });
  scanPage();
  ensureSettings();
}
