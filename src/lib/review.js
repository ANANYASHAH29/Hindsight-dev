// review.js - a person's judgement of ONE evidence issue: "this contradicts the assumption", "this supports it", or "this is unrelated".
// This is what turns related evidence into a confirmed contradiction (or removes a false match), so a finding rests on a human decision
// and never on keyword similarity alone. Shared by the screens and the Rovo agent. Every review is written to the audit log.
import { assess, assessmentOf, statusToLegacy, isReviewValue, STATUS_LABEL } from './assess.js';
import { saveAssumption } from './storage.js';
import { addAudit } from './audit.js';
import { recordReleaseVerdict } from './checker.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

// review: 'contradicts' | 'supports' | 'unrelated' | 'clear' (remove the review). Returns { assumption } or { error }.
export async function reviewEvidence(assumption, issueKey, review, accountId) {
  const key = String(issueKey || '').trim().toUpperCase();
  if (!ISSUE_KEY.test(key)) return { error: 'Please give a Jira issue key, for example KAN-4.' };
  if (review !== 'clear' && !isReviewValue(review)) return { error: 'A review must be "contradicts", "supports", "unrelated", or "clear".' };
  const known = (assumption.evidence || []).some((e) => e.key === key);
  if (!known) return { error: `${key} is not part of this assumption's evidence. Run a check first, or pick one of the matching issues.` };

  const reviews = { ...(assumption.evidenceReviews || {}) };
  if (review === 'clear') delete reviews[key]; else reviews[key] = review;
  const next = { ...assumption, evidenceReviews: reviews };

  // Re-assess from what the last check found (no new Jira call needed): the count and the matching issues are already stored.
  const before = assessmentOf(assumption).status;
  if (assumption.lastCheckedAt) {
    const result = assess({ assumption: next, count: next.lastCount, evidence: next.evidence || [] });
    next.assessment = { ...result, evaluatedAt: new Date().toISOString() };
    next.status = statusToLegacy(result.status);
  }
  await saveAssumption(next);
  await addAudit({
    type: 'evidence-reviewed', actor: accountId, assumptionId: assumption.id, text: assumption.text,
    detail: review === 'clear' ? `Removed the review of ${key}.` : `Marked ${key} as "${review}".`,
  });
  const after = assessmentOf(next).status;
  if (before !== after) {
    await addAudit({ type: 'status-changed', actor: accountId, assumptionId: assumption.id, text: assumption.text, detail: `${STATUS_LABEL[before]} -> ${STATUS_LABEL[after]} after a person's review of ${key}.` });
    await recordReleaseVerdict(next.releaseKey, accountId);
  }
  return { assumption: next };
}
