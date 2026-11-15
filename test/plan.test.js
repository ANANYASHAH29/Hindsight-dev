// Tests for the resolution plan logic. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskList, buildPlanSteps, pendingSteps, planFinished, selectSteps, stepToPayload } from '../src/lib/plan.js';

const a = { id: 'abc', text: 'Checkout handles 1,000 orders/min.', ticketKey: 'KAN-17' };

test('parseTaskList splits lines, bullets, numbers and semicolons, and caps at five', () => {
  assert.deepEqual(parseTaskList('- Investigate KAN-4 under load\n2) Add a load test; Review capacity limits'), ['Investigate KAN-4 under load', 'Add a load test', 'Review capacity limits']);
  assert.deepEqual(parseTaskList('ok\nno\nA proper task title'), ['A proper task title']); // too-short lines are dropped
  assert.equal(parseTaskList('Task one\nTask two\nTask three\nTask four\nTask five\nTask six').length, 5);
  assert.deepEqual(parseTaskList(''), []);
});

test('buildPlanSteps makes ordered, labelled steps with ids', () => {
  const r = buildPlanSteps({
    comment: 'KAN-4 directly contradicts the claim; the other two are unrelated.',
    assignOwner: true,
    followupTasks: 'Investigate the 500 errors under load\nAdd a load test',
    newSentence: 'Checkout handles 400 orders/min.',
    newThreshold: 3,
  }, a);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.steps.map((s) => s.type), ['comment', 'assign', 'task', 'task', 'doc', 'revise']);
  assert.deepEqual(r.steps.map((s) => s.id), ['s1', 's2', 's3', 's4', 's5', 's6']);
  assert.ok(r.steps.every((s) => s.state === 'proposed'));
  assert.match(r.steps[0].label, /Comment on KAN-17/);
});

test('the doc is updated BEFORE the assumption wording changes', () => {
  const r = buildPlanSteps({ newSentence: 'Checkout handles 400 orders/min.' }, a);
  assert.deepEqual(r.steps.map((s) => s.type), ['doc', 'revise']);
});

test('buildPlanSteps refuses plans that cannot work', () => {
  assert.match(buildPlanSteps({}, a).error, /no steps/);
  assert.match(buildPlanSteps({ comment: 'A long enough comment here.' }, { ...a, ticketKey: null }).error, /no Revisit ticket/);
  assert.match(buildPlanSteps({ assignOwner: true }, { ...a, ticketKey: null }).error, /no Revisit ticket/);
  assert.match(buildPlanSteps({ comment: 'short' }, a).error, /too short/);
  assert.match(buildPlanSteps({ newSentence: 'x'.repeat(501) }, a).error, /too long/);
});

test('only chosen, pending steps are selected, in order; finished plans report finished', () => {
  const plan = buildPlanSteps({ comment: 'A long enough comment here.', followupTasks: 'Investigate it properly', newSentence: 'New sentence here.' }, a);
  const p = { steps: plan.steps };
  assert.deepEqual(selectSteps(p, ['s4', 's1']).map((s) => s.id), ['s1', 's4']); // comment before revise/doc order
  p.steps[0].state = 'done';
  assert.deepEqual(selectSteps(p, ['s1', 's2']).map((s) => s.id), ['s2']); // a done step cannot run twice
  p.steps[1].state = 'failed';
  assert.ok(pendingSteps(p).some((s) => s.id === 's2')); // a failed step can be retried
  p.steps.forEach((s) => { s.state = 'done'; });
  assert.equal(planFinished(p), true);
  assert.equal(planFinished(null), true);
});

test('stepToPayload builds the input for each action', () => {
  const plan = buildPlanSteps({ comment: 'A long enough comment here.', assignOwner: true, followupTasks: 'Investigate it properly', newSentence: 'New sentence here.', newThreshold: 4 }, a);
  const byType = Object.fromEntries(plan.steps.map((s) => [s.type, s]));
  assert.deepEqual(stepToPayload(byType.comment, a), { ticketKey: 'KAN-17', comment: 'A long enough comment here.' });
  assert.deepEqual(stepToPayload(byType.assign, a), { ticketKey: 'KAN-17' });
  assert.deepEqual(stepToPayload(byType.task, a), { summary: 'Investigate it properly', ticketKey: 'KAN-17' });
  assert.equal(stepToPayload(byType.doc, a).oldSentence, 'Checkout handles 1,000 orders/min.');
  assert.equal(stepToPayload(byType.revise, a).threshold, 4);
});

import { draftAutoPlan } from '../src/lib/plan.js';

const auto = (over = {}) => draftAutoPlan({
  assumption: { id: 'a1', text: 'We assume the orders API handles 500 requests per second.', ticketKey: 'KAN-22', tripwire: { windowDays: 14, threshold: 3 } },
  assessment: { status: 'contradicted', reasons: ['1 issue(s) were confirmed by a person as contradicting this assumption.'], counts: { matched: 3, effective: 3, threshold: 3 } },
  evidence: [{ key: 'KAN-20', summary: 'Orders API returns 500 during sale' }, { key: 'KAN-18', summary: 'Orders API times out under load' }],
  owner: 'Ananya Shah',
  ...over,
});

test('AUTOMATIC PLAN: a contradicted assumption gets a comment, an assignment and follow-up tasks, all still "proposed"', () => {
  const r = auto();
  assert.deepEqual(r.steps.map((s) => s.type), ['comment', 'assign', 'task', 'task']);
  assert.ok(r.steps.every((s) => s.state === 'proposed')); // nothing is DONE automatically
  assert.match(r.steps[0].params.text, /Hindsight status: Contradicted\./);
  assert.match(r.steps[0].params.text, /KAN-20 \(Orders API returns 500 during sale\)/);
  assert.match(r.steps[2].params.summary, /Resolve the contradicted assumption/);
  assert.match(r.steps[3].params.summary, /Investigate: Orders API returns 500 during sale/);
});

test('AUTOMATIC PLAN: an at-risk assumption asks for a review, not a fix, and never claims a contradiction', () => {
  const r = auto({ assessment: { status: 'at-risk', reasons: ['3 related issue(s) mention this area, and it trips at 3.'], counts: { matched: 3, effective: 3, threshold: 3 } } });
  assert.deepEqual(r.steps.map((s) => s.type), ['comment', 'assign', 'task']);
  assert.match(r.steps[0].params.text, /Hindsight status: At risk\./);
  assert.match(r.steps[0].params.text, /confirm a contradiction, or mark the unrelated ones/);
  assert.doesNotMatch(r.steps[0].params.text, /Contradicted/);
  assert.match(r.steps[2].params.summary, /Review the related issues/);
});

test('AUTOMATIC PLAN: no plan for healthy, stale or unverified assumptions', () => {
  for (const status of ['healthy', 'stale', 'unverified']) {
    assert.equal(auto({ assessment: { status, reasons: [], counts: {} } }), null);
  }
  assert.equal(auto({ assessment: null }), null);
});

test('AUTOMATIC PLAN: without a ticket there is no comment or assignment, and without a project there are no tasks', () => {
  const noTicket = auto({ assumption: { id: 'a1', text: 'We assume the orders API handles 500 requests per second.', tripwire: { windowDays: 14, threshold: 3 } } });
  assert.deepEqual(noTicket.steps.map((s) => s.type), ['task', 'task']);
  const noOwner = auto({ owner: null });
  assert.equal(noOwner.steps.some((s) => s.type === 'assign'), false);
  assert.equal(auto({ canCreateTasks: false }).steps.some((s) => s.type === 'task'), false);
  assert.equal(auto({ assumption: { id: 'a1', text: 'x claim here', tripwire: { windowDays: 14, threshold: 3 } }, canCreateTasks: false }), null); // nothing left to propose
});
