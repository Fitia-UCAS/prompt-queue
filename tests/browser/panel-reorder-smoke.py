"""Shift+Arrow reordering in the side panel list.

Click a prompt card or a chain card, then Shift+Up / Shift+Down: the item moves one
slot in storage, the visible numbering follows, and the order survives a reopen.
"""
from pathlib import Path
import tempfile
import atexit
from tempfile import TemporaryDirectory
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
_output = tempfile.TemporaryDirectory(prefix='prompt-queue-tests-')
atexit.register(_output.cleanup)
OUT = Path(_output.name)
OUT.mkdir(parents=True,exist_ok=True)
EDGE=next(p for p in [Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),Path(r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')] if p.exists())

SEED='''async()=>{
 const now=Date.now();
 const prompt=(id,title,order)=>({id,title,content:title+' 的正文',attachments:[],usageCount:0,createdAt:now-order,updatedAt:now-order,order});
 await chrome.storage.local.set({pcSelfTestSeeded:1});
 await PromptFlowStore.updateLibrary(library=>{
  library.prompts=[prompt('p1','甲提示词',3),prompt('p2','乙提示词',2),prompt('p3','丙提示词',1)];
  library.flows=[
   PromptFlowModel.flow({id:'c1',title:'甲流程',steps:[{text:'1'}]}),
   PromptFlowModel.flow({id:'c2',title:'乙流程',steps:[{text:'1'},{text:'2'}]}),
   PromptFlowModel.flow({id:'c3',title:'丙流程',steps:[{text:'1'}]})];
 });
}'''

READ='''async()=>{const library=await PromptFlowStore.readLibrary();return {prompts:Object.fromEntries(library.prompts.map(p=>[p.id,p])),chains:library.flows.map(item=>item.id)};}'''

report={'suite':'panel-reorder','entry':'extension side panel','environment':'loaded extension in isolated Edge, seeded lists'}
with TemporaryDirectory(prefix='pc-reorder-',dir=str(OUT)) as profile:
 with sync_playwright() as p:
  context=p.chromium.launch_persistent_context(profile,executable_path=str(EDGE),headless=True,args=[f'--disable-extensions-except={ROOT}',f'--load-extension={ROOT}'])
  try:
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker',timeout=15000)
   base='/'.join(worker.url.split('/')[:3])+'/'
   worker.evaluate(SEED)
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(base+'sidepanel.html')
   page.locator('.chain-card').nth(2).wait_for(timeout=10000)
   chain_titles=lambda: page.locator('.chain-card .chain-number').all_inner_texts()
   assert chain_titles()==['01','02','03'],chain_titles()

   selected=lambda: page.locator('[data-pc-selected="true"]').count()
   assert selected()==0,selected()
   page.locator('.chain-card').nth(2).click()
   page.wait_for_timeout(200)
   assert selected()==1,selected()
   assert page.locator('.chain-card[data-pc-selected="true"]').get_attribute('data-chain-id')=='c3'
   edge=lambda selector: page.locator(selector).first.evaluate("el=>({width:getComputedStyle(el).borderLeftWidth,color:getComputedStyle(el).borderLeftColor})")
   picked=edge('.chain-card[data-pc-selected="true"]')
   plain_card=edge('.chain-card:not([data-pc-selected])')
   assert picked['width']=='3px' and plain_card['width']=='3px',(picked,plain_card)
   assert picked['color']!=plain_card['color'],(picked,plain_card)
   page.keyboard.press('Shift+ArrowUp')
   page.wait_for_timeout(600)
   assert worker.evaluate(READ)['chains']==['c1','c3','c2'],worker.evaluate(READ)
   assert chain_titles()==['01','02','03'],chain_titles()
   moved=page.locator('.chain-card').nth(1)
   assert moved.get_attribute('data-chain-id')=='c3',moved.get_attribute('data-chain-id')

   page.keyboard.press('Shift+ArrowUp')
   page.wait_for_timeout(600)
   assert worker.evaluate(READ)['chains']==['c3','c1','c2'],worker.evaluate(READ)
   assert page.locator('.chain-card').first.get_attribute('data-chain-id')=='c3'

   prompt_titles=lambda: page.locator('.prompt-card .prompt-title').all_inner_texts()
   prompt_index=lambda: page.locator('.prompt-card .prompt-index').all_inner_texts()
   assert prompt_index()==['01','02','03'],prompt_index()
   assert prompt_titles()==['丙提示词','乙提示词','甲提示词'],prompt_titles()
   page.locator('.prompt-card').nth(1).click()
   page.keyboard.press('Shift+ArrowUp')
   page.wait_for_timeout(600)
   state=worker.evaluate(READ)['prompts']
   assert [state['p1']['order'],state['p2']['order'],state['p3']['order']]==[2,0,1],state
   assert prompt_titles()==['乙提示词','丙提示词','甲提示词'],prompt_titles()
   assert prompt_index()==['01','02','03'],prompt_index()
   assert page.locator('.prompt-card[data-pc-selected="true"] .prompt-title').inner_text()=='乙提示词'
   assert selected()==1,selected()

   page.reload()
   page.locator('.chain-card').first.wait_for(timeout=10000)
   page.wait_for_timeout(600)
   assert page.locator('.chain-card').first.get_attribute('data-chain-id')=='c3'
   assert prompt_titles()==['乙提示词','丙提示词','甲提示词'],prompt_titles()
   assert not errors,errors
   report.update({'ok':True,'checks':['Clicking a card marks it selected: 3px left edge turns accent, only one card at a time','Shift+ArrowUp moves the clicked chain one slot and keeps 01/02/03 numbering','Shift+ArrowUp moves the clicked prompt and writes explicit order fields','order survives reopening the panel']})
  finally:
   context.close()
(OUT/'panel-reorder-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
