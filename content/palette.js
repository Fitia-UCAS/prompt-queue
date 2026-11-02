import { paletteCss } from './site-styles.js';

const visibleRows = 6;
export function createPalette(callbacks) {
  const host = document.createElement('div');
  host.setAttribute('data-promptchain-shortcut-suggestions', 'true');
  const shadow = host.attachShadow({ mode: 'closed' }),
    style = document.createElement('style');
  style.textContent = paletteCss;
  const panel = document.createElement('div');
  panel.className = 'pc-shortcut-suggestions';
  panel.style.display = 'none';
  const header = document.createElement('div');
  header.className = 'pc-header';
  const create = document.createElement('button');
  create.className = 'pc-create';
  create.type = 'button';
  create.setAttribute('aria-label', '新建提示词');
  create.dataset.action = 'create';
  create.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/>
    </svg>
    <span>新建提示词</span>
  `;
  create.addEventListener('click', (event) => {
    if (event.isTrusted) callbacks.onCreate();
  });
  const list = document.createElement('ul');
  list.className = 'pc-list';
  panel.appendChild(header);
  panel.appendChild(create);
  panel.appendChild(list);
  shadow.appendChild(style);
  shadow.appendChild(panel);
  document.documentElement.appendChild(host);
  let items = [],
    selected = 0;
  function sizeList() {
    list.style.maxHeight = '';
    list.style.overflowY = items.length > visibleRows ? 'auto' : 'hidden';
    if (items.length <= visibleRows) return;
    const rows = [...list.querySelectorAll('li')];
    if (!rows.length) return;
    const count = Math.min(visibleRows, rows.length),
      computed = getComputedStyle(list);
    const gap = parseFloat(computed.rowGap || computed.gap || '0');
    let height = parseFloat(computed.paddingTop || '0') + parseFloat(computed.paddingBottom || '0');
    for (let index = 0; index < count; index++) {
      height += rows[index].getBoundingClientRect().height;
      if (index < count - 1) height += gap;
    }
    list.style.maxHeight = `${Math.ceil(height)}px`;
  }
  function render() {
    list.innerHTML = '';
    if (!items.length) {
      const row = document.createElement('li');
      row.className = 'pc-empty';
      row.textContent = '没有匹配项';
      list.appendChild(row);
      sizeList();
      return;
    }
    items.forEach((item, index) => {
      const row = document.createElement('li');
      row.className = `pc-item${index === selected ? ' active' : ''}`;
      row.dataset.index = String(index);
      const body = document.createElement('div'),
        title = document.createElement('div');
      title.className = 'pc-title';
      title.textContent = item.title || '未命名';
      body.appendChild(title);
      const choose = () => {
        selected = index;
        callbacks.onSelect(item);
      };
      row.addEventListener('mousedown', (event) => {
        if (
          event.isTrusted &&
          event.button === 0 &&
          !event.target?.closest('button[data-action="edit"]')
        )
          choose();
      });
      row.addEventListener('click', (event) => {
        if (event.isTrusted) choose();
      });
      row.appendChild(body);
      if (item.kind === 'prompt') {
        const edit = document.createElement('button');
        edit.className = 'pc-edit';
        edit.setAttribute('aria-label', '编辑');
        edit.dataset.action = 'edit';
        edit.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58zM20.71 6.04a1.003 1.003 0 0 0 0-1.42l-1.34-1.34a1.003 1.003 0 0 0-1.42 0l-1.02 1.02 2.75 2.75 1.03-1.01z"/>
          </svg>
          <span class="pc-tooltip">编辑</span>
        `;
        edit.addEventListener('click', (event) => {
          if (event.isTrusted) {
            event.stopPropagation();
            selected = index;
            callbacks.onEdit(item);
          }
        });
        edit.addEventListener('mousedown', (event) => {
          if (event.isTrusted) event.stopPropagation();
        });
        row.appendChild(edit);
      }
      list.appendChild(row);
    });
    sizeList();
    if (items.length > visibleRows)
      list.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
  }
  function show(anchor, nextItems, label) {
    items = nextItems;
    selected = Math.min(selected, Math.max(0, items.length - 1));
    header.textContent = label;
    header.style.display = label ? 'block' : 'none';
    panel.style.display = 'block';
    panel.style.visibility = 'hidden';
    list.scrollTop = 0;
    render();
    panel.style.left = `${Math.max(8, anchor.x)}px`;
    panel.style.top = '0px';
    const above = anchor.top - panel.getBoundingClientRect().height - 8;
    panel.style.top = `${Math.max(8, above >= 8 ? above : anchor.bottom + 8)}px`;
    panel.style.visibility = 'visible';
  }
  function hide() {
    panel.style.display = 'none';
    items = [];
    selected = 0;
    callbacks.onClose();
  }
  return {
    show,
    hide,
    isOpen: () => panel.style.display !== 'none',
    isEventInside(event) {
      const path = event.composedPath ? event.composedPath() : [];
      return path.length ? path.includes(host) : !!event.target && host.contains(event.target);
    },
    isNodeInside(node) {
      return (
        !!node &&
        (node === host ||
          host.contains(node) ||
          shadow.contains(node) ||
          (node.getRootNode ? node.getRootNode() : null) === shadow)
      );
    },
    moveSelection(delta) {
      if (items.length) {
        selected = Math.max(0, Math.min(items.length - 1, selected + delta));
        render();
      }
    },
    selectCurrent() {
      const item = items[selected];
      if (item) callbacks.onSelect(item);
    },
    getSelected: () => items[selected]
  };
}
