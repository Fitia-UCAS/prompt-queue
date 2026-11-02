export const editorCss = `/*
Reset all inherited properties.
*/
:host {
  all: initial;
  color-scheme: light;
}

/*
Darker backdrop behind the prompt editor.
*/
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(28, 39, 44, 0.28);
  backdrop-filter: blur(2px);
  z-index: 2147483647;
  display: none;
  align-items: center;
  justify-content: center;
}

/*
Prompt editor dialog, which contains the shortcut name and prompt contents.
*/
.dialog {
  width: min(1080px, 92vw);
  max-height: 85vh;
  background: #ffffff;
  border-radius: 6px;
  overflow: hidden;
  color: #1c272c;
  border: 1px solid #bcc7ca;
  box-shadow: 0 16px 40px rgba(28, 39, 44, 0.18);
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-synthesis: none;
}

/*
Prompt editor dialog as well as all contained elements (descendents).
*/
.dialog, .dialog * {
  box-sizing: border-box;
}

/*
Top bar of the prompt editor (title + close button).
*/
.header {
  padding: 15px 18px 13px 18px;
  border-bottom: 1px solid #d9dfe1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/*
Title/label for the prompt editor.
*/
.title {
  font-size: 18px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: #1c272c;
}

/*
Close button for the prompt editor ('X' char).
*/
.close {
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: #ffffff;
  border: 1px solid #cfd6d8;
  color: #46555c;
  cursor: pointer;
  font-size: 22px;
}

/*
Text box for prompt instructions.
*/
.textarea {
  field-sizing: content;
  min-height: 300px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.close:hover,
.close:focus-visible {
  background: #edf2f3;
  border-color: #9eb1b8;
  color: #426c7a;
}

/*
Body section containing form fields. overflow-y and min-height: 0
allow this flex child to scroll when the prompt editor hits max-height.
*/
.body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  min-height: 0;
}

/*
Shared styles for the name input and instructions textarea.
*/
.input,
.textarea {
  width: 100%;
  border-radius: 4px;
  border: 1px solid #cfd6d8;
  background: #ffffff;
  color: #1c272c;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.input::placeholder,
.textarea::placeholder {
  color: #879297;
}

.error {
  font-size: 12px;
  color: #be123c;
  min-height: 16px;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 18px;
  border-top: 1px solid #d9dfe1;
}

/*
Base button styles shared by Cancel and Save.
*/
.btn {
  border-radius: 4px;
  min-height: 40px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 650;
  border: 1px solid #cfd6d8;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.btn:focus-visible,
.close:focus-visible,
.delete:focus-visible {
  outline: 2px solid #527d8c;
  outline-offset: 2px;
}

.btn-secondary {
  background: #ffffff;
  color: #1c272c;
}

.btn-primary {
  background: #527d8c;
  border-color: #527d8c;
  color: #f7fafb;
  box-shadow: 0 1px 2px rgba(20, 32, 37, 0.12);
}

.btn-secondary:hover:not(:disabled),
.btn-secondary:focus-visible:not(:disabled) {
  background: #edf2f3;
  border-color: #9eb1b8;
}

.btn-primary:hover:not(:disabled),
.btn-primary:focus-visible:not(:disabled) {
  background: #426c7a;
  border-color: #426c7a;
  box-shadow: 0 2px 4px rgba(20, 32, 37, 0.14);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/*
Square delete button with trash icon.
*/
.delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-right: auto;
  border-radius: 4px;
  border: 1px solid #cfd6d8;
  background: #ffffff;
  color: #be123c;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.delete svg {
  width: 16px;
  height: 16px;
}

.delete:hover:not(:disabled),
.delete:focus-visible:not(:disabled) {
  background: #edf2f3;
  border-color: #9eb1b8;
  color: #9f1239;
}

.delete:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.input:hover,
.textarea:hover {
  border-color: #9eb1b8;
}

.input:focus,
.textarea:focus {
  border-color: #527d8c;
  box-shadow: 0 0 0 2px rgba(82, 125, 140, 0.14);
}

.dialog ::selection {
  color: #ffffff;
  background: #527d8c;
}
`;

export const paletteCss = `
  :host {
    all: initial;
    --pc-shell: #f2f4f3;
    --pc-surface: #ffffff;
    --pc-text: #1c272c;
    --pc-text-soft: #46555c;
    --pc-text-muted: #6f7c82;
    --pc-line: #cfd6d8;
    --pc-accent: #527d8c;
    --pc-accent-hover: #426c7a;
    --pc-accent-text: #f7fafb;
  }
  .pc-shortcut-suggestions {
    position: fixed;
    z-index: 2147483647;
    min-width: 300px;
    max-width: 420px;
    overflow: hidden;
    border: 1px solid var(--pc-line);
    border-radius: 6px;
    color: var(--pc-text);
    background: var(--pc-shell);
    box-shadow: 0 16px 40px rgba(28, 39, 44, 0.18), 0 1px 3px rgba(20, 32, 37, 0.1);
    color-scheme: light;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .pc-shortcut-suggestions,
  .pc-shortcut-suggestions * {
    box-sizing: border-box;
  }
  .pc-header {
    padding: 10px 12px 9px;
    border-bottom: 1px solid #d9dfe1;
    color: var(--pc-text-muted);
    background: #fbfcfc;
    font-size: 11px;
    font-weight: 600;
  }
  .pc-create {
    display: flex;
    width: calc(100% - 16px);
    align-items: center;
    gap: 6px;
    margin: 8px 8px 2px;
    padding: 8px 10px;
    border: 1px solid var(--pc-line);
    border-radius: 4px;
    color: var(--pc-text-soft);
    background: var(--pc-surface);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
  }
  .pc-create:hover {
    border-color: #9eb1b8;
    color: var(--pc-accent-hover);
    background: #edf2f3;
  }
  .pc-create:focus-visible,
  .pc-edit:focus-visible {
    outline: 2px solid var(--pc-accent);
    outline-offset: 2px;
  }
  .pc-create svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
  }
  .pc-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 6px 8px 8px;
    overflow-y: auto;
    list-style: none;
    overscroll-behavior: contain;
    scrollbar-color: rgba(95, 110, 117, 0.3) transparent;
    scrollbar-width: thin;
  }
  .pc-item {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 10px;
    border: 1px solid transparent;
    border-left: 3px solid transparent;
    border-radius: 5px;
    background: var(--pc-surface);
    box-shadow: 0 1px 2px rgba(20, 32, 37, 0.06);
    cursor: pointer;
    transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
  }
  .pc-item:hover {
    border-color: #d9dfe1;
    border-left-color: #9eb1b8;
    background: #f8f9f9;
  }
  .pc-item.active {
    border-color: #b8c8ce;
    border-left-color: var(--pc-accent);
    background: #eef3f5;
    box-shadow: 0 2px 5px rgba(20, 32, 37, 0.08);
  }
  .pc-title {
    overflow: hidden;
    color: var(--pc-text);
    font-size: 12.5px;
    font-weight: 650;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pc-edit {
    position: relative;
    display: inline-flex;
    height: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--pc-line);
    border-radius: 3px;
    color: var(--pc-text-muted);
    background: var(--pc-surface);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 140ms ease, color 140ms ease, background 140ms ease;
  }
  .pc-edit:hover {
    border-color: var(--pc-accent);
    color: var(--pc-accent-text);
    background: var(--pc-accent);
  }
  .pc-edit svg {
    width: 14px;
    height: 14px;
    display: block;
  }
  .pc-edit .pc-tooltip {
    position: absolute;
    top: -28px;
    right: 0;
    padding: 3px 6px;
    border: 1px solid var(--pc-text);
    border-radius: 4px;
    color: var(--pc-accent-text);
    background: var(--pc-text);
    box-shadow: 0 3px 8px rgba(20, 32, 37, 0.16);
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(4px);
    pointer-events: none;
    transition: opacity 120ms ease, transform 120ms ease;
  }
  .pc-edit:hover .pc-tooltip {
    opacity: 1;
    transform: translateY(0);
  }
  .pc-empty {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    padding: 10px 12px;
    border: 1px dashed #b8c8ce;
    border-radius: 5px;
    color: var(--pc-text-muted);
    background: var(--pc-surface);
    font-size: 12px;
  }
`;

export const statusCss = `
:host {
  all: initial;
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 2147483646;
  color-scheme: light;
}
:host([hidden]) {
  display: none;
}
* {
  box-sizing: border-box;
}
[hidden] {
  display: none !important;
}
section {
  width: 340px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 40px);
  overflow: auto;
  border: 1px solid #bcc7ca;
  border-radius: 6px;
  background: #f2f4f3;
  color: #1c272c;
  box-shadow: 0 16px 40px #1c272c2e;
  font:
    12.5px/1.5 -apple-system,
    BlinkMacSystemFont,
    Segoe UI,
    sans-serif;
  font-synthesis: none;
  scrollbar-color: rgba(95, 110, 117, 0.3) transparent;
  scrollbar-width: thin;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 10px 11px 14px;
  border-bottom: 1px solid #d9dfe1;
  background: #fbfcfc;
}
.title {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
}
p {
  margin: 0;
}
.status {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 24px;
  color: #6f7c82;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}
.count {
  color: #1c272c;
  letter-spacing: 0;
}
.state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 3px 8px;
  border: 1px solid #cfd6d8;
  border-radius: 4px;
  color: #46555c;
  background: #fff;
  font-size: 10.5px;
  letter-spacing: 0;
  text-transform: none;
}
.state:before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #879297;
}
.state[data-tone="active"] {
  color: #426c7a;
  border-color: #b8c8ce;
  background: #eef3f5;
}
.state[data-tone="active"]:before {
  background: #527d8c;
}
.state[data-tone="done"] {
  color: #3f6954;
  border-color: #b5c9be;
  background: #eef4f0;
}
.state[data-tone="done"]:before {
  background: #4f7662;
}
.state[data-tone="error"] {
  color: #be123c;
  border-color: #fda4af;
  background: #fff1f2;
}
.state[data-tone="error"]:before {
  background: #be123c;
}
.message {
  padding: 8px 10px;
  border: 1px solid #cfd6d8;
  border-radius: 4px;
  color: #46555c;
  background: #fff;
  font-size: 11.5px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.message[data-tone="error"] {
  color: #be123c;
  border-color: #fda4af;
  background: #fff1f2;
}
ol {
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 240px;
  overflow-y: auto;
  scrollbar-color: rgba(95, 110, 117, 0.3) transparent;
  scrollbar-width: thin;
}
li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  -moz-column-gap: 8px;
  column-gap: 8px;
  align-items: start;
  flex: 0 0 auto;
  padding: 8px 6px 8px 10px;
  border: 1px solid #cfd6d8;
  border-left-width: 3px;
  border-radius: 5px;
  background: #fff;
  box-shadow: 0 1px 2px #1420250f;
}
li[data-current="true"] {
  border-left-color: #527d8c;
}
li p {
  padding-top: 2px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sent {
  grid-column: 1;
  margin-top: 3px;
  color: #6f7c82;
  font-size: 10.5px;
  font-weight: 500;
}
button {
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid #527d8c;
  outline-offset: 2px;
}
.toggle {
  padding: 3px 6px;
  border: 0;
  border-radius: 3px;
  color: #6f7c82;
  background: transparent;
  font-size: 10.5px;
  font-weight: 600;
  transition:
    color 0.14s ease,
    background 0.14s ease;
}
.toggle:hover {
  color: #1c272c;
  background: #edf2f3;
}
.remove {
  display: grid;
  grid-column: 2;
  grid-row: 1;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 3px;
  color: #6f7c82;
  background: transparent;
  font-size: 15px;
  line-height: 1;
  transition:
    color 0.14s ease,
    background 0.14s ease;
}
.remove:hover {
  color: #1c272c;
  background: #edf2f3;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions button {
  padding: 7px 11px;
  border: 1px solid #cfd6d8;
  border-radius: 4px;
  color: #46555c;
  background: #fff;
  font-size: 11px;
  font-weight: 600;
  transition:
    border-color 0.14s ease,
    color 0.14s ease,
    background 0.14s ease;
}
.actions button:hover {
  border-color: #9eb1b8;
  color: #426c7a;
  background: #edf2f3;
}
.actions .retry {
  border-color: #527d8c;
  color: #f7fafb;
  background: #527d8c;
}
.actions .retry:hover {
  border-color: #426c7a;
  color: #f7fafb;
  background: #426c7a;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.remove:disabled:hover {
  color: #6f7c82;
  background: transparent;
}
@media (prefers-reduced-motion: reduce) {
  button {
    transition: none;
  }
}
`;
