// actions/index.js - the "hands" of the Rovo agent. The agent (AI) decides WHEN to call these; the code here
// does the real work, so every number and issue key the agent reports comes from CODE, never from the AI.
// Each action gets (payload, context): payload = the inputs + where the user is; context = who the user is.
// Each returns compact JSON (the platform limit is 5 MB; ours are a few KB).
import api from '@forge/api';
import { buildJql, suggestOwner } from '../lib/tripwire.js';
import { storageToText } from '../lib/extract.js';
import { createAssumption } from '../lib/assumptions.js';
import { computeDrift } from '../lib/drift.js';
import { countIssues, findEvidence, getSiteBaseUrl, getTicketProperty, findRevisitTicketKeys, addTicketComment, assignTicket, createFollowupTask, linkIssues, findOpenIssueByTitle } from '../lib/jira.js';
import { updatePageBody } from '../lib/confluence.js';
import { replaceSentence, suggestOwnerDetails, projectKeyOf, containsSentence } from '../lib/docedit.js';
import { validateTripwire } from '../lib/tripwire.js';
import { saveAssumption, getSettings } from '../lib/storage.js';
import { addAudit } from '../lib/audit.js';
import { buildPlanSteps } from '../lib/plan.js';
import { getPageBody } from '../lib/confluence.js';
import { getAssumption, listAllAssumptions, listPageAssumptions } from '../lib/storage.js';
import { visibleAssumptions } from '../lib/visibility.js';
import { releaseVerdict, verdictSentence, groupByRelease, sameRelease, normalizeRelease, isRiskActive, severityOf } from '../lib/release.js';
import { assess, assessmentOf, needsAttention, EVIDENCE_FETCH } from '../lib/assess.js';
import { linkToRelease, acceptRisk } from '../lib/risk.js';

// The page id: either given by the agent/user, or the page the user has open in Rovo chat.
// Confluence page ids are plain numbers. An agent working on a Jira ticket may pass something else (like "KAN-8"),
// so anything that is not a number is ignored instead of being treated as a page.
const asPageId = (v) => (/^\d+$/.test(String(v || '').trim()) ? String(v).trim() : '');
const pageIdFrom = (payload) => asPageId(payload?.pageId) || asPageId(payload?.context?.confluence?.contentId);
const TICKET_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

// A compact view of an assumption (only what the agent needs, never the whole record).
const pageUrl = (base, pageId) => (base ? `${base}/wiki/pages/viewpage.action?pageId=${pageId}` : null);
const issueUrl = (base, key) => (base && key ? `${base}/browse/${key}` : null);

const brief = (a, base = '') => ({
  id: a.id,
  text: a.text,
  status: assessmentOf(a).status,
  statusReasons: assessmentOf(a).reasons,
  evidenceKind: assessmentOf(a).mode,
  severity: severityOf(a),
  pageId: a.pageId,
  count: a.lastCount,
  threshold: a.tripwire.threshold,
  windowDays: a.tripwire.windowDays,
  jql: a.tripwire.jql,
  lastCheckedAt: a.lastCheckedAt,
  ticket: a.ticketKey ? { key: a.ticketKey, status: a.ticketStatus, url: issueUrl(base, a.ticketKey) } : null,
  pageUrl: pageUrl(base, a.pageId),
  release: a.releaseKey || null,
  riskAccepted: isRiskActive(a) ? { by: a.riskAccepted.byName, reason: a.riskAccepted.reason, until: a.riskAccepted.until } : null,
});

// Agents describe a status in their own words ("broken", "open", "failing"...). Map them to ours; anything we do not
// understand returns '' (meaning: do not filter), so an unfamiliar word can never hide all the data.
export function normaliseStatus(word) {
  const w = String(word || '').trim().toLowerCase();
  if (['attention', 'tripped', 'broken', 'failed', 'failing', 'violated', 'red'].includes(w)) return 'attention'; // contradicted or at risk
  if (['contradicted', 'disproved'].includes(w)) return 'contradicted';
  if (['at-risk', 'at risk', 'risk', 'risky', 'investigate', 'investigation'].includes(w)) return 'at-risk';
  if (['healthy', 'ok', 'good', 'passing', 'holding', 'green'].includes(w)) return 'healthy';
  if (['unverified', 'unchecked', 'pending', 'new', 'never checked'].includes(w)) return 'unverified';
  if (['stale', 'old', 'outdated'].includes(w)) return 'stale';
  return '';
}

// ACTION list-assumptions (GET): which assumptions exist? Optional filters: page, status, ticket key.
// Filters are forgiving: if they would match nothing we show everything and say so, so the agent never wrongly
// concludes that "no assumptions are tracked".
export async function listAssumptionsAction(payload) {
  try {
    console.log(`list-assumptions inputs: ${JSON.stringify({ status: payload?.status, pageId: payload?.pageId, ticketKey: payload?.ticketKey, thisPage: payload?.thisPage })}`);
    const pageId = payload?.thisPage ? pageIdFrom(payload) : asPageId(payload?.pageId);
    const visibleIds = new Set((await visibleAssumptions(api.asUser())).visible.map((a) => a.id));
    const everything = (pageId ? await listPageAssumptions(pageId) : await listAllAssumptions()).filter((a) => visibleIds.has(a.id));
    let items = everything;
    const ticketKey = String(payload?.ticketKey || '').trim().toUpperCase();
    if (TICKET_KEY.test(ticketKey)) items = items.filter((a) => a.ticketKey === ticketKey);
    const status = normaliseStatus(payload?.status);
    const matchesStatus = (a) => (status === 'attention' ? needsAttention(assessmentOf(a).status) : assessmentOf(a).status === status);
    if (status) items = items.filter(matchesStatus);

    // Nothing stored on this side (the Jira installation has its own, empty storage): fall back to the newest Revisit tickets.
    if (items.length === 0 && everything.length === 0) {
      try {
        const found = [];
        for (const key of await findRevisitTicketKeys(10)) {
          const a = fromTicketProperty(key, await getTicketProperty(key));
          if (a) found.push(a);
        }
        items = found.filter((a) => !status || matchesStatus(a));
        if (items.length === 0) items = found;
      } catch (e) {
        console.error(`Revisit ticket fallback failed: ${e.message}`);
      }
    }

    let note = 'Counts were produced by Hindsight code at lastCheckedAt. Do not alter them. Use the url fields exactly as given; never build a link yourself.';
    if (items.length === 0 && everything.length > 0) {
      items = everything; // the filters matched nothing, so show everything rather than hide it
      note += ' NOTE: no assumption matched the requested filters, so ALL tracked assumptions are listed instead.';
    }
    let base = '';
    try { base = await getSiteBaseUrl(); } catch (e) { /* links are optional */ }
    console.log(`list-assumptions: returning ${items.length} item(s); site base url is ${base || '(unavailable)'}`);
    return {
      total: items.length,
      needAttention: items.filter((a) => needsAttention(assessmentOf(a).status)).length,
      contradicted: items.filter((a) => assessmentOf(a).status === 'contradicted').length,
      atRisk: items.filter((a) => assessmentOf(a).status === 'at-risk').length,
      assumptions: items.slice(0, 50).map((a) => brief(a, base)),
      note,
    };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { error: e.message };
  }
}

// Builds an assumption-shaped object from the summary stored on a Revisit ticket (see lib/checker.js).
function fromTicketProperty(ticketKey, prop) {
  if (!prop || !prop.text) return null;
  return {
    id: prop.assumptionId || null,
    text: prop.text,
    status: prop.status || (prop.ticketStatus === 'open' ? 'tripped' : 'unchecked'),
    assessment: prop.assessmentStatus ? { status: prop.assessmentStatus, reasons: prop.reasons || [], counts: { matched: prop.count ?? null, threshold: prop.threshold }, mode: 'related' } : undefined,
    releaseKey: prop.releaseKey || null,
    severity: prop.severity || 'critical',
    pageId: prop.pageId,
    lastCount: prop.count ?? null,
    tripwire: { jql: prop.jql, windowDays: prop.windowDays, threshold: prop.threshold },
    lastCheckedAt: prop.lastCheckedAt || null,
    ticketKey,
    ticketStatus: prop.ticketStatus || null,
    fromTicket: true, // read from the ticket, so it is NOT stored on this side and must not be edited from here
  };
}

// Find one assumption. We try every clue the agent gave us, in order, and never stop at the first miss:
//   1. an exact assumption id        2. a Jira ticket key (in ticketKey, assumptionId or the text)
//   3. the words of the assumption (best word overlap)
async function findAssumption(payload) {
  const { visible } = await visibleAssumptions(api.asUser());
  const all = visible.map(({ pageTitle, ...stored }) => stored); // pageTitle is display-only, never saved
  const clues = [payload?.assumptionId, payload?.ticketKey, payload?.text].map((v) => String(v || '').trim());

  // 1) exact id
  if (payload?.assumptionId) {
    const byId = all.find((a) => a.id === String(payload.assumptionId).trim());
    if (byId) return byId;
  }
  // 2) any clue that contains a Jira ticket key like KAN-8 (agents sometimes put it in the wrong input)
  for (const clue of clues) {
    const m = clue.toUpperCase().match(/[A-Z][A-Z0-9_]+-\d+/);
    if (m) {
      const byTicket = all.find((a) => a.ticketKey === m[0]);
      if (byTicket) return byTicket;
      // Nothing stored on this side (for example when started from a Jira ticket): read the summary kept on the ticket.
      try {
        const fromTicket = fromTicketProperty(m[0], await getTicketProperty(m[0]));
        if (fromTicket) return fromTicket;
      } catch (e) {
        console.error(`Could not read details from ${m[0]}: ${e.message}`);
      }
    }
  }
  // 3) words of the assumption
  const words = String(payload?.text || '').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (words.length === 0) return null;
  let best = null;
  for (const a of all) {
    const hay = a.text.toLowerCase();
    const score = words.filter((w) => hay.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { a, score };
  }
  return best ? best.a : null;
}

// ACTION explain-assumption (GET): the assumption + LIVE count + evidence issues + owner suggestion.
// READ-ONLY: it never creates tickets or changes status. The agent reads the evidence and judges relevance.
export async function explainAssumptionAction(payload) {
  try {
    console.log(`explain-assumption inputs: ${JSON.stringify({ assumptionId: payload?.assumptionId, ticketKey: payload?.ticketKey, text: payload?.text })}`);
    const a = await findAssumption(payload);
    if (!a) return { error: 'No matching assumption found. Ask the user which assumption they mean, or call list-assumptions.' };
    const jql = buildJql(a.tripwire.jql, a.tripwire.windowDays);
    // As the user, so the evidence only includes issues they are allowed to see.
    const requester = api.asUser();
    let base = '';
    try { base = await getSiteBaseUrl(requester); } catch (e) { /* links are optional */ }
    const liveCount = await countIssues(jql, requester);
    const evidence = liveCount > 0 ? await findEvidence(jql, EVIDENCE_FETCH, requester) : [];
    return {
      assumption: brief(a, base),
      liveCount,
      // The status NOW, computed by code from the live count and the reviews a person made. The agent must not change it.
      assessmentNow: assess({ assumption: a, count: liveCount, evidence }),
      evidenceReviews: a.evidenceReviews || {},
      evidence: evidence.slice(0, 10).map((i) => ({
        key: i.key,
        url: issueUrl(base, i.key),
        summary: i.fields.summary,
        status: i.fields.status?.name,
        assignee: i.fields.assignee?.displayName || null,
      })),
      suggestedOwner: suggestOwner(evidence),
    };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { error: e.message };
  }
}

// ACTION get-page-content (GET): the page text, so the agent can read it and propose assumptions.
export async function getPageContentAction(payload) {
  try {
    const pageId = pageIdFrom(payload);
    if (!pageId) return { error: 'No page is open. Ask the user for the Confluence page ID.' };
    const { title, storage } = await getPageBody(pageId); // as the user
    const text = storageToText(storage).replace(/\n{2,}/g, '\n').trim();
    const saved = (await listPageAssumptions(pageId)).map((a) => a.text);
    return {
      pageId,
      title,
      text: text.slice(0, 12000),
      truncated: text.length > 12000,
      alreadySavedAssumptions: saved,
    };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { error: e.message };
  }
}

// ACTION doc-freshness (GET): has Jira work changed since the page was last edited?
export async function docFreshnessAction(payload) {
  try {
    const pageId = pageIdFrom(payload);
    if (!pageId) return { error: 'No page is open. Ask the user for the Confluence page ID.' };
    const base = await getSiteBaseUrl();
    const drift = await computeDrift(pageId, api.asUser(), 10);
    if (drift.issues) drift.issues = drift.issues.map((i) => ({ ...i, url: issueUrl(base, i.key) }));
    drift.pageUrl = pageUrl(base, pageId);
    return drift;
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { error: e.message };
  }
}

// ACTION save-assumption (CREATE): ONLY after the user has said yes to a specific assumption.
export async function saveAssumptionAction(payload, context) {
  try {
    const result = await createAssumption({
      pageId: pageIdFrom(payload),
      text: payload?.text,
      jql: payload?.jql,
      windowDays: payload?.windowDays ?? 14,
      threshold: payload?.threshold ?? 3,
      template: 'rovo',
      accountId: context?.accountId,
      requester: api.asUser(),
    });
    if (result.error) return { saved: false, error: result.error };
    return { saved: true, assumption: brief(result.assumption, await getSiteBaseUrl()) };
  } catch (e) {
    return { saved: false, error: e.message };
  }
}

// ACTION release-readiness (GET): "is this release safe to ship?" The verdict is computed by code (fixed rules in lib/release.js).
export async function releaseReadinessAction(payload) {
  try {
    const { visible } = await visibleAssumptions(api.asUser());
    const release = normalizeRelease(payload?.release);
    let base = '';
    try { base = await getSiteBaseUrl(); } catch (e) { /* links are optional */ }
    if (!release) {
      return {
        releases: groupByRelease(visible).map((g) => {
          const v = releaseVerdict(g.items);
          return { release: g.name, verdict: v.verdict, counts: v.counts };
        }),
        note: 'No release was named. Ask the user which release they mean.',
      };
    }
    const items = visible.filter((a) => sameRelease(a.releaseKey, release));
    const v = releaseVerdict(items);
    console.log(`release-readiness: "${release}" -> ${v.verdict} (${items.length} assumption(s))`);
    return {
      release,
      verdict: v.verdict,
      summary: verdictSentence(v.verdict, v.counts),
      counts: v.counts,
      reasons: v.reasons,
      assumptions: items.map((a) => brief(a, base)),
      note: 'The verdict was computed by Hindsight code from fixed rules. Report it exactly as given. NEVER call a release safe unless the verdict is "ready". Use url fields exactly as given.',
    };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { error: e.message };
  }
}

// ACTION link-assumption (UPDATE): link ONE assumption to a release. Only after the user has confirmed.
export async function linkAssumptionAction(payload, context) {
  try {
    const a = await findAssumption(payload);
    if (!a) return { linked: false, error: 'No matching assumption found. Ask the user which assumption they mean.' };
    const r = await linkToRelease(a, payload?.release, context?.accountId || 'rovo');
    if (r.error) return { linked: false, error: r.error };
    return { linked: true, assumption: brief(r.assumption) };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { linked: false, error: e.message };
  }
}

// ACTION accept-risk (UPDATE): record that the team knowingly ships with a tripped assumption.
// Site administrators only (checked in code). Needs the person's own written reason. Only after an explicit yes.
export async function acceptRiskAction(payload, context) {
  try {
    const a = await findAssumption(payload);
    if (!a) return { accepted: false, error: 'No matching assumption found. Ask the user which assumption they mean.' };
    const r = await acceptRisk(a, { reason: payload?.reason, days: payload?.days }, context?.accountId || 'rovo');
    if (r.error) return { accepted: false, error: r.error };
    return { accepted: true, assumption: brief(r.assumption) };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { accepted: false, error: e.message };
  }
}

// ====================================================================================================
// "Do the work" actions. Each one runs AS THE PERSON who asked (Jira and Confluence check their permissions),
// is told to run only after an explicit yes, and returns its real result so the agent cannot pretend.
// ====================================================================================================
const ticketKeyOf = (v) => {
  const k = String(v || '').trim().toUpperCase();
  return TICKET_KEY.test(k) ? k : '';
};
const FROM_TICKET_MESSAGE = 'This assumption was read from its Jira ticket, so it can only be changed from Confluence (Rovo chat there, or the Hindsight panel).';

async function siteBase() {
  try { return await getSiteBaseUrl(); } catch (e) { return ''; }
}

// ACTION comment-on-ticket (UPDATE): post the agent's evidence review on the Revisit ticket.
// The agent writes the words; this action adds a line with the numbers computed by code.
export async function commentOnTicketAction(payload, context) {
  try {
    const ticketKey = ticketKeyOf(payload?.ticketKey);
    if (!ticketKey) return { commented: false, error: 'Please give the Jira ticket key, for example KAN-12.' };
    const comment = String(payload?.comment || '').trim();
    if (comment.length < 10) return { commented: false, error: 'Please provide the comment text (at least 10 characters).' };
    let footer = '';
    const a = await findAssumption({ ticketKey });
    if (a) {
      const count = await countIssues(buildJql(a.tripwire.jql, a.tripwire.windowDays), api.asUser());
      footer = `\nHindsight numbers (computed by code): ${count} matching issue(s) in the last ${a.tripwire.windowDays} days; this assumption trips at ${a.tripwire.threshold}.`;
    }
    await addTicketComment(ticketKey, `${comment}${footer}\n(Posted by the Hindsight agent on behalf of the person who asked.)`, api.asUser());
    await addAudit({ type: 'agent-comment', actor: context?.accountId || 'rovo', text: a?.text || '', detail: `Commented on ${ticketKey}.` });
    const base = await siteBase();
    return { commented: true, ticket: ticketKey, url: issueUrl(base, ticketKey) };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { commented: false, error: e.message };
  }
}

// ACTION assign-ticket (UPDATE): assign the Revisit ticket to the suggested owner (worked out from the evidence, by code).
export async function assignTicketAction(payload, context) {
  try {
    const a = await findAssumption(payload);
    if (!a) return { assigned: false, error: 'No matching assumption found. Ask the user which assumption they mean.' };
    const ticketKey = a.ticketKey || ticketKeyOf(payload?.ticketKey);
    if (!ticketKey) return { assigned: false, error: 'This assumption has no Revisit ticket yet.' };
    const evidence = await findEvidence(buildJql(a.tripwire.jql, a.tripwire.windowDays), 25, api.asUser());
    const owner = suggestOwnerDetails(evidence);
    if (!owner) return { assigned: false, error: 'None of the evidence issues has an assignee or reporter, so no owner could be suggested. Assign it by hand.' };
    await assignTicket(ticketKey, owner.accountId, api.asUser());
    await addAudit({ type: 'agent-assign', actor: context?.accountId || 'rovo', text: a.text, detail: `Assigned ${ticketKey} to ${owner.displayName || owner.accountId}.` });
    const base = await siteBase();
    return { assigned: true, ticket: ticketKey, owner: owner.displayName, url: issueUrl(base, ticketKey) };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { assigned: false, error: e.message };
  }
}

// ACTION create-followup-task (CREATE): create a Jira task for concrete follow-up work and link it to the Revisit ticket.
export async function createFollowupTaskAction(payload, context) {
  try {
    const summary = String(payload?.summary || '').trim();
    if (summary.length < 5) return { created: false, error: 'Please give a short summary for the task (at least 5 characters).' };
    const ticketKey = ticketKeyOf(payload?.ticketKey);
    const settings = await getSettings();
    const projectKey = projectKeyOf(ticketKey) || settings.projectKey;
    if (!projectKey) return { created: false, error: 'No Jira project is known. Give the Revisit ticket key, or choose a project in Hindsight settings.' };
    const description = [String(payload?.description || '').trim(), ticketKey ? `Created by the Hindsight agent for ${ticketKey}.` : 'Created by the Hindsight agent.'].filter(Boolean).join('\n');
    // No duplicates: if an OPEN task with this title already exists in the project, reuse it.
    const existing = await findOpenIssueByTitle(projectKey, summary);
    if (existing) {
      await addAudit({ type: 'agent-task', actor: context?.accountId || 'rovo', detail: `${existing} already existed for "${summary}"; no duplicate was created.` });
      const known = await siteBase();
      return { created: true, duplicate: true, key: existing, url: issueUrl(known, existing) };
    }
    const key = await createFollowupTask({ projectKey, summary, description, requester: api.asUser() });
    if (ticketKey) await linkIssues(key, ticketKey);
    await addAudit({ type: 'agent-task', actor: context?.accountId || 'rovo', detail: `Created ${key}${ticketKey ? ` (related to ${ticketKey})` : ''}: ${summary}` });
    const base = await siteBase();
    return { created: true, key, url: issueUrl(base, key) };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { created: false, error: e.message };
  }
}

// ACTION revise-assumption (UPDATE): change an assumption's wording, threshold, window or query, and reset it to "unchecked"
// so Hindsight starts watching the revised claim. The Jira query is tested with Jira before saving.
export async function reviseAssumptionAction(payload, context) {
  try {
    const a = await findAssumption(payload);
    if (!a) return { revised: false, error: 'No matching assumption found. Ask the user which assumption they mean.' };
    if (a.fromTicket) return { revised: false, error: FROM_TICKET_MESSAGE };
    const tripwire = { ...a.tripwire };
    if (payload?.jql) tripwire.jql = String(payload.jql).trim();
    if (payload?.windowDays) tripwire.windowDays = Number(payload.windowDays);
    if (payload?.threshold) tripwire.threshold = Number(payload.threshold);
    const problem = validateTripwire(tripwire);
    if (problem) return { revised: false, error: problem };
    const newText = String(payload?.newText || '').trim();
    if (!newText && !payload?.jql && !payload?.windowDays && !payload?.threshold) return { revised: false, error: 'Nothing to change. Give a new wording, threshold, window or query.' };
    try {
      await countIssues(buildJql(tripwire.jql, tripwire.windowDays), api.asUser()); // let Jira check the query first
    } catch (e) {
      return { revised: false, error: `Jira could not run that query. ${e.message}` };
    }
    const { riskAccepted, evidence, impactNote, suggestedOwner, assessment, evidenceReviews, ...rest } = a;
    const updated = { ...rest, text: newText || a.text, tripwire, status: 'unchecked', lastCount: null, lastCheckedAt: null, trippedAt: null, error: null };
    await saveAssumption(updated);
    await addAudit({ type: 'assumption-revised', actor: context?.accountId || 'rovo', assumptionId: a.id, text: updated.text, detail: `Was: "${a.text}". Reset to unchecked.` });
    return { revised: true, assumption: brief(updated, await siteBase()) };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { revised: false, error: e.message };
  }
}

// ACTION update-doc-sentence (UPDATE): replace ONE sentence in the design doc. It edits only when the sentence appears exactly
// once, runs as the person (Confluence checks they may edit), and the old version stays in the page history.
export async function updateDocSentenceAction(payload, context) {
  try {
    const a = (payload?.ticketKey || payload?.assumptionId || payload?.text) ? await findAssumption(payload) : null;
    const pageId = asPageId(payload?.pageId) || (a ? a.pageId : '');
    if (!pageId) return { updated: false, error: 'Which page? Give the page ID, or identify the assumption (ticket key or its words).' };
    const oldSentence = String(payload?.oldSentence || '').trim() || (a ? a.text : '');
    const newSentence = String(payload?.newSentence || '').trim();
    if (!newSentence) return { updated: false, error: 'Please give the new sentence.' };
    const page = await getPageBody(pageId); // as the person
    const result = replaceSentence(page.storage, oldSentence, newSentence);
    if (result.error) return { updated: false, error: result.error };
    await updatePageBody(pageId, {
      title: page.title,
      value: result.value,
      versionNumber: page.versionNumber + 1,
      message: 'Hindsight: updated an assumption after Jira evidence contradicted it',
    }, api.asUser());
    // VERIFY: read the page again. A save that did not really change the page is never reported as a success.
    const after = await getPageBody(pageId);
    if (!containsSentence(after.storage, newSentence)) {
      return { updated: false, error: 'The page was saved, but the new sentence could not be found on it afterwards. Please check the page by hand.' };
    }
    await addAudit({ type: 'doc-updated', actor: context?.accountId || 'rovo', assumptionId: a?.id || null, text: newSentence, detail: `Page ${pageId}: replaced "${oldSentence}".` });
    const base = await siteBase();
    return { updated: true, pageUrl: pageUrl(base, pageId), note: 'The previous version of the page is kept in its history.' };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { updated: false, error: e.message };
  }
}

// ACTION propose-resolution (UPDATE): the agent DRAFTS a plan (comment text, follow-up tasks, a new sentence, an assumption change).
// Nothing is done here: the plan is saved on the assumption, and a person ticks the steps they approve in the Hindsight panel.
export async function proposeResolutionAction(payload, context) {
  try {
    const a = await findAssumption(payload);
    if (!a) return { planned: false, error: 'No matching assumption found. Ask the user which assumption they mean.' };
    if (a.fromTicket) return { planned: false, error: `${FROM_TICKET_MESSAGE} Describe the plan in your reply instead.` };
    const built = buildPlanSteps({
      comment: payload?.comment,
      assignOwner: payload?.assignOwner,
      followupTasks: payload?.followupTasks,
      newSentence: payload?.newSentence,
      newThreshold: payload?.newThreshold,
      newWindowDays: payload?.newWindowDays,
      newJql: payload?.newJql,
    }, a);
    if (built.error) return { planned: false, error: built.error };
    const updated = { ...a, resolutionPlan: { createdAt: new Date().toISOString(), createdBy: context?.accountId || 'rovo', origin: 'agent', steps: built.steps } };
    await saveAssumption(updated);
    await addAudit({ type: 'plan-proposed', actor: context?.accountId || 'rovo', assumptionId: a.id, text: a.text, detail: `${built.steps.length} step(s) proposed by the agent.` });
    const base = await siteBase();
    return {
      planned: true,
      steps: built.steps.map((st) => st.label),
      pageUrl: pageUrl(base, a.pageId),
      instructions: 'Tell the user the plan is READY BUT NOTHING HAS BEEN DONE. They open the design doc, click Hindsight under the title, find the assumption, tick the steps they approve, and click Apply.',
    };
  } catch (e) {
    console.error(`Hindsight action failed: ${e.message}`);
    return { planned: false, error: e.message };
  }
}
