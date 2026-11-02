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
OUT.mkdir(parents=True, exist_ok=True)
with TemporaryDirectory(prefix='api-smoke-', dir=OUT) as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('chrome.runtime.getManifest().name') == 'PromptQueue'
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + 'sidepanel.html')
            page.get_by_role('button', name='设置', exact=True).wait_for()
            checks = page.evaluate('''async () => {
              const {callBackground: rpc} = await import('./shared/rpc.js');
              const {id} = await rpc('PROMPT_CREATE', {title:'通信验收',content:'原文不变'});
              const results = await rpc('PROMPT_SEARCH', {query:'通信验收'});
              if(results.length!==1 || results[0].id!==id || results[0].content!=='原文不变') throw new Error('create/search');
              await rpc('PROMPT_UPDATE', {id,title:'通信验收',content:'更新原文'});
              if((await rpc('PROMPT_SEARCH',{query:'更新原文'}))[0]?.id!==id) throw new Error('update');
              await rpc('LOG_USAGE',{promptId:id,platform:'chatgpt'});
              const store = await import('./shared/library.js');
              if((await store.getPrompt(id)).usageCount!==1) throw new Error('usage');
              const settings = await rpc('GET_SETTINGS');
              await rpc('SAVE_SETTINGS',{settings:{...settings,custom:'preserved'}});
              if((await rpc('GET_SETTINGS')).custom!=='preserved') throw new Error('settings');
              const meta = await rpc('ATTACHMENT_GET_META',{ids:['missing']});
              if(meta.missingIds[0]!=='missing') throw new Error('meta');
              let missing = false;
              try {await rpc('ATTACHMENT_GET_CHUNK',{id:'missing',offset:0});} catch(error) {missing=error.message==='ATTACHMENT_NOT_FOUND';}
              if(!missing) throw new Error('missing chunk');
              await rpc('PROMPT_DELETE',{id});
              if((await rpc('PROMPT_SEARCH',{query:'通信验收'})).length) throw new Error('delete');
              return ['MV3 worker startup','actual runtime CRUD/search/usage/settings','attachment metadata and error protocol'];
            }''')
            target = context.new_page()
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body='<div id="prompt-textarea" contenteditable="true" role="textbox"></div>'))
            target.goto('https://chatgpt.com/c/api-fixture')
            page.wait_for_function('''async () => {
              const [tab] = await chrome.tabs.query({url:'https://chatgpt.com/c/api-fixture'});
              try {return (await chrome.tabs.sendMessage(tab.id,{type:'COMPAT_CHECK',payload:{}}))?.result?.ready;} catch {return false;}
            }''')
            checks.append('content loader imports RPC through declared web accessible resources')
            assert not errors, errors
            report = {'result': 'PASS', 'checks': checks}
            (OUT / 'ui-api-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            context.close()
