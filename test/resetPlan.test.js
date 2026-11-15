// Tests for the reset safety rules. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RESET_PREFIXES, wouldPurge, isHindsightTicket, describeReset } from '../src/lib/resetPlan.js';

test('a reset removes every key family Hindsight uses, but NEVER the app settings', () => {
  for (const key of ['assumption:abc', 'page:123', 'pageconfig:123', 'index:assumptions', 'audit:log', 'lock:abc', 'release-verdict:checkout v2.0', 'sample:meta']) {
    assert.equal(wouldPurge(key), true, key);
  }
  assert.equal(wouldPurge('settings'), false);
});

test('page: does not swallow other keys by accident, and unknown keys are left alone', () => {
  assert.equal(wouldPurge('pageconfig:9'), true);   // covered by its own prefix
  assert.equal(wouldPurge('somebody-elses-key'), false);
  assert.equal(RESET_PREFIXES.includes('settings'), false);
});

test('every storage key the app writes is covered by the reset (or is the settings)', () => {
  // Read the real source so a NEW kind of key cannot be added to storage without deciding whether a reset covers it.
  const sources = ['src/lib/storage.js', 'src/lib/audit.js', 'src/lib/sample.js', 'src/lib/checker.js']
    .map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
  const used = new Set();
  for (const m of sources.matchAll(/kvs\.(?:get|set|delete)\(\s*[`'"]([a-z-]+:?)/g)) used.add(m[1]);
  for (const m of sources.matchAll(/(?:KEY|META_KEY)\s*=\s*'([a-z-]+:?[a-z]*)'/g)) used.add(m[1]);
  for (const m of sources.matchAll(/`([a-z-]+:)\$\{/g)) used.add(m[1]);
  const missed = [...used].filter((k) => k !== 'settings' && !wouldPurge(k.endsWith(':') ? `${k}x` : k));
  assert.deepEqual(missed, [], `these storage keys would survive a reset: ${missed.join(', ')}`);
});

test('only tickets Hindsight created are recognised as its own', () => {
  assert.equal(isHindsightTicket('Revisit assumption: Checkout handles 1,000 orders/min.'), true);
  assert.equal(isHindsightTicket('  revisit assumption: x'), true);
  assert.equal(isHindsightTicket('Payments API times out under load'), false);
  assert.equal(isHindsightTicket('We should revisit assumption handling'), false); // must START with the title
  assert.equal(isHindsightTicket(''), false);
  assert.equal(isHindsightTicket(undefined), false);
});

test('the preview tells a person exactly what will be deleted', () => {
  const lines = describeReset({ assumptions: 4, tickets: ['KAN-12', 'KAN-17'], auditEntries: 31, demoOn: false });
  assert.match(lines[0], /4 assumptions/);
  assert.match(lines[1], /2 "Revisit assumption" tickets \(KAN-12, KAN-17\)/);
  assert.match(lines[2], /audit log \(31 entries\)/);
  assert.equal(lines.length, 3);
  assert.equal(describeReset({ assumptions: 1, tickets: [], auditEntries: 1, demoOn: true }).length, 4);
  assert.match(describeReset({ assumptions: 1, tickets: [], auditEntries: 1 })[1], /no "Revisit assumption" tickets/);
});
