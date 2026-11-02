from pathlib import Path
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'assets/self-test'
EDGE = next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())
CHAIN = '内置自检 · 任务队列 Debug'
FILES = ['01-issue.md', '02-task-queue.cjs', '03-retry-policy.cjs', '04-task-queue.test.cjs', '05-fix-requirements.md', '06-task-queue.patch.cjs']
READ = """async () => {
  const library = await PromptFlowStore.readLibrary();
  const flow = library.flows.find(flow => flow.id === 'selftest-reading-check');
  let validation = '';
  if (flow) try { PromptFlowModel.validateFlow(flow); } catch (error) { validation = error.message; }
  const files = [];
  for (const ref of flow?.steps.flatMap(step => step.attachments) || []) {
    const file = await PromptFlowStore.getFile(ref.id);
    files.push({id: ref.id, name: ref.name, size: ref.size, text: file ? new TextDecoder().decode(file.bytes) : null});
  }
  return {library, flow, files, validation, seeded: (await chrome.storage.local.get('pcSelfTestSeeded')).pcSelfTestSeeded};
}"""
LEGACY = """async ({template, custom}) => {
  const steps = [];
  for (const source of template.steps) {
    const attachments = [];
    for (const name of source.files) attachments.push(await PromptFlowStore.saveFile(new File(['saved original'], name, {type: 'text/markdown'})));
    steps.push({...source, attachments, missingAttachments: source.files.map(name => ({name, mimeType:'text/markdown'}))});
  }
  if (custom) steps[0].text = '保留我的调试要求';
  const flow = PromptFlowModel.flow({...template, id: 'selftest-reading-check', steps});
  await PromptFlowStore.updateLibrary(library => {
    library.flows = [flow, PromptFlowModel.flow({id:'own', title:'我的流程', steps:[{text:'保留正文'}]})];
    library.trash = [];
  });
  await chrome.storage.local.set({pcSelfTestSeeded:1});
}"""

def check(state):
    flow = state['flow']
    assert flow['title'] == CHAIN, flow['title']
    assert [len(step['attachments']) for step in flow['steps']] == [0, 1, 3, 2, 0, 0]
    assert all(not step['missingAttachments'] and step['missingAttachment'] is None for step in flow['steps'])
    assert state['validation'] == '', state['validation']
    assert [file['name'] for file in state['files']] == FILES
    for file in state['files']:
        original = (ASSETS / file['name']).read_bytes()
        assert file['size'] == len(original)
        assert file['text'].encode('utf-8') == original
    assert state['seeded'] == 2

with TemporaryDirectory(prefix='prompt-queue-self-test-') as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            viewport={'width':480, 'height':850}, args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            errors = []
            page = context.new_page()
            other = context.new_page()
            for tab in (page, other):
                tab.on('pageerror', lambda error: errors.append(str(error)))
                tab.goto(base + 'sidepanel.html')
            for tab in (page, other):
                tab.get_by_text(CHAIN, exact=True).wait_for()
            fresh = page.evaluate(READ)
            check(fresh)
            assert len(fresh['library']['flows']) == 1
            page.reload()
            page.get_by_text(CHAIN, exact=True).wait_for()
            again = page.evaluate(READ)
            assert again['flow'] == fresh['flow']
            assert again['files'] == fresh['files']
            page.goto(base + 'workflow.html?standalone=1&flow=selftest-reading-check')
            page.locator('#steps > .step').nth(5).wait_for()
            assert page.locator('#missing-files').is_hidden()
            assert page.locator('#directory-name').is_hidden()
            assert page.locator('#steps .attachment.missing').count() == 0
            check(page.evaluate(READ))

            for tab in (page, other): tab.goto('about:blank')
            template = json.loads((ROOT / 'tests/fixtures/self-test-v1.json').read_text(encoding='utf-8'))
            worker.evaluate(LEGACY, {'template':template, 'custom':False})
            page.goto(base + 'workflow.html?standalone=1&flow=selftest-reading-check')
            page.locator('#steps > .step').nth(5).wait_for()
            upgraded = page.evaluate(READ)
            check(upgraded)
            assert next(flow for flow in upgraded['library']['flows'] if flow['id'] == 'own')['steps'][0]['text'] == '保留正文'
            assert page.locator('#missing-files').is_hidden()
            assert page.locator('#directory-name').is_hidden()

            page.goto('about:blank')
            worker.evaluate(LEGACY, {'template':template, 'custom':True})
            page.goto(base + 'workflow.html?standalone=1&flow=selftest-reading-check')
            page.locator('#steps > .step').nth(5).wait_for()
            custom = page.evaluate(READ)
            assert custom['flow']['steps'][0]['text'] == '保留我的调试要求'
            assert custom['flow']['title'] == template['title']
            assert all(not step['missingAttachments'] for step in custom['flow']['steps'])
            assert custom['validation'] == ''

            page.goto('about:blank')
            worker.evaluate("() => PromptFlowStore.trashFlow('selftest-reading-check')")
            page.goto(base + 'sidepanel.html')
            page.get_by_text('我的流程', exact=True).wait_for()
            assert page.evaluate(READ).get('flow') is None
            assert not errors, errors
        finally:
            context.close()
print(json.dumps({'suite':'self-test-chain', 'ok':True, 'checks':[
    'fresh concurrent panels share one six-step Debug flow with six complete bundled files',
    'reopening keeps file IDs, content and timestamps unchanged',
    'direct editor load repairs the existing default flow and hides unnecessary matching controls',
    'custom edits and other flows survive; deleted self-test stays deleted'
]}, ensure_ascii=False, indent=2))
