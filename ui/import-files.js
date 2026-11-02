export function eligiblePath(path) {
  const parts = path.split('/');
  if (parts.slice(1).some((part) => part.startsWith('.'))) return false;
  const name = parts[parts.length - 1].toLowerCase();
  return ['.md', '.markdown', '.txt'].some((extension) => name.endsWith(extension));
}

export function supportingPaths(paths) {
  const excluded = new Set();
  for (const skill of paths.filter((path) => /\/SKILL\.md$/i.test(path))) {
    const folder = skill.slice(0, skill.lastIndexOf('/') + 1);
    for (const path of paths) if (path !== skill && path.startsWith(folder)) excluded.add(path);
  }
  return excluded;
}

export function parsePromptFile(path, text) {
  const lines = text.split(/\r?\n/);
  let start = 0,
    name = '';
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      start = end + 1;
      for (const line of lines.slice(1, end)) {
        const match = /^name:\s*(.*?)\s*$/.exec(line);
        if (!match) continue;
        const value = match[1];
        name = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
      }
    }
  }
  const content = lines.slice(start).join('\n').trim();
  if (!content) return null;
  const parts = path.split('/'),
    stem = parts[parts.length - 1].replace(/\.[^.]+$/, '');
  const folder = parts.length > 1 ? parts[parts.length - 2] : '';
  return {
    path,
    title: name.trim() || (stem.toUpperCase() === 'SKILL' && folder ? folder : stem),
    content,
    suggested: !['readme', 'license', 'contributing', 'code_of_conduct', 'changelog'].includes(
      stem.toLowerCase()
    )
  };
}
