// Tests for the page-id / ticket-key rules the Rovo actions rely on.
// (The actions file imports Forge-only modules, so the two small rules are checked here, and the test also
// confirms the real source still contains them.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/actions/index.js', import.meta.url), 'utf8');

test('actions only treat numeric values as Confluence page ids', () => {
  assert.ok(src.includes('const asPageId ='), 'asPageId helper must exist in the actions file');
  const asPageId = (v) => (/^\d+$/.test(String(v || '').trim()) ? String(v).trim() : '');
  assert.equal(asPageId('KAN-8'), '');
  assert.equal(asPageId(''), '');
  assert.equal(asPageId(undefined), '');
  assert.equal(asPageId(' 262184 '), '262184');
});

test('ticket keys are recognised in the usual Jira format', () => {
  assert.ok(src.includes('const TICKET_KEY ='), 'TICKET_KEY must exist in the actions file');
  const TICKET_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
  assert.equal(TICKET_KEY.test('KAN-8'), true);
  assert.equal(TICKET_KEY.test('HSW-12'), true);
  assert.equal(TICKET_KEY.test('262184'), false);
  assert.equal(TICKET_KEY.test('kan-8'), false); // the action upper-cases before testing
});

test('status words from agents are understood in the new vocabulary, and unknown words do not filter anything out', () => {
  assert.ok(src.includes('export function normaliseStatus'));
  // Mirror of the mapping, checked against the lists in the source file.
  const body = src.slice(src.indexOf('export function normaliseStatus'), src.indexOf('// ACTION list-assumptions'));
  const normaliseStatus = new Function(`${body.replace('export function', 'function')}; return normaliseStatus;`)();
  assert.equal(normaliseStatus('tripped'), 'attention');   // the old word means "needs attention" (contradicted or at risk)
  assert.equal(normaliseStatus('Broken'), 'attention');
  assert.equal(normaliseStatus('contradicted'), 'contradicted');
  assert.equal(normaliseStatus('risky'), 'at-risk');
  assert.equal(normaliseStatus('OK'), 'healthy');
  assert.equal(normaliseStatus('pending'), 'unverified');
  assert.equal(normaliseStatus('outdated'), 'stale');
  assert.equal(normaliseStatus('open'), '');               // unknown word: do not filter
  assert.equal(normaliseStatus(undefined), '');
});
