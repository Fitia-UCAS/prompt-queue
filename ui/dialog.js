import { h } from './dom.js';

let nextId = 0;
export function confirmDelete(parent, { title, description, onConfirm, onError }) {
  const previous = document.activeElement,
    titleId = '_pq_' + nextId++,
    descriptionId = '_pq_' + nextId++;
  let busy = false;
  function close() {
    if (busy) return;
    overlay.remove();
    document.removeEventListener('keydown', keydown);
    if (previous?.isConnected) previous.focus();
  }
  const cancel = h(
    'button',
    { type: 'button', className: 'secondary-button min-h-10', onClick: close },
    '取消'
  );
  const confirm = h(
    'button',
    {
      type: 'button',
      className:
        'inline-flex min-h-10 items-center justify-center rounded-[4px] bg-rose-700 px-4 text-xs font-[650] text-white transition hover:bg-rose-600',
      onClick: async () => {
        if (busy) return;
        busy = true;
        cancel.disabled = true;
        confirm.disabled = true;
        confirm.textContent = '正在删除…';
        dialog.setAttribute('aria-busy', 'true');
        try {
          await onConfirm();
          busy = false;
          close();
        } catch (error) {
          onError(error);
        } finally {
          busy = false;
          cancel.disabled = false;
          confirm.disabled = false;
          confirm.textContent = '删除';
          dialog.setAttribute('aria-busy', 'false');
        }
      }
    },
    '删除'
  );
  const dialog = h(
    'div',
    {
      role: 'alertdialog',
      'aria-modal': true,
      'aria-labelledby': titleId,
      'aria-describedby': descriptionId,
      'aria-busy': false,
      className:
        'relative z-[101] w-[340px] rounded-[6px] border border-[#bcc7ca] bg-white p-5 text-[#1c272c] shadow-[0_16px_40px_rgba(28,39,44,0.18)]'
    },
    h('div', { id: titleId, className: 'dialog-title' }, title),
    h(
      'div',
      { id: descriptionId, className: 'mt-2 text-xs leading-5 text-[#6f7c82]' },
      description
    ),
    h('div', { className: 'mt-4 flex items-center justify-end gap-2' }, cancel, confirm)
  );
  const overlay = h(
    'div',
    { className: 'fixed left-0 top-0 z-[100] flex h-[600px] w-popup items-center justify-center' },
    h('div', {
      className: 'absolute inset-0 bg-[#1c272c]/[0.28] backdrop-blur-[2px]',
      onClick: close
    }),
    dialog
  );
  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key !== 'Tab') return;
    const nodes = [...dialog.querySelectorAll('button')].filter((node) => !node.disabled),
      first = nodes[0],
      last = nodes[nodes.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    }
    if (
      !event.shiftKey &&
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
  parent.append(overlay);
  document.addEventListener('keydown', keydown);
  cancel.focus();
}
