"""Project-page speaker labels must not replace message bodies.

Run the real background queue with the panel closed, then resume an already
answered step to verify that it is not sent twice.
"""
from pathlib import Path
import tempfile
import atexit
from tempfile import TemporaryDirectory
import json,time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
_output = tempfile.TemporaryDirectory(prefix='prompt-queue-tests-')
atexit.register(_output.cleanup)
OUT = Path(_output.name)
OUT.mkdir(parents=True,exist_ok=True)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())

HTML='''<!doctype html><meta charset="utf-8"><style>#prompt-textarea{min-height:60px;border:1px solid}button{min-width:30px;min-height:25px}</style>
<main><div id="thread"><div data-turn-key="turn-0"><div><h4 class="sr-only" data-conversation-role="user">你说：<span aria-hidden="true">你</span></h4><div class="bg-user-message"><div class="group/user-message"><div class="w-full"><div class="text-size-chat">开场问题</div></div></div></div><h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：<span>ChatGPT</span></h4><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">开场回答</p></div></div></div></div></div></main>
<form data-chatgpt-composer onsubmit="return false"><div id="prompt-textarea" contenteditable="true" role="textbox"></div><button type="button" data-testid="send-button">发送</button></form>
<script>
window.sent=[];
const thread=document.querySelector('#thread'),editor=document.querySelector('#prompt-textarea');
function turn(index,text){
 const node=document.createElement('div');node.setAttribute('data-turn-key','turn-'+index);
 node.innerHTML='<div><h4 class="sr-only" data-conversation-role="user">你说：<span aria-hidden="true">你</span></h4>'
  +'<div class="bg-user-message"><div class="group/user-message"><div class="w-full"><div class="text-size-chat"></div></div></div></div>'
  +'<h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：<span>ChatGPT</span></h4>'
  +'<div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">回答 '+index+'：已收到第 '+index+' 步。</p></div></div></div>';
 node.querySelector('.text-size-chat').textContent=text;
 thread.append(node);
}
document.querySelector('[data-testid="send-button"]').onclick=()=>{
 const text=editor.innerText.trim();if(!text)return;
 sent.push(text);editor.textContent='';turn(sent.length,text);
};
</script>'''

results=[]
with TemporaryDirectory(prefix='pc-chatgpt-project-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000)
   base='/'.join(worker.url.split('/')[:3])+'/'
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
   page.goto('https://chatgpt.com/c/project-fixture')
   page.wait_for_timeout(800)
   flow=worker.evaluate('''async()=>{const flow=PromptFlowModel.flow({title:'项目页读取',steps:[{text:'第一条测试'},{text:'第二条测试'}]});await PromptFlowStore.saveFlow(flow);return flow;}''')
   panel=context.new_page();panel.goto(base+'workflow.html?flow='+flow['id'])
   panel.locator('#target option').nth(1).wait_for(state='attached')
   panel.locator('#target').select_option(index=1)
   panel.locator('#run').click()
   panel.wait_for_function("async()=> (await chrome.storage.local.get('pfRun')).pfRun?.status==='running'")
   panel.close()
   deadline=time.monotonic()+45
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run['status']=='completed':break
    if run['status']!='running':raise AssertionError(run)
    page.wait_for_timeout(100)
   assert run['status']=='completed',run
   assert page.evaluate('sent')==['第一条测试','第二条测试'],page.evaluate('sent')
   snapshot=worker.evaluate('''async()=>{const [tab]=await chrome.tabs.query({url:'https://chatgpt.com/c/project-fixture'});return (await chrome.tabs.sendMessage(tab.id,{type:'PF_STATUS'})).snapshot}''')
   reader=snapshot['reader']
   assert reader['users']==3 and reader['assistants']==3,reader
   assert reader['version']==11,reader
   assert snapshot['lastUser']['text']=='第二条测试',snapshot['lastUser']
   assert snapshot['assistant']['text']=='回答 2：已收到第 2 步。',snapshot['assistant']
   worker.evaluate('''async () => {
    const [tab]=await chrome.tabs.query({url:'https://chatgpt.com/c/project-fixture'});
    const snapshot=(await chrome.tabs.sendMessage(tab.id,{type:'PF_STATUS'})).snapshot;
    const flow=PromptFlowModel.flow({title:'误暂停后恢复',steps:[{text:'第二条测试'},{text:'恢复后继续'}]});
    const before=snapshot.messages.slice(0,-2),now=Date.now();
    await chrome.storage.local.set({pfRun:{id:'recovered-label',flow,tabId:tab.id,targetUrl:tab.url,
     status:'paused',phase:'waiting',index:0,repeated:0,startedAt:now-45000,sentAt:now-30000,
     sentUserKey:snapshot.lastUser.key,beforeAssistantKey:before.filter(item=>item.role==='assistant').at(-1)?.key||'',
     delivery:{url:tab.url,text:'第二条测试',baselineMessages:before,
      baselineUserKey:before.filter(item=>item.role==='user').at(-1)?.key||'',
      baselineAssistantKey:before.filter(item=>item.role==='assistant').at(-1)?.key||'',attemptedAt:now-30000},
     reason:'对话中出现了其他用户消息，请核对后恢复',logs:[]}});
   }''')
   panel=context.new_page();panel.goto(base+'workflow.html?monitor=1')
   assert panel.locator('#reply-console,#last-reply').count()==0
   panel.locator('#monitor-title').get_by_text('误暂停后恢复',exact=True).wait_for()
   panel.locator('#resume').click()
   panel.locator('#pause').wait_for(state='visible')
   deadline=time.monotonic()+45
   while time.monotonic()<deadline:
    recovered=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if recovered['status']=='completed':break
    if recovered['status']!='running':raise AssertionError(recovered)
    panel.wait_for_timeout(100)
   assert recovered['status']=='completed',recovered
   assert page.evaluate('sent')==['第一条测试','第二条测试','恢复后继续'],page.evaluate('sent')
   assert not errors,errors
   results.append('project DOM: real message bodies are read; background completes with the panel closed and resumes without resending')
   report={'version':worker.evaluate('chrome.runtime.getManifest().version'),'environment':'loaded extension in isolated Edge, synthetic project-page ChatGPT DOM','checks':['Chinese duplicated speaker label 你说：你 is excluded; the actual prompt body is read','Background reads the current answer with no reply preview','Turn keys keep user and assistant distinct','Two text steps send once each and complete with the panel closed','Resuming an already answered step continues without resending it']}
   (OUT/'chatgpt-project-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False,indent=2))
  finally:context.close()
