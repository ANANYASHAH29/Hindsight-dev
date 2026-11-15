// resolvers/index.js - the backend functions the panel UI calls through `invoke('name', payload)`.
import Resolver from '@forge/resolver';
import api from '@forge/api';
import { buildTemplateJql } from '../lib/tripwire.js';
import { createAssumption } from '../lib/assumptions.js';
import { computeDrift } from '../lib/drift.js';
import { addAudit, listAudit } from '../lib/audit.js';
import { generateSample, removeSample, getSampleStatus } from '../lib/sample.js';
import { extractAssumptions } from '../lib/extract.js';
import { getPageBody } from '../lib/confluence.js';
import { validateSettings } from '../lib/dashboard.js';
import { isAdmin, requireAdmin } from '../lib/permissions.js';
import { visibleAssumptions } from '../lib/visibility.js';
import { releaseVerdict, verdictSentence, groupByRelease, sameRelease, isRiskActive, validateSeverity, severityOf } from '../lib/release.js';
import { assessmentOf } from '../lib/assess.js';
import { reviewEvidence } from '../lib/review.js';
import { previewReset, resetAll } from '../lib/reset.js';
import { linkToRelease, acceptRisk, revokeRisk } from '../lib/risk.js';
import { selectSteps, stepToPayload } from '../lib/plan.js';
import { commentOnTicketAction, assignTicketAction, createFollowupTaskAction, updateDocSentenceAction, reviseAssumptionAction } from '../actions/index.js';
import { countIssues } from '../lib/jira.js';
import { checkAssumption } from '../lib/checker.js';
import {
  getSettings, saveSettings, getPageConfig, savePageConfig, getAssumption, listPageAssumptions, listAllAssumptions, saveAssumption, deleteAssumption,
} from '../lib/storage.js';

const resolver = new Resolver();

// The id of the Confluence page the panel is open on.
// On the global page there is no page context, so fall back to a page id typed by the user.
const pageIdOf = (req) => String(req.context.extension?.content?.id || req.payload?.pageId || '').trim();

resolver.define('getPanelData', async (req) => {
  const pageId = pageIdOf(req);
  return {
    // On a page: that page's assumptions. On the global page: every assumption.
    assumptions: (pageId ? await listPageAssumptions(pageId) : await listAllAssumptions()).map((a) => ({ ...a, view: assessmentOf(a) })),
    settings: await getSettings(),
    // true when opened from a Confluence page (byline); false on the global page.
    onPage: Boolean(pageId),
  };
});

// Saves settings. Only the fields that were sent are changed. Returns { settings } or { error }.
resolver.define('saveSettings', async (req) => {
  const p = req.payload;
  try {
    await requireAdmin('change Hindsight settings'); // settings affect the whole site
  } catch (e) {
    return { error: e.message };
  }
  const problem = validateSettings(p);
  if (problem) return { error: problem };
  const patch = {};
  if (p.projectKey !== undefined) patch.projectKey = String(p.projectKey || '').trim().toUpperCase();
  if (p.confluenceComments !== undefined) patch.confluenceComments = Boolean(p.confluenceComments);
  if (p.defaultWindowDays !== undefined) patch.defaultWindowDays = Number(p.defaultWindowDays);
  if (p.defaultThreshold !== undefined) patch.defaultThreshold = Number(p.defaultThreshold);
  if (p.checkIntervalMinutes !== undefined) patch.checkIntervalMinutes = Number(p.checkIntervalMinutes);
  const settings = await saveSettings(patch);
  await addAudit({ type: 'settings', actor: req.context.accountId, detail: JSON.stringify(patch) });
  return { settings };
});

resolver.define('getSettings', async () => ({ settings: await getSettings() }));

// ---- One-click demo data (site administrators only; checked inside the functions) ----
resolver.define('getSampleStatus', async () => getSampleStatus());
resolver.define('generateSample', async (req) => {
  try { return await generateSample(req.context.accountId); } catch (e) { return { error: e.message }; }
});
resolver.define('removeSample', async (req) => {
  try { return await removeSample(req.context.accountId); } catch (e) { return { error: e.message }; }
});

// ---- Reset Hindsight data (administrators only; checked again inside). Step 1 shows what would go; step 2 does it. ----
resolver.define('previewReset', async () => {
  try { return await previewReset(); } catch (e) { return { error: e.message }; }
});
resolver.define('resetAll', async (req) => {
  try { return await resetAll(req.context.accountId); } catch (e) { return { error: e.message }; }
});

// The audit log (newest first).
resolver.define('getAudit', async () => ({ entries: await listAudit(100) }));

// ---- Assumption Health dashboard data -----------------------------------------------------------
// PERMISSIONS: we only return assumptions whose Confluence page THIS user can see (checked as the user).
// If the user cannot open the page, its assumptions (and evidence) are hidden from them.
resolver.define('getDashboard', async (req) => {
  const { visible, hiddenCount } = await visibleAssumptions(api.asUser());
  return {
    siteUrl: req.context.siteUrl || '',
    isAdmin: await isAdmin(), // only administrators see the Demo mode button
    hiddenCount,
    assumptions: visible.map((a) => ({
      id: a.id,
      text: a.text,
      status: assessmentOf(a).status,
      reasons: assessmentOf(a).reasons,
      counts: assessmentOf(a).counts,
      mode: assessmentOf(a).mode,
      severity: severityOf(a),
      evidence: a.evidence || [],
      evidenceReviews: a.evidenceReviews || {},
      impactNote: a.impactNote || null,
      pageId: a.pageId,
      pageTitle: a.pageTitle,
      releaseKey: a.releaseKey || null,
      riskAccepted: isRiskActive(a) ? { by: a.riskAccepted.by, until: a.riskAccepted.until } : null,
      count: a.lastCount,
      threshold: a.tripwire.threshold,
      windowDays: a.tripwire.windowDays,
      ticketKey: a.ticketKey,
      ticketStatus: a.ticketStatus,
      trippedAt: a.trippedAt || null,
      lastCheckedAt: a.lastCheckedAt,
      error: a.error || null,
    })),
  };
});

// ---- Releases: "is it safe to ship this?" The verdict is computed by code (lib/release.js). ----
// Every release with its verdict (only assumptions the viewer may see are counted).
resolver.define('getReleases', async () => {
  const { visible, hiddenCount } = await visibleAssumptions(api.asUser());
  const releases = groupByRelease(visible).map((g) => {
    const v = releaseVerdict(g.items);
    return { name: g.name, verdict: v.verdict, counts: v.counts };
  });
  return { releases, unlinked: visible.filter((a) => !a.releaseKey).length, hiddenCount };
});

// One release in detail: the verdict, the reasons, and each assumption.
resolver.define('getRelease', async (req) => {
  const { visible } = await visibleAssumptions(api.asUser());
  const items = visible.filter((a) => sameRelease(a.releaseKey, req.payload.release));
  const v = releaseVerdict(items);
  return {
    release: req.payload.release,
    verdict: v.verdict,
    sentence: verdictSentence(v.verdict, v.counts),
    counts: v.counts,
    reasons: v.reasons,
    canAcceptRisk: await isAdmin(),
    assumptions: items.map((a) => ({
      id: a.id, text: a.text, status: assessmentOf(a).status, severity: severityOf(a), count: a.lastCount, threshold: a.tripwire.threshold, ticketKey: a.ticketKey,
      riskAccepted: isRiskActive(a) ? { by: a.riskAccepted.by, reason: a.riskAccepted.reason, until: a.riskAccepted.until } : null,
    })),
  };
});

// Find an assumption the person is allowed to see (so decisions cannot be made on hidden ones).
async function visibleAssumptionById(id) {
  const { visible } = await visibleAssumptions(api.asUser());
  const found = visible.find((a) => a.id === id);
  if (!found) return null;
  const { pageTitle, ...stored } = found; // pageTitle is display-only and is never saved
  return stored;
}

// A person reviews ONE evidence issue: "contradicts", "supports", "unrelated", or "clear". This is what turns related evidence into a
// confirmed contradiction (or removes a false match). Needs only that the person can see the assumption's page.
resolver.define('reviewEvidence', async (req) => {
  const a = await visibleAssumptionById(req.payload.id);
  if (!a) return { error: 'Assumption not found, or you cannot see its page.' };
  const r = await reviewEvidence(a, req.payload.issueKey, req.payload.review, req.context.accountId);
  return r.error ? { error: r.error } : { ok: true, status: assessmentOf(r.assumption).status };
});

// How much a release depends on this assumption: "critical" (a contradiction blocks the release) or "standard" (it is a risk only).
resolver.define('setSeverity', async (req) => {
  const problem = validateSeverity(req.payload.severity);
  if (problem || !req.payload.severity) return { error: problem || 'Please choose critical or standard.' };
  const a = await visibleAssumptionById(req.payload.id);
  if (!a) return { error: 'Assumption not found, or you cannot see its page.' };
  await saveAssumption({ ...a, severity: req.payload.severity });
  await addAudit({ type: 'severity-changed', actor: req.context.accountId, assumptionId: a.id, text: a.text, detail: `Now "${req.payload.severity}" for its release.` });
  return { ok: true };
});

resolver.define('linkRelease', async (req) => {
  const a = await visibleAssumptionById(req.payload.id);
  if (!a) return { error: 'Assumption not found, or you cannot see its page.' };
  const r = await linkToRelease(a, req.payload.release, req.context.accountId);
  return r.error ? { error: r.error } : { ok: true };
});

resolver.define('acceptRisk', async (req) => {
  const a = await visibleAssumptionById(req.payload.id);
  if (!a) return { error: 'Assumption not found, or you cannot see its page.' };
  const r = await acceptRisk(a, { reason: req.payload.reason, days: req.payload.days }, req.context.accountId);
  return r.error ? { error: r.error } : { ok: true };
});

resolver.define('revokeRisk', async (req) => {
  const a = await visibleAssumptionById(req.payload.id);
  if (!a) return { error: 'Assumption not found, or you cannot see its page.' };
  const r = await revokeRisk(a, req.context.accountId);
  return r.error ? { error: r.error } : { ok: true };
});

// Add an assumption. The shared function validates the JQL with Jira BEFORE saving.
resolver.define('addAssumption', async (req) => {
  const result = await createAssumption({
    ...req.payload,
    pageId: pageIdOf(req),
    releaseKey: req.payload.release,
    accountId: req.context.accountId,
    requester: api.asUser(),
  });
  if (result.assumption) {
    await addAudit({ type: 'added', actor: req.context.accountId, assumptionId: result.assumption.id, text: result.assumption.text, detail: `Tripwire: ${result.assumption.tripwire.jql}` });
  }
  return result;
});

// "Suggest assumptions from this page": read the page, extract candidates with plain code.
// Nothing is saved here - the human confirms each one in the UI first.
resolver.define('suggestAssumptions', async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { error: 'Please enter the Confluence page ID first.' };
  try {
    const { title, storage } = await getPageBody(pageId);
    const existing = new Set((await listPageAssumptions(pageId)).map((a) => a.text.toLowerCase()));
    const suggestions = extractAssumptions(storage).filter((s) => !existing.has(s.text.toLowerCase()));
    return { pageTitle: title, suggestions };
  } catch (e) {
    return { error: e.message };
  }
});

// Build JQL from a template (pure code), so the UI can show it before saving.
resolver.define('buildTemplate', async (req) => buildTemplateJql(req.payload.template, req.payload.project, req.payload.value));

// ---- Doc freshness: has Jira work in this doc's area changed since the doc was last edited? ----
resolver.define('getDrift', async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { error: 'Please enter the Confluence page ID first.' };
  try {
    return await computeDrift(pageId, api.asUser());
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('saveDrift', async (req) => {
  const pageId = pageIdOf(req);
  if (!pageId) return { error: 'Please enter the Confluence page ID first.' };
  const scopeJql = String(req.payload.scopeJql || '').trim();
  if (!scopeJql) return { error: 'Please enter a JQL query that describes the Jira work this doc covers.' };
  if (/order\s+by/i.test(scopeJql)) return { error: 'Please remove "ORDER BY" from the JQL.' };
  try {
    await countIssues(scopeJql, api.asUser()); // validates the JQL with Jira
  } catch (e) {
    return { error: `Jira could not run that JQL. ${e.message}` };
  }
  await savePageConfig(pageId, { scopeJql });
  return { ok: true };
});

// ---- The agent's resolution plan: a person ticks the steps they approve, then Hindsight performs them AS THAT PERSON. ----
const STEP_RUNNERS = {
  comment: commentOnTicketAction,
  assign: assignTicketAction,
  task: createFollowupTaskAction,
  doc: updateDocSentenceAction,
  revise: reviseAssumptionAction,
};
const stepSucceeded = (r) => !r.error && Boolean(r.commented || r.assigned || r.created || r.updated || r.revised);
const stepText = (type, r) => ({
  comment: 'Comment posted.',
  assign: `Assigned to ${r.owner || 'the suggested owner'}.`,
  task: r.duplicate ? `Already existed as ${r.key}; no duplicate was created.` : `Created ${r.key}.`,
  doc: 'Design doc updated (the old version is in the page history).',
  revise: 'Assumption revised and reset to unchecked.',
}[type]);

resolver.define('applyPlan', async (req) => {
  const found = await visibleAssumptionById(req.payload.id);
  if (!found || !found.resolutionPlan) return { error: 'There is no plan to apply.' };
  const chosen = selectSteps(found.resolutionPlan, req.payload.stepIds);
  if (chosen.length === 0) return { error: 'Tick at least one step to apply.' };
  const context = { accountId: req.context.accountId };
  const results = {};
  for (const step of chosen) {
    const current = (await getAssumption(found.id)) || found; // reload, so an earlier step (like a revision) is respected
    let r;
    try {
      r = await STEP_RUNNERS[step.type](stepToPayload(step, current), context);
    } catch (e) {
      r = { error: e.message };
    }
    const ok = stepSucceeded(r);
    results[step.id] = { ok, text: ok ? stepText(step.type, r) : (r.error || 'This step did not complete.'), url: r.url || r.pageUrl || null };
  }
  // Save each step's outcome on the latest copy of the assumption.
  const latest = (await getAssumption(found.id)) || found;
  const steps = (latest.resolutionPlan?.steps || found.resolutionPlan.steps).map((s) => (results[s.id]
    ? { ...s, state: results[s.id].ok ? 'done' : 'failed', result: results[s.id].text, url: results[s.id].url }
    : s));
  await saveAssumption({ ...latest, resolutionPlan: { ...(latest.resolutionPlan || found.resolutionPlan), steps } });
  const done = Object.values(results).filter((x) => x.ok).length;
  await addAudit({ type: 'plan-applied', actor: req.context.accountId, assumptionId: found.id, text: found.text, detail: `${done} of ${chosen.length} step(s) done.` });
  return { ok: true, results };
});

resolver.define('dismissPlan', async (req) => {
  const found = await visibleAssumptionById(req.payload.id);
  if (!found) return { error: 'Assumption not found, or you cannot see its page.' };
  const { resolutionPlan, ...rest } = found;
  await saveAssumption(rest);
  await addAudit({ type: 'plan-discarded', actor: req.context.accountId, assumptionId: found.id, text: found.text, detail: 'The proposed plan was discarded.' });
  return { ok: true };
});

resolver.define('deleteAssumption', async (req) => {
  const a = await getAssumption(req.payload.id);
  if (a) {
    // Only the person who added it, or a site administrator, may delete an assumption.
    if (a.createdBy !== req.context.accountId && !(await isAdmin())) {
      return { error: 'Only the person who added this assumption, or a site administrator, can delete it.' };
    }
    await deleteAssumption(a);
    await addAudit({ type: 'deleted', actor: req.context.accountId, assumptionId: a.id, text: a.text });
  }
  return { ok: true };
});

// "Check now": runs as the clicking user, so the count only reflects issues they can see.
resolver.define('checkNow', async (req) => {
  const a = await getAssumption(req.payload.id);
  if (!a) return { error: 'Assumption not found.' };
  try {
    return { assumption: await checkAssumption(a, api.asUser(), req.context.accountId) };
  } catch (e) {
    return { error: e.message };
  }
});

export const handler = resolver.getDefinitions();
