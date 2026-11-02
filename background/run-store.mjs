import { record } from '../shared/logging.mjs';
export function createRunStore({ chrome, scheduler, clock: Date = globalThis.Date }) {
  const { arm } = scheduler;
  const getRun = async () => (await chrome.storage.local.get('pfRun')).pfRun || null;
  function log(run, text, tone = 'info', logger = 'prompt_chain.runner') {
    run.logs = [...(run.logs || []), record(Date.now(), text, tone, logger)].slice(-250);
  }
  async function save(run) {
    run.updatedAt = Date.now();
    await chrome.storage.local.set({ pfRun: run });
    arm(run);
    return run;
  }
  return { getRun, log, save };
}
