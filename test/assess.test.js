// Tests for the evidence-confidence model. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assess, assessmentOf, queryKind, validationMode, legacyToStatus, statusToLegacy, needsAttention, STATUS, FRESHNESS_DAYS, EVIDENCE_FETCH,
} from '../src/lib/assess.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const related = { tripwire: { jql: 'project = KAN AND summary ~ "payments"', threshold: 3 } };
const direct = { tripwire: { jql: 'project = KAN AND issuetype = Incident AND priority = Highest', threshold: 3 } };
const ev = (...keys) => keys.map((key) => ({ key }));

test('query kind: text search is related evidence, structured fields are a defined criterion', () => {
  assert.equal(queryKind('project = KAN AND summary ~ "payments"'), 'related');
  assert.equal(queryKind('project = KAN AND text ~ "checkout"'), 'related');
  assert.equal(queryKind('project = KAN AND description !~ "x"'), 'related');
  assert.equal(queryKind('project = KAN AND issuetype = Bug AND component = Checkout'), 'direct');
  assert.equal(validationMode({ ...direct, validation: { mode: 'related' } }), 'related'); // an explicit choice wins
});

test('KEYWORD SIMILARITY ALONE CANNOT ESTABLISH A CONTRADICTION: related matches reaching the threshold are "at risk"', () => {
  const r = assess({ assumption: related, count: 3, evidence: ev('KAN-1', 'KAN-2', 'KAN-3') });
  assert.equal(r.status, STATUS.AT_RISK);
  assert.notEqual(r.status, STATUS.CONTRADICTED);
  assert.match(r.reasons.join(' '), /related evidence and not proof/);
});

test('the same count on a structured, explicitly defined criterion is contradicted', () => {
  const r = assess({ assumption: direct, count: 3, evidence: ev('KAN-1', 'KAN-2', 'KAN-3') });
  assert.equal(r.status, STATUS.CONTRADICTED);
  assert.match(r.reasons[0], /defined contradiction criteria are met/);
});

test('A SINGLE INCIDENT DOES NOT TRIGGER A FINDING (below the threshold)', () => {
  assert.equal(assess({ assumption: direct, count: 1, evidence: ev('KAN-1') }).status, STATUS.HEALTHY);
  assert.equal(assess({ assumption: related, count: 2, evidence: ev('KAN-1', 'KAN-2') }).status, STATUS.HEALTHY);
});

test('AN UNRELATED ISSUE DOES NOT TRIGGER A FALSE FINDING: a person can dismiss it', () => {
  const a = { ...related, evidenceReviews: { 'KAN-3': 'unrelated' } };
  const r = assess({ assumption: a, count: 3, evidence: ev('KAN-1', 'KAN-2', 'KAN-3') });
  assert.equal(r.status, STATUS.HEALTHY);
  assert.equal(r.counts.effective, 2);
  assert.equal(r.counts.dismissed, 1);
  assert.match(r.reasons.join(' '), /marked unrelated/);
});

test('a person confirming a contradiction makes it contradicted, even for keyword matches', () => {
  const a = { ...related, evidenceReviews: { 'KAN-9': 'contradicts' } };
  const r = assess({ assumption: a, count: 1, evidence: ev('KAN-9') });
  assert.equal(r.status, STATUS.CONTRADICTED);
  assert.equal(r.counts.confirmed, 1);
});

test('reviews of issues that no longer match are ignored', () => {
  const a = { ...related, evidenceReviews: { 'KAN-OLD': 'unrelated' } };
  const r = assess({ assumption: a, count: 3, evidence: ev('KAN-1', 'KAN-2', 'KAN-3') });
  assert.equal(r.counts.dismissed, 0);
  assert.equal(r.status, STATUS.AT_RISK);
});

test('no check yet: unverified (never pretend to know)', () => {
  assert.equal(assess({ assumption: direct, count: null, evidence: [] }).status, STATUS.UNVERIFIED);
  assert.equal(assess({ assumption: direct, count: undefined, evidence: [] }).status, STATUS.UNVERIFIED);
});

test('staleness: a healthy assumption not checked within its freshness period becomes stale; others keep their status', () => {
  const old = new Date(NOW.getTime() - (FRESHNESS_DAYS + 1) * 86400000).toISOString();
  const fresh = new Date(NOW.getTime() - 86400000).toISOString();
  const healthy = { ...direct, assessment: { status: 'healthy', reasons: [], counts: {}, mode: 'direct' } };
  assert.equal(assessmentOf({ ...healthy, lastCheckedAt: old }, NOW).status, STATUS.STALE);
  assert.equal(assessmentOf({ ...healthy, lastCheckedAt: fresh }, NOW).status, STATUS.HEALTHY);
  const contradicted = { ...direct, assessment: { status: 'contradicted', reasons: [], counts: {}, mode: 'direct' }, lastCheckedAt: old };
  assert.equal(assessmentOf(contradicted, NOW).status, STATUS.CONTRADICTED); // staleness never hides a problem
});

test('COMPATIBILITY: data saved by earlier versions is mapped safely and never silently rewritten', () => {
  assert.equal(legacyToStatus('tripped'), STATUS.AT_RISK);   // never "contradicted": the old status could not tell the difference
  assert.equal(legacyToStatus('healthy'), STATUS.HEALTHY);
  assert.equal(legacyToStatus('unchecked'), STATUS.UNVERIFIED);
  assert.equal(legacyToStatus(undefined), STATUS.UNVERIFIED);
  const old = { ...related, status: 'tripped', lastCount: 3, lastCheckedAt: NOW.toISOString() };
  const shown = assessmentOf(old, NOW);
  assert.equal(shown.status, STATUS.AT_RISK);
  assert.equal(shown.counts.matched, 3);
  assert.equal(old.assessment, undefined); // the stored record is untouched
});

test('we keep writing the legacy value next to the new status, so older readers still work', () => {
  assert.equal(statusToLegacy(STATUS.CONTRADICTED), 'tripped');
  assert.equal(statusToLegacy(STATUS.AT_RISK), 'tripped');
  assert.equal(statusToLegacy(STATUS.HEALTHY), 'healthy');
  assert.equal(statusToLegacy(STATUS.STALE), 'healthy');
  assert.equal(statusToLegacy(STATUS.UNVERIFIED), 'unchecked');
});

test('only at-risk and contradicted need attention; we load enough evidence to apply a person\'s reviews', () => {
  assert.equal(needsAttention(STATUS.AT_RISK), true);
  assert.equal(needsAttention(STATUS.CONTRADICTED), true);
  assert.equal(needsAttention(STATUS.HEALTHY), false);
  assert.equal(needsAttention(STATUS.STALE), false);
  assert.ok(EVIDENCE_FETCH >= 10);
});
