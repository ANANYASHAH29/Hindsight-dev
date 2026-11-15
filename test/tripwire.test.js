// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJql, validateTripwire, decideTicket, suggestOwner } from '../src/lib/tripwire.js';

test('buildJql wraps user JQL, adds the window, and excludes our own Revisit tickets', () => {
  assert.equal(
    buildJql('project = HD', 14),
    '(project = HD) AND created >= -14d AND summary !~ "\\"Revisit assumption\\""',
  );
});

test('validateTripwire accepts good input and rejects bad input', () => {
  assert.equal(validateTripwire({ jql: 'project = HD', windowDays: 14, threshold: 3 }), null);
  assert.match(validateTripwire({ jql: '', windowDays: 14, threshold: 3 }), /JQL/);
  assert.match(validateTripwire({ jql: 'a = b ORDER BY created', windowDays: 14, threshold: 3 }), /ORDER BY/);
  assert.match(validateTripwire({ jql: 'a = b', windowDays: 0, threshold: 3 }), /Window/);
  assert.match(validateTripwire({ jql: 'a = b', windowDays: 14, threshold: 0 }), /Threshold/);
});

test('decideTicket: a ticket only exists while the assumption needs attention', () => {
  assert.equal(decideTicket('healthy', 'none'), 'none');
  assert.equal(decideTicket('stale', 'none'), 'none');
  assert.equal(decideTicket('unverified', 'none'), 'none');
  assert.equal(decideTicket('at-risk', 'none'), 'create');
  assert.equal(decideTicket('contradicted', 'none'), 'create');
});

test('REPEATED SCHEDULED EXECUTION CANNOT CREATE DUPLICATE TICKETS: while a ticket is open it is only updated', () => {
  // Simulate five hourly runs against an assumption that stays contradicted: only the first one creates anything.
  let ticketState = 'none';
  const actions = [];
  for (let run = 0; run < 5; run += 1) {
    const decision = decideTicket('contradicted', ticketState);
    actions.push(decision);
    if (decision === 'create') ticketState = 'open'; // the ticket now exists
  }
  assert.deepEqual(actions, ['create', 'update', 'update', 'update', 'update']);
});

test('a ticket that was resolved and then the problem returns gets a NEW ticket; a recovery needs none', () => {
  assert.equal(decideTicket('contradicted', 'resolved'), 'create');
  assert.equal(decideTicket('at-risk', 'resolved'), 'create');
  assert.equal(decideTicket('healthy', 'open'), 'none'); // recovered: nothing to create (the open ticket is left for a person to close)
});

test('suggestOwner picks most frequent assignee, falls back to reporter', () => {
  const a = (n) => ({ fields: { assignee: n ? { displayName: n } : null, reporter: { displayName: 'Rita' } } });
  assert.equal(suggestOwner([a('Sam'), a('Sam'), a('Joe')]), 'Sam');
  assert.equal(suggestOwner([a(null), a(null)]), 'Rita');
  assert.equal(suggestOwner([]), null);
});

import { buildDriftJql, driftStatus } from '../src/lib/tripwire.js';

test('buildDriftJql uses the page edit date and ignores our own Revisit tickets', () => {
  assert.equal(
    buildDriftJql('project = HSW', '2026-10-12T08:30:00.000Z'),
    '(project = HSW) AND updated >= "2026-10-12" AND summary !~ "Revisit assumption"',
  );
});

test('driftStatus marks a doc stale at the threshold and counts days', () => {
  const now = new Date('2026-11-12T00:00:00.000Z');
  const s = driftStatus(3, '2026-11-02T00:00:00.000Z', now);
  assert.equal(s.stale, true);
  assert.equal(s.daysSince, 10);
  assert.equal(driftStatus(2, '2026-11-02T00:00:00.000Z', now).stale, false);
  assert.equal(driftStatus(5, 'not a date', now).daysSince, null);
});

import { changedAfter } from '../src/lib/tripwire.js';

test('changedAfter keeps only issues updated after the exact page edit time', () => {
  const issues = [
    { key: 'A', fields: { updated: '2026-11-06T10:00:00.000+0000' } },
    { key: 'B', fields: { updated: '2026-11-06T20:00:00.000+0000' } },
  ];
  assert.deepEqual(changedAfter(issues, '2026-11-06T15:00:00.000Z').map((i) => i.key), ['B']);
  assert.deepEqual(changedAfter([], '2026-11-06T15:00:00.000Z'), []);
});

import { buildImpactNote } from '../src/lib/tripwire.js';

test('buildImpactNote uses only supplied numbers and keys', () => {
  const note = buildImpactNote({
    assumption: { text: 'Checkout handles 1,000 orders/min', tripwire: { windowDays: 14, threshold: 3 } },
    count: 4,
    evidence: [{ key: 'HSW-1', summary: 'Checkout times out' }, { key: 'HSW-2', summary: 'Cart total wrong' }],
    owner: 'Ananya Shah',
    pageTitle: 'Checkout redesign: design doc',
  });
  assert.match(note, /Checkout redesign: design doc/);
  assert.match(note, /4 matching issues in the last 14 days/);
  assert.match(note, /the threshold is 3/);
  assert.match(note, /HSW-1 \(Checkout times out\)/);
  assert.match(note, /Suggested owner: Ananya Shah/);
  assert.doesNotMatch(buildImpactNote({ assumption: { text: 'x', tripwire: { windowDays: 7, threshold: 1 } }, count: 1 }), /Suggested owner/);
});

test('buildImpactNote never prints "undefined" and avoids a doubled full stop', () => {
  const note = buildImpactNote({
    assumption: { text: 'Checkout handles 1,000 orders/min.', tripwire: { windowDays: 14, threshold: 3 } },
    count: 3,
    evidence: [{ key: 'KAN-4', summary: 'Demo checkout: coupon fails' }, { key: 'KAN-5' }],
  });
  assert.doesNotMatch(note, /undefined/);
  assert.match(note, /assumed: "Checkout handles 1,000 orders\/min"\./);
  assert.match(note, /KAN-4 \(Demo checkout: coupon fails\); KAN-5\./);
});

test('the impact note says plainly whether the evidence is related (at risk) or contradicting', () => {
  const base = {
    assumption: { text: 'Checkout handles 1,000 orders/min', tripwire: { windowDays: 14, threshold: 3 } },
    count: 3,
    evidence: [{ key: 'KAN-4', summary: 'Payment page returns 500' }],
  };
  const atRisk = buildImpactNote({ ...base, assessment: { status: 'at-risk', reasons: ['3 related issue(s) mention this area, and it trips at 3.', 'These are keyword matches, which are related evidence and not proof.'] } });
  assert.match(atRisk, /Status: At risk\./);
  assert.match(atRisk, /related evidence and not proof/);
  assert.match(atRisk, /confirm a contradiction, or mark the unrelated ones/);
  assert.doesNotMatch(atRisk, /Contradicted/);
  const contradicted = buildImpactNote({ ...base, assessment: { status: 'contradicted', reasons: ['The defined contradiction criteria are met: 3 matching issue(s), and it trips at 3.'] } });
  assert.match(contradicted, /Status: Contradicted\./);
  assert.match(contradicted, /resolve the contradiction, or revise the assumption/);
});
