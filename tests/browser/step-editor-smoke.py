from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EDGE = next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())
READ = "async () => (await PromptFlowStore.readLibrary()).flows.find(flow => flow.id === 'editing')"

with TemporaryDirectory(prefix='prompt-queue-step-editor-') as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            viewport={'width':480, 'height':850}, args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            worker.evaluate("""async () => {
                await chrome.storage.local.set({pcSelfTestSeeded:1});
                const ref = await PromptFlowStore.saveFile(new File(['source'], 'source.cjs', {type:'text/javascript'}));
                await PromptFlowStore.saveFlow({id:'editing',title:'任务队列调试',steps:[
                    {id:'input',title:'检查输入',text:'先看输入记录。',attachments:[ref]},
                    {id:'retry',title:'检查重试',text:'再看重试逻辑。',enabled:false},
                    {id:'tests',title:'回归测试',text:'最后运行测试。'}
                ]});
            }""")
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def open_editor():
                page.goto(base + 'workflow.html?standalone=1&flow=editing')
                page.locator('#steps > .step').nth(2).wait_for()

            def step(id):
                return page.locator(f'#steps > .step[data-step="{id}"]')

            def order():
                return page.locator('#steps > .step').evaluate_all('(nodes) => nodes.map(node => node.dataset.step)')

            def saved(predicate):
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    flow = worker.evaluate(READ)
                    if predicate(flow): return flow
                    page.wait_for_timeout(50)
                raise AssertionError(worker.evaluate(READ))

            open_editor()
            assert page.locator('.step-summary-text small, .step-actions').count() == 0
            assert page.locator('[data-step-action="up"], [data-step-action="down"], [data-step-action="duplicate"], [data-step-action="edit"]').count() == 0
            assert page.locator('.step-header-tools').first.locator('button').count() == 1
            edge = lambda id: step(id).evaluate('node => ({width:getComputedStyle(node).borderLeftWidth, color:getComputedStyle(node).borderLeftColor})')
            assert edge('input')['width'] == edge('retry')['width'] == '3px'
            assert edge('input')['color'] != edge('retry')['color']
            original = worker.evaluate(READ)

            step('input').locator('.step-toggle').click()
            assert step('input').get_attribute('open') is not None
            assert step('input').locator('.step-enable').get_attribute('aria-pressed') == 'true'
            assert step('input').locator('textarea').is_enabled()
            assert worker.evaluate(READ) == original
            step('input').locator('.step-toggle').click()
            assert step('input').get_attribute('open') is None
            assert worker.evaluate(READ) == original

            step('retry').locator('.step-toggle').click()
            assert step('retry').get_attribute('open') is not None
            assert step('retry').locator('.step-enable').get_attribute('aria-pressed') == 'false'
            step('retry').locator('textarea').fill('检查重试时是否重复入队。')
            saved(lambda flow: flow['steps'][1]['text'] == '检查重试时是否重复入队。')
            assert not worker.evaluate(READ)['steps'][1]['enabled']
            step('retry').locator('.step-enable').click()
            saved(lambda flow: flow['steps'][1]['enabled'])
            assert step('retry').get_attribute('open') is not None
            assert edge('input')['color'] == edge('retry')['color']
            step('retry').locator('.step-enable').click()
            saved(lambda flow: not flow['steps'][1]['enabled'])
            assert step('retry').get_attribute('open') is not None
            step('retry').locator('.step-enable').click()
            saved(lambda flow: flow['steps'][1]['enabled'])

            box=step('input').bounding_box()
            page.mouse.click(box['x']+2,box['y']+25)
            saved(lambda flow: not flow['steps'][0]['enabled'])
            assert step('input').get_attribute('open') is None
            step('retry').locator('textarea').focus()
            page.keyboard.press('Shift+ArrowUp')
            assert order() == ['input', 'retry', 'tests']
            step('retry').locator('.step-toggle').focus()
            page.keyboard.press('Shift+ArrowUp')
            saved(lambda flow: [s['id'] for s in flow['steps']] == ['retry', 'input', 'tests'])
            assert order() == ['retry', 'input', 'tests']
            assert step('retry').get_attribute('open') is not None
            assert step('retry').locator('.step-toggle').evaluate('node => document.activeElement === node')
            page.keyboard.press('Shift+ArrowDown')
            saved(lambda flow: [s['id'] for s in flow['steps']] == ['input', 'retry', 'tests'])
            state=worker.evaluate(READ)
            assert state['steps'][0]['attachments'] == original['steps'][0]['attachments']
            assert not state['steps'][0]['enabled'] and state['steps'][1]['enabled']
            assert page.locator('.step-num').all_inner_texts() == ['01', '02', '03']

            step('tests').get_by_role('button', name='删除本步', exact=True).click()
            saved(lambda flow: len(flow['steps']) == 2)
            page.locator('#notice').get_by_role('button', name='撤销', exact=True).click()
            saved(lambda flow: [s['id'] for s in flow['steps']] == ['input', 'retry', 'tests'])
            for width in [360,380,480]:
                page.set_viewport_size({'width':width,'height':850})
                layout=page.locator('#steps').evaluate('node => ({width:node.clientWidth, scroll:node.scrollWidth})')
                assert layout['scroll'] <= layout['width'], (width,layout)
                assert page.locator('.step-actions, [data-step-action="up"], [data-step-action="down"], [data-step-action="duplicate"]').count() == 0
                for id in ['input','retry','tests']:
                    assert step(id).locator('.step-header-tools button').count() == 1
            page.set_viewport_size({'width':480,'height':850})
            open_editor()
            assert step('input').locator('.step-enable').get_attribute('aria-pressed') == 'false'
            assert step('retry').locator('.step-enable').get_attribute('aria-pressed') == 'true'
            assert order() == ['input','retry','tests']

            worker.evaluate("""async () => {
                const flow=(await PromptFlowStore.readLibrary()).flows.find(flow => flow.id === 'editing');
                await chrome.storage.local.set({pfRun:{id:'locked',flow,status:'paused',index:0,targetUrl:'https://chatgpt.com/c/example',logs:[]}});
            }""")
            open_editor()
            locked=worker.evaluate(READ)
            assert step('retry').get_by_role('button',name='删除本步',exact=True).is_disabled()
            assert step('retry').locator('.step-enable').is_disabled()
            step('retry').get_by_role('button',name='查看本步',exact=True).click()
            assert step('retry').get_attribute('open') is not None
            assert step('retry').locator('textarea').is_disabled()
            page.keyboard.press('Shift+ArrowUp')
            assert order() == ['input','retry','tests'] and worker.evaluate(READ) == locked

            worker.evaluate("""async () => {
                await chrome.storage.local.remove('pfRun');
                await PromptFlowStore.saveFlow({id:'single',title:'单步调试',steps:[{text:'检查这一项'}]});
            }""")
            page.goto(base+'workflow.html?standalone=1&flow=single')
            single=page.locator('#steps > .step');single.wait_for()
            assert single.get_attribute('open') is not None
            single.locator('.step-toggle').click()
            assert single.get_attribute('open') is None
            single.locator('.step-enable').click()
            assert single.get_attribute('open') is None
            single.locator('.step-enable').click()
            assert single.get_attribute('open') is None
            single.locator('.step-toggle').click()
            assert single.get_attribute('open') is not None
            assert single.locator('.step-enable').get_attribute('aria-pressed') == 'true'
            assert not errors, errors
        finally:
            context.close()

print(json.dumps({'suite':'step-editor','ok':True,'checks':[
    'one title click opens editing; opening and closing preserve enabled state',
    'left edge and number toggle enabled state independently; no move/copy toolbar remains',
    'Shift+Arrow reorders by stable ID, keeps focus, expansion, files and enabled state',
    'text editing and active runs do not reorder; compact headers fit 360/380/480px'
]},ensure_ascii=False,indent=2))
