// tripwire.js - PURE logic (no network, no storage) so it is easy to unit test.
import { needsAttention, STATUS, STATUS_LABEL } from './assess.js';

// A "tripwire" says: "if the JQL query finds >= threshold issues in the last
// windowDays days, the assumption is broken".

// Hindsight's own tickets are titled "Revisit assumption: ...". They often contain the same words as the tripwire
// (for example "payments"), so they must never be counted as evidence against the assumption they were created for.
export const REVISIT_EXCLUSION = 'summary !~ "\\"Revisit assumption\\""';

// Build the final JQL we actually run: the user's JQL AND a time window, minus our own Revisit tickets.
export function buildJql(jql, windowDays) {
  const clean = String(jql || '').trim();
  return `(${clean}) AND created >= -${Number(windowDays)}d AND ${REVISIT_EXCLUSION}`;
}

// Check user input BEFORE saving. Returns an error string, or null if fine.
export function validateTripwire({ jql, windowDays, threshold }) {
  if (!jql || !String(jql).trim()) return 'Please enter a JQL query.';
  // ORDER BY cannot be wrapped in parentheses, and we do not need it for counting.
  if (/order\s+by/i.test(jql)) return 'Please remove "ORDER BY" from the JQL.';
  const w = Number(windowDays);
  const t = Number(threshold);
  if (!Number.isInteger(w) || w < 1 || w > 365) return 'Window must be a whole number of days from 1 to 365.';
  if (!Number.isInteger(t) || t < 1) return 'Threshold must be a whole number of 1 or more.';
  return null;
}

// ---- IMPACT NOTE: a short plain-English note written when an assumption needs attention. ----
// All numbers and issue keys come from CODE (never from an AI). Pure function, easy to test.
// It says plainly whether the evidence is RELATED (needs investigation) or CONTRADICTING (the defined criteria are met).
export function buildImpactNote({ assumption, count, evidence = [], owner = null, pageTitle = null, assessment = null }) {
  const t = assumption.tripwire;
  const examples = evidence.slice(0, 5).map((i) => (i.summary ? `${i.key} (${i.summary})` : i.key)).join('; ');
  const claim = String(assumption.text).trim().replace(/[.!?\s]+$/, ''); // drop the sentence's own final punctuation
  const status = assessment?.status || STATUS.CONTRADICTED;
  const parts = [
    `${pageTitle ? `The design doc "${pageTitle}"` : 'A design doc'} assumed: "${claim}".`,
    `Status: ${STATUS_LABEL[status] || status}.`,
    `Jira now shows ${count} matching issue${count === 1 ? '' : 's'} in the last ${t.windowDays} days (the threshold is ${t.threshold}).`,
  ];
  for (const r of assessment?.reasons || []) parts.push(r);
  if (examples) parts.push(`Evidence: ${examples}.`);
  if (owner) parts.push(`Suggested owner: ${owner}.`);
  parts.push(status === STATUS.AT_RISK
    ? 'Please review these issues: confirm a contradiction, or mark the unrelated ones so they are not counted.'
    : 'Please resolve the contradiction, or revise the assumption and update the doc.');
  return parts.join(' ');
}

// ---- Tripwire TEMPLATES: so users do not have to know JQL -------------------------------
// Each template builds a JQL string from a project key and (usually) one value.
export const TEMPLATES = [
  { id: 'bug-component', label: 'Bug count in a component', needsValue: true, valueLabel: 'Component name' },
  { id: 'incident', label: 'Incident count', needsValue: false },
  { id: 'label', label: 'Issues with a label', needsValue: true, valueLabel: 'Label' },
  { id: 'text', label: 'Issues matching text', needsValue: true, valueLabel: 'Words to search for' },
  { id: 'custom', label: 'Custom JQL (advanced)', needsValue: false },
];

// Escape a value so it is safe inside "double quotes" in JQL.
const q = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Returns { jql } or { error }.
export function buildTemplateJql(templateId, projectKey, value) {
  const project = String(projectKey || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(project)) return { error: 'Project key should look like HSW (letters/numbers, 2-10 characters).' };
  const v = String(value || '').trim();
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl || templateId === 'custom') return { error: 'Choose a template.' };
  if (tpl.needsValue && !v) return { error: `Please fill in: ${tpl.valueLabel}.` };
  switch (templateId) {
    case 'bug-component': return { jql: `project = ${project} AND issuetype = Bug AND component = ${q(v)}` };
    case 'incident': return { jql: `project = ${project} AND issuetype = Incident` };
    case 'label': return { jql: `project = ${project} AND labels = ${q(v)}` };
    case 'text': return { jql: `project = ${project} AND text ~ ${q(v)}` };
    default: return { error: 'Unknown template.' };
  }
}

// ---- DOC FRESHNESS ("drift") ---------------------------------------------------------
// Idea: a doc is probably out of date if lots of Jira work in the area it covers has changed
// since the doc was last edited. Pure functions, easy to test.

// Jira work in `scopeJql` that changed AFTER the doc's last edit (ignoring our own Revisit tickets).
export function buildDriftJql(scopeJql, lastEditedAt) {
  const day = String(lastEditedAt || '').slice(0, 10); // JQL accepts yyyy-MM-dd
  return `(${String(scopeJql).trim()}) AND updated >= "${day}" AND summary !~ "Revisit assumption"`;
}

// JQL can only filter by whole days, so we fetch candidates and keep only issues changed
// strictly AFTER the exact moment the page was last edited.
export function changedAfter(issues, lastEditedAt) {
  const edited = new Date(lastEditedAt).getTime();
  return (issues || []).filter((i) => new Date(i.fields?.updated).getTime() > edited);
}

// Turn a count into a freshness verdict.
export function driftStatus(count, lastEditedAt, now = new Date(), threshold = 3) {
  const edited = new Date(lastEditedAt);
  const daysSince = Number.isNaN(edited.getTime()) ? null : Math.max(0, Math.floor((now - edited) / 86400000));
  return { count: Number(count), lastEditedAt, daysSince, threshold, stale: Number(count) >= threshold };
}

// What should happen with the Jira "Revisit assumption" ticket?
//   status       - the assumption's assessed status (healthy, at-risk, contradicted, unverified, stale)
//   ticketState  - 'none' (no ticket), 'open', or 'resolved'
// Returns:
//   'none'    - the assumption does not need attention, so no ticket is needed
//   'create'  - it needs attention and there is no open ticket: make ONE new ticket
//               (this also covers "the old ticket was resolved and the problem came back")
//   'update'  - it needs attention and a ticket is already open: only refresh the numbers (NEVER a duplicate)
export function decideTicket(status, ticketState) {
  if (!needsAttention(status)) return 'none';
  if (ticketState === 'open') return 'update';
  return 'create';
}

// Suggest an owner: the most frequent assignee (or reporter if nobody is assigned).
// issues = [{ fields: { assignee: {displayName}|null, reporter: {displayName}|null } }]
export function suggestOwner(issues) {
  const tally = {};
  const bump = (name) => { if (name) tally[name] = (tally[name] || 0) + 1; };
  for (const i of issues || []) bump(i.fields?.assignee?.displayName);
  if (Object.keys(tally).length === 0) {
    for (const i of issues || []) bump(i.fields?.reporter?.displayName);
  }
  let best = null;
  for (const [name, n] of Object.entries(tally)) if (!best || n > best.n) best = { name, n };
  return best ? best.name : null;
}
