const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function loadRpc() {
  const calls = [];
  const context = vm.createContext({calls, response:{ok:true,result:'result'}, location:{protocol:'chrome-extension:',href:''}, chrome:{
    runtime:{async sendMessage(message){calls.push(['runtime',message]);return context.response;},getURL:name=>'chrome-extension://test/'+name},
    tabs:{async sendMessage(id,message){calls.push(['tab',id,message]);return context.response;}}
  }});
  vm.runInContext(read('shared/rpc.js').replace(/export /g,'')+';globalThis.api={callBackground,callTab,createMessageListener};',context);
  return context;
}

test('后台与标签页 RPC 保留信封、流程转发范围和错误信息', async () => {
  const ctx=loadRpc(), {api,calls}=ctx;
  assert.equal(await api.callBackground('GET_SETTINGS',{key:1}),'result');
  assert.deepEqual(plain(calls.pop()),['runtime',{type:'GET_SETTINGS',payload:{key:1}}]);
  assert.equal(await api.callTab(4,'INSERT',{text:'原文'}),'result');
  assert.deepEqual(plain(calls.pop()),['tab',4,{type:'INSERT',payload:{text:'原文'}}]);
  for (const expectedHref of ['https://chatgpt.com/c/a','https://chat.openai.com/c/a','https://gemini.google.com/app/a','https://chat.deepseek.com/a/chat/s/a']) {
    assert.deepEqual(plain(await api.callTab(4,'RUN_CHAIN',{expectedHref})),{ok:true});
    assert.deepEqual(plain(calls.pop()),['runtime',{type:'PC_RUN_NATIVE',tabId:4,payload:{expectedHref}}]);
    assert.equal(ctx.location.href,'chrome-extension://test/workflow.html?monitor=1');
  }
  await api.callTab(4,'RUN_CHAIN',{expectedHref:'https://chatgpt.com.evil/c/a'});
  assert.equal(calls.pop()[0],'tab');
  ctx.location.protocol='https:';
  await api.callTab(4,'RUN_CHAIN',{expectedHref:'https://chatgpt.com/c/a'});
  assert.equal(calls.pop()[0],'tab');
  ctx.response=undefined;
  await assert.rejects(api.callBackground('TEST'),/扩展没有响应，请重新加载后重试。/);
  ctx.response={ok:false,error:'原错误'};
  await assert.rejects(api.callBackground('TEST'),/原错误/);
  vm.runInContext("chrome.runtime.sendMessage=async()=>{throw new Error('Extension context invalidated.');}",ctx);
  await assert.rejects(api.callBackground('TEST'),/PromptQueue 已更新，请刷新页面。/);
});

test('消息监听只接受明确注册的操作并传回异步结果或错误', async () => {
  const {api}=loadRpc();
  const handler=api.createMessageListener({KNOWN:async input=>input,FAIL:async()=>{throw 'literal';}});
  for (const message of [null,{}, {type:1},{type:'toString'},{type:'UNKNOWN'}]) assert.equal(handler(message,{},()=>assert.fail()),undefined);
  const invoke=message=>new Promise(resolve=>assert.equal(handler(message,{},resolve),true));
  assert.deepEqual(plain(await invoke({type:'KNOWN',payload:{a:1}})),{ok:true,result:{a:1}});
  assert.deepEqual(plain(await invoke({type:'FAIL'})),{ok:false,error:'literal'});
});

test('界面 API 按当前资料库接口处理搜索、用量、编辑与附件', async () => {
  const calls=[],listeners=[],timers=[];
  const store=Object.fromEntries(['getSettings','saveSettings','searchPrompts','searchFlows','savePrompt','updatePrompt','deletePrompt','logUsage','getAttachmentMeta','readAttachmentChunk'].map(name=>[name,async(...args)=>{
    calls.push([name,...args]);
    if(name==='searchPrompts')return[{id:'p',title:'提示词',content:'原文',attachments:[],private:1}];
    if(name==='searchFlows')return[{id:'f',title:'流程',steps:[{text:'原文'}],private:1}];
    if(name==='getAttachmentMeta')return args[0]==='missing'?null:{id:args[0]};
    if(name==='readAttachmentChunk')return args[0]==='missing'?null:{chunkBase64:'YWJj',done:true};
    return {value:name};
  }]));
  const context=vm.createContext({store,Date:{now:()=>1700000000000},Math:Object.assign(Object.create(Math),{random:()=>0.25}),
    setTimeout:(fn,delay)=>timers.push([fn,delay]),createMessageListener:handlers=>handlers,
    chrome:{storage:{local:{set:(patch,callback)=>{calls.push(['storage',patch]);callback();}}},action:{openPopup:()=>Promise.resolve()},
      runtime:{onMessage:{addListener:listener=>listeners.push(listener)},sendMessage:message=>calls.push(['message',message])}}
  });
  const source=read('background/ui-api.js').replace(/^import[\s\S]*?from '..\/shared\/rpc.js';/,'const {'+Object.keys(store).join(',')+'}=store;').replace('export const handlers','const handlers');
  vm.runInContext(source,context);
  const api=listeners[0];
  assert.deepEqual(plain(await api.PROMPT_SEARCH({query:'提示词'})),[{id:'p',title:'提示词',content:'原文',attachments:[]}]);
  assert.deepEqual(plain(await api.PROMPT_SEARCH({query:'提示词',limit:-1})),[]);
  assert.deepEqual(plain(await api.CHAIN_SEARCH({query:'流程',limit:1})),[{id:'f',title:'流程',steps:[{text:'原文'}]}]);
  assert.deepEqual(plain(await api.GET_SETTINGS()),{value:'getSettings'});
  await api.SAVE_SETTINGS({settings:{custom:true}});
  const {id}=await api.PROMPT_CREATE({title:'名称',content:'正文'});
  assert.ok(id);
  await api.PROMPT_UPDATE({id,title:'名称',content:'更新原文',attachments:[]});
  await api.PROMPT_DELETE({id});
  await api.LOG_USAGE({promptId:id,platform:'chatgpt'});
  assert.deepEqual(plain(calls.find(call=>call[0]==='logUsage')),['logUsage',{timestamp:1700000000000,platform:'chatgpt',promptId:id}]);
  await api.OPEN_PROMPT_EDITOR({promptId:id});
  assert.deepEqual(plain(calls.find(call=>call[0]==='storage')),['storage',{pqPendingAction:{type:'OPEN_EDIT_PROMPT',promptId:id}}]);
  assert.equal(timers[0][1],600);timers[0][0]();
  assert.deepEqual(plain(await api.ATTACHMENT_GET_META({ids:['a','missing']})),{attachments:[{id:'a'}],missingIds:['missing']});
  assert.deepEqual(plain(await api.ATTACHMENT_GET_CHUNK({id:'a',offset:0})),{chunkBase64:'YWJj',done:true});
  await assert.rejects(api.ATTACHMENT_GET_CHUNK({id:'missing',offset:0}),/ATTACHMENT_NOT_FOUND/);
});
