// Tests for the retry and friendly-error helpers. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWithRetry, friendlyStatus, failWith } from '../src/lib/http.js';

const response = (status, headers = {}, body = '') => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] },
  text: async () => body,
});

test('sendWithRetry returns straight away on success', async () => {
  let calls = 0;
  const res = await sendWithRetry(async () => { calls += 1; return response(200); });
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
});

test('sendWithRetry retries a 429 and then succeeds', async () => {
  let calls = 0;
  const res = await sendWithRetry(async () => { calls += 1; return calls < 2 ? response(429, { 'retry-after': '0' }) : response(200); });
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
});

test('sendWithRetry gives up after the retry limit', async () => {
  let calls = 0;
  const res = await sendWithRetry(async () => { calls += 1; return response(429, { 'retry-after': '0' }); }, 2);
  assert.equal(res.status, 429);
  assert.equal(calls, 3); // first try + 2 retries
});

test('sendWithRetry does not retry normal errors', async () => {
  let calls = 0;
  await sendWithRetry(async () => { calls += 1; return response(400); });
  assert.equal(calls, 1);
});

test('friendlyStatus explains common problems in plain English', () => {
  assert.match(friendlyStatus(403), /permission/);
  assert.match(friendlyStatus(404), /not found/);
  assert.match(friendlyStatus(429), /try again/);
  assert.match(friendlyStatus(503), /temporary/);
  assert.equal(friendlyStatus(418), null);
});

test('failWith keeps Jira\'s own explanation for a bad query (400) and is friendly otherwise', async () => {
  const bad = response(400, {}, JSON.stringify({ errorMessages: ['Error in the JQL Query: unexpected token'], errors: {} }));
  await assert.rejects(failWith(bad, 'Counting issues'), /Counting issues failed: Error in the JQL Query/);
  await assert.rejects(failWith(response(403, {}, 'secret internal text'), 'Reading project'), (e) => /permission/.test(e.message) && !/secret/.test(e.message));
});
