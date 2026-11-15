// risk.js - changing an assumption's release link and accepting / revoking a risk. Shared by the screens and the Rovo agent,
// so both follow exactly the same rules and write the same audit entries.
import { requireAdmin } from './permissions.js';
import { assessmentOf, needsAttention } from './assess.js';
import { validateRelease, normalizeRelease, validateRiskAcceptance, buildRiskAcceptance } from './release.js';
import { saveAssumption } from './storage.js';
import { addAudit } from './audit.js';

// Link an assumption to a release. Returns { assumption } or { error }.
export async function linkToRelease(assumption, release, accountId) {
  const problem = validateRelease(release);
  if (problem) return { error: problem };
  const updated = { ...assumption, releaseKey: normalizeRelease(release) };
  await saveAssumption(updated);
  await addAudit({ type: 'linked-release', actor: accountId, assumptionId: assumption.id, text: assumption.text, detail: `Linked to release "${updated.releaseKey}".` });
  return { assumption: updated };
}

// Knowingly accept the risk of a TRIPPED assumption. Site administrators only. Returns { assumption } or { error }.
export async function acceptRisk(assumption, { reason, days }, accountId) {
  try {
    await requireAdmin('accept a risk');
  } catch (e) {
    return { error: e.message };
  }
  if (!needsAttention(assessmentOf(assumption).status)) return { error: 'Only an assumption that is at risk or contradicted needs a risk acceptance.' };
  const checked = validateRiskAcceptance({ reason, days });
  if (checked.error) return { error: checked.error };
  // We keep the account ID only; screens show the person's name with the <User> component (no extra permission needed).
  const record = buildRiskAcceptance({ accountId, byName: null, reason: checked.reason, days: checked.days });
  const updated = { ...assumption, riskAccepted: record };
  await saveAssumption(updated);
  await addAudit({ type: 'risk-accepted', actor: accountId, assumptionId: assumption.id, text: assumption.text, detail: `Until ${record.until.slice(0, 10)}: ${record.reason}` });
  return { assumption: updated };
}

// Take an accepted risk back (the assumption blocks releases again). Site administrators only.
export async function revokeRisk(assumption, accountId) {
  try {
    await requireAdmin('revoke an accepted risk');
  } catch (e) {
    return { error: e.message };
  }
  const { riskAccepted, ...rest } = assumption;
  await saveAssumption(rest);
  await addAudit({ type: 'risk-revoked', actor: accountId, assumptionId: assumption.id, text: assumption.text, detail: 'The accepted risk was revoked.' });
  return { assumption: rest };
}
