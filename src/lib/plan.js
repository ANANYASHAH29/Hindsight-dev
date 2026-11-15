// plan.js - PURE logic for the "resolution plan": the work the agent prepares and a person approves step by step.
// The agent DRAFTS the plan (the wording of a comment, task titles, a new sentence). A person ticks the steps they approve,
// and Hindsight performs only those steps, as that person. Nothing here touches the network, so it is easy to test.

import { STATUS_LABEL } from './assess.js';

export const MAX_TASKS = 5;

// Steps always run in this order (the doc is updated before the assumption's wording changes, so the old sentence is still known).
const ORDER = { comment: 1, assign: 2, task: 3, doc: 4, revise: 5 };

const short = (text, n = 90) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
};

// "Investigate KAN-4\n- Add a load test; 3) Review limits" -> ['Investigate KAN-4', 'Add a load test', 'Review limits']
export function parseTaskList(text) {
  return String(text || '')
    .split(/\n|;|\|/)
    .map((t) => t.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((t) => t.length >= 5)
    .slice(0, MAX_TASKS);
}

// Builds the steps from what the agent proposed. Returns { steps } or { error }.
//   input: { comment, assignOwner, followupTasks, newSentence, newThreshold, newWindowDays, newJql }
//   assumption: the stored assumption (we need its ticket key and its current wording)
export function buildPlanSteps(input, assumption) {
  const steps = [];
  const ticket = assumption.ticketKey || '';
  const add = (type, label, params) => steps.push({ type, label, params, state: 'proposed' });

  const comment = String(input.comment || '').trim();
  if (comment) {
    if (!ticket) return { error: 'This assumption has no Revisit ticket yet, so a comment cannot be planned.' };
    if (comment.length < 10) return { error: 'The comment is too short (at least 10 characters).' };
    add('comment', `Comment on ${ticket}: "${short(comment)}"`, { text: comment });
  }
  if (input.assignOwner === true || String(input.assignOwner).toLowerCase() === 'true') {
    if (!ticket) return { error: 'This assumption has no Revisit ticket yet, so it cannot be assigned.' };
    add('assign', `Assign ${ticket} to the suggested owner (worked out from the evidence)`, {});
  }
  for (const title of parseTaskList(input.followupTasks)) {
    add('task', `Create a Jira task: "${short(title, 100)}"`, { summary: title });
  }
  const newSentence = String(input.newSentence || '').trim();
  if (newSentence) {
    if (newSentence.length > 500) return { error: 'The new sentence is too long (500 characters at most).' };
    add('doc', `Update the design doc: replace "${short(assumption.text, 60)}" with "${short(newSentence, 60)}"`, { newSentence });
  }
  const threshold = input.newThreshold ? Number(input.newThreshold) : null;
  const windowDays = input.newWindowDays ? Number(input.newWindowDays) : null;
  const jql = String(input.newJql || '').trim();
  if (newSentence || threshold || windowDays || jql) {
    const parts = [];
    if (newSentence) parts.push(`wording "${short(newSentence, 50)}"`);
    if (threshold) parts.push(`trips at ${threshold}`);
    if (windowDays) parts.push(`window ${windowDays} days`);
    if (jql) parts.push('a new Jira query');
    add('revise', `Revise the assumption (${parts.join(', ')}) and reset it to unchecked`, { newText: newSentence, threshold, windowDays, jql });
  }
  if (steps.length === 0) return { error: 'The plan has no steps. Propose at least one thing to do.' };

  steps.sort((a, b) => ORDER[a.type] - ORDER[b.type]);
  steps.forEach((s, i) => { s.id = `s${i + 1}`; });
  return { steps };
}

// The steps a person can still approve (not done yet).
export const pendingSteps = (plan) => (plan?.steps || []).filter((s) => s.state === 'proposed' || s.state === 'failed');

// True when nothing is left to do, so the screen can hide the plan.
export const planFinished = (plan) => !plan || pendingSteps(plan).length === 0;

// Which of the chosen step ids are valid, in the right order.
export function selectSteps(plan, stepIds) {
  const wanted = new Set(stepIds || []);
  return pendingSteps(plan).filter((s) => wanted.has(s.id)).sort((a, b) => ORDER[a.type] - ORDER[b.type]);
}

// Turns one plan step into the input for the matching action. `assumption` is the CURRENT stored assumption.
export function stepToPayload(step, assumption) {
  const ticketKey = assumption.ticketKey || '';
  switch (step.type) {
    case 'comment': return { ticketKey, comment: step.params.text };
    case 'assign': return { ticketKey };
    case 'task': return { summary: step.params.summary, ticketKey };
    case 'doc': return { ticketKey, assumptionId: assumption.id, oldSentence: assumption.text, newSentence: step.params.newSentence };
    case 'revise': return {
      ticketKey, assumptionId: assumption.id, newText: step.params.newText,
      threshold: step.params.threshold, windowDays: step.params.windowDays, jql: step.params.jql,
    };
    default: return null;
  }
}

// ---- The AUTOMATIC plan -------------------------------------------------------------------------------
// When an assumption becomes "at risk" or "contradicted", Hindsight prepares a recommended plan straight away, so a developer never has
// to ask for one. The scheduled check never calls an AI (that would cost credits every hour), so this plan is drafted by CODE from the
// evidence: a comment, the suggested owner, and a follow-up task. The Rovo agent can replace it with a richer plan (for example a
// revised sentence for the doc) when asked. Nothing here DOES anything: a person ticks the steps they approve.
//   assumption: the saved assumption (it must already have its ticket key if a ticket exists)
//   assessment: its assessment ({ status, reasons, counts })
//   evidence:   [{ key, summary }] the matching issues
//   owner:      the suggested owner's name, or null
//   canCreateTasks: false when no Jira project is known to put a follow-up task in
// Returns { steps } or null when there is nothing sensible to propose.
export function draftAutoPlan({ assumption, assessment, evidence = [], owner = null, canCreateTasks = true }) {
  if (!assessment || (assessment.status !== 'at-risk' && assessment.status !== 'contradicted')) return null;
  const ticket = assumption.ticketKey || '';
  const claim = short(assumption.text, 80);
  const counts = assessment.counts || {};
  const window = assumption.tripwire?.windowDays;
  const examples = evidence.slice(0, 5).map((i) => (i.summary ? `${i.key} (${i.summary})` : i.key)).join('; ');
  const closing = assessment.status === 'at-risk'
    ? 'Please review these issues in Hindsight: confirm a contradiction, or mark the unrelated ones so they are not counted.'
    : 'Please resolve the contradiction, or revise the assumption and update the design doc.';

  const comment = [
    `Hindsight status: ${STATUS_LABEL[assessment.status]}.`,
    `${counts.effective ?? counts.matched} matching issue(s) in the last ${window} days for "${claim}" (the threshold is ${counts.threshold}).`,
    assessment.reasons?.[0] || '',
    examples ? `Evidence: ${examples}.` : '',
    closing,
  ].filter(Boolean).join(' ');

  const tasks = [];
  if (canCreateTasks) {
    tasks.push(assessment.status === 'contradicted' ? `Resolve the contradicted assumption: ${claim}` : `Review the related issues for: ${claim}`);
    if (assessment.status === 'contradicted' && evidence[0]?.summary) tasks.push(`Investigate: ${short(evidence[0].summary, 80)}`);
  }

  const built = buildPlanSteps({
    comment: ticket ? comment : '',
    assignOwner: Boolean(ticket && owner),
    followupTasks: tasks.join('\n'),
  }, assumption);
  return built.error ? null : { steps: built.steps };
}
