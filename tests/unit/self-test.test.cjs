const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../../shared/model.js');
const C = require('../../shared/chat-import.js');
const root = path.resolve(__dirname, '../..');
const assets = path.join(root, 'assets/self-test');
const source = fs.readFileSync(path.join(root, 'shared/library.js'), 'utf8');
const legacy = require('../fixtures/self-test-v1.json');
const builtinId = 'selftest-reading-check';
const names = ['01-issue.md', '02-task-queue.cjs', '03-retry-policy.cjs',
  '04-task-queue.test.cjs', '05-fix-requirements.md', '06-task-queue.patch.cjs'];

function setup() {
  const state = {};
  const files = new Map();
  let library = { flows: [], prompts: [], trash: [], selectedId: '' };
  let queue = Promise.resolve();
  let fail = '';
  const context = vm.createContext({
    crypto, File, TextEncoder, PromptFlowModel: M, PromptFlowChatImport: C,
    chrome: {
      runtime: { getURL: (name) => 'https://extension.test/' + name },
      storage: { local: {
        async get(keys) { return Object.fromEntries([keys].flat().map((key) => [key, structuredClone(state[key])])); },
        async set(patch) { Object.assign(state, structuredClone(patch)); }
      } }
    },
    fetch: async (url) => {
      const name = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
      return { ok: name !== fail, text: async () => fs.readFileSync(path.join(assets, name), 'utf8') };
    },
    PromptFlowStore: {
      getFile: async (id) => files.get(id),
      updateLibrary(change, pending) {
        const result = queue.then(async () => {
          const draft = structuredClone(library);
          const value = await change(draft);
          for (const [id, file] of pending) {
            files.set(id, { id, name: file.name, size: file.size, mimeType: file.type, bytes: await file.arrayBuffer() });
          }
          library = draft;
          return value;
        });
        queue = result.catch(() => {});
        return result;
      }
    }
  });
  vm.runInContext(source.replace(/\bexport /g, '') + ';globalThis.ensure = ensureSelfTest;', context);
  const save = (name, text = 'saved content') => {
    const bytes = new TextEncoder().encode(text).buffer;
    const ref = { id: crypto.randomUUID(), name, size: bytes.byteLength, mimeType: 'text/markdown' };
    files.set(ref.id, { ...ref, bytes });
    return ref;
  };
  function seedLegacy() {
    const flow = M.flow({ ...legacy, id: builtinId, steps: legacy.steps.map((step) => ({
      ...step,
      attachments: step.files.map((name) => save(name)),
      missingAttachments: step.files.map((name) => ({ name }))
    })) });
    library.flows.push(flow);
    state.pcSelfTestSeeded = 1;
    return flow;
  }
  return { state, files, save, seedLegacy, ensure: context.ensure,
    get library() { return library; }, fail: (name) => { fail = name; } };
}

function checkBuiltin(env) {
  const flow = env.library.flows.find((flow) => flow.id === builtinId);
  assert.equal(flow.title, '内置自检 · 任务队列 Debug');
  assert.equal(flow.steps.length, 6);
  assert.deepEqual(Array.from(flow.steps, (step) => step.attachments.length), [0, 1, 3, 2, 0, 0]);
  assert.ok(flow.steps.every((step) => step.missingAttachments.length === 0 && step.missingAttachment === null));
  assert.doesNotThrow(() => M.validateFlow(flow));
  const refs = flow.steps.flatMap((step) => step.attachments);
  assert.deepEqual(Array.from(refs, (ref) => ref.name), names);
  for (const ref of refs) {
    const file = env.files.get(ref.id);
    assert.equal(ref.size, file.bytes.byteLength);
    assert.deepEqual(Buffer.from(file.bytes), fs.readFileSync(path.join(assets, ref.name)));
  }
  return flow;
}

test('内置 Debug 自检直接携带六份完整附件，重新打开不改编号和时间', async () => {
  const env = setup();
  await Promise.all([env.ensure(), env.ensure()]);
  assert.equal(env.library.flows.length, 1);
  const first = JSON.stringify(checkBuiltin(env));
  await env.ensure({ create: false });
  assert.equal(JSON.stringify(checkBuiltin(env)), first);
  assert.equal(env.files.size, 6);
  assert.equal(env.state.pcSelfTestSeeded, 2);
  assert.ok(fs.readdirSync(assets).every((name) => /^[\x20-\x7e]+$/.test(name)));
});

test('既有默认自检升级为同一 Debug 案例，其他用户流程保留', async () => {
  const env = setup();
  const old = env.seedLegacy();
  const own = M.flow({ id: 'own', title: '我的流程', steps: [{ text: '保留正文' }] });
  env.library.flows.push(own);
  await env.ensure({ create: false });
  const current = checkBuiltin(env);
  assert.equal(current.createdAt, old.createdAt);
  assert.deepEqual(env.library.flows.find((flow) => flow.id === 'own'), own);
});

test('用户修改过的自检只清除已保存附件的错误待匹配项', async () => {
  const env = setup();
  const old = env.seedLegacy();
  old.steps[0].text = '我的调试要求';
  old.steps[0].enabled = false;
  old.steps[0].missingAttachments = [{ name: 'my-notes.md' }];
  old.steps[0].missingAttachment = old.steps[0].missingAttachments[0];
  const originalFiles = old.steps.flatMap((step) => step.attachments.map((ref) => ref.id));
  await env.ensure();
  const flow = env.library.flows[0];
  assert.equal(flow.title, old.title);
  assert.equal(flow.steps[0].text, '我的调试要求');
  assert.equal(flow.steps[0].enabled, false);
  assert.equal(flow.steps[0].missingAttachments[0].name, 'my-notes.md');
  assert.ok(flow.steps.slice(1).every((step) => step.missingAttachments.length === 0));
  assert.deepEqual(flow.steps.flatMap((step) => step.attachments.map((ref) => ref.id)), originalFiles);
});

test('内置附件二进制丢失时从随包资源恢复，保留用户的步骤内容和启用状态', async () => {
  const env = setup();
  await env.ensure();
  const flow = env.library.flows[0];
  flow.steps[0].text = '只检查这一项';
  flow.steps[2].enabled = false;
  env.files.delete(flow.steps[1].attachments[0].id);
  await env.ensure();
  checkBuiltin(env);
  assert.equal(env.library.flows[0].steps[0].text, '只检查这一项');
  assert.equal(env.library.flows[0].steps[2].enabled, false);
});

test('不自动重建删除过的自检，独立编辑页不创建新自检', async () => {
  const env = setup();
  assert.equal(await env.ensure({ create: false }), null);
  assert.equal(env.library.flows.length, 0);
  env.state.pcSelfTestSeeded = 1;
  await env.ensure();
  assert.equal(env.library.flows.length, 0);
  delete env.state.pcSelfTestSeeded;
  env.library.trash.push({ flow: { id: builtinId } });
  await env.ensure();
  assert.equal(env.library.flows.length, 0);
  assert.equal(env.files.size, 0);
});

for (const status of ['running', 'paused']) {
  test(`${status} 中的自检不替换步骤和附件`, async () => {
    const env = setup();
    const flow = env.seedLegacy();
    env.state.pfRun = { status, flow: structuredClone(flow) };
    const before = JSON.stringify(env.library);
    await env.ensure();
    assert.equal(JSON.stringify(env.library), before);
    assert.equal(env.state.pcSelfTestSeeded, 1);
    assert.deepEqual(env.state.pfRun.flow, flow);
  });
}

test('随包资源读取失败不会留下半个自检或错误完成标记', async () => {
  const env = setup();
  env.fail('04-task-queue.test.cjs');
  await assert.rejects(env.ensure(), /内置自检资源不可用/);
  assert.equal(env.library.flows.length, 0);
  assert.equal(env.files.size, 0);
  assert.equal(env.state.pcSelfTestSeeded, undefined);
  env.fail('');
  await env.ensure();
  checkBuiltin(env);
});

test('Debug 材料能实际复现重复执行，候选补丁通过四组回归', async () => {
  const { verifyQueue } = require('../../assets/self-test/04-task-queue.test.cjs');
  const broken = require('../../assets/self-test/02-task-queue.cjs');
  const fixed = require('../../assets/self-test/06-task-queue.patch.cjs');
  await assert.rejects(verifyQueue(broken.createQueue), { code: 'ERR_ASSERTION' });
  await verifyQueue(fixed.createQueue);
  const queue = fixed.createQueue();
  queue.add('failed', async () => { throw new Error('failed'); });
  await assert.rejects(queue.drain(), /failed/);
  let completed = false;
  queue.add('next', async () => { completed = true; });
  await queue.drain();
  assert.equal(completed, true);
});
