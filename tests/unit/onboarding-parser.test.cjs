const {test, before} = require('node:test');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
let parser;
before(async () => { parser = await import(pathToFileURL(path.join(__dirname, '../../ui/import-files.js')).href); });

test('导入文件解析 frontmatter、标题、换行与空文件', () => {
  const cases = [
    ['draft.md', '', null],
    ['draft.md', '  \n ', null],
    ['draft.md', '  保留正文。\r\n\r\n 下一行。  ', {title:'draft', content:'保留正文。\n\n 下一行。', suggested:true}],
    ['draft.md', '\uFEFF---\nname: "引号名称"\n---\n正文', {title:'引号名称', content:'正文', suggested:true}],
    ['draft.md', '---\nname: 第一名称\nname: \'第二名称\'\n---\n\n正文\n', {title:'第二名称', content:'正文', suggested:true}],
    ['draft.md', '---\n name: 缩进不会匹配\n---\n正文', {title:'draft', content:'正文', suggested:true}],
    ['draft.md', '---\nname: ""\n---\n正文', {title:'draft', content:'正文', suggested:true}],
    ['draft.md', '---\nname: 空正文\n---\n', null],
    ['draft.md', '---\nname: 未关闭的 frontmatter\n正文', {title:'draft', content:'---\nname: 未关闭的 frontmatter\n正文', suggested:true}],
    ['bundle/能力/SKILL.md', '---\nname: " 标题 "\n---\n  原文\r\n下一行  ', {title:'标题', content:'原文\n下一行', suggested:true}],
    ['bundle/能力/SKILL.md', '原文', {title:'能力', content:'原文', suggested:true}],
    ['SKILL.md', '原文', {title:'SKILL', content:'原文', suggested:true}]
  ];
  for (const [file, text, expected] of cases) {
    assert.deepEqual(parser.parsePromptFile(file, text), expected && {path:file, ...expected}, file);
  }
  for (const file of ['README.md', 'LICENSE.txt', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'Changelog.markdown']) {
    assert.equal(parser.parsePromptFile(file, '正文').suggested, false, file);
  }
});

test('导入只选文本格式，跳过技能目录附属文件和子目录隐藏文件', () => {
  for (const [file, allowed] of [
    ['top.md',true], ['top.MARKDOWN',true], ['top.TXT',true], ['top.json',false],
    ['.hidden.md',true], ['bundle/.hidden.md',false], ['bundle/.cache/a.md',false],
    ['bundle/name.md/child.txt',true], ['bundle/tool/SKILL.md',true]
  ]) assert.equal(parser.eligiblePath(file), allowed, file);
  assert.deepEqual([...parser.supportingPaths([
    'bundle/tool/SKILL.md', 'bundle/tool/references/a.md', 'bundle/tool/other/SKILL.md',
    'bundle/tool2/SKILL.md', 'top.md', 'SKILL.md'
  ])].sort(), ['bundle/tool/other/SKILL.md', 'bundle/tool/references/a.md']);
  assert.deepEqual([...parser.supportingPaths(['SKILL.md','readme.md'])], []);
});
