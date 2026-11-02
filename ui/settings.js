import { h, nativeIcon } from './dom.js';
import { getSettings } from '../shared/library.js';

export function settingsView({ back, exportLibrary }) {
  const control = (label, glyph, callback, disabled = false) =>
    h(
      'button',
      {
        type: 'button',
        className: 'icon-button pc-control',
        'aria-label': label,
        onClick: callback,
        disabled
      },
      nativeIcon(glyph)
    );
  const row = (label, glyph, callback, aria = label) =>
    h('div', { className: 'pc-setting-row' }, h('span', {}, label), control(aria, glyph, callback));
  const section = (label, ...children) =>
    h('section', { className: 'settings-panel', 'aria-label': label }, children);
  let alive = true,
    notice,
    note;
  const diagnostics = section(
    '诊断',
    row('导出网页 DOM', 'dom', async () => {
      const show = (text) => {
        note?.remove();
        note = h('p', { className: 'pc-setting-note' }, text);
        diagnostics.append(note);
      };
      note?.remove();
      try {
        const response = await chrome.runtime.sendMessage({ type: 'PF_EXPORT_DOM' });
        if (!response?.ok) throw new Error(response?.error || '导出失败');
      } catch (error) {
        if (alive) show(error.message || '导出失败');
      }
    })
  );
  const exporting = row(
    '导出提示词库',
    'export',
    (event) => exportLibrary(event.currentTarget),
    '导出'
  );
  const fieldset = h(
    'fieldset',
    { disabled: true, className: 'contents' },
    h(
      'main',
      { className: 'popup-scroll pc-settings-list' },
      section('导出', exporting),
      diagnostics,
      section(
        '记录',
        row('执行记录', 'logs', () => {
          location.href = chrome.runtime.getURL('workflow.html?monitor=1');
        })
      ),
      section(
        '回收站',
        row('最近删除', 'trash', () => {
          location.href = chrome.runtime.getURL('workflow.html?trash=1');
        })
      )
    )
  );
  const shell = h(
    'div',
    { className: 'popup-shell pc-settings' },
    h(
      'header',
      { className: 'popup-header pc-settings-header' },
      control('返回', 'back', back),
      h('div', { className: 'popup-title' }, '设置')
    ),
    fieldset
  );
  async function load() {
    notice?.remove();
    try {
      await getSettings();
      if (alive) fieldset.disabled = false;
    } catch {
      if (!alive) return;
      notice = h(
        'div',
        { className: 'pc-settings-notice is-error', role: 'alert' },
        h('span', {}, '无法读取设置。'),
        control('重试', 'restore', load),
        control('关闭提示', 'close', () => notice.remove())
      );
      shell.insertBefore(notice, fieldset);
    }
  }
  load();
  return {
    element: shell,
    dispose: () => {
      alive = false;
    }
  };
}
