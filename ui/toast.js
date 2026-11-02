import { h } from './dom.js';

export const toastContainer = h('div', {
  className: 'fixed bottom-3 left-[200px] z-[9999] w-[376px] -translate-x-1/2 space-y-2'
});
export function showToast({ title, message, variant = 'info', durationMs = 2400 }) {
  let timer;
  const close = () => {
    clearTimeout(timer);
    element.remove();
  };
  const element = h(
    'div',
    {
      role: 'status',
      className: `flex items-start gap-2 rounded-[4px] border px-3 py-2.5 text-xs shadow-lg
              ${variant === 'success' ? 'border-[#b5c9be] bg-[#eef4f0] text-[#3f6954]' : ''}
              ${variant === 'error' ? 'border-rose-300 bg-rose-50 text-rose-700' : ''}
              ${variant === 'info' ? 'border-[#cfd6d8] bg-white text-[#1c272c]' : ''}
            `
    },
    h(
      'div',
      { className: 'flex-1' },
      title ? h('div', { className: 'font-medium mb-0.5' }, title) : null,
      h('div', {}, message)
    ),
    h(
      'button',
      { className: 'text-[#6f7c82] hover:text-[#1c272c]', 'aria-label': '关闭', onClick: close },
      '×'
    )
  );
  toastContainer.append(element);
  timer = setTimeout(close, Math.max(1200, durationMs));
}
