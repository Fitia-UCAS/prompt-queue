const SVG = 'http://www.w3.org/2000/svg';
const svgTags = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline']);

export function h(tag, props = {}, ...children) {
  const element = svgTags.has(tag)
    ? document.createElementNS(SVG, tag)
    : document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('on')) {
      element.addEventListener(name.slice(2).toLowerCase(), value);
      continue;
    }
    if (value === undefined || value === null) continue;
    if (name === 'className') {
      element.setAttribute('class', value);
      continue;
    }
    if (name === 'value') {
      element.value = value;
      continue;
    }
    if (['disabled', 'hidden', 'multiple'].includes(name)) {
      element[name] = value;
      continue;
    }
    element.setAttribute(name, String(value));
  }
  if (tag === 'input' && props.value !== undefined) element.setAttribute('value', props.value);
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false)
      element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

export function iconButton(label, className, glyph, onClick, disabled = false) {
  return h('button', { className, 'aria-label': label, onClick, disabled }, glyph);
}

export function nativeIcon(name) {
  return h(
    'svg',
    { viewBox: '0 0 24 24', 'aria-hidden': true },
    h('path', { d: PromptChainIcons[name] })
  );
}

export function restoreFocus(element) {
  if (element?.isConnected) {
    element.focus();
    return;
  }
  const card = element?.closest?.('.prompt-card,.chain-card');
  if (!card) return;
  const attribute = card.matches('.chain-card') ? 'data-chain-id' : 'data-prompt-id';
  const current = document.querySelector(
    '[' + attribute + '="' + CSS.escape(card.getAttribute(attribute)) + '"]'
  );
  const index = [...card.querySelectorAll('button')].indexOf(element);
  if (index >= 0) current?.querySelectorAll('button')[index]?.focus();
}

export function trapFocus(
  event,
  container,
  selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
) {
  const nodes = [...container.querySelectorAll(selector)].filter(
    (node) => !node.matches(':disabled')
  );
  if (!nodes.length) {
    event.preventDefault();
    return;
  }
  const first = nodes[0],
    last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
