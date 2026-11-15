// jira.js - all Jira REST calls live here.
// api.asUser() = runs with the permissions of the person clicking (they only see what they may see).
// api.asApp()  = runs as the app itself (needed for creating tickets / the scheduler).
// Every call retries politely if Jira says "slow down" (rate limit) and reports problems in plain English.
import api, { route } from '@forge/api';
import { sendWithRetry, failWith } from './http.js';
import { toAdf, normalizeTitle } from './docedit.js';
import { STATUS_LABEL } from './assess.js';

const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

// How many issues match this JQL?
export async function countIssues(jql, requester = api.asApp()) {
  const res = await sendWithRetry(() => requester.requestJira(route`/rest/api/3/search/approximate-count`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ jql }),
  }));
  if (!res.ok) await failWith(res, 'Counting issues');
  return (await res.json()).count;
}

// Fetch up to `max` matching issues to use as evidence.
export async function findEvidence(jql, max = 5, requester = api.asApp()) {
  const res = await sendWithRetry(() => requester.requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ jql, maxResults: max, fields: ['summary', 'status', 'assignee', 'reporter', 'created', 'updated'] }),
  }));
  if (!res.ok) await failWith(res, 'Fetching evidence');
  return (await res.json()).issues || [];
}

// Is the ticket still open? Returns 'open' | 'resolved' | 'none' (deleted/not found).
export async function getTicketState(key) {
  if (!key) return 'none';
  const res = await sendWithRetry(() => api.asApp().requestJira(route`/rest/api/3/issue/${key}?fields=status`, {
    headers: { Accept: 'application/json' },
  }));
  if (res.status === 404) return 'none';
  if (!res.ok) await failWith(res, 'Reading the ticket');
  const data = await res.json();
  return data.fields.status.statusCategory.key === 'done' ? 'resolved' : 'open';
}

// Pick an issue type for the new ticket: prefer "Task", else the first non-subtask type.
async function pickIssueTypeId(projectKey) {
  const res = await sendWithRetry(() => api.asApp().requestJira(route`/rest/api/3/project/${projectKey}`, {
    headers: { Accept: 'application/json' },
  }));
  if (!res.ok) await failWith(res, `Reading project ${projectKey}`);
  const types = (await res.json()).issueTypes.filter((t) => !t.subtask);
  const task = types.find((t) => t.name === 'Task');
  return (task || types[0]).id;
}

// Small helper to build Atlassian Document Format (ADF) paragraphs.
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

// Create the "Revisit assumption: ..." ticket. Returns the new issue key.
export async function createRevisitTicket({ projectKey, assumption, count, jql, evidence, assessment = null }) {
  const issueTypeId = await pickIssueTypeId(projectKey);
  const lines = [
    para(`Assumption: "${assumption.text}"`),
    para(`Status: ${assessment ? STATUS_LABEL[assessment.status] : 'Needs attention'}. ${(assessment?.reasons || []).join(' ')}`.trim()),
    para(`Evidence: ${count} issue(s) matched (threshold ${assumption.tripwire.threshold}, last ${assumption.tripwire.windowDays} days).`),
    para(`JQL: ${jql}`),
    para('Example issues: ' + (evidence.length ? evidence.map((i) => `${i.key} (${i.fields.summary})`).join('; ') : 'none returned')),
    para(assessment?.status === 'at-risk'
      ? 'Please review the related issues: confirm a contradiction, or mark the unrelated ones in Hindsight so they are not counted.'
      : 'Please confirm whether this assumption still holds, and update the design doc if it does not.'),
  ];
  // NOTE: a ticket is created only ONCE per problem (see decideAction), so retrying a 429 here cannot make duplicates.
  const res = await sendWithRetry(() => api.asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      fields: {
        project: { key: projectKey },
        issuetype: { id: issueTypeId },
        summary: `Revisit assumption: ${assumption.text}`.slice(0, 250),
        description: { type: 'doc', version: 1, content: lines },
      },
    }),
  }));
  if (!res.ok) await failWith(res, 'Creating the Revisit ticket');
  return (await res.json()).key;
}

// The real address of this Atlassian site, e.g. "https://yoursite.atlassian.net" (so links we hand out are correct).
export async function getSiteBaseUrl(requester = api.asUser()) {
  const res = await sendWithRetry(() => requester.requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } }));
  if (!res.ok) await failWith(res, 'Reading the site address');
  return String((await res.json()).baseUrl || '').replace(/\/+$/, '');
}

// ---- A small summary stored ON the Revisit ticket (a Jira "issue property") ----
// Why: Forge storage is separate for the Jira and Confluence installations of the app, so something running from a Jira
// ticket cannot see what was saved from Confluence. The ticket itself is visible from both sides, so we keep a summary there.
const PROPERTY_KEY = 'hindsight';

export async function setTicketProperty(issueKey, value) {
  const res = await sendWithRetry(() => api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify(value),
  }));
  if (!res.ok) await failWith(res, 'Saving details on the ticket');
}

// Reads the summary from a ticket. Tries as the person first (so Jira permissions apply), then as the app.
export async function getTicketProperty(issueKey, requester = api.asUser()) {
  const read = (r) => sendWithRetry(() => r.requestJira(route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, { headers: { Accept: 'application/json' } }));
  let res = await read(requester);
  if (res.status === 401 || res.status === 403) res = await read(api.asApp());
  if (res.status === 404) return null;
  if (!res.ok) await failWith(res, 'Reading details from the ticket');
  return (await res.json()).value || null;
}

// The newest "Revisit assumption" tickets (used when nothing is stored on this side).
export async function findRevisitTicketKeys(max = 10, requester = api.asUser()) {
  const issues = await findEvidence('summary ~ "\\"Revisit assumption\\"" ORDER BY created DESC', max, requester);
  return issues.map((i) => i.key);
}

// ---- Write actions used by the Rovo agent. They run AS THE PERSON asking, so Jira enforces their permissions. ----

// Add a comment to an issue.
export async function addTicketComment(issueKey, text, requester = api.asUser()) {
  const res = await sendWithRetry(() => requester.requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ body: toAdf(text) }),
  }));
  if (!res.ok) await failWith(res, 'Adding the comment');
}

// Assign an issue to a person (by Atlassian account id).
export async function assignTicket(issueKey, accountId, requester = api.asUser()) {
  const res = await sendWithRetry(() => requester.requestJira(route`/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ accountId }),
  }));
  if (!res.ok) await failWith(res, 'Assigning the ticket');
}

// Create a follow-up task. Returns the new issue key.
export async function createFollowupTask({ projectKey, summary, description, requester = api.asUser() }) {
  const issueTypeId = await pickIssueTypeId(projectKey);
  const fields = { project: { key: projectKey }, issuetype: { id: issueTypeId }, summary: String(summary).slice(0, 250) };
  if (description && String(description).trim()) fields.description = toAdf(description);
  const res = await sendWithRetry(() => requester.requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ fields }),
  }));
  if (!res.ok) await failWith(res, 'Creating the follow-up task');
  return (await res.json()).key;
}

// Link two issues ("Relates"). Linking is a nicety, so a failure here never blocks the main action.
export async function linkIssues(keyA, keyB, requester = api.asUser()) {
  try {
    const res = await requester.requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: keyA }, outwardIssue: { key: keyB } }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Look for an OPEN issue in a project with (almost) this exact title. Used so that retries and overlapping runs can never create
// a duplicate ticket or task. Runs as the app so it sees the whole project. Returns the issue key, or null.
export async function findOpenIssueByTitle(projectKey, title, requester = api.asApp()) {
  const wanted = normalizeTitle(String(title).slice(0, 250));
  if (!wanted) return null;
  // Search by the first few words only (a long exact phrase is fragile), then compare the full normalised titles here.
  const phrase = wanted.split(' ').slice(0, 8).join(' ');
  const issues = await findEvidence(`project = ${projectKey} AND statusCategory != Done AND summary ~ "\\"${phrase}\\"" ORDER BY created DESC`, 15, requester);
  const match = issues.find((i) => normalizeTitle(i.fields?.summary).startsWith(wanted) || wanted.startsWith(normalizeTitle(i.fields?.summary)));
  return match ? match.key : null;
}
