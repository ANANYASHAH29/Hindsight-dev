// Tests for the display helpers. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo, gauge, summaryLine, metaLine, attentionBanner, releaseBanner } from '../src/lib/format.js';

const NOW = new Date('2026-11-10T12:00:00Z');

test('timeAgo gives short, human wording', () => {
  assert.equal(timeAgo(null, NOW), 'never');
  assert.equal(timeAgo('2026-11-10T11:59:30Z', NOW), 'just now');
  assert.equal(timeAgo('2026-11-10T11:55:00Z', NOW), '5 minutes ago');
  assert.equal(timeAgo('2026-11-10T11:00:00Z', NOW), '1 hour ago');
  assert.equal(timeAgo('2026-11-08T12:00:00Z', NOW), '2 days ago');
});

test('gauge is 0 to 1, never more, and 0 when nothing was checked', () => {
  assert.equal(gauge({ matched: 3, effective: 3, threshold: 3 }), 1);
  assert.equal(gauge({ matched: 1, effective: 1, threshold: 4 }), 0.25);
  assert.equal(gauge({ matched: 9, effective: 9, threshold: 3 }), 1);
  assert.equal(gauge({ matched: null, threshold: 3 }), 0);
  assert.equal(gauge(undefined), 0);
  assert.equal(gauge({ matched: 3, effective: 2, threshold: 4 }), 0.5); // reviewed-unrelated issues are not counted
});

test('summaryLine says what was found, and mentions dismissed issues', () => {
  assert.equal(summaryLine({ matched: 3, effective: 3, threshold: 3 }, 14), '3 of 3 matching issues in the last 14 days');
  assert.equal(summaryLine({ matched: 1, effective: 1, threshold: 1 }, 7), '1 of 1 matching issue in the last 7 days');
  assert.equal(summaryLine({ matched: 3, effective: 2, dismissed: 1, threshold: 3 }, 14), '2 of 3 matching issues in the last 14 days (1 marked unrelated)');
  assert.equal(summaryLine({ matched: null, threshold: 3 }, 14), 'Not checked yet.');
});

test('metaLine lists ticket, release and last check, and skips what is missing', () => {
  assert.equal(metaLine({ ticketKey: 'KAN-12', ticketStatus: 'open', releaseKey: 'Checkout v2.0', lastCheckedAt: '2026-11-10T11:00:00Z' }, NOW), 'Ticket KAN-12 (open)  |  Release Checkout v2.0  |  Checked 1 hour ago');
  assert.equal(metaLine({}, NOW), 'Never checked');
});

test('the dashboard banner puts the most serious thing first and never claims "healthy" falsely', () => {
  assert.equal(attentionBanner({ total: 0 }), null);
  const contradicted = attentionBanner({ total: 4, contradicted: 1, atRisk: 1, healthy: 2, unverified: 0, stale: 0 });
  assert.equal(contradicted.appearance, 'error');
  assert.match(contradicted.title, /1 assumption is contradicted/);
  assert.match(contradicted.text, /1 more needs investigating/);
  assert.equal(attentionBanner({ total: 3, contradicted: 0, atRisk: 2, unverified: 0, stale: 0 }).appearance, 'warning');
  assert.equal(attentionBanner({ total: 3, contradicted: 0, atRisk: 0, unverified: 1, stale: 1 }).appearance, 'information');
  const ok = attentionBanner({ total: 3, contradicted: 0, atRisk: 0, unverified: 0, stale: 0 });
  assert.equal(ok.appearance, 'success');
});

test('the release banner reflects the verdict', () => {
  assert.deepEqual(releaseBanner('Checkout v2.0', 'blocked', 'Blocked: 1 critical assumption is contradicted.'), { appearance: 'error', title: 'Checkout v2.0: Blocked', text: 'Blocked: 1 critical assumption is contradicted.' });
  assert.equal(releaseBanner('R', 'at-risk', '').appearance, 'warning');
  assert.equal(releaseBanner('R', 'ready', '').appearance, 'success');
  assert.equal(releaseBanner('R', 'unknown', '').appearance, 'information');
});
