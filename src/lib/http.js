// http.js - shared helpers for calling Jira/Confluence politely and reporting problems in plain English.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `call()` (a function that returns a response). If the product says "slow down" (HTTP 429) or is briefly
// unavailable (503), wait a moment and try again, up to `retries` times. Honours the Retry-After header (max 5 s).
export async function sendWithRetry(call, retries = 2) {
  let res = await call();
  for (let attempt = 0; attempt < retries && (res.status === 429 || res.status === 503); attempt += 1) {
    const seconds = Number(res.headers?.get?.('retry-after')) || 2 * (attempt + 1);
    await sleep(Math.min(seconds, 5) * 1000);
    res = await call();
  }
  return res;
}

// Turns a status code into a message a normal person can act on.
export function friendlyStatus(status) {
  if (status === 401 || status === 403) return 'You do not have permission to do that.';
  if (status === 404) return 'It was not found, or you do not have permission to see it.';
  if (status === 429) return 'The Atlassian site is busy and asked us to slow down. Please try again in a minute.';
  if (status >= 500) return 'Atlassian is having a temporary problem. Please try again in a moment.';
  return null;
}

// Throws an Error whose message is friendly. For "400 Bad Request" we keep Jira's own explanation
// (for example "Error in the JQL Query"), because that is what the user needs to fix their query.
export async function failWith(res, what) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = [...(json.errorMessages || []), ...Object.values(json.errors || {})].join(' ');
    } catch (e) {
      detail = text;
    }
  } catch (e) { /* ignore */ }
  const friendly = friendlyStatus(res.status);
  if (res.status === 400) throw new Error(`${what} failed: ${detail.slice(0, 300) || 'the request was not valid.'}`);
  throw new Error(`${what} failed. ${friendly || `(HTTP ${res.status}) ${detail.slice(0, 200)}`}`);
}
