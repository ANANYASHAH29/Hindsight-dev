// storage.js - everything that touches Forge Key-Value Storage (KVS).
// Keys:
//   assumption:<id>  -> one assumption object
//   page:<pageId>    -> array of assumption ids on that page
//   index:assumptions-> array of ALL ids (used by the scheduler/dashboard later)
//   settings         -> { projectKey, defaultWindowDays, defaultThreshold, confluenceComments }
import { kvs } from '@forge/kvs';

const DEFAULT_SETTINGS = { projectKey: '', defaultWindowDays: 14, defaultThreshold: 3, confluenceComments: false, checkIntervalMinutes: 60 };

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...((await kvs.get('settings')) || {}) };
}
export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await kvs.set('settings', next);
  return next;
}

export async function getAssumption(id) {
  return (await kvs.get(`assumption:${id}`)) || null;
}

export async function listPageAssumptions(pageId) {
  const ids = (await kvs.get(`page:${pageId}`)) || [];
  const items = await Promise.all(ids.map(getAssumption));
  return items.filter(Boolean);
}

export async function listAllAssumptions() {
  const ids = (await kvs.get('index:assumptions')) || [];
  const items = await Promise.all(ids.map(getAssumption));
  return items.filter(Boolean);
}

// Save (create or update) one assumption and keep the two id lists in sync.
export async function saveAssumption(a) {
  await kvs.set(`assumption:${a.id}`, a);
  await addToList(`page:${a.pageId}`, a.id);
  await addToList('index:assumptions', a.id);
  return a;
}

export async function deleteAssumption(a) {
  await kvs.delete(`assumption:${a.id}`);
  await removeFromList(`page:${a.pageId}`, a.id);
  await removeFromList('index:assumptions', a.id);
}

async function addToList(key, id) {
  const list = (await kvs.get(key)) || [];
  if (!list.includes(id)) await kvs.set(key, [...list, id]);
}
async function removeFromList(key, id) {
  const list = (await kvs.get(key)) || [];
  await kvs.set(key, list.filter((x) => x !== id));
}

// Per-page settings: which Jira area does this doc cover? (used for the freshness check)
export async function getPageConfig(pageId) {
  return (await kvs.get(`pageconfig:${pageId}`)) || { scopeJql: '' };
}
export async function savePageConfig(pageId, patch) {
  const next = { ...(await getPageConfig(pageId)), ...patch };
  await kvs.set(`pageconfig:${pageId}`, next);
  return next;
}

// ---- A short "check running" lock (best effort: Forge storage has no atomic compare-and-set) ----
const LOCK_MS = 60000;
export async function acquireLock(id) {
  const key = `lock:${id}`;
  const taken = await kvs.get(key);
  if (taken && Date.now() - Number(taken) < LOCK_MS) return false;
  await kvs.set(key, Date.now());
  return true;
}
export async function releaseLock(id) {
  await kvs.delete(`lock:${id}`);
}

// ---- The last verdict we saw for each release (so a CHANGE can be written to the audit log) ----
const verdictKey = (name) => `release-verdict:${String(name).toLowerCase()}`;
export async function getReleaseVerdict(name) {
  return (await kvs.get(verdictKey(name))) || null;
}
export async function saveReleaseVerdict(name, verdict) {
  await kvs.set(verdictKey(name), verdict);
}
