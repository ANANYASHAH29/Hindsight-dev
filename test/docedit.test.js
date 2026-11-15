// Tests for the doc-editing and owner helpers used by the agent's "do the work" actions. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceSentence, suggestOwnerDetails, toAdf, projectKeyOf, normalizeTitle, containsSentence } from '../src/lib/docedit.js';

const page = '<h1>Payments</h1><p>We assume the payments API handles 500 requests per second.</p><ul><li>Refunds never exceed 2% of orders.</li></ul>';

test('replaceSentence replaces exactly one sentence and leaves the rest untouched', () => {
  const r = replaceSentence(page, 'We assume the payments API handles 500 requests per second.', 'We assume the payments API handles 350 requests per second.');
  assert.equal(r.error, undefined);
  assert.match(r.value, /350 requests per second\./);
  assert.match(r.value, /Refunds never exceed 2% of orders\./);
  assert.doesNotMatch(r.value, /500 requests/);
});

test('replaceSentence matches even when the page lacks the final full stop', () => {
  const r = replaceSentence('<p>Refunds never exceed 2% of orders</p>', 'Refunds never exceed 2% of orders.', 'Refunds never exceed 3% of orders.');
  assert.equal(r.value, '<p>Refunds never exceed 3% of orders</p>');
});

test('replaceSentence handles HTML entities in the page', () => {
  const r = replaceSentence('<p>Peak is 5k users &amp; growing.</p>', 'Peak is 5k users & growing.', 'Peak is 8k users & growing.');
  assert.equal(r.value, '<p>Peak is 8k users &amp; growing.</p>');
});

test('replaceSentence refuses when the sentence is missing or appears twice', () => {
  assert.match(replaceSentence(page, 'Not on this page at all.', 'x').error, /not found/);
  assert.match(replaceSentence('<p>Same.</p><p>Same.</p>', 'Same.', 'Other.').error, /more than once/);
  assert.match(replaceSentence(page, '', 'x').error, /no sentence/);
  assert.match(replaceSentence(page, 'Refunds never exceed 2% of orders.', '').error, /empty/);
  assert.match(replaceSentence(page, 'Refunds never exceed 2% of orders.', 'x'.repeat(600)).error, /too long/);
});

test('replaceSentence escapes angle brackets in new text so it cannot inject markup', () => {
  const r = replaceSentence('<p>Old sentence.</p>', 'Old sentence.', 'New <b>sentence</b>.');
  assert.equal(r.value, '<p>New &lt;b&gt;sentence&lt;/b&gt;.</p>');
});

test('suggestOwnerDetails prefers the most frequent assignee, then the reporter, and returns the account id', () => {
  const issue = (assignee, reporter) => ({ fields: { assignee, reporter } });
  const sam = { accountId: 's1', displayName: 'Sam' };
  const joe = { accountId: 'j1', displayName: 'Joe' };
  const rita = { accountId: 'r1', displayName: 'Rita' };
  assert.deepEqual(suggestOwnerDetails([issue(sam, rita), issue(sam, rita), issue(joe, rita)]), { accountId: 's1', displayName: 'Sam' });
  assert.deepEqual(suggestOwnerDetails([issue(null, rita), issue(null, joe), issue(null, rita)]), { accountId: 'r1', displayName: 'Rita' });
  assert.equal(suggestOwnerDetails([]), null);
  assert.equal(suggestOwnerDetails([issue(null, null)]), null);
});

test('toAdf builds one paragraph per line and ignores blanks', () => {
  const adf = toAdf('First line\n\nSecond line');
  assert.equal(adf.type, 'doc');
  assert.equal(adf.content.length, 2);
  assert.equal(adf.content[1].content[0].text, 'Second line');
});

test('projectKeyOf reads the project from an issue key', () => {
  assert.equal(projectKeyOf('KAN-12'), 'KAN');
  assert.equal(projectKeyOf(' hsw-3 '), 'HSW');
  assert.equal(projectKeyOf('262184'), '');
  assert.equal(projectKeyOf(''), '');
});

test('normalizeTitle ignores case and punctuation, so duplicate tasks and tickets are recognised', () => {
  assert.equal(normalizeTitle('Investigate: the 500 errors, under load!'), 'investigate the 500 errors under load');
  assert.equal(normalizeTitle('  Revisit  assumption: Checkout handles 1,000 orders/min.'), 'revisit assumption checkout handles 1 000 orders min');
  assert.equal(normalizeTitle(''), '');
});

test('containsSentence verifies a saved page really holds the new sentence (a failed update is never reported as success)', () => {
  const after = '<p>Checkout handles 400 orders/min.</p><p>Peak is 8k users &amp; growing.</p>';
  assert.equal(containsSentence(after, 'Checkout handles 400 orders/min.'), true);
  assert.equal(containsSentence(after, 'Checkout handles 400 orders/min'), true);   // without the final full stop
  assert.equal(containsSentence(after, 'Peak is 8k users & growing.'), true);       // HTML-escaped in the page
  assert.equal(containsSentence(after, 'Checkout handles 1,000 orders/min.'), false);
  assert.equal(containsSentence(after, ''), false);
  assert.equal(containsSentence('', 'anything'), false);
});
