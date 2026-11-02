from pathlib import Path
import tempfile
import atexit
from tempfile import TemporaryDirectory
import argparse
import json
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
OUT.mkdir(parents=True, exist_ok=True)
with TemporaryDirectory(prefix='extension-', dir=OUT) as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            assert worker.evaluate('chrome.runtime.getManifest().name') == 'PromptQueue'
            worker.evaluate('''async()=>PromptFlowStore.updateLibrary(library=>{library.prompts=[]})''')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            page = context.new_page()
            errors, requests = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url))
            page.goto(base + 'onboarding.html#import')
            page.get_by_role('heading', name='导入提示词', exact=True).wait_for()
            files = [{'name': 'alpha.md', 'mimeType': 'text/markdown', 'buffer': '---\nname: "扩展导入甲"\n---\n  原文甲。\r\n下一行。  '.encode()},
                {'name': 'beta.txt', 'mimeType': 'text/plain', 'buffer': '原文乙。'.encode()},
                {'name': 'README.md', 'mimeType': 'text/markdown', 'buffer': '默认不选中。'.encode()}]
            def upload():
                with page.expect_file_chooser() as chooser:
                    page.get_by_role('button', name='选择文件', exact=True).click()
                chooser.value.set_files(files)
                page.locator('.review-list li').nth(2).wait_for()
                assert page.locator('.review-list input:checked').count() == 2
            upload()
            page.get_by_role('button', name='导入 2 条提示词', exact=True).click()
            page.get_by_role('heading', name='已导入 2 条提示词', exact=True).wait_for()
            stored = worker.evaluate('async()=>(await PromptFlowStore.readLibrary()).prompts')
            assert {p['title']: p['content'] for p in stored} == {'扩展导入甲': '原文甲。\n下一行。', 'beta': '原文乙。'}, stored
            page.reload()
            upload()
            page.get_by_role('button', name='导入 2 条提示词', exact=True).click()
            page.get_by_role('heading', name='已导入 0 条提示词', exact=True).wait_for()
            page.get_by_text('2 条重复记录已跳过。', exact=True).wait_for()
            page.goto(base + 'onboarding.html')
            page.get_by_role('button', name='新建提示词', exact=True).click()
            dialog = page.get_by_role('dialog')
            dialog.get_by_label('名称', exact=True).fill('引导页新建提示词')
            dialog.get_by_label('提示词', exact=True).fill('保留全部原文。\n第二行。')
            page.keyboard.press('Control+Shift+Enter')
            dialog.wait_for(state='hidden')
            page.get_by_text('已保存「引导页新建提示词」。在聊天框输入 $ 即可插入。', exact=True).wait_for()
            assert worker.evaluate('async()=>(await PromptFlowStore.readLibrary()).prompts.length') == 3
            assert not errors, errors
            assert not any('/assets/onboarding.js' in url or '/assets/ui-vendor.js' in url for url in requests)
            report = {'result': 'PASS', 'root': str(ROOT), 'checks': ['real MV3 onboarding loads without legacy bundles',
                'native file picker selection and unchecked README', 'actual storage persists normalized imported content',
                'reload and duplicate import', 'shared editor and keyboard save']}
            (OUT / 'extension-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            context.close()
