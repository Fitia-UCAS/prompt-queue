import './vendor/marked/marked.js';
import './shared/platforms.js';
import './shared/model.js';
import './shared/store.js';
import './shared/file-match.js';
import './background/ui-api.js';
import { createBackground } from './background/runtime.mjs';

createBackground({
  chrome,
  model: PromptFlowModel,
  store: PromptFlowStore,
  fileMatch: PromptFlowFileMatch
});
