import { h } from './dom.js';
import { icon } from './icons.js';
import { openEditor } from './editor.js';
import { toastContainer, showToast } from './toast.js';
import { importPromptList } from '../shared/library.js';
import { eligiblePath, supportingPaths, parsePromptFile } from './import-files.js';

const state = {
  items: [],
  selected: new Set(),
  skipped: { support: 0, unsupported: 0, empty: 0 },
  reading: false,
  importing: false,
  result: null,
  savedTitle: null
};
const mac = navigator.platform.includes('Mac');
const folderInput = h('input', {
  type: 'file',
  multiple: true,
  className: 'hidden',
  onChange: () => readFiles(folderInput.files)
});
folderInput.setAttribute('webkitdirectory', '');
const fileInput = h('input', {
  type: 'file',
  multiple: true,
  accept: '.md,.markdown,.txt',
  className: 'hidden',
  onChange: () => readFiles(fileInput.files)
});
const page = h('div', { className: 'onboarding-page' }, folderInput, fileInput);
let editor, review, result, writingCard, choices;

async function readFiles(files) {
  if (!files?.length) return;
  state.reading = true;
  state.result = null;
  renderBusy();
  renderResult();
  const picked = [...files],
    supporting = supportingPaths(picked.map((file) => file.webkitRelativePath || file.name)),
    items = [];
  let unsupported = 0,
    empty = 0;
  try {
    for (const file of picked) {
      const path = file.webkitRelativePath || file.name;
      if (supporting.has(path)) continue;
      if (!eligiblePath(path) || file.size > 1024 * 1024) {
        unsupported++;
        continue;
      }
      const item = parsePromptFile(path, await file.text());
      if (!item) {
        empty++;
        continue;
      }
      items.push(item);
    }
  } catch (error) {
    showToast({
      variant: 'error',
      message: error instanceof Error ? error.message : '无法读取文件'
    });
  } finally {
    folderInput.value = '';
    fileInput.value = '';
    state.reading = false;
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  state.items = items;
  state.selected = new Set(items.filter((item) => item.suggested).map((item) => item.path));
  state.skipped = { support: supporting.size, unsupported, empty };
  renderBusy();
  renderReview();
  if (!items.length) showToast({ variant: 'info', message: '没有找到 Markdown 或文本文件' });
}

async function importSelected() {
  const items = state.items.filter((item) => state.selected.has(item.path));
  if (!items.length || state.importing) return;
  state.importing = true;
  renderBusy();
  try {
    state.result = await importPromptList(items);
    state.items = [];
    state.selected = new Set();
    chrome.runtime.sendMessage({ type: 'PROMPTS_IMPORTED' }).catch(() => {});
  } catch (error) {
    showToast({ variant: 'error', message: error instanceof Error ? error.message : '导入失败' });
  } finally {
    state.importing = false;
    renderBusy();
    renderReview();
    renderResult();
  }
}

const folderButton = h(
  'button',
  { className: 'primary-button', onClick: () => folderInput.click() },
  icon('folder-open', 15),
  ' ',
  '选择文件夹'
);
const filesButton = h(
  'button',
  { className: 'secondary-button', onClick: () => fileInput.click() },
  icon('file-text', 15),
  ' 选择文件'
);
function renderBusy() {
  folderButton.disabled = filesButton.disabled = state.reading || state.importing;
  folderButton.lastChild.textContent = state.reading ? '正在读取…' : '选择文件夹';
  if (!review) return;
  const buttons = review.querySelectorAll('.review-footer button');
  buttons[0].disabled = state.selected.size === 0 || state.importing;
  buttons[0].textContent = state.importing ? '正在导入…' : `导入 ${state.selected.size} 条提示词`;
  buttons[1].disabled = state.importing;
}

function renderReview() {
  review?.remove();
  review = null;
  if (!state.items.length) return;
  const select = (all) => {
    state.selected = all ? new Set(state.items.map((item) => item.path)) : new Set();
    updateSelection();
  };
  review = h(
    'section',
    { className: 'onboarding-card onboarding-review' },
    h(
      'div',
      { className: 'review-header' },
      h('h2', {}, state.items.length, ' 个文件'),
      h(
        'div',
        { className: 'review-tools' },
        h('button', { className: 'compact-button', onClick: () => select(true) }, '全选'),
        h('button', { className: 'compact-button', onClick: () => select(false) }, '全不选')
      )
    ),
    h(
      'ul',
      { className: 'review-list' },
      state.items.map((item) => {
        const input = h('input', {
          type: 'checkbox',
          onChange: () => {
            if (state.selected.has(item.path)) state.selected.delete(item.path);
            else state.selected.add(item.path);
            renderBusy();
          }
        });
        input.checked = state.selected.has(item.path);
        if (input.checked) input.setAttribute('checked', '');
        return h(
          'li',
          {},
          h(
            'label',
            { className: 'review-row' },
            input,
            h(
              'div',
              { className: 'min-w-0' },
              h('div', { className: 'review-title' }, item.title),
              h('div', { className: 'review-path' }, item.path)
            ),
            h('div', { className: 'review-preview' }, item.content.slice(0, 240))
          )
        );
      })
    ),
    ignoredNotice(),
    h(
      'div',
      { className: 'review-footer' },
      h(
        'button',
        { className: 'primary-button', onClick: importSelected },
        `导入 ${state.selected.size} 条提示词`
      ),
      h(
        'button',
        {
          className: 'secondary-button',
          onClick: () => {
            state.items = [];
            state.selected = new Set();
            renderReview();
          }
        },
        '取消'
      ),
      h('span', { className: 'review-hint' }, '跳过重复名称。')
    )
  );
  page.insertBefore(review, result || hints);
  renderBusy();
}

function updateSelection() {
  review?.querySelectorAll('.review-list input').forEach((input, index) => {
    input.checked = state.selected.has(state.items[index].path);
  });
  renderBusy();
}

function ignoredNotice() {
  const skipped = state.skipped;
  const labels = [
    skipped.support > 0 ? `${skipped.support} 个技能附属文件` : '',
    skipped.unsupported > 0 ? `${skipped.unsupported} 个隐藏或不支持的文件` : '',
    skipped.empty > 0 ? `${skipped.empty} 个空文件` : ''
  ].filter(Boolean);
  return labels.length
    ? h('p', { className: 'review-ignored' }, '已跳过：', labels.join(', '), '.')
    : null;
}

function renderResult() {
  result?.remove();
  result = null;
  if (!state.result) return;
  result = h(
    'section',
    { className: 'onboarding-card onboarding-review', role: 'status' },
    h('h2', {}, '已导入 ', state.result.imported, ' 条提示词'),
    state.result.skipped > 0 ? h('p', {}, state.result.skipped, ' 条重复记录已跳过。') : null
  );
  page.insertBefore(result, hints);
}

function writePrompt() {
  if (editor && page.querySelector('[role="dialog"]')) return;
  editor = openEditor(
    page,
    undefined,
    (prompt) => {
      state.savedTitle = prompt.title;
      updateSavedTitle();
    },
    { shortcutTitle: true }
  );
}
function updateSavedTitle() {
  writingCard?.querySelector('.onboarding-note')?.remove();
  if (writingCard && state.savedTitle)
    writingCard.append(
      h(
        'div',
        { className: 'onboarding-note' },
        '已保存「',
        state.savedTitle,
        '」。在聊天框输入 $ 即可插入。'
      )
    );
}

const title = h('h1', { className: 'onboarding-title' });
const lede = h(
  'p',
  { className: 'onboarding-lede' },
  '在 ChatGPT、Gemini 和 DeepSeek 中复用提示词。'
);
const importCard = h(
  'section',
  { className: 'onboarding-card' },
  h('h2', {}, '导入技能或文件'),
  h(
    'p',
    {},
    '选择技能目录，例如 ',
    h('code', {}, '~/prompts'),
    ' 或 ',
    h('code', {}, '~/.codex/skills'),
    '，或选择 Markdown 文件。每个 ',
    h('code', {}, 'SKILL.md'),
    ' 会成为一条提示词。'
  ),
  mac
    ? h(
        'p',
        {},
        '按 ',
        h('kbd', {}, '⌘'),
        ' ',
        h('kbd', {}, '⇧'),
        ' ',
        h('kbd', {}, '.'),
        ' 可在文件选择器中显示隐藏目录。'
      )
    : null,
  h('div', { className: 'onboarding-actions' }, folderButton, filesButton)
);
choices = h('div', { className: 'onboarding-choices' }, importCard);
const hints = h(
  'footer',
  { className: 'onboarding-hints' },
  h(
    'span',
    {},
    h('kbd', {}, mac ? '⌘' : 'Ctrl'),
    ' ',
    h('kbd', {}, '⇧'),
    ' ',
    h('kbd', {}, 'L'),
    ' 打开提示词库'
  ),
  h('span', {}, h('kbd', {}, '$'), ' 在聊天框中插入提示词'),
  h('span', {}, '保存在本机')
);
page.append(
  h(
    'header',
    { className: 'onboarding-header' },
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
    h('div', { className: 'popup-title mt-0' }, 'PromptQueue')
  ),
  title,
  choices,
  hints
);

function updateRoute() {
  const importing = location.hash === '#import';
  title.textContent = importing ? '导入提示词' : '设置提示词库';
  lede.remove();
  if (!importing) page.insertBefore(lede, choices);
  if (importing) {
    writingCard?.remove();
    writingCard = null;
  } else if (!writingCard) {
    writingCard = h(
      'section',
      { className: 'onboarding-card' },
      h('h2', {}, '编写提示词'),
      h(
        'div',
        { className: 'onboarding-actions' },
        h(
          'button',
          { className: 'primary-button', onClick: writePrompt },
          icon('plus', 15),
          ' 新建提示词'
        )
      )
    );
    choices.append(writingCard);
    updateSavedTitle();
  }
}
toastContainer.className = 'fixed bottom-5 left-1/2 z-[9999] w-[420px] -translate-x-1/2 space-y-2';
document.getElementById('root').replaceChildren(page, toastContainer);
updateRoute();
window.addEventListener('hashchange', updateRoute);
