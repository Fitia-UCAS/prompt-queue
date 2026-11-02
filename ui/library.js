import { h, iconButton, nativeIcon, restoreFocus } from './dom.js';
import { icon, exportIcon } from './icons.js';
import { visiblePrompts } from './state.js';
import {
  panelState,
  action,
  repairConnection,
  exportDom,
  runFlow,
  stopFlow,
  editFlow
} from './controller.js';

export function promptCard(prompt, index, ready, handlers) {
  const name = prompt.title || '提示词';
  return h(
    'article',
    { className: 'prompt-card', 'data-enabled': ready, 'data-prompt-id': prompt.id },
    h(
      'div',
      { className: 'flex items-start gap-3' },
      h(
        'button',
        {
          type: 'button',
          className: 'min-w-0 flex-1 text-left',
          disabled: !ready,
          'aria-label': '插入 ' + name,
          onClick: () => handlers.insert(prompt)
        },
        h('div', { className: 'prompt-index' }, String(index + 1).padStart(2, '0')),
        h('div', { className: 'prompt-title break-words' }, prompt.title || '未命名'),
        h('div', { className: 'prompt-copy' }, prompt.content)
      ),
      h(
        'div',
        { className: 'flex items-center gap-1' },
        iconButton('编辑 ' + name, 'card-action', icon('pencil', 13), () => handlers.edit(prompt)),
        iconButton('删除 ' + name, 'card-action', icon('trash-2', 13), () =>
          handlers.deletePrompt(prompt)
        )
      )
    ),
    h(
      'div',
      { className: 'mt-4 flex items-center justify-between border-t border-[#d9dfe1] pt-3' },
      h(
        'div',
        { className: 'prompt-meta' },
        h('span', {}, prompt.usageCount ?? 0, ' 次使用'),
        prompt.attachments?.length
          ? [
              h('span', { 'aria-hidden': true }, '•'),
              h('span', {}, prompt.attachments.length, ' 个附件')
            ]
          : null
      ),
      h(
        'button',
        {
          className: 'card-action',
          'data-primary': 'true',
          'aria-label': '发送 ' + name,
          disabled: !ready,
          onClick: () => ready && handlers.send(prompt)
        },
        icon('发送', 13)
      )
    )
  );
}

export function chainCard(chain, index, handlers) {
  const { ready, run } = panelState();
  const active = run && PromptFlowModel.ACTIVE.has(run.status),
    current = active && run.flow.id === chain.id;
  const start = h(
    'button',
    {
      className: 'compact-button',
      'aria-label':
        (current ? (run.status === 'paused' ? '恢复流程 ' : '查看执行记录 ') : '运行流程 ') +
        chain.title,
      disabled: active ? !current : !ready || !chain.steps.length,
      onClick: action(() => runFlow(chain.id))
    },
    h(
      'svg',
      { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true },
      h('path', { d: PromptChainIcons.play, fill: 'currentColor' })
    )
  );
  const stop = h(
    'button',
    {
      className: 'compact-button pc-icon',
      'data-pc-pause': chain.id,
      'aria-label': '停止流程 ' + chain.title,
      disabled: !current,
      'data-glyph': 'stop',
      onClick: action(stopFlow)
    },
    nativeIcon('stop')
  );
  return h(
    'li',
    { className: 'chain-card', 'data-chain-id': chain.id },
    h('div', { className: 'chain-number' }, String(index + 1).padStart(2, '0')),
    h(
      'div',
      { className: 'min-w-0' },
      h('div', { className: 'truncate text-xs font-semibold text-[#1c272c]' }, chain.title)
    ),
    h(
      'div',
      { className: 'ml-auto flex items-center gap-1.5' },
      start,
      stop,
      iconButton(
        '编辑流程 ' + chain.title,
        'compact-button',
        icon('pencil', 14),
        action(() => editFlow(chain.id))
      ),
      iconButton('删除流程 ' + chain.title, 'compact-button', icon('trash-2', 14), () =>
        handlers.deleteChain(chain)
      )
    )
  );
}

export function libraryView(state, handlers) {
  let debounce;
  const input = h('input', {
    className: 'search-input h-10 w-full rounded-[4px] py-2 pl-9 pr-9 text-xs',
    placeholder: '搜索',
    'aria-label': '搜索提示词',
    value: state.query
  });
  const searchBox = h(
    'div',
    { className: 'relative min-w-0 flex-1' },
    icon('搜索', 14, 'pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6f7c82]'),
    input
  );
  let clear;
  function updateClear() {
    clear?.remove();
    if (!input.value) return;
    clear = iconButton('清除搜索', 'pc-clear-search', icon('x', 14), () => {
      clearTimeout(debounce);
      input.value = '';
      input.setAttribute('value', '');
      state.query = '';
      updateClear();
      renderContent();
      input.focus();
    });
    searchBox.append(clear);
  }
  input.addEventListener('input', () => {
    input.setAttribute('value', input.value);
    updateClear();
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.query = input.value;
      renderContent();
    }, 300);
  });
  const sort = h(
    'select',
    {
      className: 'select-input h-10 w-[112px] rounded-[4px] px-2.5 text-[10px] font-semibold',
      'aria-label': '排序',
      onChange: () => {
        state.sort = sort.value;
        renderContent();
      }
    },
    h('option', { value: 'recent' }, '最近使用'),
    h('option', { value: 'alpha' }, 'A–Z'),
    h('option', { value: 'mostUsed' }, '使用最多')
  );
  sort.value = state.sort;
  const status = h(
    'div',
    {
      className: 'platform-status',
      'data-ready': false,
      'data-pc-ready': false,
      role: 'img',
      'aria-label': '未连接对话'
    },
    h('span', { className: 'status-dot ', 'aria-hidden': true }),
    h('span')
  );
  const refresh = h(
    'button',
    {
      id: 'pc-refresh',
      className: 'icon-button pc-icon',
      'aria-label': '刷新连接',
      onClick: action(async () => {
        refresh.disabled = true;
        try {
          await repairConnection();
        } finally {
          refresh.disabled = false;
        }
      })
    },
    nativeIcon('refresh')
  );
  const gear = iconButton('设置', 'icon-button', icon('设置', 15), handlers.settings);
  gear.dataset.pcDom = '1';
  const header = h(
    'header',
    { className: 'popup-header' },
    h(
      'div',
      { className: 'flex items-center gap-3' },
      h(
        'div',
        { className: 'logo-frame' },
        h('img', {
          src: chrome.runtime.getURL('icons/logo.svg'),
          width: 22,
          height: 22,
          alt: 'PromptQueue'
        })
      ),
      h('div', { className: 'popup-title mt-0' }, 'PromptQueue'),
      h(
        'div',
        { className: 'ml-auto flex items-center gap-2' },
        status,
        refresh,
        h(
          'button',
          {
            id: 'pc-export-dom',
            className: 'icon-button pc-icon',
            'aria-label': '导出页面 DOM',
            onClick: action(exportDom)
          },
          nativeIcon('dom')
        ),
        gear
      )
    ),
    h(
      'div',
      { className: 'mt-4' },
      h('div', { className: 'flex items-center gap-2' }, searchBox, sort)
    )
  );
  const main = h('main', { className: 'popup-scroll' }),
    footer = h('footer', { className: 'popup-footer' });
  const shell = h('div', { className: 'popup-shell' }, header, main, footer);
  let loadingOverlay;
  function renderContent() {
    const previousFocus = main.contains(document.activeElement) ? document.activeElement : null;
    const visible = visiblePrompts(state.prompts, state.query, state.sort);
    const children = [];
    if (!state.loading && state.prompts.length)
      children.push(
        h(
          'div',
          { className: 'section-label' },
          h('span', {}, '提示词'),
          h('span', { className: 'section-count' }, visible.length, ' / ', state.prompts.length)
        )
      );
    if (!state.loading && !state.prompts.length)
      children.push(
        h(
          'div',
          { className: 'empty-panel' },
          h(
            'div',
            {},
            h('div', { className: 'text-base font-semibold' }, '还没有提示词'),
            h(
              'button',
              { className: 'primary-button mt-4', onClick: () => handlers.edit() },
              icon('plus', 16),
              ' 新建提示词'
            )
          )
        )
      );
    else if (!state.loading && !visible.length)
      children.push(
        h(
          'div',
          { className: 'empty-panel' },
          h('div', { className: 'text-base font-semibold' }, '没有匹配项')
        )
      );
    else
      children.push(
        h(
          'div',
          { className: 'grid grid-cols-1 gap-3' },
          visible.map((prompt, index) => promptCard(prompt, index, state.ready, handlers))
        )
      );
    if (!state.loading)
      children.push(
        h(
          'section',
          { className: 'mt-6' },
          h(
            'div',
            { className: 'section-label' },
            h('span', {}, '提示词序列'),
            h('span', { className: 'section-count' }, state.chains.length)
          ),
          state.chains.length
            ? h(
                'ul',
                { className: 'space-y-2' },
                state.chains.map((chain, index) => chainCard(chain, index, handlers))
              )
            : h(
                'div',
                {
                  className:
                    'rounded-[4px] border border-dashed border-[#bdc7ca] px-3 py-4 text-xs text-[#6f7c82]'
                },
                '还没有流程'
              )
        )
      );
    main.replaceChildren(...children);
    if (!footer.childNodes.length)
      footer.replaceChildren(
        h(
          'div',
          { className: 'mb-2.5 flex items-center gap-3 text-[10px] text-[#6f7c82]' },
          h(
            'span',
            {},
            h('strong', { className: 'text-[#1c272c]' }, state.stats.totalPrompts),
            ' 条提示词'
          ),
          h(
            'span',
            {},
            h('strong', { className: 'text-[#1c272c]' }, state.stats.totalUses),
            ' 次使用'
          ),
          h(
            'button',
            {
              className: 'text-button ml-auto inline-flex items-center gap-1.5',
              onClick: (event) => handlers.export(event.currentTarget)
            },
            exportIcon(),
            '导出'
          )
        ),
        h(
          'div',
          { className: 'grid grid-cols-2 gap-2' },
          h(
            'button',
            {
              className: 'secondary-button',
              onClick: () => {
                location.href = chrome.runtime.getURL('workflow.html?new=1');
              }
            },
            icon('流程', 15),
            ' 新建流程'
          ),
          h(
            'button',
            { className: 'primary-button', onClick: () => handlers.edit() },
            icon('plus', 15),
            ' 新建提示词'
          )
        )
      );
    const counts = footer.querySelectorAll('strong');
    counts[0].textContent = state.stats.totalPrompts;
    counts[1].textContent = state.stats.totalUses;
    loadingOverlay?.remove();
    if (state.loading) {
      loadingOverlay = h(
        'div',
        {
          className:
            'absolute inset-0 z-50 flex items-center justify-center bg-[#f2f4f3]/90 backdrop-blur-sm'
        },
        h('div', { className: 'loading-orbit', 'aria-label': '正在加载' })
      );
      shell.insertBefore(loadingOverlay, footer);
    }
    handlers.rendered();
    if (previousFocus && document.activeElement === document.body) restoreFocus(previousFocus);
  }
  function updateConnection() {
    const current = panelState();
    status.dataset.ready = String(state.ready);
    status.dataset.pcReady = String(current.ready);
    status.setAttribute('aria-label', current.ready ? '已连接对话' : '未连接对话');
    status.lastChild.textContent = state.ready
      ? { chatgpt: 'ChatGPT', gemini: 'Gemini', deepseek: 'DeepSeek' }[state.platform] || '未连接'
      : '未打开对话';
  }
  updateClear();
  renderContent();
  updateConnection();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  return {
    element: shell,
    renderContent,
    updateConnection,
    focusSearch: () => {
      input.focus();
      input.select();
    },
    dispose: () => clearTimeout(debounce)
  };
}
