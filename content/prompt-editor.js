import { editorCss } from './site-styles.js';

const trash = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M9 3h6l1.5 2H20v2H4V5h3.5L9 3zm-2 6h2v10H7V9zm4 0h2v10h-2V9zm4 0h2v10h-2V9z"/>
</svg>
`;
export function createPromptEditor(callbacks) {
  const host = document.createElement('div');
  host.setAttribute('data-promptchain-prompt-editor', 'true');
  const shadow = host.attachShadow({ mode: 'closed' }),
    sheet = new CSSStyleSheet();
  sheet.replaceSync(editorCss);
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'prompt-editor-title');
  const header = document.createElement('div');
  header.className = 'header';
  const heading = document.createElement('div');
  heading.className = 'title';
  heading.id = 'prompt-editor-title';
  heading.textContent = '编辑提示词';
  const closeButton = document.createElement('button');
  closeButton.className = 'close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '关闭');
  closeButton.innerHTML = '&times;';
  header.append(heading, closeButton);
  const body = document.createElement('div');
  body.className = 'body';
  const name = document.createElement('input');
  name.className = 'input';
  name.id = 'shortcut-name';
  name.placeholder = '提示词名称';
  name.setAttribute('aria-label', '提示词名称');
  const content = document.createElement('textarea');
  content.className = 'textarea';
  content.id = 'shortcut-instructions';
  content.placeholder = '提示词';
  content.setAttribute('aria-label', '提示词');
  const error = document.createElement('div');
  error.className = 'error';
  error.setAttribute('role', 'alert');
  body.append(name, content, error);
  const footer = document.createElement('div');
  footer.className = 'footer';
  const remove = document.createElement('button');
  remove.className = 'delete';
  remove.type = 'button';
  remove.setAttribute('aria-label', '删除提示词');
  remove.innerHTML = trash;
  const cancel = document.createElement('button');
  cancel.className = 'btn btn-secondary';
  cancel.textContent = '取消';
  const save = document.createElement('button');
  save.className = 'btn btn-primary';
  save.textContent = '保存';
  save.title = navigator.userAgent.toLowerCase().includes('mac') ? '⌘ + Enter' : 'Ctrl + Enter';
  footer.append(remove, cancel, save);
  dialog.append(header, body, footer);
  backdrop.append(dialog);
  shadow.append(backdrop);
  shadow.adoptedStyleSheets = [sheet];
  document.documentElement.append(host);
  let id,
    attached = false,
    opened = false,
    busy = false,
    previous = null;
  function setBusy(value) {
    busy = value;
    save.disabled =
      cancel.disabled =
      remove.disabled =
      closeButton.disabled =
      name.disabled =
      content.disabled =
        value;
    dialog.setAttribute('aria-busy', String(value));
  }
  function open(prompt) {
    previous = document.activeElement;
    id = prompt.id;
    attached = (prompt.attachmentCount ?? 0) > 0;
    heading.textContent = id ? '编辑提示词' : '新建提示词';
    name.value = prompt.title || '';
    content.value = prompt.content || '';
    error.textContent = '';
    remove.style.display = id ? 'inline-flex' : 'none';
    backdrop.style.display = 'flex';
    opened = true;
    setTimeout(() => name.focus(), 0);
  }
  function close() {
    if (!busy) {
      backdrop.style.display = 'none';
      opened = false;
      callbacks.onClose?.();
      if (previous) setTimeout(() => previous?.focus(), 0);
    }
  }
  async function savePrompt() {
    if (busy) return;
    const title = name.value.trim(),
      text = content.value;
    if (!title) {
      error.textContent = '请填写名称。';
      name.focus();
      return;
    }
    if (!text.trim() && !attached) {
      error.textContent = '请填写提示词内容。';
      content.focus();
      return;
    }
    error.textContent = '';
    setBusy(true);
    try {
      if (await callbacks.onSave({ id, title, content: text })) {
        setBusy(false);
        close();
      } else error.textContent = '保存失败。';
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : '保存失败。';
    } finally {
      setBusy(false);
    }
  }
  async function deletePrompt() {
    if (busy || !id) return;
    setBusy(true);
    try {
      if (await callbacks.onDelete(id)) {
        setBusy(false);
        close();
      } else error.textContent = '删除失败。';
    } catch (reason) {
      error.textContent = reason instanceof Error ? reason.message : '删除失败。';
    } finally {
      setBusy(false);
    }
  }
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted || !opened) return;
      if (event.key === 'Tab') {
        const focusable = [
          ...dialog.querySelectorAll(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'
          )
        ].filter((node) => node.getClientRects().length > 0);
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && (shadow.activeElement === first || !shadow.activeElement)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (shadow.activeElement === last || !shadow.activeElement)) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        savePrompt();
      }
    },
    true
  );
  closeButton.addEventListener('click', (event) => {
    if (event.isTrusted) close();
  });
  cancel.addEventListener('click', (event) => {
    if (event.isTrusted) close();
  });
  save.addEventListener('click', (event) => {
    if (event.isTrusted) savePrompt();
  });
  remove.addEventListener('click', (event) => {
    if (event.isTrusted) deletePrompt();
  });
  backdrop.addEventListener('mousedown', (event) => {
    if (event.isTrusted && event.target === backdrop) close();
  });
  return { open, close, isOpen: () => opened };
}
