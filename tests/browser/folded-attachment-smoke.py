from pathlib import Path
from tempfile import TemporaryDirectory
import json
import time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
EDGE = next(path for path in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'), Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if path.exists())
URL = 'https://chatgpt.com/c/folded-fixture'
NAME = '02-anadiplosis-information-linkage.md'
HTML = '''<!doctype html><meta charset="utf-8"><main></main>
<form onsubmit="return false"><textarea id="mobile-composer-prompt"></textarea>
<button type="button" aria-label="发送消息">发送</button></form><script>
window.sendCount=0;
window.turn=(text,index,filename='')=>{
 const main=document.querySelector('main'),user=document.createElement('article'),answer=document.createElement('article');
 user.dataset.testid='conversation-turn-'+(index*2-1);
 user.innerHTML='<div data-message-author-role="user" data-message-id="u'+index+'"><div class="whitespace-pre-wrap"></div></div>';
 user.querySelector('.whitespace-pre-wrap').textContent=text;
 if(filename){const file=document.createElement('span');file.dataset.testid='attachment-name';file.textContent=filename;user.firstElementChild.append(file);}
 answer.dataset.testid='conversation-turn-'+index*2;
 answer.innerHTML='<div data-message-author-role="assistant" data-message-id="a'+index+'"><div class="markdown prose">已经完整阅读。</div></div>';
 main.append(user,answer);return [user,answer];
};
turn('开场消息',1);turn('继续准备',2);
window.prepareReceipt=name=>{window.receipt=turn('',3,name);receipt.forEach(node=>node.remove());};
window.revealReceipt=()=>document.querySelector('main').append(...receipt);
document.querySelector('form button').onclick=()=>{
 sendCount++;const input=document.querySelector('textarea');turn(input.value,4);input.value='';
};
</script>'''

with TemporaryDirectory(prefix='prompt-queue-folded-') as profile:
    with sync_playwright() as playwright:
        context = playwright.chromium.launch_persistent_context(profile, executable_path=str(EDGE), headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}'])
        try:
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
            base = '/'.join(worker.url.split('/')[:3]) + '/'
            target = context.new_page()
            target.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html', body=HTML))
            target.goto(URL)
            requests = []
            target.on('request', lambda request: requests.append(request.url))
            panel = context.new_page()
            panel.goto(base + 'workflow.html')
            panel.wait_for_function('''async () => {
              const [tab]=await chrome.tabs.query({url:'https://chatgpt.com/c/folded-fixture'});
              try{return !!(await chrome.tabs.sendMessage(tab.id,{type:'PF_STATUS'}))?.ok;}catch{return false;}
            }''')
            panel.evaluate('''async ({url,name}) => {
              const [tab]=await chrome.tabs.query({url}), snapshot=(await chrome.tabs.sendMessage(tab.id,{type:'PF_STATUS'})).snapshot;
              const attachment=await PromptFlowStore.saveFile(new File(['abc'],name,{type:'text/markdown'})), now=Date.now();
              const pending={id:'pending-file',runId:'folded-run',url,text:'',attachment,attachments:[attachment],attachmentUploaded:true,
                attemptedAt:now-45000,createdAt:now-45000,baselineUserKey:snapshot.lastUser.key,baselineAssistantKey:snapshot.assistant.key,
                baselineMessages:snapshot.messages,documentId:'previous-document'};
              const flow=PromptFlowModel.flow({title:'已发送附件恢复测试',steps:[{text:'开场消息'},{attachment},{text:'下一步'}]});
              await chrome.storage.local.set({pfRun:{id:'folded-run',tabId:tab.id,targetUrl:url,status:'paused',phase:'sending',index:1,
                repeated:0,reason:'尚未匹配本步内容',flow,pending,sentUserKey:snapshot.lastUser.key,beforeAssistantKey:snapshot.assistant.key,logs:[]}});
            }''', {'url': URL, 'name': NAME})
            target.evaluate('name=>prepareReceipt(name)', NAME)
            refused = panel.evaluate('async () => chrome.runtime.sendMessage({type:"PF_RESUME"})')
            assert not refused['ok'], refused
            assert 'RECEIPT_UNCONFIRMED' in refused['error'] or 'RESEND_CONFIRMATION_REQUIRED' in refused['error'], refused
            assert target.evaluate('sendCount') == 0
            target.evaluate('revealReceipt()')
            resumed = panel.evaluate('async () => chrome.runtime.sendMessage({type:"PF_RESUME"})')
            assert resumed['ok'], resumed
            target.evaluate('receipt[0].style.maxHeight="1px";receipt[0].style.overflow="hidden"')
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                run = worker.evaluate('async () => (await chrome.storage.local.get("pfRun")).pfRun')
                if run['status'] == 'completed':
                    break
                assert run['status'] != 'paused', run
                panel.wait_for_timeout(100)
            assert run['status'] == 'completed' and run['index'] == 3, run
            assert target.evaluate('sendCount') == 1
            assert target.locator('[data-message-author-role="user"]').last.inner_text() == '下一步'
            assert not any('/backend-api/' in url or '/api/auth/session' in url for url in requests), requests
            print(json.dumps({'result': 'PASS', 'checks': ['absent receipt pauses without resending',
                'available DOM receipt resumes; collapsing it does not resend', 'no backend conversation request']}, ensure_ascii=False))
        finally:
            context.close()
