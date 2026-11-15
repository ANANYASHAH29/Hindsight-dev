// confluence.js - Confluence REST calls.
// We use asUser() so a person can only read pages THEY are allowed to see.
import api, { route } from '@forge/api';
import { sendWithRetry, failWith } from './http.js';

// Returns { title, storage, lastEditedAt, versionNumber } for a page, or throws a readable Error.
export async function getPageBody(pageId, requester = api.asUser()) {
  const res = await sendWithRetry(() => requester.requestConfluence(route`/wiki/api/v2/pages/${pageId}?body-format=storage`, {
    headers: { Accept: 'application/json' },
  }));
  if (res.status === 404) throw new Error('That Confluence page was not found, or you do not have permission to see it.');
  if (!res.ok) await failWith(res, 'Reading the page');
  const page = await res.json();
  return { title: page.title, storage: page.body?.storage?.value || '', lastEditedAt: page.version?.createdAt || null, versionNumber: page.version?.number || 1 };
}

// Adds a footer comment to a page (used when an assumption trips and comments are switched on in settings).
// Runs as the APP (there may be no user in the room, e.g. the hourly scheduler). Returns true if it worked.
const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export async function addFooterComment(pageId, text) {
  const res = await sendWithRetry(() => api.asApp().requestConfluence(route`/wiki/api/v2/footer-comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ pageId: String(pageId), body: { representation: 'storage', value: `<p>${escapeHtml(text)}</p>` } }),
  }));
  if (!res.ok) await failWith(res, 'Adding the Confluence comment');
  return true;
}

// Just the page title (no body), as the given requester. Used by the dashboard.
// Returns null when the page is missing OR the person may not see it (404/403), so we can hide it.
// Any other failure throws, and the caller decides what to do.
export async function getPageTitle(pageId, requester = api.asUser()) {
  const res = await sendWithRetry(() => requester.requestConfluence(route`/wiki/api/v2/pages/${pageId}`, { headers: { Accept: 'application/json' } }));
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) await failWith(res, 'Reading the page');
  return (await res.json()).title;
}

// Save a new version of a page body. Runs AS THE PERSON, so Confluence checks they may edit the page.
// Confluence keeps the previous version in the page history.
export async function updatePageBody(pageId, { title, value, versionNumber, message }, requester = api.asUser()) {
  const res = await sendWithRetry(() => requester.requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: String(pageId),
      status: 'current',
      title,
      body: { representation: 'storage', value },
      version: { number: versionNumber, message },
    }),
  }));
  if (!res.ok) await failWith(res, 'Updating the page');
}
