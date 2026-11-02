export const state = {
  prompts: [],
  chains: [],
  stats: { totalPrompts: 0, totalUses: 0, mostUsedPrompt: null },
  query: '',
  sort: 'recent',
  loading: true,
  ready: false,
  platform: 'other',
  view: 'main',
  run: null
};

export function recentOrder(a, b) {
  return (
    (a.order ?? Number.MIN_SAFE_INTEGER) - (b.order ?? Number.MIN_SAFE_INTEGER) ||
    (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) ||
    (b.updatedAt ?? 0) - (a.updatedAt ?? 0) ||
    (b.createdAt ?? 0) - (a.createdAt ?? 0)
  );
}

export function visiblePrompts(prompts, query, sort) {
  const needle = query.trim().toLowerCase();
  const items = prompts.filter(
    (prompt) => !needle || [prompt.title, prompt.content].join('\n').toLowerCase().includes(needle)
  );
  if (sort === 'alpha') return items.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'mostUsed') return items.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
  return items.sort(recentOrder);
}
