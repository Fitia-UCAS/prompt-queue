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

            # Reimport into a saved flow must replace its contents in place, including local files.
            page.evaluate('''async () => {
                const folder = (await PromptFlowStore.getDirectory()).handle;
                const file = await folder.getFileHandle('needed.txt', {create:true});
                const writer = await file.createWritable();
                await writer.write('old attachment');
                await writer.close();
            }''')
            page.goto(base + 'workflow.html?standalone=1&flow=' + saved['id'])
            page.wait_for_function('() => editor?.steps[1]?.attachments.length === 1')
            page.locator('#flow-title').fill('我的长期训练')
            page.evaluate("async () => { editor.title = '我的长期训练'; editor.description = '保留流程说明'; await persist(); }")
            original = page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows[0]')
            assert page.get_by_role('button', name='导入聊天', exact=True).is_visible()
            page.evaluate('''async () => {
                const file = await sourceDirectory.handle.getFileHandle('needed.txt');
                const writer = await file.createWritable();
                await writer.write('updated attachment');
                await writer.close();
            }''')
            updated_chat = CHAT.replace('准备读取。', '读取最新技能。') + '\n\n---\n\n## User 3\n\n回到训练04补临写。'

            def import_chat(text):
                with page.expect_file_chooser() as chooser:
                    page.get_by_role('button', name='导入聊天', exact=True).click()
                chooser.value.set_files({'name':'chat.md','mimeType':'text/markdown','buffer':text.encode()})
                try:
                    page.get_by_text('已更新当前流程，共 3 步', exact=True).wait_for(timeout=6000)
                except Exception as error:
                    raise AssertionError(page.locator('#notice').inner_text()) from error
                return page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows')

            flows = import_chat(updated_chat)
            assert len(flows) == 1, flows
            updated = flows[0]
            assert updated['id'] == original['id'] and updated['createdAt'] == original['createdAt']
            assert updated['title'] == original['title'] and updated['description'] == original['description']
            assert [step['text'] for step in updated['steps']] == ['读取最新技能。', '读取本文件。', '回到训练04补临写。']
            assert not any(step['missingAttachments'] for step in updated['steps'])
            content = page.evaluate('async id => new TextDecoder().decode((await PromptFlowStore.getFile(id)).bytes)', updated['steps'][1]['attachment']['id'])
            assert content == 'updated attachment', content
            flows = import_chat(updated_chat)
            assert len(flows) == 1 and flows[0]['id'] == original['id'] and len(flows[0]['steps']) == 3

            # A previously selected directory can lose permission. Cached content must be identified.
            page.evaluate("() => { FileSystemDirectoryHandle.prototype.queryPermission = async () => 'prompt'; }")
            page.locator('#chat-file').set_input_files({'name':'chat.md','mimeType':'text/markdown','buffer':updated_chat.encode()})
            page.locator('#notice').get_by_text('1 个附件来自缓存', exact=False).wait_for()
            diagnostic = page.evaluate("async () => (await chrome.storage.local.get('pqImportDiagnostic')).pqImportDiagnostic")
            assert diagnostic['status'] == 'used-cache' and diagnostic['cached'] == 1, diagnostic
            page.reload()
            page.wait_for_function('() => editor?.steps.length === 3')

            # Invalid input and active execution must not destroy the saved flow.
            before = page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows')
            page.locator('#chat-file').set_input_files({'name':'invalid.md','mimeType':'text/markdown','buffer':b'not a chat export'})
            page.wait_for_function("async () => (await chrome.storage.local.get('pqImportDiagnostic')).pqImportDiagnostic.status === 'error'")
            assert page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows') == before
            page.evaluate("() => { runState = {status:'paused', flow:{id:editor.id}}; displayEditor(); }")
            assert page.get_by_role('button', name='导入聊天', exact=True).is_disabled()
            page.locator('#chat-file').set_input_files({'name':'chat.md','mimeType':'text/markdown','buffer':updated_chat.encode()})
            page.get_by_text('请先停止流程再导入聊天', exact=True).wait_for()
            assert page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows') == before
            page.evaluate('() => { runState = null; displayEditor(); }')

            # The same source name must not target an old editor after returning to the library.
            page.locator('#editor-view [data-action="back"]').click()
            page.locator('#library-view').wait_for(state='visible')
            before_library = page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows')
            page.locator('#chat-file').set_input_files({'name':'chat.md','mimeType':'text/markdown','buffer':updated_chat.encode()})
            page.get_by_text('已导入 3 步', exact=True).wait_for()
            flows = page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows')
            assert len(flows) == 2, flows
            assert next(flow for flow in flows if flow['id'] == original['id']) == before_library[0]

            # A populated creation draft is replaced rather than prepended to the import.
            page.goto(base + 'workflow.html?standalone=1&new=1')
            page.locator('#flow-title').wait_for(state='visible')
            page.evaluate("async () => { editor.title = '当前草稿'; editor.steps[0].text = '旧草稿'; await persist(); }")
            flows = import_chat(updated_chat)
            draft = next(flow for flow in flows if flow['title'] == '当前草稿')
            assert len(draft['steps']) == 3 and all(step['text'] != '旧草稿' for step in draft['steps'])

            # Late matches still update the imported flow when the user opens another one.
            other = next(flow for flow in flows if flow['id'] == original['id'])
            page.evaluate('''() => {
                const realMatch = PromptFlowFileMatch.match;
                PromptFlowFileMatch.match = async (...args) => {
                    await new Promise(resolve => { window.finishMatch = resolve; });
                    return realMatch(...args);
                };
            }''')
            page.locator('#chat-file').set_input_files({'name':'chat.md','mimeType':'text/markdown','buffer':updated_chat.encode()})
            page.wait_for_function('() => typeof window.finishMatch === "function"')
            page.locator('#editor-view [data-action="back"]').click()
            page.locator(f'[data-flow="{other["id"]}"]').click()
            page.locator('#flow-title').wait_for(state='visible')
            assert page.locator('#flow-title').input_value() == other['title']
            page.evaluate('window.finishMatch()')
            page.get_by_text('「当前草稿」已导入 3 步', exact=True).wait_for()
            flows = page.evaluate('async () => (await PromptFlowStore.readLibrary()).flows')
            assert next(flow for flow in flows if flow['id'] == other['id']) == other
            imported = next(flow for flow in flows if flow['id'] == draft['id'])
            assert imported['steps'][1]['attachment']['name'] == 'needed.txt', imported
            diagnostic = page.evaluate("async () => (await chrome.storage.local.get('pqImportDiagnostic')).pqImportDiagnostic")
            assert diagnostic['status'] == 'completed' and diagnostic['flowId'] == draft['id'], diagnostic
            assert not errors, errors
            print(json.dumps({'result':'PASS','checks':['steps saved and displayed before directory matching','stalled directory has durable stage and elapsed-time diagnostics','missing attachment stays explicit after matching','reimport replaces steps and rereads attachments without duplicating the flow','flow identity, name, description and creation time survive updates','cached attachments are reported as cached in the editor and diagnostics','invalid input and active execution leave the saved flow intact','library imports do not overwrite a previously opened flow','creation drafts are replaced rather than appended','a late match while switching editors updates its original flow']}, ensure_ascii=False))
        finally:
            context.close()
