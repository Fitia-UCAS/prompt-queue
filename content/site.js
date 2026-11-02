import { createSiteAdapters } from './site-adapters.js';
import { createSiteHost } from './site-host.js';

const marker = '__langqueue_content_script__';
if (!window[marker]) {
  window[marker] = true;
  const adapter = createSiteAdapters().find((candidate) => candidate.matchesAdapterDomain());
  if (adapter) createSiteHost(adapter);
}
