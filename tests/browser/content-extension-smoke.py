from pathlib import Path
import tempfile
import atexit
from tempfile import TemporaryDirectory
import argparse
import json
import time
from playwright.sync_api import sync_playwright

PROJECT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=PROJECT)
args = parser.parse_args()
ROOT = args.root.resolve()
_output = tempfile.TemporaryDirectory(prefix='prompt-queue-tests-')
atexit.register(_output.cleanup)
OUT = Path(_output.name)
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
HTML = '''<!doctype html><html><body><main></main><form onsubmit="return false"><textarea id="prompt-textarea" style="width:600px;height:100px;margin-top:500px"></textarea><button type="button" aria-label="Send message">Send</button></form></body></html>'''
OUT.mkdir(parents=True, exist_ok=True)
with TemporaryDirectory(prefix='extension-', dir=OUT) as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            worker.evaluate('''async()=>{await chrome.storage.local.set({pcSelfTestSeeded:1});await PromptFlowStore.updateLibrary(library=>{library.prompts=[{id:'p1',title:'Alpha',content:'候选插入的原文。',attachments:[],usageCount:0,createdAt:1,updatedAt:1}];});}''')
            target = context.new_page()
            errors = []
            target.on('pageerror', lambda error: errors.append(str(error)))
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            target.goto('https://chatgpt.com/c/content-smoke')
            panel = context.new_page()
            panel.goto(base + 'sidepanel.html')
            panel.get_by_role('button', name='设置', exact=True).wait_for()
            tab = worker.evaluate('async()=>(await chrome.tabs.query({url:"https://chatgpt.com/c/content-smoke"}))[0].id')
            def message(kind, payload=None):
                return panel.evaluate('({tab,kind,payload})=>chrome.tabs.sendMessage(tab,{type:kind,payload})', {'tab': tab, 'kind': kind, 'payload': payload or {}})
            assert message('COMPAT_CHECK')['result']['ready']
            session = context.new_cdp_session(target)
            def shadows():
                document = session.send('DOM.getDocument', {'depth': -1, 'pierce': True})['root']
                found = {}
                def walk(node):
                    attrs = node.get('attributes', [])
                    attrs = dict(zip(attrs[::2], attrs[1::2]))
                    kind = 'palette' if 'data-promptchain-shortcut-suggestions' in attrs else 'editor' if 'data-promptchain-prompt-editor' in attrs else 'status' if attrs.get('id') == 'promptchain-execution' else None
                    if kind:
                        assert node['shadowRoots'][0]['shadowRootType'] == 'closed'
                        found[kind] = node['shadowRoots'][0]['nodeId']
                    for child in node.get('children', []): walk(child)
                walk(document)
                return found
            def palette():
                node = shadows()['palette']
                object_id = session.send('DOM.resolveNode', {'nodeId': node})['object']['objectId']
                result = session.send('Runtime.callFunctionOn', {'objectId': object_id, 'functionDeclaration': 'function(){const panel=this.querySelector(".pc-shortcut-suggestions");return{open:panel.style.display==="block",titles:[...this.querySelectorAll(".pc-title")].map(n=>n.textContent)};}', 'returnByValue': True})
                return result['result']['value']
            assert len(shadows()) == 3
            target.locator('#prompt-textarea').fill('$Alpha')
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                state = palette()
                if state['open'] and state['titles'] == ['Alpha']: break
                target.wait_for_timeout(50)
            assert state == {'open': True, 'titles': ['Alpha']}, state
            target.keyboard.press('Enter')
            target.wait_for_function('document.querySelector("#prompt-textarea").value.includes("候选插入的原文。")')
            assert target.locator('#prompt-textarea').input_value() == '$Alpha\n候选插入的原文。'
            assert message('PC_ACQUIRE')['result']['acquired']
            assert message('PC_ACQUIRE')['result']['acquired']
            draft = target.locator('#prompt-textarea').input_value()
            blocked = message('INJECT_PROMPT', {'content': '锁内不应插入', 'expectedHref': target.url})
            assert not blocked['result']['ok'] and target.locator('#prompt-textarea').input_value() == draft
            message('PC_RELEASE')
            inserted = message('INJECT_PROMPT', {'content': '解锁后追加', 'expectedHref': target.url})
            assert inserted['result']['ok']
            assert target.locator('#prompt-textarea').input_value().endswith('\n解锁后追加\n')
            worker.evaluate('tab=>chrome.scripting.executeScript({target:{tabId:tab},files:["content/loader.js"]})', tab)
            target.wait_for_timeout(100)
            assert len(shadows()) == 3

            target.evaluate('''() => {
                const composer = document.querySelector('#prompt-textarea');
                const send = document.querySelector('[aria-label="Send message"]');
                send.dataset.testid = 'send-button';
                send.insertAdjacentHTML('afterend',
                    '<button type="button" id="composer-submit-button" data-testid="stop-button" aria-label="停止">停止</button>');
                window.nativeSubmissions = [];
                composer.addEventListener('keydown', event => {
                    if (event.key !== 'Enter' || event.defaultPrevented || send.disabled) return;
                    event.preventDefault();
                    window.nativeSubmissions.push(composer.value);
                    composer.value = '';
                });
            }''')
            composer = target.locator('#prompt-textarea')
            composer.fill('Adjust the current answer')
            composer.press('Enter')
            assert target.evaluate('window.nativeSubmissions') == ['Adjust the current answer']
            assert composer.input_value() == ''
            target.locator('[data-testid="send-button"]').evaluate('button => button.disabled = true')
            composer.fill('Send after the current answer')
            composer.press('Enter')
            target.wait_for_function("document.querySelector('#prompt-textarea').value === ''")
            assert target.evaluate('window.nativeSubmissions') == ['Adjust the current answer']
            assert not errors, errors
            report = {'result': 'PASS', 'root': str(ROOT), 'checks': ['real content loader and declared module resources',
                'three original closed Shadow DOM hosts', 'actual keyboard palette search through background RPC and insertion',
                'repeatable supervisor lock blocks manual insertion', 'release restores insertion', 'reinjecting loader does not duplicate hosts',
                'ChatGPT Enter uses native send during generation when enabled and queues otherwise']}
            (OUT / 'extension-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            context.close()
