const mimeTypes = [
  /^image\//i,
  /^text\//i,
  /^application\/pdf$/i,
  /^application\/(json|xml|xhtml\+xml|rtf|epub\+zip|sql|toml|x-yaml|x-sh|x-tex|x-ipynb\+json)$/i,
  /^application\/msword$/i,
  /^application\/vnd\.ms-(excel|powerpoint)$/i,
  /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/i,
  /^application\/vnd\.oasis\.opendocument\.(text|spreadsheet|presentation)$/i
];
const extensions = new Set(
  'png jpg jpeg gif webp bmp svg pdf doc docx xls xlsx ppt pptx odt ods odp rtf epub txt md markdown log tex csv tsv json jsonl xml yaml yml toml html htm css js mjs cjs jsx ts tsx py ipynb java c h cpp hpp cs go rs rb php swift kt sh sql'.split(
    ' '
  )
);
export const attachmentKind = (mimeType) => (/^image\//i.test(mimeType) ? 'image' : 'file');

function validateFile(file) {
  if (!file || typeof file.size !== 'number' || typeof file.name !== 'string')
    return '附件数据无效。';
  if (file.size <= 0) return '附件为空。';
  if (file.size > Number.MAX_SAFE_INTEGER) return '附件超过 25 MB。';
  const dot = (file.name || '').lastIndexOf('.');
  const extension = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
  if (mimeTypes.some((pattern) => pattern.test(file.type || '')) || extensions.has(extension))
    return null;
  return '不支持此附件类型。';
}

export function makeAttachmentRef(file) {
  const error = validateFile(file);
  if (error) throw new Error(file.name + ': ' + error);
  const mimeType = file.type || 'application/octet-stream';
  return { id: newId(), name: file.name || 'attachment', mimeType, size: file.size };
}

const readRecord = (id) => store().getFile(id);

export async function getAttachmentMeta(id) {
  const record = await readRecord(id);
  return record ? PromptFlowModel.fileRef(record) : null;
}

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(text);
}

function decodeBase64(text) {
  if (!text) return new ArrayBuffer(0);
  const decoded = atob(text);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes.buffer;
}

export async function readAttachmentChunk(id, offset, length = 65536) {
  const record = await readRecord(id);
  if (!record) return null;
  const start = Math.max(0, offset),
    size = Math.max(1, length),
    totalBytes = record.bytes.byteLength;
  if (start >= totalBytes)
    return { chunkBase64: '', nextOffset: totalBytes, totalBytes, done: true };
  const nextOffset = Math.min(totalBytes, start + size);
  return {
    chunkBase64: encodeBase64(record.bytes.slice(start, nextOffset)),
    nextOffset,
    totalBytes,
    done: nextOffset >= totalBytes
  };
}

export async function exportAttachments(ids) {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.trim().length > 0))];
  return (await Promise.all(unique.map(readRecord))).filter(Boolean).map((record) => {
    const { bytes, ...ref } = record;
    return { ...ref, dataBase64: encodeBase64(bytes) };
  });
}

export function parseAttachmentBackup(input) {
  if (!Array.isArray(input)) throw new Error('备份中的附件列表无效。');
  const seen = new Set();
  return input.map((record) => {
    if (!record || typeof record !== 'object') throw new Error('备份中的附件记录无效。');
    if (
      typeof record.id !== 'string' ||
      !record.id ||
      seen.has(record.id) ||
      typeof record.name !== 'string' ||
      !record.name ||
      typeof record.mimeType !== 'string' ||
      !record.mimeType ||
      typeof record.dataBase64 !== 'string' ||
      typeof record.size !== 'number' ||
      !Number.isSafeInteger(record.size) ||
      (record.size ?? 0) <= 0
    ) {
      throw new Error('备份中的附件记录无效或重复。');
    }
    seen.add(record.id);
    if (
      record.size > Number.MAX_SAFE_INTEGER ||
      record.dataBase64.length > Math.ceil(Number.MAX_SAFE_INTEGER / 3) * 4
    )
      throw new Error('备份中的附件超过 25 MB。');
    let bytes;
    try {
      bytes = decodeBase64(record.dataBase64);
    } catch {
      throw new Error('附件编码无效：' + record.name);
    }
    if (bytes.byteLength !== record.size) throw new Error('附件大小与内容不符：' + record.name);
    if (record.kind !== undefined && record.kind !== 'image' && record.kind !== 'file')
      throw new Error('附件类型无效：' + record.name);
    const file = new File([bytes], record.name, { type: record.mimeType });
    if (file.type !== record.mimeType) throw new Error('附件 MIME 类型格式无效：' + record.name);
    const kind = attachmentKind(file.type);
    if (record.kind !== undefined && record.kind !== kind)
      throw new Error('附件类型与 MIME 类型不符：' + record.name);
    const error = validateFile(file);
    if (error) throw new Error(record.name + ': ' + error);
    return { ref: PromptFlowModel.fileRef(record), file };
  });
}

const store = () => globalThis.PromptFlowStore;
const model = () => globalThis.PromptFlowModel;
const newId = () => crypto.randomUUID();
const refs = (input) => (input || []).map(model().fileRef);
const titleScore = (title, query) => {
  const text = (title || '').toLowerCase();
  return text === query ? 120 : text.startsWith(query) ? 100 : text.includes(query) ? 80 : 0;
};
function validateTitle(prompts, title, id) {
  const value = title.trim();
  if (!value) throw new Error('请填写名称。');
  if (prompts.some((prompt) => prompt.title === value && prompt.id !== id))
    throw new Error('此名称已存在。');
  return value;
}

export async function getPrompt(id) {
  return (await store().readLibrary()).prompts.find((prompt) => prompt.id === id) || null;
}
export async function listPrompts() {
  return (await store().readLibrary()).prompts.sort((a, b) => a.title.localeCompare(b.title));
}
export function savePrompt(input, pending = new Map()) {
  return store().updateLibrary((library) => {
    const index = library.prompts.findIndex((prompt) => prompt.id === input.id);
    const previous = library.prompts[index],
      now = Date.now();
    const prompt = {
      ...input,
      id: input.id || newId(),
      title: validateTitle(library.prompts, input.title, input.id),
      attachments: refs(input.attachments),
      usageCount: input.usageCount ?? 0,
      createdAt: previous?.createdAt ?? input.createdAt ?? now,
      updatedAt: now
    };
    if (index < 0) library.prompts.push(prompt);
    else library.prompts[index] = prompt;
  }, pending);
}
export function updatePrompt(id, patch, pending = new Map()) {
  return store().updateLibrary((library) => {
    const index = library.prompts.findIndex((prompt) => prompt.id === id),
      previous = library.prompts[index];
    if (!previous) throw new Error(`Prompt not found: ${id}`);
    library.prompts[index] = {
      ...previous,
      ...patch,
      id,
      title: validateTitle(library.prompts, patch.title ?? previous.title, id),
      attachments: patch.attachments ? refs(patch.attachments) : previous.attachments,
      updatedAt: Date.now()
    };
  }, pending);
}
export function deletePrompt(id) {
  return store().updateLibrary((library) => {
    library.prompts = library.prompts.filter((prompt) => prompt.id !== id);
  });
}
export async function searchPrompts(input) {
  const query = input.trim().toLowerCase();
  if (!query) return listPrompts();
  const prompts = (await store().readLibrary()).prompts;
  const score = (prompt) =>
    titleScore(prompt.title, query) +
    (prompt.content.toLowerCase().includes(query) ? 50 : 0) +
    (prompt.lastUsedAt ? 5 : 0);
  return prompts
    .filter((prompt) => [prompt.title, prompt.content].join('\n').toLowerCase().includes(query))
    .sort((a, b) => score(b) - score(a));
}
export function logUsage(log) {
  return store().updateLibrary((library) => {
    library.usage.logs = [...library.usage.logs, { ...log }].slice(-1000);
    library.usage.totalUses++;
    const prompt = library.prompts.find((prompt) => prompt.id === log.promptId);
    if (prompt) {
      prompt.usageCount = (prompt.usageCount ?? 0) + 1;
      prompt.lastUsedAt = log.timestamp;
      prompt.updatedAt = Date.now();
    }
  });
}
export async function getStats() {
  const library = await store().readLibrary();
  let mostUsedPrompt = null;
  for (const prompt of library.prompts)
    if (!mostUsedPrompt || (prompt.usageCount ?? 0) > (mostUsedPrompt.usageCount ?? 0))
      mostUsedPrompt = prompt;
  return {
    totalPrompts: library.prompts.length,
    totalUses: library.usage.totalUses,
    mostUsedPrompt
  };
}
export const getSettings = async () => (await store().readLibrary()).settings;
export const saveSettings = (settings) =>
  store().updateLibrary((library) => {
    library.settings = { ...settings };
  });
export const listFlows = async () => (await store().readLibrary()).flows;
export const saveFlow = (flow, pending) => store().saveFlow(flow, pending);
export const deleteFlow = (id) => store().trashFlow(id);
const SELF_TEST_ID = 'selftest-reading-check';
const SELF_TEST_REVISION = 2;
const PREVIOUS_SELF_TEST = '0489dfeb3925017b2572d9e1743ae7c521801aa9437102d3fda9781088df9203';

async function selfTestSignature(flow) {
  const value = {
    title: flow.title,
    description: flow.description,
    steps: flow.steps.map((step) => ({
      text: step.text,
      title: step.title,
      enabled: step.enabled !== false,
      files: [...new Set([...step.attachments, ...step.missingAttachments].map((ref) => ref.name))].sort()
    }))
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function ensureSelfTest({ create = true } = {}) {
  const pending = new Map();
  let ready = false;
  const result = await store().updateLibrary(async (library) => {
    const state = await chrome.storage.local.get(['pcSelfTestSeeded', 'pfRun']);
    const index = library.flows.findIndex((flow) => flow.id === SELF_TEST_ID);
    if (index < 0 && (!create || state.pcSelfTestSeeded || library.trash.some((item) => item.flow.id === SELF_TEST_ID)))
      return null;
    if (state.pfRun?.flow?.id === SELF_TEST_ID && PromptFlowModel.ACTIVE.has(state.pfRun.status))
      return null;
    const read = async (name) => {
      const response = await fetch(chrome.runtime.getURL('assets/self-test/' + encodeURIComponent(name)));
      if (!response.ok) throw new Error('内置自检资源不可用：' + name);
      return response.text();
    };
    const parsed = PromptFlowChatImport.parse(await read('self-test.md'));
    const bundled = new Map(parsed.steps.flatMap((step) => step.importAttachments || []).map((ref) => [ref.name, ref]));
    const fileRef = async (name) => {
      const source = bundled.get(name);
      const file = new File([await read(name)], name, { type: source.mimeType });
      const ref = makeAttachmentRef(file);
      pending.set(ref.id, file);
      return ref;
    };
    const stored = library.flows[index];
    const previous = stored ? PromptFlowModel.flow(stored) : null;
    if (previous) previous.updatedAt = stored.updatedAt;
    const replace = !previous || await selfTestSignature(previous) === PREVIOUS_SELF_TEST;
    let flow;
    if (replace) {
      const steps = [];
      for (const step of parsed.steps) {
        const attachments = [];
        for (const ref of step.importAttachments || []) attachments.push(await fileRef(ref.name));
        steps.push({ ...step, attachments, missingAttachments: [], missingAttachment: null });
      }
      flow = PromptFlowModel.flow({
        id: SELF_TEST_ID,
        title: '内置自检 · 任务队列 Debug',
        description: '围绕一次任务队列重试重复执行，核对复现记录、源码、测试和修复补丁。',
        createdAt: previous?.createdAt,
        steps
      });
    } else {
      flow = previous;
      const before = JSON.stringify(flow);
      for (const step of flow.steps) {
        const available = new Set();
        for (let position = 0; position < step.attachments.length; position++) {
          let ref = step.attachments[position];
          const file = await store().getFile(ref.id);
          if (file?.name === ref.name && file.size === ref.size && file.bytes?.byteLength === ref.size)
            available.add(ref.name);
          else if (bundled.has(ref.name)) {
            ref = await fileRef(ref.name);
            step.attachments[position] = ref;
            available.add(ref.name);
          }
        }
        const missing = [];
        for (const ref of step.missingAttachments) {
          if (!available.has(ref.name) && bundled.has(ref.name)) {
            step.attachments.push(await fileRef(ref.name));
            available.add(ref.name);
          }
          if (!available.has(ref.name)) missing.push(ref);
        }
        step.attachment = step.attachments[0] || null;
        step.missingAttachments = missing;
        step.missingAttachment = missing[0] || null;
      }
      if (JSON.stringify(flow) !== before) flow.updatedAt = Date.now();
      else flow = stored;
    }
    if (index < 0) library.flows.unshift(flow);
    else library.flows[index] = flow;
    ready = true;
    return flow;
  }, pending);
  if (ready) await chrome.storage.local.set({ pcSelfTestSeeded: SELF_TEST_REVISION });
  return result;
}

export async function searchFlows(input) {
  const query = input.trim().toLowerCase(),
    flows = await listFlows();
  if (!query) return flows;
  const score = (flow) =>
    titleScore(flow.title, query) +
    (flow.steps.some((step) => step.text.toLowerCase().includes(query)) ? 50 : 0);
  return flows
    .filter((flow) =>
      [flow.title, ...flow.steps.map((step) => step.text)].join('\n').toLowerCase().includes(query)
    )
    .sort((a, b) => score(b) - score(a));
}

export function reorder(kind, id, neighborId, promptOrder) {
  return store().updateLibrary((library) => {
    const items =
      kind === 'chain'
        ? library.flows
        : promptOrder
            .map((id) => library.prompts.find((prompt) => prompt.id === id))
            .filter(Boolean);
    const from = items.findIndex((item) => item.id === id),
      to = items.findIndex((item) => item.id === neighborId);
    if (from < 0 || to < 0) return;
    const [item] = items.splice(from, 1);
    items.splice(to, 0, item);
    if (kind !== 'chain')
      items.forEach((prompt, index) => {
        prompt.order = index;
      });
  });
}
export function importPromptList(input) {
  return store().updateLibrary((library) => {
    const titles = new Set(library.prompts.map((prompt) => prompt.title)),
      now = Date.now();
    let imported = 0,
      skipped = 0;
    for (const item of input) {
      const title = item.title.trim();
      if (!title || titles.has(title)) {
        skipped++;
        continue;
      }
      titles.add(title);
      library.prompts.push({
        id: newId(),
        title,
        content: item.content,
        attachments: [],
        usageCount: 0,
        createdAt: now,
        updatedAt: now
      });
      imported++;
    }
    return { imported, skipped };
  });
}

export async function exportBackup() {
  const { prompts, flows } = await store().readLibrary();
  const ids = new Set(
    [
      ...prompts.flatMap((prompt) => prompt.attachments),
      ...flows.flatMap((flow) => flow.steps.flatMap((step) => step.attachments))
    ].map((ref) => ref.id)
  );
  const files = await exportAttachments([...ids]);
  if (files.length !== ids.size) throw new Error('部分附件原文件缺失，请先匹配附件再导出。');
  return { format: 'prompt-queue', version: 1, exportedAt: Date.now(), prompts, flows, files };
}
export async function importBackup(input) {
  const backup = typeof input === 'string' ? JSON.parse(input) : input;
  if (backup?.format === 'prompt-flow') {
    const count = await store().importBundle(backup);
    return { chains: { imported: count, replaced: 0, skipped: 0, duplicated: 0 } };
  }
  if (
    backup?.format !== 'prompt-queue' ||
    backup.version !== 1 ||
    !Array.isArray(backup.prompts) ||
    !Array.isArray(backup.flows)
  )
    throw new Error('备份格式无效，请选择 JSON 文件。');
  const prompts = backup.prompts.map((prompt) => {
    if (
      !prompt?.id ||
      typeof prompt.title !== 'string' ||
      !prompt.title.trim() ||
      typeof prompt.content !== 'string'
    )
      throw new Error('备份中的提示词无效。');
    return { ...prompt, attachments: refs(prompt.attachments) };
  });
  const flows = backup.flows.map(model().flow);
  const incoming = new Map(parseAttachmentBackup(backup.files).map((item) => [item.ref.id, item]));
  const pending = new Map(),
    replacements = new Map();
  for (const record of [...prompts, ...flows.flatMap((flow) => flow.steps)]) {
    record.attachments = record.attachments.map((ref) => {
      const binary = incoming.get(ref.id);
      if (!binary || ['name', 'size', 'mimeType'].some((key) => binary.ref[key] !== ref[key]))
        throw new Error('备份缺少完整附件：' + ref.name);
      if (!replacements.has(ref.id)) {
        const replacement = { ...ref, id: newId() };
        replacements.set(ref.id, replacement);
        pending.set(replacement.id, binary.file);
      }
      return { ...replacements.get(ref.id) };
    });
    if (Object.hasOwn(record, 'attachment')) record.attachment = record.attachments[0] || null;
  }
  return store().updateLibrary((library) => {
    const result = {};
    for (const [key, records] of [
      ['prompts', prompts],
      ['flows', flows]
    ]) {
      const counts = { imported: 0, replaced: 0, skipped: 0, duplicated: 0 };
      for (const record of records) {
        const index = library[key].findIndex((item) => item.id === record.id);
        if (index < 0) {
          library[key].unshift(record);
          counts.imported++;
        } else {
          library[key][index] = record;
          counts.replaced++;
        }
      }
      result[key === 'flows' ? 'chains' : key] = counts;
    }
    result.attachments = { imported: pending.size };
    return result;
  }, pending);
}
