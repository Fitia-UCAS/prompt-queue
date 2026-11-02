import { h, nativeIcon } from './dom.js';
import { readAttachmentChunk } from '../shared/library.js';

const M = PromptFlowModel,
  S = PromptFlowStore;

async function originalFile(ref, pending) {
  if (pending.has(ref.id)) return pending.get(ref.id);
  const parts = [];
  let offset = 0;
  while (offset < ref.size) {
    const chunk = await readAttachmentChunk(ref.id, offset);
    if (!chunk || chunk.nextOffset <= offset) throw new Error('找不到附件：' + ref.name);
    parts.push(S.decode(chunk.chunkBase64));
    offset = chunk.nextOffset;
  }
  return new File(parts, ref.name, { type: ref.mimeType });
}

async function draftSteps(draft) {
  if (!draft.content.trim() && !draft.attachments.length) return [];
  if (!draft.attachments.length) return [M.step({ text: draft.content })];
  const attachments = [];
  for (const ref of draft.attachments) {
    if (draft.pendingFiles.has(ref.id))
      await S.saveFile(await originalFile(ref, draft.pendingFiles), ref.id);
    attachments.push(ref);
  }
  return [M.step({ text: draft.content, attachments })];
}

export function sourceActions({ attach, readDraft, apply, setBusy, valid }) {
  const container = h('div', { className: 'pc-prompt-sources' });
  const actions = h('div', { className: 'pc-prompt-source-actions' });
  let busy = false,
    disabled = false,
    error;
  const buttons = [];
  const update = () => {
    for (const button of buttons) button.disabled = busy || disabled;
  };
  container.setDisabled = (value) => {
    disabled = value;
    update();
  };
  async function perform(action) {
    if (busy || disabled || !valid()) return;
    busy = true;
    update();
    setBusy(true);
    error?.remove();
    try {
      await action();
    } catch (reason) {
      if (valid() && reason.name !== 'AbortError') {
        error = h('div', { className: 'pc-source-error', role: 'alert' }, reason.message);
        container.append(error);
      }
    } finally {
      busy = false;
      if (valid()) {
        update();
        setBusy(false);
      }
    }
  }
  async function finish(items, title) {
    if (!valid()) return;
    if (!items.length) throw new Error('没有可导入的提示词');
    const draft = readDraft(),
      directory = await S.getDirectory();
    const flow = M.flow({
      title: draft.title.trim() || (items.length === 1 ? items[0].title : title),
      steps: items.flatMap((item) => item.steps)
    });
    if (directory && PromptFlowFileMatch.canMatch(flow))
      await PromptFlowFileMatch.match(flow, directory.handle, S);
    if (!valid()) return;
    if (flow.steps.length === 1 && !flow.steps[0].missingAttachments.length) {
      const step = flow.steps[0],
        files = [];
      for (const ref of step.attachments) {
        const saved = await S.getFile(ref.id);
        if (!saved) throw new Error('找不到附件：' + ref.name);
        files.push({ ref });
      }
      if (valid()) {
        apply({
          title: flow.title,
          content: [draft.content, step.text].filter(Boolean).join('\n\n'),
          files
        });
        requestAnimationFrame(() => {
          const body = container.closest('.pc-prompt-body');
          if (body) body.scrollTop = 0;
          body?.querySelector('#prompt-title')?.focus();
        });
      }
      return;
    }
    flow.steps = [...(await draftSteps(draft)), ...flow.steps];
    if (!valid()) return;
    await S.saveFlow(flow);
    if (valid())
      location.href = chrome.runtime.getURL(
        'workflow.html?flow=' + encodeURIComponent(flow.id) + '&imported=1'
      );
  }
  function input(kind, accept) {
    const element = h('input', {
      type: 'file',
      accept,
      multiple: kind !== 'chat',
      hidden: true,
      'data-pc-source': kind,
      onChange: () => {
        const files = [...element.files];
        element.value = '';
        if (!files.length) return;
        perform(async () => {
          if (kind === 'chat') {
            const parsed = PromptFlowChatImport.parse(await files[0].text());
            const flow = await PromptFlowChatImport.materialize(parsed, S);
            await finish([{ title: flow.title, steps: flow.steps }], flow.title);
          } else
            await finish(
              await PromptChainSources.files(files, S),
              files[0].name.replace(/\.[^.]+$/, '')
            );
        });
      }
    });
    return element;
  }
  const chat = input('chat', '.md,.markdown,.txt'),
    prompts = input('prompts', '.json,.md,.markdown,.txt'),
    markdown = input('markdown', '.md,.markdown,.txt');
  function button(label, glyph, callback) {
    const element = h(
      'button',
      { type: 'button', className: 'compact-button pc-source-button', onClick: callback },
      nativeIcon(glyph),
      h('span', {}, label)
    );
    buttons.push(element);
    return element;
  }
  actions.append(
    button('导入聊天', 'chat', () => chat.click()),
    button('导入 Skill', 'skill', () =>
      perform(async () => {
        const directory = await showDirectoryPicker({ id: 'prompt-chain-skills', mode: 'read' });
        await finish(await PromptChainSources.skills(directory), directory.name);
      })
    ),
    button('导入 Prompts', 'prompts', () => prompts.click()),
    button('导入 Markdown', 'file', () => markdown.click()),
    button('添加附件', 'attachment', attach),
    button('附件目录', 'folder', () =>
      perform(async () => {
        const directory = await showDirectoryPicker({ id: 'prompt-chain-source', mode: 'read' });
        if (!valid()) return;
        await S.saveDirectory(directory);
        await PromptFlowFileMatch.cacheDirectory(directory, S);
      })
    )
  );
  container.append(actions, chat, prompts, markdown);
  return container;
}
