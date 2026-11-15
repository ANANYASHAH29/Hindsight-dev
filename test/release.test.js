// Tests for the release verdict rules. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  releaseVerdict, verdictSentence, groupByRelease, normalizeRelease, validateRelease, sameRelease,
  isRiskActive, validateRiskAcceptance, buildRiskAcceptance, severityOf, validateSeverity,
} from '../src/lib/release.js';
import { FRESHNESS_DAYS } from '../src/lib/assess.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const fresh = '2026-11-10T08:00:00Z';
const old = new Date(NOW.getTime() - (FRESHNESS_DAYS + 3) * 86400000).toISOString();
// An assumption with a stored assessment of the given status.
const a = (status, over = {}) => ({
  id: over.id || `id-${status}`, text: `Assumption (${status})`, tripwire: { threshold: 3, jql: 'project = KAN' },
  assessment: { status, reasons: [`reason for ${status}`], counts: {}, mode: 'direct' }, lastCheckedAt: fresh, ...over,
});

test('nothing linked: unknown (Hindsight must not claim anything)', () => {
  const v = releaseVerdict([], NOW);
  assert.equal(v.verdict, 'unknown');
  assert.match(verdictSentence(v.verdict, v.counts), /cannot say/);
});

test('all healthy and recently checked: ready', () => {
  const v = releaseVerdict([a('healthy'), a('healthy', { id: 'y' })], NOW);
  assert.equal(v.verdict, 'ready');
  assert.equal(v.counts.ok, 2);
});

test('a CONTRADICTED critical assumption blocks only its own release', () => {
  const v = releaseVerdict([a('healthy'), a('contradicted', { ticketKey: 'KAN-12', ticketStatus: 'open' })], NOW);
  assert.equal(v.verdict, 'blocked');
  assert.equal(v.counts.blockers, 1);
  assert.match(v.reasons[0].why, /Contradicted: reason for contradicted/);
  assert.match(v.reasons[0].why, /KAN-12 \(open\)/);
  assert.match(v.reasons[0].required, /administrator must knowingly accept/);
  // A different release whose assumptions are healthy is unaffected.
  assert.equal(releaseVerdict([a('healthy')], NOW).verdict, 'ready');
});

test('A SINGLE "AT RISK" (related evidence) ASSUMPTION DOES NOT BLOCK A RELEASE: it needs investigation', () => {
  const v = releaseVerdict([a('healthy'), a('at-risk')], NOW);
  assert.equal(v.verdict, 'at-risk');
  assert.equal(v.counts.blockers, 0);
  assert.match(v.reasons[0].why, /Needs investigation/);
});

test('severity decides the effect: a standard assumption never blocks, and at-risk standard changes nothing', () => {
  assert.equal(severityOf({}), 'critical');
  assert.equal(severityOf({ severity: 'standard' }), 'standard');
  assert.equal(validateSeverity('critical'), null);
  assert.match(validateSeverity('huge'), /critical/);
  const standardContradicted = releaseVerdict([a('contradicted', { severity: 'standard' })], NOW);
  assert.equal(standardContradicted.verdict, 'at-risk');
  const standardAtRisk = releaseVerdict([a('at-risk', { severity: 'standard' }), a('healthy')], NOW);
  assert.equal(standardAtRisk.verdict, 'ready');
  assert.equal(standardAtRisk.counts.info, 1);
});

test('an ACTIVE accepted risk turns a blocker into a visible risk, with who and why', () => {
  const accepted = a('contradicted', { riskAccepted: { by: 'u1', byName: 'Ananya', reason: 'Fix lands in the next sprint', at: '2026-11-09T00:00:00Z', until: '2026-11-20T00:00:00Z' } });
  const v = releaseVerdict([accepted], NOW);
  assert.equal(v.verdict, 'at-risk');
  assert.match(v.reasons[0].why, /risk was accepted by Ananya until 2026-11-20/);
  assert.match(v.reasons[0].why, /Fix lands in the next sprint/);
});

test('EXPIRED RISK ACCEPTANCE RESTORES THE WARNING', () => {
  const expired = a('contradicted', { riskAccepted: { by: 'u1', reason: 'long enough reason', until: '2026-11-01T00:00:00Z' } });
  assert.equal(isRiskActive(expired, NOW), false);
  assert.equal(releaseVerdict([expired], NOW).verdict, 'blocked');
});

test('unverified and stale critical assumptions make a release "at risk", never "ready"', () => {
  assert.equal(releaseVerdict([a('unverified', { lastCheckedAt: null })], NOW).verdict, 'at-risk');
  const staleFromTime = releaseVerdict([a('healthy', { lastCheckedAt: old })], NOW); // healthy but not checked for too long
  assert.equal(staleFromTime.verdict, 'at-risk');
  assert.match(staleFromTime.reasons[0].why, /Stale/);
});

test('a blocker wins over a risk', () => {
  const v = releaseVerdict([a('unverified', { lastCheckedAt: null }), a('contradicted')], NOW);
  assert.equal(v.verdict, 'blocked');
  assert.equal(v.counts.blockers, 1);
  assert.equal(v.counts.risks, 1);
});

test('data saved by an earlier version ("tripped") is treated as needing investigation, not as a proven contradiction', () => {
  const legacy = { id: 'old', text: 'Old', status: 'tripped', lastCount: 3, lastCheckedAt: fresh, tripwire: { threshold: 3, jql: 'project = KAN AND summary ~ "x"' } };
  const v = releaseVerdict([legacy], NOW);
  assert.equal(v.verdict, 'at-risk');
  assert.equal(v.counts.blockers, 0);
});

test('release names: normalised, validated, matched ignoring case, grouped', () => {
  assert.equal(normalizeRelease('  Checkout   v2.0 '), 'Checkout v2.0');
  assert.equal(validateRelease('Checkout v2.0'), null);
  assert.equal(validateRelease('KAN-3'), null);
  assert.match(validateRelease(''), /release name/);
  assert.match(validateRelease('<script>'), /letters, numbers/);
  assert.equal(sameRelease('checkout V2.0', 'Checkout v2.0'), true);
  const groups = groupByRelease([a('healthy', { releaseKey: 'Checkout v2.0' }), a('healthy', { releaseKey: 'checkout V2.0' }), a('healthy', { releaseKey: 'Payments v1' }), a('healthy')]);
  assert.deepEqual(groups.map((g) => [g.name, g.items.length]), [['Checkout v2.0', 2], ['Payments v1', 1]]);
});

test('accepting a risk needs a real reason and a sensible length', () => {
  assert.match(validateRiskAcceptance({ reason: 'ok', days: 7 }).error, /at least 10/);
  assert.match(validateRiskAcceptance({ reason: 'A proper written reason', days: 0 }).error, /1 to 90/);
  assert.match(validateRiskAcceptance({ reason: 'A proper written reason', days: 365 }).error, /1 to 90/);
  assert.deepEqual(validateRiskAcceptance({ reason: 'A proper written reason', days: '7' }), { reason: 'A proper written reason', days: 7 });
  assert.equal(validateRiskAcceptance({ reason: 'A proper written reason' }).days, 14); // default
  const rec = buildRiskAcceptance({ accountId: 'u1', byName: 'Ananya', reason: 'A proper written reason', days: 7 }, NOW);
  assert.equal(rec.until, '2026-11-17T12:00:00.000Z');
  assert.equal(rec.by, 'u1');
});
