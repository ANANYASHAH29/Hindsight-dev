// checker.js - checks ONE assumption against Jira and reacts: assessment, ticket, impact note, comment, audit.
// The hourly scheduler and the "Check now" button both call this.
//
// Rules this file keeps:
//   * Numbers and statuses come from CODE (lib/assess.js). Nothing here asks an AI.
//   * At most ONE Revisit ticket per problem, even if two checks run at the same moment (see "idempotency" below).
//   * Every change of status is written to the audit log.
import { buildJql, decideTicket, suggestOwner, buildImpactNote } from './tripwire.js';
import { assess, assessmentOf, statusToLegacy, needsAttention, EVIDENCE_FETCH, STATUS_LABEL } from './assess.js';
import { releaseVerdict, groupByRelease, sameRelease } from './release.js';
import {
  countIssues, findEvidence, getTicketState, createRevisitTicket, findOpenIssueByTitle, setTicketProperty,
} from './jira.js';
import { getPageBody, addFooterComment } from './confluence.js';
import {
  getSettings, getAssumption, saveAssumption, listAllAssumptions, acquireLock, releaseLock, getReleaseVerdict, saveReleaseVerdict,
} from './storage.js';
import { addAudit } from './audit.js';
import { draftAutoPlan, planFinished } from './plan.js';

// `requester` is api.asUser() when a person clicked, or api.asApp() for the scheduler.
// `actor` is who to record in the audit log (an accountId, or 'scheduler').
export async function checkAssumption(assumption, requester, actor = 'app') {
  // IDEMPOTENCY (1/3): a short "check running" lock, so "Check now" and the hourly run cannot overlap on the same assumption.
  // (Forge storage has no atomic compare-and-set, so this lock is best-effort. Steps 2 and 3 below make duplicates impossible anyway.)
  if (!(await acquireLock(assumption.id))) {
    return { ...assumption, error: 'A check for this assumption is already running. Please wait a moment and try again.', skipped: true };
  }
  try {
    return await runCheck(assumption, requester, actor);
  } finally {
    await releaseLock(assumption.id);
  }
}

async function runCheck(given, requester, actor) {
  const settings = await getSettings();
  // Always work from the freshest stored copy: another run may have saved a ticket key or a person's review a moment ago.
  const assumption = (await getAssumption(given.id)) || given;
  const now = new Date();
  const jql = buildJql(assumption.tripwire.jql, assumption.tripwire.windowDays);

  // 1. NUMBERS COME FROM CODE: ask Jira how many issues match, and load the matching issues (so reviews can be applied).
  const count = await countIssues(jql, requester);
  const matches = count > 0 ? await findEvidence(jql, EVIDENCE_FETCH, requester) : [];
  const result = assess({ assumption, count, evidence: matches });
  const before = assessmentOf(assumption, now).status;

  const evidence = matches.slice(0, 10).map((i) => ({ key: i.key, summary: i.fields.summary, status: i.fields.status?.name || null }));
  const updated = {
    ...assumption,
    status: statusToLegacy(result.status), // kept so data and screens from earlier versions keep working
    assessment: { ...result, evaluatedAt: now.toISOString() },
    lastCount: count,
    lastCheckedAt: now.toISOString(),
    evidence,
    error: null,
  };
  const attention = needsAttention(result.status);

  // 2. Ticket policy: a Revisit ticket exists only while the assumption needs attention.
  const ticketState = await getTicketState(assumption.ticketKey);
  const decision = decideTicket(result.status, ticketState);

  if (attention) {
    updated.trippedAt = assumption.trippedAt || updated.lastCheckedAt;
    updated.suggestedOwner = suggestOwner(matches);
    let pageTitle = null;
    try { pageTitle = (await getPageBody(assumption.pageId, requester)).title; } catch (e) { /* the title is optional */ }
    updated.impactNote = buildImpactNote({ assumption, count, evidence, owner: updated.suggestedOwner, pageTitle, assessment: updated.assessment });
  } else {
    updated.trippedAt = null;
    updated.impactNote = null;
  }

  if (decision === 'create') {
    if (!settings.projectKey) {
      updated.error = `${STATUS_LABEL[result.status]}, but no Jira project is chosen for tickets. Choose one in Settings.`;
    } else {
      // IDEMPOTENCY (2/3): before creating anything, look in Jira for an OPEN ticket with this exact title. If one exists
      // (for example a concurrent run just made it), adopt it instead of creating another.
      const title = `Revisit assumption: ${assumption.text}`;
      const existing = await findOpenIssueByTitle(settings.projectKey, title);
      if (existing) {
        updated.ticketKey = existing;
        updated.ticketStatus = 'open';
        await addAudit({ type: 'ticket-adopted', actor, assumptionId: assumption.id, text: assumption.text, detail: `Reused the open ticket ${existing}; no duplicate was created.` });
      } else {
        // IDEMPOTENCY (3/3): the ticket key is saved straight after creating, so the next check sees it and only updates.
        updated.ticketKey = await createRevisitTicket({ projectKey: settings.projectKey, assumption, count, jql, evidence: matches, assessment: updated.assessment });
        updated.ticketStatus = 'open';
        await addAudit({ type: 'ticket-created', actor, assumptionId: assumption.id, text: assumption.text, detail: `Created ${updated.ticketKey} (${STATUS_LABEL[result.status]}).` });
        // Optional Confluence comment, only when a NEW ticket is created (so it is never repeated) and the setting is on.
        if (settings.confluenceComments) {
          try {
            await addFooterComment(assumption.pageId, `Hindsight: "${assumption.text}" is now ${STATUS_LABEL[result.status].toLowerCase()} - see ${updated.ticketKey}. ${count} matching Jira issue(s).`);
            await addAudit({ type: 'comment-added', actor, assumptionId: assumption.id, text: assumption.text, detail: `Commented on page ${assumption.pageId}.` });
          } catch (e) {
            updated.error = `Ticket created, but the Confluence comment failed: ${e.message}`;
          }
        }
      }
    }
  } else if (decision === 'update') {
    updated.ticketStatus = 'open'; // the ticket is already open: only the numbers changed
  } else {
    updated.ticketStatus = ticketState === 'none' ? null : ticketState;
  }

  // 2b. The recommended plan: prepared AUTOMATICALLY once per episode (when it starts needing attention), so nobody has to ask for it.
  //     A person who discards it is not nagged again until the assumption has recovered and breaks again.
  if (attention) {
    if (!updated.autoPlanned && planFinished(updated.resolutionPlan)) {
      const drafted = draftAutoPlan({
        assumption: updated, assessment: updated.assessment, evidence, owner: updated.suggestedOwner,
        canCreateTasks: Boolean(settings.projectKey || updated.ticketKey),
      });
      if (drafted) {
        updated.resolutionPlan = { createdAt: now.toISOString(), createdBy: 'hindsight', origin: 'auto', steps: drafted.steps };
        updated.autoPlanned = true;
        await addAudit({ type: 'plan-proposed', actor: 'hindsight', assumptionId: assumption.id, text: assumption.text, detail: `${drafted.steps.length} step(s) prepared automatically. Waiting for a person's approval.` });
      }
    }
  } else {
    updated.autoPlanned = false;
  }

  await saveAssumption(updated);

  // 3. Audit: every change of status, with the reason.
  if (before !== result.status) {
    await addAudit({
      type: 'status-changed', actor, assumptionId: assumption.id, text: assumption.text,
      detail: `${STATUS_LABEL[before]} -> ${STATUS_LABEL[result.status]}. ${result.reasons[0] || ''}`,
    });
  }

  await mirrorToTicket(updated);
  await recordReleaseVerdict(updated.releaseKey, actor);
  return updated;
}

// Mirror a small summary onto the ticket so it can be read from the Jira side too (Forge storage is separate per product).
async function mirrorToTicket(a) {
  if (!a.ticketKey) return;
  try {
    await setTicketProperty(a.ticketKey, {
      assumptionId: a.id,
      text: a.text,
      pageId: a.pageId,
      status: a.status,
      assessmentStatus: a.assessment?.status || null,
      reasons: a.assessment?.reasons || [],
      count: a.lastCount,
      threshold: a.tripwire.threshold,
      windowDays: a.tripwire.windowDays,
      jql: a.tripwire.jql,
      releaseKey: a.releaseKey || null,
      severity: a.severity || 'critical',
      ticketStatus: a.ticketStatus,
      lastCheckedAt: a.lastCheckedAt,
    });
  } catch (e) {
    console.error(`Could not save details on ticket ${a.ticketKey}: ${e.message}`);
  }
}

// When the verdict of a release changes (for example Ready -> Blocked), write it to the audit log.
export async function recordReleaseVerdict(releaseKey, actor = 'app') {
  if (!releaseKey) return;
  try {
    const all = await listAllAssumptions();
    const group = groupByRelease(all).find((g) => sameRelease(g.name, releaseKey));
    if (!group) return;
    const { verdict } = releaseVerdict(group.items);
    const previous = await getReleaseVerdict(group.name);
    if (previous !== verdict) {
      await saveReleaseVerdict(group.name, verdict);
      if (previous) await addAudit({ type: 'release-verdict-changed', actor, text: group.name, detail: `${previous} -> ${verdict}.` });
    }
  } catch (e) {
    console.error(`Could not record the release verdict for "${releaseKey}": ${e.message}`);
  }
}
