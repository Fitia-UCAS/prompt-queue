import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceTypes = new Set(['.js', '.mjs', '.html', '.css']);
const files = [], errors = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (sourceTypes.has(path.extname(file))) files.push(file);
  }
}
for (const directory of ['assets','background','content','shared','ui','vendor']) walk(path.join(root, directory));
for (const name of ['background.js','sidepanel.html','onboarding.html','workflow.html']) files.push(path.join(root,name));
const relative = file => path.relative(root,file).split(path.sep).join('/');
function localReference(owner, reference) {
  const clean = reference.split(/[?#]/,1)[0];
  const target = clean.startsWith('/') ? path.join(root,clean.slice(1)) : path.resolve(path.dirname(owner),clean);
  if (!target.startsWith(root+path.sep) || !fs.existsSync(target)) errors.push(`${relative(owner)}: missing ${reference}`);
}

let moduleEdges=0, htmlReferences=0;
for (const file of files) {
  const source=fs.readFileSync(file,'utf8');
  const vendor=relative(file).startsWith('vendor/');
  if (/\.min\.[cm]?js$|\.map$/.test(file) || /sourceMappingURL/.test(source)) errors.push(`${relative(file)}: compressed source or source map`);
  if (!vendor && /\b(?:React|Tailwind|Vite|Webpack|esbuild)\b|\beval\s*\(|\bnew\s+Function\s*\(|--tw-/.test(source)) errors.push(`${relative(file)}: unexpected runtime or generated bundle`);
  if (!vendor && /\b(?:langqueue_(?:prompts|chains|attachments|settings|usage)|pfLibrary|pfTrash|PC_SYNC_FLOW|PC_MIGRATE|PC_PREPARE|PC_DELETE_NATIVE)\b|prompt-flow-files/.test(source)) errors.push(`${relative(file)}: duplicate library or synchronization route`);
  if (['.js','.mjs'].includes(path.extname(file))) {
    for (const pattern of [
      /^\s*(?:import|export)\s+(?:\*\s+as\s+\w+|\{[^}]*\}|[\w$]+)\s+from\s*['"]([^'"]+)['"]/gm,
      /^\s*import\s*['"]([^'"]+)['"]/gm,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ]) for (const match of source.matchAll(pattern)) {
      moduleEdges++;
      if (match[1].startsWith('.') || match[1].startsWith('/')) localReference(file,match[1]);
      else errors.push(`${relative(file)}: external module ${match[1]}`);
    }
    for (const match of source.matchAll(/chrome\.runtime\.getURL\(\s*['"]([^'"]+)['"]\s*\)/g)) localReference(path.join(root,'manifest.json'),match[1]);
  }
  if (path.extname(file)==='.html') for (const match of source.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g)) {
    htmlReferences++;
    localReference(file,match[1]);
  }
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const resources=[manifest.background.service_worker,manifest.side_panel.default_path,...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),...manifest.content_scripts.flatMap(script=>script.js||[]),
  ...manifest.web_accessible_resources.flatMap(group=>group.resources)];
for (const file of resources) localReference(path.join(root,'manifest.json'),file);
const selfTest = fs.readFileSync(path.join(root,'assets/self-test/self-test.md'),'utf8');
const selfTestFiles = ['self-test.md', ...[...selfTest.matchAll(/^- File · ([^·]+) ·/gm)].map(match=>match[1].trim())];
for (const name of selfTestFiles) {
  localReference(path.join(root,'manifest.json'),'assets/self-test/'+name);
}
console.log(JSON.stringify({result:errors.length?'FAIL':'PASS',sources:files.length,moduleEdges,htmlReferences,errors},null,2));
if (errors.length) process.exitCode=1;
