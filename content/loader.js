(() => {
  'use strict';
  import(chrome.runtime.getURL('content/site.js')).catch(console.error);
})();
