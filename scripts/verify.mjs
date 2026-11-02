import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function run(program,args) {
  const result=spawnSync(program,args,{cwd:root,stdio:'inherit',timeout:180000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
  if (result.error) throw result.error;
  if (result.status!==0) process.exit(result.status||1);
}
run(process.execPath,['scripts/audit.mjs']);
const tests=fs.readdirSync(path.join(root,'tests/unit')).filter(name=>name.endsWith('.test.cjs'));
run(process.execPath,['--test',...tests.map(name=>'tests/unit/'+name)]);
if (process.argv.includes('--browser')) {
  const python=process.env.PYTHON||'python';
  const browserTests=fs.readdirSync(path.join(root,'tests/browser')).filter(name=>name.endsWith('.py') && name!=='native-sidepanel-smoke.py' && name!=='basic-flow-smoke.py');
  for (const name of browserTests) {
    console.log(`\nChecking ${name}`);
    run(python,[`tests/browser/${name}`]);
  }
  for (const provider of ['chatgpt','gemini','deepseek']) {
    console.log(`\nChecking ${provider} flow`);
    run(python,['tests/browser/basic-flow-smoke.py','--provider',provider]);
  }
  if (process.argv.includes('--native-panel')) run(python,['tests/browser/native-sidepanel-smoke.py']);
}
