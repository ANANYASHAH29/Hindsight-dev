// assumptions.js - creating an assumption. Shared by the panel (resolvers) AND the Rovo agent (actions),
// so both go through exactly the same validation.
import { randomUUID } from 'node:crypto';
import { validateTripwire, buildJql } from './tripwire.js';
import { validateRelease, normalizeRelease } from './release.js';
import { countIssues } from './jira.js';
import { saveAssumption } from './storage.js';

// Returns { assumption } or { error }. `requester` is api.asUser() so Jira checks the person's permissions.
export async function createAssumption({ pageId, text, jql, windowDays, threshold, template, releaseKey, accountId, requester }) {
  if (!text || !String(text).trim()) return { error: 'Please describe the assumption.' };
  if (!pageId) return { error: 'Please say which Confluence page this assumption belongs to.' };
  const problem = validateTripwire({ jql, windowDays, threshold });
  if (problem) return { error: problem };
  if (releaseKey && String(releaseKey).trim()) {
    const releaseProblem = validateRelease(releaseKey);
    if (releaseProblem) return { error: releaseProblem };
  }
  try {
    // Ask Jira to run the query once, so a broken JQL is rejected BEFORE we save anything.
    await countIssues(buildJql(jql, windowDays), requester);
  } catch (e) {
    return { error: `Jira could not run that JQL. ${e.message}` };
  }
  const assumption = {
    id: randomUUID(),
    pageId: String(pageId),
    text: String(text).trim(),
    tripwire: { type: String(template || 'custom'), jql: String(jql).trim(), windowDays: Number(windowDays), threshold: Number(threshold) },
    status: 'unchecked',
    lastCount: null,
    lastCheckedAt: null,
    ticketKey: null,
    ticketStatus: null,
    releaseKey: releaseKey && String(releaseKey).trim() ? normalizeRelease(releaseKey) : null,
    createdBy: accountId || null,
    createdAt: new Date().toISOString(),
  };
  await saveAssumption(assumption);
  return { assumption };
}
