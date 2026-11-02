const {test} = require('node:test');
const assert = require('node:assert/strict');
require('../../shared/model.js');
const C = require('../../shared/chat-import.js');
const examples=require('../fixtures/chat-exports.json');
for(const tier of ['minimal','full','detailed'])test(`聊天导出 ${tier} 格式导入后保持用户原文与轮次`,()=>{
  const markdown=examples[tier];
  const parsed=C.parse(markdown);
  assert.equal(parsed.tier,tier);assert.equal(parsed.turns.length,2);assert.equal(parsed.steps.length,2);
  assert.equal(parsed.steps[0].text,'第一条\n\n```markdown\n---\n\n## User 99\n```');
  assert.equal(parsed.steps[1].text,'继续写');assert.equal(parsed.steps[1].missingAttachments.length,2);
  assert.equal(parsed.steps[0].importAttachment.name,'设定.md');
  assert.ok(parsed.steps[0].referenceReply.includes('这是一段助手回复'));
  assert.ok(!parsed.steps.some(s=>s.text.includes('这是一段助手回复')));
  if(tier==='minimal')assert.equal(parsed.steps[0].importAttachment.text,null);
  else assert.equal(parsed.steps[0].importAttachment.text,'# 人设\n## User 98\n原文');
});
test('详尽资源附录恢复原文件，并验证大小与 SHA256',async()=>{
  const bytes=new Uint8Array([0,1,2,255]),markdown=examples.resources;
  const parsed=C.parse(markdown),saved=[];
  const flow=await C.materialize(parsed,{saveFile:async file=>{saved.push(new Uint8Array(await file.arrayBuffer()));return{id:'saved',name:file.name,size:file.size,mimeType:file.type};}});
  assert.deepEqual(saved[0],bytes);assert.equal(flow.steps[0].missingAttachment,null);
  parsed.resources.get('R1').checksum.hex='bad';
  await assert.rejects(()=>C.materialize(parsed,{saveFile(){throw Error('should not save');}}),/校验和/);
});
test('用户粘贴的普通二级标题不拆轮；原附件链接仅作为名称处理',()=>{
  const parsed=C.parse('# 对话\n\n---\n\n## User 1\n\n- File: [设定\\[一\\].md](<https://example.com/private>)\n\n请阅读\n## User 88\n这里仍是原文\n\n---\n\n## ChatGPT 1\n\n好了');
  assert.equal(parsed.turns.length,1);assert.equal(parsed.steps[0].missingAttachment.name,'设定[一].md');
  assert.ok(parsed.steps[0].text.includes('## User 88'));assert.equal(parsed.steps[0].importAttachment.resourceId,'');
});
test('独立的系统与工具消息不会混入用户原文',()=>{
  const markdown=examples.system;
  const parsed=C.parse(markdown);
  assert.equal(parsed.steps.length,1);assert.equal(parsed.steps[0].text,'用户原文');assert.ok(!parsed.steps[0].referenceReply.includes('工具结果'));
});
