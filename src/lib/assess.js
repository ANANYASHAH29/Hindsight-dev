// assess.js - the evidence-confidence model. PURE (no network, no storage), so every rule can be tested.
//
// The central idea: a Jira issue that merely MENTIONS the same words as an assumption is RELATED evidence, not proof.
// Hindsight therefore separates "this needs investigating" from "this is contradicted":
//
//   healthy       Current evidence does not indicate a violation of the defined criteria.
//   at-risk       Related evidence reaches the threshold. A person must review it. (This is NOT "contradicted".)
//   contradicted  The defined contradiction criteria are met by explicit evidence, or a person confirmed a contradiction.
//   unverified    Nothing has been checked yet, so validity is unknown.
//   stale         It was healthy, but has not been checked within its freshness period.
//
// Counts, thresholds, time windows and the final status are ALWAYS computed here, by code. An AI may explain and suggest,
// but it never decides a status and never supplies a number.

export const STATUS = Object.freeze({
  HEALTHY: 'healthy',
  AT_RISK: 'at-risk',
  CONTRADICTED: 'contradicted',
  UNVERIFIED: 'unverified',
  STALE: 'stale',
});

export const STATUS_LABEL = Object.freeze({ healthy: 'Healthy', 'at-risk': 'At risk', contradicted: 'Contradicted', unverified: 'Unverified', stale: 'Stale' });
export const STATUS_APPEARANCE = Object.freeze({ healthy: 'success', 'at-risk': 'moved', contradicted: 'removed', unverified: 'default', stale: 'default' });
// What needs attention first (lower = sooner).
export const STATUS_PRIORITY = Object.freeze({ contradicted: 0, 'at-risk': 1, stale: 2, unverified: 3, healthy: 4 });

export const FRESHNESS_DAYS = 7;       // a healthy assumption not checked for this long becomes "stale"
export const EVIDENCE_FETCH = 25;      // how many matching issues we load so a person's reviews can be applied

// ---- What kind of query is it? ---------------------------------------------------------------------
// A query that searches TEXT (summary ~ "payments") finds issues that mention words: related evidence.
// A query on STRUCTURED fields (component, priority, issue type, labels) is a defined criterion a person chose on purpose.
const TEXT_OPERATOR = /\b(summary|description|text|comment|environment)\s*!?~/i;
export const queryKind = (jql) => (TEXT_OPERATOR.test(String(jql || '')) ? 'related' : 'direct');

// How matches are treated: an explicit setting wins, otherwise it follows the query kind.
export function validationMode(assumption) {
  const chosen = assumption?.validation?.mode;
  return chosen === 'related' || chosen === 'direct' ? chosen : queryKind(assumption?.tripwire?.jql);
}

// ---- Evidence reviews: a person's judgement of one issue ------------------------------------------
export const REVIEW = Object.freeze({ CONTRADICTS: 'contradicts', SUPPORTS: 'supports', UNRELATED: 'unrelated' });
export const isReviewValue = (v) => Object.values(REVIEW).includes(v);

// ---- The assessment --------------------------------------------------------------------------------
//   assumption: the stored assumption (tripwire, evidenceReviews, validation, ...)
//   count:      how many issues Jira says match the tripwire right now
//   evidence:   the matching issues we loaded: [{ key }]  (at most EVIDENCE_FETCH)
// Returns { status, mode, reasons: [string], counts: { matched, dismissed, confirmed, effective, threshold } }.
export function assess({ assumption, count, evidence = [] }) {
  const threshold = Number(assumption.tripwire?.threshold);
  const reviews = assumption.evidenceReviews || {};
  const keys = evidence.map((i) => i.key);
  const dismissed = keys.filter((k) => reviews[k] === REVIEW.UNRELATED).length;
  const confirmed = keys.filter((k) => reviews[k] === REVIEW.CONTRADICTS).length;
  const matched = count === null || count === undefined || count === '' ? Number.NaN : Number(count); // no count = no check yet (Number(null) would be 0)
  const effective = Math.max(0, matched - dismissed);
  const mode = validationMode(assumption);
  const counts = { matched, dismissed, confirmed, effective, threshold };

  if (!Number.isFinite(matched)) {
    return { status: STATUS.UNVERIFIED, mode, reasons: ['No check has run yet, so nobody knows whether this still holds.'], counts };
  }
  if (confirmed >= 1) {
    return { status: STATUS.CONTRADICTED, mode, counts, reasons: [`${confirmed} issue(s) were confirmed by a person as contradicting this assumption.`] };
  }
  if (effective >= threshold) {
    if (mode === 'direct') {
      return { status: STATUS.CONTRADICTED, mode, counts, reasons: [`The defined contradiction criteria are met: ${effective} matching issue(s), and it trips at ${threshold}.`] };
    }
    return {
      status: STATUS.AT_RISK, mode, counts,
      reasons: [
        `${effective} related issue(s) mention this area, and it trips at ${threshold}.`,
        'These are keyword matches, which are related evidence and not proof. A person needs to review them.',
      ],
    };
  }
  const reasons = effective > 0
    ? [`${effective} related issue(s) found, below the threshold of ${threshold}.`]
    : ['No matching issues in the time window.'];
  if (dismissed > 0) reasons.push(`${dismissed} issue(s) were marked unrelated by a person and are not counted.`);
  return { status: STATUS.HEALTHY, mode, counts, reasons };
}

// ---- Compatibility with data saved by earlier versions ---------------------------------------------
// Earlier versions stored a single `status`: 'tripped' | 'healthy' | 'unchecked'. We never rewrite those silently.
// 'tripped' meant "matches reached the threshold" (often keyword matches), so it maps to 'at-risk' (needs investigation),
// NOT 'contradicted'. The next check replaces it with a proper assessment.
export function legacyToStatus(legacy) {
  if (legacy === 'tripped') return STATUS.AT_RISK;
  if (legacy === 'healthy') return STATUS.HEALTHY;
  return STATUS.UNVERIFIED;
}

// The legacy value we keep writing next to the new assessment, so older screens and stored data stay readable.
export function statusToLegacy(status) {
  if (status === STATUS.AT_RISK || status === STATUS.CONTRADICTED) return 'tripped';
  if (status === STATUS.HEALTHY || status === STATUS.STALE) return 'healthy';
  return 'unchecked';
}

const daysSince = (iso, now) => Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);

// The assessment to DISPLAY for any stored assumption (new or old), with staleness applied.
export function assessmentOf(a, now = new Date()) {
  let current;
  if (a.assessment && STATUS_LABEL[a.assessment.status]) {
    current = { ...a.assessment };
  } else {
    const status = legacyToStatus(a.status);
    const matched = a.lastCount ?? null;
    current = {
      status,
      mode: validationMode(a),
      counts: { matched, dismissed: 0, confirmed: 0, effective: matched, threshold: Number(a.tripwire?.threshold) },
      reasons: status === STATUS.AT_RISK
        ? ['Reported as "tripped" by an earlier version. Check it again to see whether the evidence is related or contradicting.']
        : status === STATUS.UNVERIFIED ? ['No check has run yet.'] : ['No matching issues in the time window.'],
    };
  }
  if (current.status === STATUS.HEALTHY && a.lastCheckedAt && daysSince(a.lastCheckedAt, now) >= FRESHNESS_DAYS) {
    return { ...current, status: STATUS.STALE, reasons: [`Last checked ${daysSince(a.lastCheckedAt, now)} days ago, longer than its ${FRESHNESS_DAYS}-day freshness period.`] };
  }
  return current;
}

// Does this status need a person's attention (and a Revisit ticket)?
export const needsAttention = (status) => status === STATUS.AT_RISK || status === STATUS.CONTRADICTED;
