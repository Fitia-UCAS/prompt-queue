import { h, iconButton, trapFocus, restoreFocus as returnFocus } from './dom.js';
import { icon } from './icons.js';
import { makeAttachmentRef, savePrompt, updatePrompt } from '../shared/library.js';
import { sourceActions } from './source-actions.js';

export function openEditor(parent, initialPrompt, onSaved, { shortcutTitle = false } = {}) {
  const editing = !!initialPrompt,
    previousFocus = document.activeElement;
  const pending = new Map();
  let attachments = [...(initialPrompt?.attachments ?? [])],
    alive = true,
    saving = false,
    choosing = false;
  const title = h('input', {
    id: 'prompt-title',
    value: initialPrompt?.title ?? '',
    className: 'form-input w-full rounded-[4px] px-3 py-2.5 text-sm'
  });
  const content = h(
    'textarea',
    {
      id: 'prompt-content',
      className:
        'form-input min-h-[120px] w-full resize-none rounded-[4px] px-3 py-2.5 text-sm leading-6',
      rows: 4
    },
    initialPrompt?.content ?? ''
  );
  const fieldset = h('fieldset', { className: 'contents' });
  const body = h('div', { className: 'space-y-4 p-4 pc-prompt-body' });
  let errorNode, attachmentList;
  let sources, cancelButton, saveButton;
  const setBusy = (busy) => {
    fieldset.disabled = busy;
    sources?.setDisabled(busy);
    if (cancelButton) cancelButton.disabled = busy;
    if (saveButton) {
      saveButton.disabled = busy;
      saveButton.replaceChildren(
        ...(busy ? [icon('loader-circle', 16, 'animate-spin')] : []),
        '保存'
      );
    }
  };
  function fail(message) {
    errorNode?.remove();
    errorNode = h(
      'div',
      {
        className:
          'rounded-[4px] border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700',
        role: 'alert'
      },
      message
    );
    body.prepend(errorNode);
  }
  function close(restoreFocus = true) {
    if (saving) return;
    alive = false;
    pending.clear();
    backdrop.remove();
    window.removeEventListener('keydown', keydown, true);
    if (restoreFocus) setTimeout(() => returnFocus(previousFocus), 0);
  }
  function renderAttachments() {
    attachmentList?.remove();
    if (!attachments.length) return;
    attachmentList = h(
      'ul',
      { className: 'mt-2 max-h-24 space-y-1.5 overflow-auto' },
      attachments.map((ref) =>
        h(
          'li',
          {
            className:
              'flex items-center justify-between gap-2 rounded-[4px] border border-[#cfd6d8] bg-[#f8f9f9] px-3 py-2 text-[11px]'
          },
          h(
            'div',
            { className: 'min-w-0' },
            h('div', { className: 'truncate' }, ref.name),
            h(
              'div',
              { className: 'mt-0.5 text-[9px] text-[#6f7c82]' },
              Math.ceil(ref.size / 1024),
              ' KB'
            )
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'icon-button h-7 w-7',
              'aria-label': 'Remove ' + ref.name,
              onClick: () => {
                if (saving) return;
                pending.delete(ref.id);
                attachments = attachments.filter((item) => item.id !== ref.id);
                renderAttachments();
              }
            },
            icon('trash-2', 12)
          )
        )
      )
    );
    attachmentSection.append(attachmentList);
  }
  const upload = h('input', {
    type: 'file',
    multiple: true,
    className: 'hidden',
    onChange: () => {
      if (saving || !choosing || !alive) return;
      choosing = false;
      if (!upload.files?.length) return;
      setBusy(true);
      try {
        const refs = [...upload.files].map((file) => ({ file, ref: makeAttachmentRef(file) }));
        for (const { file, ref } of refs) pending.set(ref.id, file);
        attachments.push(...refs.map((item) => item.ref));
        renderAttachments();
      } catch (error) {
        fail(error instanceof Error ? error.message : '无法添加该附件。');
      } finally {
        upload.value = '';
        setBusy(false);
      }
    }
  });
  sources = sourceActions({
    attach: () => {
      if (!saving) {
        choosing = true;
        upload.click();
      }
    },
    readDraft: () => ({
      title: title.value,
      content: content.value,
      attachments,
      pendingFiles: new Map(pending)
    }),
    apply: (draft) => {
      if (saving) return;
      for (const item of draft.files) if (item.file) pending.set(item.ref.id, item.file);
      title.value = draft.title;
      title.setAttribute('value', draft.title);
      content.value = draft.content;
      content.textContent = draft.content;
      attachments.push(...draft.files.map((item) => item.ref));
      errorNode?.remove();
      renderAttachments();
    },
    setBusy,
    valid: () => alive
  });
  const attachmentSection = h('div', {}, upload, sources);
  body.append(
    h('div', {}, h('label', { 'for': 'prompt-title', className: 'field-label' }, '名称'), title),
    h(
      'div',
      {},
      h('label', { 'for': 'prompt-content', className: 'field-label' }, '提示词'),
      content
    ),
    attachmentSection
  );
  title.addEventListener('input', () => title.setAttribute('value', title.value));
  content.addEventListener('input', () => {
    content.textContent = content.value;
  });
  async function save() {
    if (saving) return;
    const name = title.value.trim(),
      text = content.value;
    if (!name) {
      fail('请填写名称。');
      title.focus();
      return;
    }
    if (name.length < 3) {
      fail('名称至少需要 3 个字符。');
      title.focus();
      return;
    }
    if (!text.trim() && !attachments.length) {
      fail('请添加文字或附件。');
      content.focus();
      return;
    }
    saving = true;
    setBusy(true);
    errorNode?.remove();
    try {
      const now = Date.now();
      const prompt = editing
        ? { ...initialPrompt, title: name, content: text, attachments, updatedAt: now }
        : {
            id: `p_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            title: name,
            content: text,
            attachments,
            usageCount: 0,
            createdAt: now,
            updatedAt: now
          };
      if (editing)
        await updatePrompt(
          initialPrompt.id,
          { title: name, content: text, attachments },
          new Map(pending)
        );
      else await savePrompt(prompt, new Map(pending));
      if (!alive) return;
      pending.clear();
      onSaved?.(prompt);
      saving = false;
      close();
    } catch (error) {
      if (alive) fail(error instanceof Error ? error.message : '保存提示词失败。');
    } finally {
      if (alive) {
        saving = false;
        setBusy(false);
      }
    }
  }
  const dialog = h(
    'div',
    {
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': 'prompt-editor-title',
      className: 'dialog-surface outline-none'
    },
    fieldset
  );
  const backdrop = h(
    'div',
    {
      className: 'dialog-backdrop',
      'aria-hidden': false,
      onMousedown: (event) => {
        if (event.target === backdrop) close();
      }
    },
    dialog
  );
  cancelButton = h(
    'button',
    { className: 'secondary-button min-h-10', onClick: () => close() },
    '取消'
  );
  saveButton = h(
    'button',
    {
      className: 'primary-button min-h-10',
      onClick: save,
      title: shortcutTitle
        ? `${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + Shift + Enter`
        : undefined
    },
    '保存'
  );
  fieldset.append(
    h(
      'div',
      { className: 'dialog-header' },
      h(
        'div',
        { id: 'prompt-editor-title', className: 'dialog-title' },
        editing ? '编辑提示词' : '新建提示词'
      ),
      iconButton('关闭', 'icon-button', icon('x', 16), () => close())
    ),
    body,
    h(
      'div',
      { className: 'flex items-center justify-end gap-2 border-t border-[#d9dfe1] p-4' },
      cancelButton,
      saveButton
    )
  );
  function keydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(false);
    }
    if (
      ['Enter', 'NumpadEnter'].includes(event.key) &&
      event.shiftKey &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!saving) Promise.resolve().then(save);
    }
    if (event.key === 'Tab') trapFocus(event, dialog);
  }
  window.addEventListener('keydown', keydown, true);
  parent.append(backdrop);
  renderAttachments();
  setTimeout(() => title.focus(), 0);
  return { close };
}
