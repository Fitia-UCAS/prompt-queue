const shortcutPattern = /\$([^\s]*)$/;
const invisible = /[\u200B-\u200D\u2060\uFEFF]/g;
const boundaries = new Set([' ', '\u00a0', '\n']);

export function shortcutQuery(text) {
  const match = shortcutPattern.exec(text);
  if (!match || typeof match.index !== 'number' || /^\d/.test(match[1] ?? '')) return null;
  const before = text.slice(0, match.index);
  if (
    !before.length ||
    !before.replace(invisible, '').length ||
    boundaries.has(before[before.length - 1])
  ) {
    return { query: match[1] ?? '', shortcutIndex: match.index };
  }
  return null;
}

export function readShortcut(input) {
  if (!input) return null;
  if (input instanceof HTMLTextAreaElement) {
    const end = input.selectionStart ?? 0,
      query = shortcutQuery((input.value || '').slice(0, end));
    return query
      ? {
          kind: 'textarea',
          input,
          query: query.query,
          start: query.shortcutIndex,
          end,
          rect: input.getBoundingClientRect()
        }
      : null;
  }
  if (!(input instanceof HTMLElement) || input.getAttribute('contenteditable') !== 'true')
    return null;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !input.contains(range.startContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(input);
  before.setEnd(range.endContainer, range.endOffset);
  const fragment = before.cloneContents();
  fragment.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  fragment.querySelectorAll('p, div, li').forEach((node) => node.before('\n'));
  const textBefore = fragment.textContent || '',
    query = shortcutQuery(textBefore);
  if (!query) return null;
  const after = range.cloneRange();
  after.selectNodeContents(input);
  after.setStart(range.endContainer, range.endOffset);
  return {
    kind: 'contenteditable',
    input,
    query: query.query,
    shortcutIndex: query.shortcutIndex,
    textBefore,
    textAfter: after.toString(),
    rect: range.getBoundingClientRect().width
      ? range.getBoundingClientRect()
      : input.getBoundingClientRect()
  };
}

function dispatchInput(element, type, text, inputType) {
  try {
    element.dispatchEvent(
      new InputEvent(type, {
        bubbles: true,
        ...(type === 'beforeinput' ? { cancelable: true } : {}),
        data: text,
        inputType
      })
    );
  } catch {
    if (type === 'input') element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
function writeTextarea(input, text) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}
function writeEditable(input, text) {
  input.focus();
  const type = /[\r\n\t]/.test(text) || / {2,}/.test(text) ? 'insertFromPaste' : 'insertText';
  dispatchInput(input, 'beforeinput', text, type);
  const selection = window.getSelection(),
    range = document.createRange();
  range.selectNodeContents(input);
  range.deleteContents();
  const fragment = document.createDocumentFragment();
  for (const line of text.split(/\r\n|\r|\n/)) {
    const paragraph = document.createElement('p');
    paragraph.appendChild(line ? document.createTextNode(line) : document.createElement('br'));
    fragment.appendChild(paragraph);
  }
  range.insertNode(fragment);
  const caret = document.createRange();
  caret.selectNodeContents(input);
  caret.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(caret);
  dispatchInput(input, 'input', text, type);
}
export function readComposer(input) {
  if (!input) return '';
  if (input instanceof HTMLTextAreaElement) return input.value || '';
  const children = [...input.children];
  if (
    children.length &&
    input.childNodes.length === children.length &&
    children.every((node) => node.tagName === 'P')
  ) {
    return children
      .map((node) => {
        const text = node.innerText || '';
        return node.lastChild?.nodeName === 'BR' && text.endsWith('\n') ? text.slice(0, -1) : text;
      })
      .join('\n');
  }
  return input.innerText || '';
}
export const sameText = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
export const writeComposer = (input, text) =>
  input instanceof HTMLTextAreaElement ? writeTextarea(input, text) : writeEditable(input, text);
export function appendComposer(input, text) {
  const previous = input instanceof HTMLTextAreaElement ? input.value || '' : readComposer(input);
  const next = previous ? `${previous}\n${text}` : text;
  writeComposer(input, next);
  if (input instanceof HTMLTextAreaElement) {
    try {
      input.setSelectionRange(next.length, next.length);
    } catch {}
  }
}

export function visible(element) {
  return element ? element.offsetParent !== null || element.getClientRects().length > 0 : false;
}
export const enabledComposer = (input) => (input ? visible(input) && !input.disabled : false);
export function enabledButton(button) {
  if (!button || !(button instanceof HTMLButtonElement) || button.disabled) return false;
  if (button.getAttribute('aria-disabled')?.toLowerCase() === 'true') return false;
  return visible(button);
}
export const fileInputEnabled = (input) =>
  !!input && input instanceof HTMLInputElement && input.type === 'file' && !input.disabled;
export function findFileInput(composer, selectors) {
  if (!composer) return null;
  const scope = composer.closest('form') || composer.parentElement;
  if (scope && scope !== document.body && scope !== document.documentElement) {
    const candidates = selectors.length ? [...scope.querySelectorAll(selectors.join(', '))] : [];
    if (candidates.length)
      return candidates.length === 1 && fileInputEnabled(candidates[0]) ? candidates[0] : null;
    const inputs = [...scope.querySelectorAll('input[type="file"]')];
    if (inputs.length) return inputs.length === 1 && fileInputEnabled(inputs[0]) ? inputs[0] : null;
  }
  const inputs = selectors.length ? [...document.querySelectorAll(selectors.join(', '))] : [];
  return inputs.length === 1 && fileInputEnabled(inputs[0]) ? inputs[0] : null;
}
export function assignFiles(input, files) {
  try {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '无法添加附件。' };
  }
}
export function findSendButton(composer, selectors) {
  const form = composer.closest('form');
  let scope = form || composer.parentElement;
  while (scope && scope !== document.body && scope !== document.documentElement) {
    if (
      !form &&
      [...scope.querySelectorAll('textarea, [contenteditable="true"]')].some(
        (input) =>
          input !== composer &&
          !composer.contains(input) &&
          !(
            input.getAttribute('class')?.split(/\s+/).includes('ql-clipboard') &&
            input.getAttribute('tabindex') === '-1'
          ) &&
          visible(input)
      )
    )
      return null;
    const buttons = [...scope.querySelectorAll(selectors.join(', '))];
    const candidates = buttons.filter(
      (button) =>
        enabledButton(button) &&
        !/\bstop\b/i.test(button.getAttribute('aria-label') || '') &&
        button.getAttribute('data-testid') !== 'stop-button' &&
        !button.getAttribute('class')?.split(/\s+/).includes('stop')
    );
    if (candidates.length > 1) return null;
    if (candidates.length === 1) return candidates[0];
    if (form || buttons.length) return null;
    scope = scope.parentElement;
  }
  return null;
}
