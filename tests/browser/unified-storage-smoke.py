from pathlib import Path
import tempfile
import atexit
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
_output = tempfile.TemporaryDirectory(prefix='prompt-queue-tests-')
atexit.register(_output.cleanup)
OUT = Path(_output.name)
EDGE = next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())

with TemporaryDirectory(prefix='unified-store-', dir=OUT) as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            worker.evaluate('async () => chrome.storage.local.set({pcSelfTestSeeded: 1})')
            first, second = context.new_page(), context.new_page()
            first.goto(base + 'sidepanel.html')
            second.goto(base + 'sidepanel.html')
            for page in [first, second]:
                page.wait_for_function('() => typeof PromptFlowStore !== "undefined"')
                page.evaluate('async () => { window.library = await import(chrome.runtime.getURL("shared/library.js")); }')
            ref = first.evaluate('''async () => {
              const file = new File(['附件原始内容'], 'shared.md', {type:'text/markdown'});
              const ref = library.makeAttachmentRef(file);
              await library.savePrompt({id:'prompt',title:'共用附件提示词',content:'原文',attachments:[ref]}, new Map([[ref.id,file]]));
              await library.saveFlow({id:'flow',title:'共用附件流程',steps:[{id:'step',text:'运行原文',attachments:[ref],repeat:{count:2}}]});
              return ref;
            }''')
            first.goto(base + 'workflow.html?flow=flow')
            first.locator('#steps>details').wait_for()
            assert first.locator('#steps>details').count() == 1
            first.goto(base + 'sidepanel.html')
            first.wait_for_function('() => typeof PromptFlowStore !== "undefined"')
            first.evaluate('async () => { window.library = await import(chrome.runtime.getURL("shared/library.js")); }')
            snapshot = worker.evaluate('async () => PromptFlowStore.readLibrary()')
            assert len(snapshot['flows']) == 1 and snapshot['flows'][0]['id'] == 'flow'
            assert snapshot['flows'][0]['steps'][0]['id'] == 'step'
            assert snapshot['flows'][0]['steps'][0]['repeat']['count'] == 2
            assert snapshot['flows'][0]['steps'][0]['attachments'][0] == ref
            assert snapshot['prompts'][0]['attachments'][0] == ref
            # Start writes in both document contexts before awaiting either batch.
            first.evaluate('''() => { window.writes = Promise.all(Array.from({length:12}, (_,i) =>
              library.savePrompt({id:'p'+i,title:'并发提示词'+i,content:String(i),attachments:[]}))); }''')
            second.evaluate('''() => { window.writes = Promise.all(Array.from({length:12}, (_,i) =>
              library.saveFlow({id:'f'+i,title:'并发流程'+i,steps:[{text:String(i)}]}))); }''')
            first.evaluate('() => window.writes')
            second.evaluate('() => window.writes')
            snapshot = worker.evaluate('async () => PromptFlowStore.readLibrary()')
            assert len(snapshot['prompts']) == 13 and len(snapshot['flows']) == 13
            first.evaluate('async () => library.deleteFlow("flow")')
            first.evaluate('async () => PromptFlowStore.deleteTrashedFlow("flow")')
            assert worker.evaluate('async id => !!await PromptFlowStore.getFile(id)', ref['id'])
            first.evaluate('async () => library.deletePrompt("prompt")')
            assert not worker.evaluate('async id => !!await PromptFlowStore.getFile(id)', ref['id'])
            backup = first.evaluate('async () => library.exportBackup()')
            assert backup['format'] == 'prompt-queue' and 'chains' not in backup
            # Round-trip a shared binary without making one copy per reference.
            result = first.evaluate('''async () => {
              const file = new File(['round trip'], 'roundtrip.md', {type:'text/markdown'}), ref=library.makeAttachmentRef(file);
              await library.savePrompt({id:'backup-p',title:'备份提示词',content:'内容',attachments:[ref]}, new Map([[ref.id,file]]));
              await library.saveFlow({id:'backup-f',title:'备份流程',steps:[{text:'内容',attachments:[ref]}]});
              const backup=await library.exportBackup();
              await library.importBackup(backup);
              const state=await PromptFlowStore.readLibrary();
              const prompt=state.prompts.find(p=>p.id==='backup-p'), flow=state.flows.find(f=>f.id==='backup-f');
              if(prompt.attachments[0].id !== flow.steps[0].attachments[0].id) throw Error('Shared reference duplicated');
              const saved=await PromptFlowStore.getFile(prompt.attachments[0].id);
              if(new TextDecoder().decode(saved.bytes)!=='round trip') throw Error('Binary changed');
              return {files:backup.files.length, refsEqual:true};
            }''')
            assert result == {'files': 1, 'refsEqual': True}
            # Failed commits roll back newly staged bytes and preserve the library.
            rollback = first.evaluate('''async () => {
              const file=new File(['rollback'], 'rollback.md', {type:'text/markdown'}), ref=library.makeAttachmentRef(file);
              const before=JSON.stringify(await PromptFlowStore.readLibrary()), original=chrome.storage.local.set;
              chrome.storage.local.set=async()=>{throw Error('fixture save failure')};
              try { await library.savePrompt({id:'failed',title:'失败提示词',content:'内容',attachments:[ref]},new Map([[ref.id,file]])); }
              catch(error) { if(!error.message.includes('fixture save failure')) throw error; }
              finally { chrome.storage.local.set=original; }
              return {same:before===JSON.stringify(await PromptFlowStore.readLibrary()), binary:!!await PromptFlowStore.getFile(ref.id)};
            }''')
            assert rollback == {'same': True, 'binary': False}
            keys = worker.evaluate('async () => Object.keys(await chrome.storage.local.get(null))')
            assert not any(key.startswith('langqueue_') or key in ['pfLibrary', 'pfTrash'] for key in keys), keys
            databases = first.evaluate('async () => (await indexedDB.databases()).map(db=>db.name)')
            assert databases == ['prompt-queue'], databases
            report = {'result':'PASS', 'databases':databases, 'checks':[
                'one flow ID and unchanged step options across card/editor/library',
                'one binary reference shared by prompts and flows',
                '24 concurrent writes across two panels without lost updates',
                'purge retains shared binaries until their last reference is removed',
                'backup round-trip retains shared bytes and one reference',
                'failed publication rolls back new binary files',
                'no historical library keys or duplicate attachment databases']}
            (OUT / 'unified-storage.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            context.close()
