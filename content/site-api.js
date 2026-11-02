import { callBackground } from '../shared/rpc.js';

export const readSettings = () => callBackground('GET_SETTINGS', undefined);
export const searchPrompts = (query, limit) => callBackground('PROMPT_SEARCH', { query, limit });
export const searchChains = (query, limit) => callBackground('CHAIN_SEARCH', { query, limit });
export async function recordUsage(promptId, platform) {
  try {
    await callBackground('LOG_USAGE', { promptId, platform });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '无法保存使用记录。');
  }
}
export async function updatePrompt(id, title, content, attachments) {
  try {
    await callBackground('PROMPT_UPDATE', { id, title, content, attachments });
    return true;
  } catch (error) {
    throw error instanceof Error ? error : new Error('保存失败。');
  }
}
export async function deletePrompt(id) {
  try {
    await callBackground('PROMPT_DELETE', { id });
    return true;
  } catch {
    return false;
  }
}
export async function createPrompt(title, content, attachments) {
  try {
    await callBackground('PROMPT_CREATE', { title, content, attachments });
    return true;
  } catch (error) {
    throw error instanceof Error ? error : new Error('保存失败。');
  }
}
export function decodeChunks(chunks, totalBytes) {
  const bytes = new Uint8Array(Math.max(0, totalBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    const text = atob(chunk);
    for (let index = 0; index < text.length && offset < bytes.length; index++, offset++)
      bytes[offset] = text.charCodeAt(index);
  }
  return bytes.buffer.slice(0, offset);
}
export async function attachmentFiles(refs) {
  if (!Array.isArray(refs) || !refs.length) return [];
  const files = [];
  for (const ref of refs) {
    let offset = 0,
      totalBytes = 0,
      done = false;
    const chunks = [];
    while (!done) {
      const part = await callBackground('ATTACHMENT_GET_CHUNK', {
        id: ref.id,
        offset,
        length: 65536
      });
      chunks.push(part.chunkBase64);
      offset = part.nextOffset;
      totalBytes = part.totalBytes;
      done = part.done;
    }
    files.push(new File([decodeChunks(chunks, totalBytes)], ref.name, { type: ref.mimeType }));
  }
  return files;
}
