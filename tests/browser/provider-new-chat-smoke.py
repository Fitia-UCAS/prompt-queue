from pathlib import Path
import tempfile
import atexit
from tempfile import TemporaryDirectory
import json,base64,time,argparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
_output = tempfile.TemporaryDirectory(prefix='prompt-queue-tests-')
atexit.register(_output.cleanup)
OUT = Path(_output.name)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())
HTML=(ROOT/'tests/fixtures/providers.html').read_text(encoding='utf-8')
results=[]
parser=argparse.ArgumentParser();parser.add_argument('--provider');args=parser.parse_args()
with TemporaryDirectory(prefix='pc-providers-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
  base='/'.join(worker.url.split('/')[:3])+'/'
  panel=context.new_page();panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='设置',exact=True).wait_for()
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=')
  flow_id=worker.evaluate('''async bytes=>{const file=await PromptFlowStore.saveFile(new File(['fixture markdown'],'fixture.md',{type:'text/markdown'})),image=await PromptFlowStore.saveFile(new File([new Uint8Array(bytes)],'fixture.png',{type:'image/png'}));const flow=PromptFlowModel.flow({title:'三站流程验收',steps:[{text:'第一条测试消息'},{attachment:file},{attachment:image},{text:'最后一条测试消息'}]});await PromptFlowStore.saveFlow(flow);return flow.id;}''',list(png))
  def wait_run(status,timeout=35000):
   deadline=time.monotonic()+timeout/1000
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run and run['status']==status:return run
    if run and status=='completed' and run['status']=='paused':raise AssertionError(run)
    panel.wait_for_timeout(100)
   diagnostic=worker.evaluate('''async()=>{const run=(await chrome.storage.local.get('pfRun')).pfRun;return (await chrome.scripting.executeScript({target:{tabId:run.tabId},func:()=>{const a=globalThis.PromptChainSiteAdapter,c=a?.getInputElement(),r=c?.closest('form');return{adapter:a?.id,input:!!c,send:!!a?.getSendButton(c),generating:a?.isGenerating(),form:r?.outerHTML}}}))[0].result}''')
   raise AssertionError({'run':run,'page':diagnostic})
  def start_run(button):
   previous=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun?.id')
   button.click();deadline=time.monotonic()+10
   while time.monotonic()<deadline:
    run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
    if run and run['id']!=previous:return run
    panel.wait_for_timeout(100)
   raise AssertionError('No new run created: '+panel.locator('body').inner_text())
  for provider,start in [('Gemini','https://gemini.google.com/app?dest=create'),('DeepSeek','https://chat.deepseek.com/')]:
   if args.provider and args.provider!=provider:continue
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.route('https://**/*',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML))
   page.goto(start);page.wait_for_timeout(900)
   panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='刷新连接',exact=True).click()
   try:panel.locator('.platform-status[data-pc-ready="true"]').wait_for(timeout=10000)
   except Exception:
    details=worker.evaluate('''async url=>{const [tab]=await chrome.tabs.query({url});const result={};for(const type of ['COMPAT_CHECK','PF_STATUS'])try{result[type]=await chrome.tabs.sendMessage(tab.id,{type})}catch(error){result[type]=error.message}return result}''',start)
    raise AssertionError({'provider':provider,'errors':errors,'panel':panel.locator('body').inner_text(),'diagnostic':details})
   assert page.evaluate('sent.length')==0
   panel.get_by_role('button',name='新建提示词',exact=True).last.click()
   dialog=panel.get_by_role('dialog');dialog.get_by_label('名称',exact=True).fill(provider+'独立提示词');dialog.get_by_label('提示词',exact=True).fill('独立提示词作为第一条消息');dialog.get_by_role('button',name='保存',exact=True).click()
   send=panel.get_by_role('button',name='发送 '+provider+'独立提示词',exact=True);send.click();page.wait_for_function('sent.length===1');page.wait_for_timeout(1600);send.click();page.wait_for_function('sent.length===2');page.wait_for_timeout(1600)
   page.goto(start);page.wait_for_timeout(900);page.evaluate('holdAnswers=true');panel.get_by_role('button',name='刷新连接',exact=True).click()
   start_run(panel.get_by_role('button',name='运行流程 三站流程验收',exact=True));page.wait_for_function('sent.length===1');panel.locator('#pause').click();wait_run('paused')
   page.evaluate('holdAnswers=false;completeAnswer()');panel.locator('#resume').click();wait_run('completed')
   assert page.evaluate('sent.length')==4,worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun')
   assert page.evaluate('filesSeen.map(file=>file.name)')==['fixture.md','fixture.png']
   run=worker.evaluate('async()=> (await chrome.storage.local.get("pfRun")).pfRun');assert run['targetUrl']==page.url and run['index']==4
   assert 'lastReply' not in run
   panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='编辑流程 三站流程验收',exact=True).click();panel.locator('#run').wait_for()
   assert panel.locator('#target').input_value()
   start_run(panel.locator('#run'));wait_run('completed');assert page.evaluate('sent.length')==8,page.evaluate('sent')
   assert page.evaluate('filesSeen.map(file=>file.name)')==['fixture.md','fixture.png']*2
   panel.goto(base+'sidepanel.html');panel.get_by_role('button',name='编辑流程 三站流程验收',exact=True).click();page.evaluate('interrupt=true');start_run(panel.locator('#run'));page.wait_for_function('sent.length===9');wait_run('paused');page.wait_for_timeout(1800);assert page.evaluate('sent.length')==9
   panel.locator('#stop').click();wait_run('cancelled')
   assert not errors,errors
   results.append(f'{provider}: loaded extension UI; manual prompt first/middle; list and editor run through shared persistent monitor; pause/resume without resend; Markdown and PNG uploads; reply completion and next step; unrelated navigation pauses. Local fixture.')
   print(results[-1],flush=True);page.close()
  excluded=context.new_page();excluded.route('https://claude.ai/**',lambda route:route.fulfill(status=200,content_type='text/html',body=HTML));excluded.goto('https://claude.ai/new')
  panel.goto(base+'workflow.html?flow='+flow_id);panel.locator('#run').wait_for();assert panel.locator('#target option').count()==1
  panel.locator('#run').click();panel.get_by_text('先选择目标对话',exact=True).wait_for();assert excluded.evaluate('sent.length')==0
  results.append('Claude excluded from target picker and execution; no message sent')
  context.close()
(OUT/'provider-new-chat-report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
