// Tests for the dashboard/settings helpers. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, filterAssumptions, validateSettings, isDueForCheck } from '../src/lib/dashboard.js';

const items = [
  { id: 1, text: 'Checkout handles 1,000 orders/min', status: 'contradicted', trippedAt: '2026-11-06T10:00:00Z', lastCheckedAt: '2026-11-06T11:00:00Z', pageTitle: 'Checkout design', ticketKey: 'HSW-7', releaseKey: 'Checkout v2.0' },
  { id: 2, text: 'Uploads never exceed 10 MB', status: 'healthy', trippedAt: null, lastCheckedAt: '2026-11-06T12:00:00Z', pageTitle: 'Checkout design', ticketKey: null },
  { id: 3, text: 'Vendor API under 200 ms', status: 'at-risk', trippedAt: '2026-11-06T13:00:00Z', lastCheckedAt: '2026-11-06T09:00:00Z', pageTitle: 'Vendor doc', ticketKey: 'HSW-8' },
  { id: 4, text: 'Uptime 99.9%', status: 'unverified', trippedAt: null, lastCheckedAt: null, pageTitle: 'Ops doc', ticketKey: null },
  { id: 5, text: 'Search p95 under 300 ms', status: 'stale', trippedAt: null, lastCheckedAt: '2026-10-01T00:00:00Z', pageTitle: 'Search doc', ticketKey: null },
];

test('summarize counts each status and what needs attention', () => {
  assert.deepEqual(summarize(items), { total: 5, healthy: 1, atRisk: 1, contradicted: 1, unverified: 1, stale: 1, attention: 2 });
  assert.deepEqual(summarize([]), { total: 0, healthy: 0, atRisk: 0, contradicted: 0, unverified: 0, stale: 0, attention: 0 });
});

test('filter by status, including the "needs attention" group', () => {
  assert.deepEqual(filterAssumptions(items, { status: 'contradicted' }).map((a) => a.id), [1]);
  assert.deepEqual(filterAssumptions(items, { status: 'attention' }).map((a) => a.id), [1, 3]); // contradicted before at-risk
  assert.equal(filterAssumptions(items, { status: 'all' }).length, 5);
});

test('the default sort puts what needs attention first: contradicted, at-risk, stale, unverified, healthy', () => {
  assert.deepEqual(filterAssumptions(items).map((a) => a.id), [1, 3, 5, 4, 2]);
});

test('search matches text, page title, ticket key and release (case-insensitive)', () => {
  assert.deepEqual(filterAssumptions(items, { search: 'VENDOR' }).map((a) => a.id), [3]);
  assert.deepEqual(filterAssumptions(items, { search: 'hsw-7' }).map((a) => a.id), [1]);
  assert.deepEqual(filterAssumptions(items, { search: 'checkout design' }).map((a) => a.id).sort(), [1, 2]);
  assert.deepEqual(filterAssumptions(items, { search: 'checkout v2' }).map((a) => a.id), [1]);
  assert.deepEqual(filterAssumptions(items, { search: 'zzz' }), []);
});

test('sort by checked and by text', () => {
  assert.deepEqual(filterAssumptions(items, { sort: 'checked' }).map((a) => a.id), [2, 1, 3, 5, 4]);
  assert.deepEqual(filterAssumptions(items, { sort: 'text' }).map((a) => a.id), [1, 5, 4, 2, 3].sort((x, y) => items.find((i) => i.id === x).text.localeCompare(items.find((i) => i.id === y).text)));
});

test('validateSettings accepts good values and rejects bad ones', () => {
  assert.equal(validateSettings({ defaultWindowDays: '14', defaultThreshold: '3', checkIntervalMinutes: 60 }), null);
  assert.equal(validateSettings({}), null);
  assert.match(validateSettings({ defaultWindowDays: '0' }), /window/i);
  assert.match(validateSettings({ defaultWindowDays: '400' }), /window/i);
  assert.match(validateSettings({ defaultThreshold: '0' }), /threshold/i);
  assert.match(validateSettings({ checkIntervalMinutes: 7 }), /interval/i);
});

test('isDueForCheck honours the interval with a 5 minute grace', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  assert.equal(isDueForCheck(null, 60, now), true);
  assert.equal(isDueForCheck('2026-11-06T11:30:00Z', 60, now), false); // 30 min ago
  assert.equal(isDueForCheck('2026-11-06T11:00:00Z', 60, now), true);  // 60 min ago
  assert.equal(isDueForCheck('2026-11-06T11:56:00Z', 60, now), false);
  assert.equal(isDueForCheck('2026-11-06T09:00:00Z', 360, now), false); // 3 h ago, interval 6 h
});
