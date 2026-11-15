// resetPlan.js - PURE rules for "Reset Hindsight data" (no network, no storage), so the safety rules can be tested.
//
// A reset deletes ONLY what Hindsight itself created:
//   * everything Hindsight stored (assumptions, page lists, per-page settings, audit log, locks, release verdicts, demo record)
//   * the Jira tickets titled "Revisit assumption: ..." that Hindsight created
// It never touches the app settings, your own Jira issues, or your Confluence pages.

// Storage key families that a reset removes. 'settings' is deliberately NOT here.
export const RESET_PREFIXES = Object.freeze(['assumption:', 'page:', 'pageconfig:', 'index:', 'audit:', 'lock:', 'release-verdict:', 'sample:']);

// Would a reset delete this storage key?
export const wouldPurge = (key) => RESET_PREFIXES.some((p) => String(key).startsWith(p));

// Is this Jira issue one that Hindsight created? (Its title always starts with "Revisit assumption:".)
export const isHindsightTicket = (summary) => /^revisit assumption:/i.test(String(summary || '').trim());

// The plain-English list shown to the administrator BEFORE anything is deleted.
export function describeReset({ assumptions = 0, tickets = [], auditEntries = 0, demoOn = false }) {
  const lines = [];
  lines.push(`${assumptions} assumption${assumptions === 1 ? '' : 's'}, with their plans, reviews and release links`);
  lines.push(tickets.length ? `${tickets.length} "Revisit assumption" ticket${tickets.length === 1 ? '' : 's'} (${tickets.slice(0, 8).join(', ')}${tickets.length > 8 ? ', ...' : ''})` : 'no "Revisit assumption" tickets');
  lines.push(`the audit log (${auditEntries} entr${auditEntries === 1 ? 'y' : 'ies'}) and the per-page monitoring settings`);
  if (demoOn) lines.push('the demo data (its design doc and Jira issues) because Demo mode is on');
  return lines;
}
