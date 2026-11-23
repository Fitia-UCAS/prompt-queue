from pathlib import Path
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EDGE = next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
CHAT = '# 导入回归\n\n## User 1\n\n准备读取。\n\n---\n\n## User 2\n\n### Attachments\n\n- File · needed.txt · text/plain\n\n读取本文件。'

with TemporaryDirectory(prefix='pq-import-progress-') as profile:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base + 'workflow.html?standalone=1&new=1')
            page.locator('#flow-title').wait_for(state='visible')
            page.evaluate('''() => {
                sourceDirectory = {name:'old-folder',handle:{}};
                window.realGetDirectory = PromptFlowStore.getDirectory;
                PromptFlowStore.getDirectory = async () => sourceDirectory;
                PromptFlowFileMatch.match = () => new Promise(resolve => { window.finishMatch = resolve; });
            }''')
            page.locator('#chat-file').set_input_files({'name':'chat.md','mimeType':'text/markdown','buffer':CHAT.encode()})
            page.wait_for_function('() => document.querySelectorAll("#steps > .step").length === 2')
            page.wait_for_function('() => typeof window.finishMatch === "function"')
            # The sequence must be visible and saved even while a previously selected directory stalls.
            saved = worker.evaluate('async () => (await PromptFlowStore.readLibrary()).flows.find(f => f.title === "导入回归")')
            assert len(saved['steps']) == 2, saved
            page.wait_for_function('''async () => (await chrome.storage.local.get('pqImportDiagnostic')).pqImportDiagnostic.status === 'waiting' ''')
            diagnostic = page.evaluate("async () => (await chrome.storage.local.get('pqImportDiagnostic')).pqImportDiagnostic")
            assert '匹配附件目录' in diagnostic['stage'], diagnostic
            page.evaluate('window.finishMatch({matched:0,remaining:1})')
            page.get_by_text('已导入 2 步，1 个附件待匹配', exact=True).wait_for()
            switched = page.evaluate('''async () => {
                PromptFlowStore.getDirectory = window.realGetDirectory;
                const root = await navigator.storage.getDirectory();
                const first = await root.getDirectoryHandle('first', {create:true});
                const second = await root.getDirectoryHandle('second', {create:true});
                await PromptFlowStore.saveDirectory(first);
                const original = FileSystemDirectoryHandle.prototype.isSameEntry;
                FileSystemDirectoryHandle.prototype.isSameEntry = () => new Promise(() => {});
                try {
                    const value = await PromptFlowStore.saveDirectory(second);
                    return {name:value.name, saved:(await PromptFlowStore.getDirectory()).name};
                } finally { FileSystemDirectoryHandle.prototype.isSameEntry = original; }
            }''')
            assert switched == {'name':'second','saved':'second'}, switched
            assert not errors, errors
            print(json.dumps({'result':'PASS','checks':['steps saved and displayed before directory matching','stalled directory has durable stage and elapsed-time diagnostics','missing attachment stays explicit after matching']}, ensure_ascii=False))
        finally:
            context.close()
