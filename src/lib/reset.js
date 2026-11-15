// reset.js - "Reset Hindsight data": a clean slate. Administrators only, and the screen shows exactly what will go BEFORE it happens.
// It deletes only what Hindsight created (see resetPlan.js). It never deletes app settings, your own Jira issues or your Confluence pages.
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { sendWithRetry } from './http.js';
import { requireAdmin } from './permissions.js';
import { findEvidence } from './jira.js';
import { listAllAssumptions } from './storage.js';
import { removeSample } from './sample.js';
import { addAudit } from './audit.js';
import { RESET_PREFIXES, isHindsightTicket, describeReset } from './resetPlan.js';

// Every "Revisit assumption: ..." ticket the admin can see (the ones Hindsight created in any run, even if its record was lost).
async function revisitTickets() {
  const issues = await findEvidence('summary ~ "\\"Revisit assumption\\"" ORDER BY created DESC', 100, api.asUser());
  return issues.filter((i) => isHindsightTicket(i.fields?.summary)).map((i) => i.key);
}

// Delete every storage key that starts with `prefix`. Returns how many were deleted.
async function purgePrefix(prefix) {
  let deleted = 0;
  let cursor;
  do {
    let query = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(50);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    for (const row of page.results) {
      await kvs.delete(row.key);
      deleted += 1;
    }
    cursor = page.nextCursor;
  } while (cursor);
  return deleted;
}

// What a reset would delete. Changes nothing.
export async function previewReset() {
  await requireAdmin('reset Hindsight data');
  const [assumptions, tickets, audit, demo] = await Promise.all([listAllAssumptions(), revisitTickets(), kvs.get('audit:log'), kvs.get('sample:meta')]);
  const summary = { assumptions: assumptions.length, tickets, auditEntries: (audit || []).length, demoOn: Boolean(demo) };
  return { ...summary, lines: describeReset(summary) };
}

// Do the reset. Returns { ok, deletedTickets, deletedRecords, problems }.
export async function resetAll(accountId) {
  await requireAdmin('reset Hindsight data');
  const problems = [];

  // 1) If Demo mode is on, take the demo down properly first (its design doc and Jira issues).
  if (await kvs.get('sample:meta')) {
    const r = await removeSample(accountId);
    if (r.error) problems.push(r.error);
  }

  // 2) The Revisit tickets Hindsight created.
  let deletedTickets = 0;
  for (const key of await revisitTickets()) {
    try {
      const res = await sendWithRetry(() => api.asUser().requestJira(route`/rest/api/3/issue/${key}`, { method: 'DELETE' }));
      if (res.ok || res.status === 404) deletedTickets += 1;
      else problems.push(`Could not delete ${key} (HTTP ${res.status}).`);
    } catch (e) {
      problems.push(`Could not delete ${key}: ${e.message}`);
    }
  }

  // 3) Everything Hindsight stored.
  let deletedRecords = 0;
  for (const prefix of RESET_PREFIXES) deletedRecords += await purgePrefix(prefix);

  // 4) One fresh audit entry, so the log starts with a clear record of the reset.
  await addAudit({ type: 'reset', actor: accountId, detail: `Deleted ${deletedRecords} stored record(s) and ${deletedTickets} Revisit ticket(s).${problems.length ? ` Problems: ${problems.join(' ')}` : ''}` });
  return { ok: problems.length === 0, deletedTickets, deletedRecords, problems };
}
