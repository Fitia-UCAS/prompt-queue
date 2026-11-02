from pathlib import Path
import tempfile
import atexit
import json
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
_output = tempfile.TemporaryDirectory(prefix='prompt-queue-tests-')
atexit.register(_output.cleanup)
OUT = Path(_output.name)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
HTML=(ROOT/'tests/fixtures/messages.html').read_text(encoding='utf-8')
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=str(EDGE),headless=True)
 for mode in ['bare','bare_user','h2','ids','actions','shadow','project','project_split','project_v2','project_cn','attribute','rich','folded','attachment','image','busy','turns','pair']:
  page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('https://chatgpt.com/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
  page.goto('https://chatgpt.com/c/message-reader')
  page.evaluate('(mode)=>window.mode=mode',mode)
  if mode.startswith('bare'):
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div class="prose"><div><div data-user-message-bubble>历史问题</div></div><div><div class="markdown prose">历史回答</div></div></div>';if(mode==='bare_user')document.querySelector('[data-user-message-bubble]').innerHTML='<div class="markdown prose">历史问题</div>'}''')
  if mode=='h2':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<section><h2 class="sr-only">你说：</h2><div data-user-message-bubble>历史问题</div></section><section><h2 class="sr-only">ChatGPT 说：</h2><div>历史回答</div></section>'}''')
  if mode=='ids':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div data-message-id="old-user"><div data-user-message-bubble>历史问题</div></div><div data-message-id="old-answer"><div>历史回答</div></div>'}''')
  if mode=='actions':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<section><div data-user-message-bubble>历史问题</div></section><section><div>历史回答</div><div><button data-testid="copy-turn-action-button">复制</button><button data-testid="good-response-turn-action-button">好评</button></div></section>'}''')
  if mode=='turns':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div data-turn-key="t1"><div data-conversation-role="user"><div data-user-message-bubble>历史问题</div></div></div><div data-turn-key="t2"><div data-conversation-role="assistant"><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">历史回答</p></div></div></div></div>'}''')
  if mode=='pair':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div data-turn-key="t1"><div data-conversation-role="user"><div data-user-message-bubble>历史问题</div></div><div data-conversation-role="assistant"><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">历史回答</p></div></div></div></div>'}''')
  if mode=='project':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div data-turn-key="t1"><div class="group"><h4 data-conversation-role="user">你说：</h4><div data-user-message-bubble>历史问题</div></div><div class="group"><h4 data-conversation-role="assistant">ChatGPT 说：</h4><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">历史回答</p></div></div></div></div>'}''')
  if mode=='project_split':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div data-turn-key="t1"><div class="group"><div data-user-message-bubble>历史问题</div></div><div class="group"><h4 data-conversation-role="assistant">ChatGPT 说：</h4></div><div class="group"><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">历史回答</p></div></div></div></div>'}''')
  if mode in ['project_v2','project_cn']:
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div data-turn-key="t1"><div><h4 class="sr-only" data-conversation-role="user">你说：<span>You</span></h4><div class="bg-user-message"><div class="group/user-message"><div class="w-full"><div class="text-size-chat">历史问题</div></div></div></div><h4 class="sr-only" data-conversation-role="assistant">ChatGPT 说：<span>ChatGPT</span></h4><div class="MarkdownRoot-rZKhxa"><div class="DilRenderer-tB76Jj"><p class="TextBase-qM5iDq">历史回答</p></div></div></div></div>'}''')
  if mode=='project_cn':
   page.evaluate("""() => {
    const duplicate=document.querySelector('h4[data-conversation-role="user"] span');
    duplicate.textContent='你';duplicate.setAttribute('aria-hidden','true');
   }""")
  if mode=='shadow':
   page.evaluate('''()=>{document.querySelector('main').innerHTML='<div id="conversation-shadow"></div>';document.querySelector('#conversation-shadow').attachShadow({mode:'open'}).innerHTML='<section><div data-user-message-bubble>历史问题</div></section><section><div class="markdown prose">历史回答</div></section>'}''')
  for file in ['vendor/marked/marked.js','shared/platforms.js','shared/model.js','content/message-reader.js','content/supervisor-engine.js','content/bridge.js']:page.add_script_tag(path=str(ROOT/file))
  if mode=='busy':
   page.evaluate('''()=>{const busy=document.createElement('div');busy.setAttribute('role','status');busy.setAttribute('aria-busy','true');busy.setAttribute('data-is-streaming','true');busy.textContent='加载其他组件';document.querySelector('main').append(busy)}''')
   assert not page.evaluate('PromptFlowSupervisor.snapshot().generating')
   page.evaluate('''()=>{const stop=document.createElement('button');stop.id='real-stop';stop.setAttribute('data-testid','fruitjuice-stop-button');stop.textContent='停止';document.querySelector('form').append(stop)}''')
   assert page.evaluate('PromptFlowSupervisor.snapshot().generating')
   page.evaluate("document.querySelector('#real-stop').remove()")
  before=page.evaluate('PromptFlowSupervisor.snapshot()')
  assert before['lastRole']=='assistant' and (before['lastUser'] or {}).get('text')=='历史问题',(mode,before)
  assert before['reader']['users']==1 and before['reader']['assistants']==1,before
  if mode.startswith('project'):assert before['assistant']['text']=='历史回答',before
  text='' if mode=='attachment' else '# 文件要求\n\n1. **完整阅读**，不要遗漏。\n2. 保留 foo bar，保持ＡＢＣ全角原文。'
  if mode=='folded':text='请从头到尾完整阅读文件，并如实报告实际阅读范围。'*15
  operation={'id':mode,'runId':'reader-run','url':page.url,'text':text,'baselineUserKey':before['lastUser']['key'],'baselineAssistantKey':before['assistant']['key'],'baselineMessages':before['messages']}
  if mode=='attachment':operation['attachment']={'id':'file','name':'原文.md','size':3,'mimeType':'text/markdown'}
  if mode=='image':operation['attachment']={'id':'image','name':'test.png','size':3,'mimeType':'image/png'}
  result=page.evaluate('(operation)=>bridgeMessage({type:"PF_SEND",operation})',operation)
  assert result['ok'],(mode,result)
  assert page.evaluate('clicks')==1
  snap=result['snapshot'];assert snap['lastRole']=='assistant'
  assert '本轮文件已收到' in snap['assistant']['text'] and '复制' not in snap['assistant']['text']
  # Only a leading speaker label is UI; a quote like "ChatGPT 说：…" inside the answer is real content.
  assert not re.match(r'^(你说|ChatGPT\s*说|You\s+said|ChatGPT\s+said)\s*[：:]', snap['assistant']['text']),snap['assistant']
  if mode=='attachment':assert '原文.md' in snap['lastUser']['filesText']
  if mode=='image':
   assert snap['lastUser']['imageCount']==1,snap
   assert 'test.png' not in snap['lastUser']['filesText']
   operation['attachmentUploaded']=True
  if mode=='folded':
   assert snap['lastUser']['folded']
   page.get_by_role('button',name='展开',exact=True).click()
   snap=page.evaluate('PromptFlowSupervisor.snapshot()')
   assert not snap['lastUser']['folded']
  decision=page.evaluate('''({snapshot,operation,key})=>{
   const flow=PromptFlowModel.flow({delaySeconds:0,steps:[{text:'test'}]});
   return PromptFlowModel.replyDecision({flow,index:0,repeated:0,targetUrl:location.href,sentUserKey:key,beforeAssistantKey:operation.baselineAssistantKey,delivery:{...operation,attemptedAt:1},quietSignature:snapshot.assistant.signature,quietSince:1},snapshot,3000);
  }''',{'snapshot':snap,'operation':operation,'key':result['snapshot']['lastUser']['key']})
  assert decision['type']=='next',(mode,decision,snap)
  assert not errors,errors
  results.append(mode+': one send, confirmed fresh user, correct new reply, stable completion')
  page.close()
 browser.close()
(OUT/'message-reader-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
