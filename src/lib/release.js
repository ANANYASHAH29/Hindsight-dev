// release.js - PURE logic for "Is it safe to ship this release?" (no network, no storage), so it is easy to test.
// The VERDICT is always computed here, by fixed rules. An AI may explain it, but never decides it, and there is no AI-made risk score.
//
// A release depends on an assumption only when the two are explicitly LINKED, and each link says how much the release
// relies on it (its severity):
//
//   critical  the release cannot responsibly ship if this assumption is contradicted (the default)
//   standard  the release can ship, but a contradiction is a risk the team should be aware of
//
// Rules (applied to each linked assumption, using its assessment from lib/assess.js):
//
//   contradicted + critical  -> BLOCKER            contradicted + standard -> risk
//   at-risk      + critical  -> risk               at-risk      + standard -> info (listed, changes nothing)
//   unverified / stale + critical -> risk          unverified / stale + standard -> info
//   healthy                  -> fine
//   An ACTIVE accepted risk turns a blocker or risk into a visible "risk accepted" risk. An EXPIRED acceptance does nothing,
//   so the original warning returns on its own.
//
// Verdict:  blocked (any blocker)  >  at-risk (any risk)  >  ready  ...  unknown when nothing is linked.

import { assessmentOf, STATUS, STATUS_LABEL } from './assess.js';

export const MAX_RISK_DAYS = 90;         // an accepted risk can last at most this long
export const DEFAULT_RISK_DAYS = 14;

export const SEVERITY = Object.freeze({ CRITICAL: 'critical', STANDARD: 'standard' });
export const severityOf = (a) => (a?.severity === SEVERITY.STANDARD ? SEVERITY.STANDARD : SEVERITY.CRITICAL);
export const validateSeverity = (v) => (v === undefined || v === null || v === '' || Object.values(SEVERITY).includes(v) ? null : 'Severity must be "critical" or "standard".');

// ---- Release names -------------------------------------------------------------------------------
export const normalizeRelease = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 60);

// Returns an error string, or null if the release name is fine.
export function validateRelease(v) {
  const r = normalizeRelease(v);
  if (!r) return 'Please enter a release name or key, for example "Checkout v2.0" or "KAN-3".';
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._\-/]*$/.test(r)) return 'A release name may use letters, numbers, spaces, dots, dashes and slashes only.';
  return null;
}

// Compare release names without caring about upper/lower case.
export const sameRelease = (a, b) => normalizeRelease(a).toLowerCase() === normalizeRelease(b).toLowerCase();

// Group assumptions by release name. Assumptions with no release are left out.
export function groupByRelease(items) {
  const groups = {};
  const display = {};
  for (const a of items) {
    const name = normalizeRelease(a.releaseKey);
    if (!name) continue;
    const key = name.toLowerCase();
    display[key] = display[key] || name;
    (groups[key] = groups[key] || []).push(a);
  }
  return Object.keys(groups).sort().map((key) => ({ name: display[key], items: groups[key] }));
}

// ---- Accepting a risk ---------------------------------------------------------------------------
// A risk acceptance is { by, byName, reason, at, until }. It is "active" until the `until` date passes.
export function isRiskActive(assumption, now = new Date()) {
  const r = assumption.riskAccepted;
  if (!r) return false;
  if (!r.until) return true;
  return new Date(r.until).getTime() > now.getTime();
}

// Validates what a person typed. Returns { error } or { reason, days }.
export function validateRiskAcceptance({ reason, days }) {
  const text = String(reason || '').trim();
  if (text.length < 10) return { error: 'Please write a reason of at least 10 characters, so the decision can be understood later.' };
  if (text.length > 300) return { error: 'Please keep the reason under 300 characters.' };
  const d = days === undefined || days === null || days === '' ? DEFAULT_RISK_DAYS : Number(days);
  if (!Number.isInteger(d) || d < 1 || d > MAX_RISK_DAYS) return { error: `Accept the risk for a whole number of days from 1 to ${MAX_RISK_DAYS}.` };
  return { reason: text, days: d };
}

// Builds the record to store.
export function buildRiskAcceptance({ accountId, byName, reason, days }, now = new Date()) {
  return {
    by: accountId,
    byName: byName || null,
    reason,
    at: now.toISOString(),
    until: new Date(now.getTime() + days * 86400000).toISOString(),
  };
}

// ---- The verdict ---------------------------------------------------------------------------------
const day = (iso) => String(iso).slice(0, 10);

// Returns { verdict, reasons, counts }.
//   reasons: [{ assumptionId, text, level: 'blocker' | 'risk' | 'info', status, severity, why, required }]
//   Healthy assumptions add no reason.
export function releaseVerdict(assumptions, now = new Date()) {
  if (!assumptions || assumptions.length === 0) {
    return { verdict: 'unknown', reasons: [], counts: { total: 0, blockers: 0, risks: 0, info: 0, ok: 0 } };
  }
  const reasons = [];
  let ok = 0;
  for (const a of assumptions) {
    const assessment = assessmentOf(a, now);
    const status = assessment.status;
    const severity = severityOf(a);
    const critical = severity === SEVERITY.CRITICAL;
    const base = { assumptionId: a.id, text: a.text, status, severity };
    const evidence = assessment.reasons[0] || '';
    const ticket = a.ticketKey ? ` Ticket ${a.ticketKey} (${a.ticketStatus || 'unknown status'}).` : '';

    if (status === STATUS.HEALTHY) { ok += 1; continue; }

    // An active, written acceptance by an administrator keeps the warning visible but stops it blocking.
    const accepted = (status === STATUS.CONTRADICTED || status === STATUS.AT_RISK) && isRiskActive(a, now);
    if (accepted) {
      const r = a.riskAccepted;
      reasons.push({
        ...base, level: 'risk',
        why: `${STATUS_LABEL[status]}, but the risk was accepted${r.byName ? ` by ${r.byName}` : ''} until ${day(r.until)}: "${r.reason}"`,
        required: `Resolve it, or renew the decision before ${day(r.until)}.`,
      });
      continue;
    }

    if (status === STATUS.CONTRADICTED) {
      reasons.push({
        ...base, level: critical ? 'blocker' : 'risk',
        why: `Contradicted: ${evidence}${ticket}`,
        required: critical
          ? 'Resolve the contradiction (fix the cause, or revise the assumption), or an administrator must knowingly accept the risk.'
          : 'Revise the assumption or resolve the issues; the release can still ship.',
      });
    } else if (status === STATUS.AT_RISK) {
      reasons.push({
        ...base, level: critical ? 'risk' : 'info',
        why: `Needs investigation: ${evidence}${ticket}`,
        required: 'Review the related issues, then confirm a contradiction or mark them unrelated.',
      });
    } else if (status === STATUS.UNVERIFIED) {
      reasons.push({ ...base, level: critical ? 'risk' : 'info', why: 'Not verified: it has never been checked.', required: 'Run a check.' });
    } else if (status === STATUS.STALE) {
      reasons.push({ ...base, level: critical ? 'risk' : 'info', why: `Stale: ${evidence}`, required: 'Check it again.' });
    }
  }
  const count = (level) => reasons.filter((r) => r.level === level).length;
  const blockers = count('blocker');
  const risks = count('risk');
  const info = count('info');
  const verdict = blockers > 0 ? 'blocked' : risks > 0 ? 'at-risk' : 'ready';
  return { verdict, reasons, counts: { total: assumptions.length, blockers, risks, info, ok } };
}

// One plain-English sentence for the verdict (used by the screen and by the agent).
export function verdictSentence(verdict, counts) {
  switch (verdict) {
    case 'blocked': return `Blocked: ${counts.blockers} critical assumption(s) behind this release are contradicted, and nobody has accepted the risk.`;
    case 'at-risk': return `At risk: nothing blocks the release, but ${counts.risks} assumption(s) need investigation, a check, or carry an accepted risk.`;
    case 'ready': return `Ready: all ${counts.total} assumption(s) linked to this release are healthy and were checked recently.`;
    default: return 'Unknown: no assumptions are linked to this release, so Hindsight cannot say whether it is safe.';
  }
}
