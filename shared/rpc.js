export function createMessageListener(handlers) {
  return (message, sender, respond) => {
    const type = message?.type;
    if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) return;
    handlers[type](message?.payload)
      .then((result) => respond({ ok: true, result }))
      .catch((error) =>
        respond({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  };
}

function unwrap(response) {
  if (typeof response?.ok !== 'boolean') throw new Error('扩展没有响应，请重新加载后重试。');
  if (!response.ok) throw new Error(response.error);
  return response.result;
}

export async function callBackground(type, payload) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type, payload });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Extension context invalidated'))
      throw new Error('PromptQueue 已更新，请刷新页面。');
    throw error;
  }
  return unwrap(response);
}

export async function callTab(tabId, type, payload) {
  const platforms = [
    'https://chatgpt.com/',
    'https://chat.openai.com/',
    'https://gemini.google.com/',
    'https://chat.deepseek.com/'
  ];
  if (
    type === 'RUN_CHAIN' &&
    globalThis.location?.protocol === 'chrome-extension:' &&
    platforms.some((prefix) => (payload?.expectedHref || '').startsWith(prefix))
  ) {
    const response = await chrome.runtime.sendMessage({ type: 'PC_RUN_NATIVE', tabId, payload });
    if (!response?.ok) throw new Error(response?.error || '无法启动流程');
    location.href = chrome.runtime.getURL('workflow.html?monitor=1');
    return { ok: true };
  }
  return unwrap(await chrome.tabs.sendMessage(tabId, { type, payload }));
}
