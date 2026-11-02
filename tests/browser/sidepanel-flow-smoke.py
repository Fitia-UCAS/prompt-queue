from pathlib import Path
import tempfile
import atexit
from tempfile import TemporaryDirectory
import ast
import json
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
_output = tempfile.TemporaryDirectory(prefix='prompt-queue-tests-')
atexit.register(_output.cleanup)
OUT = Path(_output.name)
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
html=(ROOT/'tests/fixtures/chat.html').read_text(encoding='utf-8')
html = html.replace('document.querySelector(\'main\').append(answer);', 'window.releaseAnswer=()=>document.querySelector(\'main\').append(answer);')
checks = []
with TemporaryDirectory(prefix='flow-sidebar-', dir=OUT) as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            worker.evaluate("""async () => {
              await chrome.storage.local.set({pcSelfTestSeeded:1});
              await PromptFlowStore.saveFlow({id:'row-flow',title:'卡片流程',steps:[{text:'第一步原文'},{text:'第二步原文'}]});
            }""")
            target = context.new_page()
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
            target.goto('https://chatgpt.com/c/sidebar-flow-fixture')
            panel = context.new_page()
            errors = []
            panel.on('pageerror', lambda error: errors.append(str(error)))
            panel.goto(base + 'sidepanel.html')
            panel.locator('.platform-status[data-pc-ready="true"]').wait_for()
            panel.get_by_role('button', name='运行流程 卡片流程', exact=True).click()
            panel.wait_for_url('**/workflow.html?monitor=1')
            target.wait_for_function('sendCount===1')
            def wait_state(status):
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    run = worker.evaluate('async () => (await chrome.storage.local.get("pfRun")).pfRun')
                    if run and run['status'] == status: return run
                    panel.wait_for_timeout(100)
                raise AssertionError(run)
            panel.get_by_role('button', name='暂停', exact=True).click()
            wait_state('paused')
            panel.get_by_role('button', name='‹ 流程库', exact=True).click()
            panel.get_by_role('button', name='恢复流程 卡片流程', exact=True).click()
            panel.wait_for_url('**/workflow.html?monitor=1&resume=*')
            wait_state('running')
            panel.wait_for_timeout(600)
            assert target.evaluate('sendCount') == 1
            target.evaluate('releaseAnswer()')
            target.wait_for_function('sendCount===2', timeout=15000)
            checks.append('run row starts the original engine; paused row resumes without resending the first step')
            panel.get_by_role('button', name='‹ 流程库', exact=True).click()
            panel.get_by_role('button', name='停止流程 卡片流程', exact=True).click()
            wait_state('cancelled')
            panel.wait_for_timeout(500)
            assert target.evaluate('sendCount') == 2
            panel.get_by_role('button', name='删除流程 卡片流程', exact=True).click()
            panel.get_by_role('alertdialog').get_by_role('button', name='删除', exact=True).click()
            panel.get_by_text('还没有流程', exact=True).wait_for()
            assert not errors, errors
            checks.append('stop row cancels the active run; deleting the card removes the library item through the existing protocol')
            report = {'result': 'PASS', 'environment': 'isolated Edge extension and local ChatGPT fixture', 'checks': checks}
            (OUT / 'sidepanel-flow.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            context.close()
