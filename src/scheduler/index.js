// scheduler/index.js - runs every hour (see manifest) and re-checks every assumption on the site.
// It uses PLAIN CODE only: no AI calls, so it costs no Rovo credits.
// It runs as the APP (asApp): the app user can only see Jira projects it has access to. This is documented in the README.
import api from '@forge/api';
import { checkAssumption } from '../lib/checker.js';
import { listAllAssumptions, getSettings } from '../lib/storage.js';
import { isDueForCheck } from '../lib/dashboard.js';
import { assessmentOf } from '../lib/assess.js';
import { addAudit } from '../lib/audit.js';

// Scheduled functions have a short time limit, so we stop early and carry on next hour.
const TIME_BUDGET_MS = 40000;

export async function hourlyCheck() {
  const started = Date.now();
  // Oldest-checked first, so nothing is starved if there are many assumptions.
  // Honour the "check interval" setting: skip assumptions that were checked recently enough.
  const { checkIntervalMinutes } = await getSettings();
  const all = (await listAllAssumptions())
    .filter((a) => isDueForCheck(a.lastCheckedAt, checkIntervalMinutes))
    .sort((a, b) => String(a.lastCheckedAt || '').localeCompare(String(b.lastCheckedAt || '')));
  let checked = 0;
  let failed = 0;
  let changed = 0;
  for (const a of all) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const before = assessmentOf(a).status;
      const result = await checkAssumption(a, api.asApp(), 'scheduler');
      if (result.skipped) continue; // another check was already running for it
      checked += 1;
      if (assessmentOf(result).status !== before) changed += 1;
    } catch (e) {
      failed += 1;
      console.error(`Hourly check failed for assumption ${a.id}: ${e.message}`);
    }
  }
  // Quiet runs are not written to the audit log (it would fill with noise), but any status change or failure is.
  if (changed > 0 || failed > 0) {
    await addAudit({ type: 'monitoring-run', actor: 'scheduler', detail: `${checked} checked, ${changed} status change(s), ${failed} failed.` });
  }
  console.log(`Hourly check done: ${checked} checked, ${failed} failed, ${all.length - checked - failed} left for next time.`);
}
