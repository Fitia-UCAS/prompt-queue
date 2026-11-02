from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))['version']
out = root / 'dist'
out.mkdir(parents=True, exist_ok=True)
target = out / f'PromptQueue-{version}.zip'
files = [root / name for name in ['manifest.json', 'background.js', 'sidepanel.html', 'workflow.html', 'onboarding.html', 'README.md']]
for name in ['assets', 'icons', 'content', 'shared', 'vendor', 'background', 'ui']:
    files.extend(path for path in (root / name).rglob('*') if path.is_file())

with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(root).as_posix())

print(json.dumps({'path': str(target), 'files': len(files), 'bytes': target.stat().st_size,
    'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2))
