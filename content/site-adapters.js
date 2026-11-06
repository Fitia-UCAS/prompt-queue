import { wrapGeminiUpload } from './gemini-upload.mjs';
import { createDeepSeekAdapter } from './deepseek-adapter.mjs';
import {
  visible,
  enabledComposer,
  enabledButton,
  fileInputEnabled,
  findFileInput,
  assignFiles,
  findSendButton
} from './composer.js';

class Adapter {
  async waitForIdle(options) {
    const timeout = options?.timeoutMs ?? 1800000,
      interval = options?.pollMs ?? 500,
      start = Date.now();
    while (Date.now() - start < timeout) {
      const input = this.getInputElement();
      if (!this.isGenerating() && enabledComposer(input)) return true;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return false;
  }
}
const filename = (name) => name.replace(/\(\d+\)(?=\.[^.]*$|$)/, '');
class ChatGPTAdapter extends Adapter {
  id = 'chatgpt';
  uploadAttempt = null;
  matchesAdapterDomain() {
    return /chatgpt\.com|chat\.openai\.com/.test(window.location.hostname);
  }
  getInputElement() {
    if (globalThis.PromptFlowSupervisor) return PromptFlowSupervisor.composer();
    for (const selector of [
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-testid*="prompt" i]',
      'div[contenteditable="true"]'
    ]) {
      const input = [...document.querySelectorAll(selector)].find(visible);
      if (input) return input;
    }
    const named = document.getElementById('prompt-textarea');
    if (named && named.tagName === 'TEXTAREA' && visible(named)) return named;
    const formInput = [
      ...document.querySelectorAll(
        'form textarea:not([readonly]):not([disabled]):not([class*="fallbackTextarea"])'
      )
    ].find((input) => input.tagName === 'TEXTAREA' && visible(input));
    return (
      formInput ||
      [...document.querySelectorAll('textarea')].find(
        (input) => input.tagName === 'TEXTAREA' && visible(input)
      ) ||
      null
    );
  }
  isGenerating() {
    if (globalThis.PromptFlowSupervisor) return PromptFlowSupervisor.generating();
    const any = (selector) => [...document.querySelectorAll(selector)].some(visible);
    return !!(
      any('button[data-testid="stop-button"]') ||
      any('button[aria-label="Stop streaming"]') ||
      any('.streaming-animation') ||
      this.getInputElement()?.closest('form')?.querySelector('button[aria-label="Stop"]') ||
      any('[role="status"][aria-busy="true"], [data-talvt-turn-state="in_progress"]')
    );
  }
  canSendWhileGenerating(input) {
    // The composer submit ID can also belong to the stop button.
    const button = findSendButton(input, [
      'button[data-testid="send-button"]',
      'button[data-testid="fruitjuice-send-button"]',
      'button[aria-label="Send prompt" i]',
      'button[aria-label="Send message" i]',
      'button[aria-label="Send" i]',
      'button[aria-label="发送提示"]',
      'button[aria-label="发送消息"]',
      'button[aria-label="发送"]'
    ]);
    return !!button?.checkVisibility({ visibilityProperty: true });
  }
  getSendButton(input) {
    if (globalThis.PromptFlowSupervisor)
      return PromptFlowSupervisor.sendBtn(input || this.getInputElement());
    const composer = input || this.getInputElement();
    return composer
      ? findSendButton(composer, [
          'button#composer-submit-button',
          'button.composer-submit-btn',
          'button[data-testid="send-button"]',
          'button[aria-label="Send message"]',
          'button[aria-label="Send"]'
        ])
      : null;
  }
  clickSend(input) {
    const button = this.getSendButton(input);
    if (!button) return false;
    try {
      button.click();
      return true;
    } catch {
      throw new Error('This may have been sent. Check the chat before you send it again.');
    }
  }
  async attachFiles(files) {
    if (globalThis.PromptChainNativeFiles) return PromptChainNativeFiles.attach(files);
    this.uploadAttempt = null;
    if (!Array.isArray(files) || !files.length) return { ok: true };
    const input = this.getInputElement(),
      picker = findFileInput(input, ['input[type="file"][aria-label="Attach files"]']);
    if (!picker)
      return {
        ok: false,
        error: "Couldn't find where to upload files on this page. Attach them yourself."
      };
    const form = input?.closest('form[data-chatgpt-composer]');
    if (!input || !form)
      return { ok: false, error: "Can't confirm uploads on this page. Attach the files yourself." };
    const counts = new Map();
    for (const button of form.querySelectorAll('button[aria-label^="Remove "]')) {
      const name = filename(button.getAttribute('aria-label').slice(7));
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    this.uploadAttempt = { input, form, href: location.href, files: [...files], counts };
    const result = assignFiles(picker, files);
    if (!result.ok) this.uploadAttempt = null;
    return result;
  }
  async waitForUploadsComplete(options) {
    if (globalThis.PromptChainNativeFiles) return PromptChainNativeFiles.wait(options);
    const attempt = this.uploadAttempt,
      files = options?.files;
    if (
      !attempt ||
      !files?.length ||
      files.length !== attempt.files.length ||
      files.some((file, index) => file !== attempt.files[index])
    )
      return false;
    const expected = new Map(attempt.counts);
    for (const file of files) {
      const name = filename(file.name);
      expected.set(name, (expected.get(name) || 0) + 1);
    }
    const start = Date.now();
    while (Date.now() - start < (options?.timeoutMs ?? 60000)) {
      if (
        this.uploadAttempt !== attempt ||
        location.href !== attempt.href ||
        !attempt.form.isConnected ||
        !attempt.input.isConnected ||
        this.getInputElement() !== attempt.input ||
        attempt.input.closest('form[data-chatgpt-composer]') !== attempt.form
      ) {
        if (this.uploadAttempt === attempt) this.uploadAttempt = null;
        return false;
      }
      const counts = new Map();
      for (const button of attempt.form.querySelectorAll('button[aria-label^="Remove "]')) {
        const card = button.parentElement;
        if (!card?.getClientRects().length) continue;
        const name = button.getAttribute('aria-label').slice(7);
        const labeled = [card, ...card.querySelectorAll('[aria-label]')].some(
          (node) => node.getAttribute('aria-label') === name && node.getClientRects().length > 0
        );
        const imagesLoaded = [...card.querySelectorAll('img')].every(
          (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
        );
        if (!labeled || !imagesLoaded) continue;
        const normalized = filename(name);
        counts.set(normalized, (counts.get(normalized) || 0) + 1);
      }
      const busy = [
        ...attempt.form.querySelectorAll(
          '[aria-busy="true"], [aria-label*="Uploading" i], [class*="animate-spin"], [class*="upload" i][class*="progress" i]'
        )
      ].some((node) => node.getClientRects().length > 0);
      if (
        files.every(
          (file) => (counts.get(filename(file.name)) || 0) >= expected.get(filename(file.name))
        ) &&
        !busy &&
        this.getSendButton(attempt.input)
      ) {
        this.uploadAttempt = null;
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, options?.pollMs ?? 200));
    }
    if (this.uploadAttempt === attempt) this.uploadAttempt = null;
    return false;
  }
}

class GeminiAdapter extends Adapter {
  id = 'gemini';
  uploadAttempt = null;
  matchesAdapterDomain() {
    return /gemini\.google\.com/.test(window.location.hostname);
  }
  getInputElement() {
    const inputs = [...document.querySelectorAll('div[contenteditable="true"]')].filter(visible);
    if (inputs.length === 1) return inputs[0];
    if (inputs.length > 1) {
      const input = inputs.find((node) =>
        ['gemini', 'prompt', 'message', 'chat'].some((word) =>
          (node.getAttribute('aria-label') || '').toLowerCase().includes(word)
        )
      );
      if (input) return input;
    }
    return [...document.querySelectorAll('textarea')].find(visible) ?? null;
  }
  isGenerating() {
    return !!(
      document.querySelector('button[aria-label="Stop response"]') ||
      document.querySelector('.send-button.stop')
    );
  }
  getSendButton(input) {
    const composer = input || this.getInputElement();
    return composer
      ? findSendButton(composer, ['button[aria-label="Send message"]', 'button.send-button'])
      : null;
  }
  clickSend(input) {
    const button = this.getSendButton(input);
    if (!button) return false;
    try {
      button.click();
      return true;
    } catch {
      throw new Error('This may have been sent. Check the chat before you send it again.');
    }
  }
  async attachFiles(files) {
    if (!Array.isArray(files) || !files.length) return { ok: true };
    this.uploadAttempt = null;
    const composer = this.getInputElement(),
      picker = findFileInput(composer, []);
    const failed = {
        ok: false,
        error: "Couldn't find where to upload files on this page. Attach them yourself."
      },
      area = composer?.closest('input-area-v2');
    if (!composer || area?.localName !== 'input-area-v2') return failed;
    if (picker) return this.assignUploadFiles(picker, files, composer, area);
    if (
      (composer.closest('form') || composer.parentElement)?.querySelectorAll('input[type="file"]')
        .length
    )
      return failed;
    const buttons = area.querySelectorAll(
      'button[aria-label="Upload & tools"][aria-haspopup="menu"]'
    );
    if (buttons.length !== 1 || !enabledButton(buttons[0])) return failed;
    const button = buttons[0],
      href = location.href;
    if (!composer.isConnected || !area.isConnected) return failed;
    let opened = false;
    if (button.getAttribute('aria-expanded') !== 'true') {
      if ([...document.querySelectorAll('[role="menu"]')].some(visible)) return failed;
      if (document.visibilityState === 'hidden')
        return {
          ok: false,
          error: 'Gemini uploads need this tab on screen. Show the tab, then retry.'
        };
      button.click();
      opened = true;
    }
    const start = Date.now();
    while (Date.now() - start < 1500) {
      if (
        location.href !== href ||
        !composer.isConnected ||
        this.getInputElement() !== composer ||
        composer.closest('input-area-v2') !== area ||
        !button.isConnected
      )
        return failed;
      const menus = [...document.querySelectorAll('[role="menu"]')].filter(visible),
        options = menus.filter((menu) => menu.getAttribute('aria-label') === 'Menu options'),
        upload = menus.filter((menu) => menu.getAttribute('aria-label') === 'Upload file options');
      if (
        menus.some((menu) => !options.includes(menu) && !upload.includes(menu)) ||
        options.length > 1 ||
        upload.length > 1
      )
        return failed;
      if (options.length === 1 && upload.length === 1) {
        if (!options[0].contains(upload[0]) || button.getAttribute('aria-expanded') !== 'true')
          return failed;
        const inputs = upload[0].querySelectorAll(
          'images-files-uploader > input.hidden-file-input[type="file"]'
        );
        if (inputs.length > 1) return failed;
        if (inputs.length === 1)
          return fileInputEnabled(inputs[0])
            ? this.assignUploadFiles(inputs[0], files, composer, area)
            : failed;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (opened && button.getAttribute('aria-expanded') === 'true') button.click();
    return failed;
  }
  assignUploadFiles(picker, files, composer, area) {
    if (!composer.isConnected || !area.isConnected || this.getInputElement() !== composer)
      return { ok: false, error: 'The chat box changed before the upload started. Try again.' };
    const counts = new Map();
    for (const preview of area.querySelectorAll('uploader-file-preview')) {
      const name = this.getUploadFilename(preview);
      if (!name)
        return {
          ok: false,
          error:
            'A file in the chat box is still uploading. Wait for it or remove it, then try again.'
        };
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    this.uploadAttempt = { composer, area, href: location.href, files: [...files], counts };
    const result = assignFiles(picker, files);
    if (!result.ok) this.uploadAttempt = null;
    return result;
  }
  getUploadFilename(preview) {
    const names = (
      preview
        .querySelector('.file-preview-container[aria-describedby]')
        ?.getAttribute('aria-describedby')
        ?.split(/\s+/) || []
    )
      .map((id) => document.getElementById(id)?.textContent?.trim())
      .filter(Boolean);
    return names.length === 1 ? names[0] : null;
  }
  async waitForUploadsComplete(options) {
    const attempt = this.uploadAttempt,
      files = options?.files;
    if (
      !attempt ||
      !files?.length ||
      files.length !== attempt.files.length ||
      files.some((file, index) => file !== attempt.files[index])
    )
      return false;
    const expected = new Map(attempt.counts);
    for (const file of files) expected.set(file.name, (expected.get(file.name) || 0) + 1);
    const start = Date.now();
    while (Date.now() - start < (options?.timeoutMs ?? 60000)) {
      options?.guard?.();
      if (
        this.uploadAttempt !== attempt ||
        location.href !== attempt.href ||
        !attempt.composer.isConnected ||
        !attempt.area.isConnected ||
        this.getInputElement() !== attempt.composer ||
        attempt.composer.closest('input-area-v2') !== attempt.area
      ) {
        if (this.uploadAttempt === attempt) this.uploadAttempt = null;
        return false;
      }
      if (
        [
          ...attempt.area.querySelectorAll(
            '.gem-attachment-loading-error, gem-icon[fonticonname="error"]'
          )
        ].some(visible)
      ) {
        this.uploadAttempt = null;
        return false;
      }
      const counts = new Map();
      for (const preview of attempt.area.querySelectorAll('uploader-file-preview')) {
        if (!visible(preview)) continue;
        const name = this.getUploadFilename(preview);
        if (!name) continue;
        const file =
          [...preview.querySelectorAll('gem-attachment .gem-attachment-text')].some(visible) &&
          [...preview.querySelectorAll('gem-attachment .gem-attachment-extension-label')].some(
            visible
          );
        const image = [
          ...preview.querySelectorAll(
            'gem-media-attachment img.gem-attachment-style-img[alt="attachment"]'
          )
        ].some(
          (node) =>
            visible(node) && node.complete && node.naturalWidth > 0 && node.naturalHeight > 0
        );
        if (file || image) counts.set(name, (counts.get(name) || 0) + 1);
      }
      const busy = [
        ...attempt.area.querySelectorAll(
          '[aria-busy="true"], [aria-label*="Uploading" i], [class*="upload" i][class*="progress" i], [role="progressbar"], .gem-attachment-loading, mat-spinner, mat-progress-spinner'
        )
      ].some(visible);
      if (
        files.every((file) => (counts.get(file.name) || 0) >= expected.get(file.name)) &&
        !busy &&
        this.getSendButton(attempt.composer)
      ) {
        this.uploadAttempt = null;
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, options?.pollMs ?? 200));
    }
    if (this.uploadAttempt === attempt) this.uploadAttempt = null;
    return false;
  }
}
export const createSiteAdapters = () => [
  new ChatGPTAdapter(),
  createDeepSeekAdapter(),
  wrapGeminiUpload(new GeminiAdapter())
];
