// Tests for the example-workspace definitions. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ISSUES, SAMPLE_PAGE_BODY, SAMPLE_PAGE_TITLE, sampleAssumptions, phraseJql, sampleScopeJql, isValidProjectKey } from '../src/lib/sampleData.js';
import { extractAssumptions } from '../src/lib/extract.js';
import { validateTripwire } from '../src/lib/tripwire.js';

test('exactly three checkout issues so the checkout assumption trips at 3', () => {
  assert.equal(SAMPLE_ISSUES.filter((i) => i.phrase === 'checkout v2').length, 3);
  assert.equal(SAMPLE_ISSUES.filter((i) => i.phrase === 'vendor api').length, 1); // a near miss: stays healthy
  assert.ok(SAMPLE_ISSUES.every((i) => i.summary.toLowerCase().startsWith(i.phrase)));
});

test('the example looks like a real project: no "demo" or "sample" wording in titles', () => {
  assert.doesNotMatch(SAMPLE_PAGE_TITLE, /demo|sample/i);
  for (const i of SAMPLE_ISSUES) assert.doesNotMatch(i.summary, /demo|sample/i);
});

test('example tripwires are valid and each targets its own phrase', () => {
  const defs = sampleAssumptions('HSW');
  assert.equal(defs.length, 4);
  for (const d of defs) assert.equal(validateTripwire(d), null);
  assert.equal(defs[0].jql, 'project = HSW AND summary ~ "\\"checkout v2\\""');
  assert.equal(defs.filter((d) => d.check).length, 3); // the 4th stays unchecked
  assert.equal(phraseJql('KAN', 'vendor api'), 'project = KAN AND summary ~ "\\"vendor api\\""');
  assert.match(sampleScopeJql('KAN'), /project = KAN AND \(summary ~ "\\"checkout v2\\"" OR summary ~ "\\"vendor api\\""\)/);
});

test('the example page contains sentences our extractor can pick up', () => {
  const found = extractAssumptions(SAMPLE_PAGE_BODY).map((s) => s.text);
  assert.ok(found.some((s) => /1,000 orders\/min/.test(s)));
  assert.ok(found.some((s) => /200 ms/.test(s)));
});

test('project key validation', () => {
  assert.equal(isValidProjectKey('HSW'), true);
  assert.equal(isValidProjectKey('K'), false);
  assert.equal(isValidProjectKey('has space'), false);
  assert.equal(isValidProjectKey(''), false);
});
