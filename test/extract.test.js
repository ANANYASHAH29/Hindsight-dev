// Tests for deterministic extraction and tripwire templates. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAssumptions, storageToText } from '../src/lib/extract.js';
import { buildTemplateJql } from '../src/lib/tripwire.js';

const page = `
<h1>Checkout redesign</h1>
<p>We assume checkout handles 1,000 orders/min.</p>
<ul><li>The vendor API should never exceed 200 ms.</li><li>Users never upload files over 10 MB.</li></ul>
<p>This paragraph is just background and has no claims at all.</p>
<p>We expect 99.9% uptime during sales.</p>
<p>We assume checkout handles 1,000 orders/min.</p>
<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Peak load is 5k users.</p></ac:rich-text-body></ac:structured-macro>
`;

test('storageToText strips tags and keeps blocks on separate lines', () => {
  const t = storageToText('<p>One &amp; two</p><ul><li>Three</li></ul>');
  assert.match(t, /One & two/);
  assert.ok(t.split('\n').filter(Boolean).length >= 2);
  assert.doesNotMatch(t, /</);
});

test('extractAssumptions finds assumption wording and numbers with units', () => {
  const found = extractAssumptions(page).map((s) => s.text);
  assert.ok(found.some((s) => /1,000 orders\/min/.test(s)));
  assert.ok(found.some((s) => /200 ms/.test(s)));
  assert.ok(found.some((s) => /10 MB/.test(s)));
  assert.ok(found.some((s) => /99\.9%/.test(s)));
  assert.ok(found.some((s) => /5k users/.test(s)));
});

test('extractAssumptions ignores background text and removes duplicates', () => {
  const found = extractAssumptions(page).map((s) => s.text);
  assert.ok(!found.some((s) => /background/.test(s)));
  assert.equal(found.filter((s) => /1,000 orders/.test(s)).length, 1);
});

test('extractAssumptions handles empty input', () => {
  assert.deepEqual(extractAssumptions(''), []);
  assert.deepEqual(extractAssumptions(null), []);
});

test('buildTemplateJql builds JQL and escapes quotes', () => {
  assert.equal(buildTemplateJql('bug-component', 'hsw', 'Checkout').jql, 'project = HSW AND issuetype = Bug AND component = "Checkout"');
  assert.equal(buildTemplateJql('incident', 'HSW', '').jql, 'project = HSW AND issuetype = Incident');
  assert.equal(buildTemplateJql('text', 'HSW', 'say "hi"').jql, 'project = HSW AND text ~ "say \\"hi\\""');
});

test('buildTemplateJql rejects bad input', () => {
  assert.match(buildTemplateJql('label', 'not a key', 'x').error, /Project key/);
  assert.match(buildTemplateJql('label', 'HSW', '').error, /Label/);
  assert.match(buildTemplateJql('nope', 'HSW', 'x').error, /template/i);
});
