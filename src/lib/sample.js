// sample.js - one-click demo data: create it, and remove it again. Safe to click twice (idempotent).
// Everything we create is recorded in ONE storage record ("sample:meta") so "Remove" can undo exactly that.
// Only Jira site administrators may use it. Calls run AS THE USER, so Atlassian enforces their permissions.
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { SAMPLE_PAGE_TITLE, SAMPLE_PAGE_TITLE_FALLBACK, SAMPLE_PAGE_BODY, SAMPLE_ISSUES, SAMPLE_RELEASE, sampleAssumptions, sampleScopeJql, isValidProjectKey } from './sampleData.js';
import { createAssumption } from './assumptions.js';
import { checkAssumption } from './checker.js';
import { reviewEvidence } from './review.js';
import { countIssues } from './jira.js';
import { buildJql } from './tripwire.js';
import { getSettings, saveSettings, getAssumption, deleteAssumption, savePageConfig } from './storage.js';
import { addAudit } from './audit.js';
import { failWith } from './http.js';
import { requireAdmin } from './permissions.js';

const META_KEY = 'sample:meta';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

const fail = failWith;

// Which Jira project to use: the one chosen in settings, otherwise the first software project the user can see.
async function pickProject() {
  const { projectKey } = await getSettings();
  if (projectKey && isValidProjectKey(projectKey)) return projectKey;
  const res = await api.asUser().requestJira(route`/rest/api/3/project/search?maxResults=20&typeKey=software`, { headers: { Accept: 'application/json' } });
  if (!res.ok) await fail(res, 'Looking for a Jira project');
  const first = (await res.json()).values?.[0];
  if (!first) throw new Error('No Jira software project found. Create a Jira project first, or choose one in Settings.');
  return first.key;
}

// Bug if the project has a Bug type, otherwise Task (some simple projects only have Task/Epic/Subtask).
async function pickIssueType(projectKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/project/${projectKey}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) await fail(res, `Reading project ${projectKey}`);
  const types = (await res.json()).issueTypes.filter((t) => !t.subtask);
  return types.find((t) => t.name === 'Bug') || types.find((t) => t.name === 'Task') || types[0];
}

async function createDemoIssue(projectKey, issueTypeId, summary) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ fields: { project: { key: projectKey }, issuetype: { id: issueTypeId }, summary } }),
  });
  if (!res.ok) await fail(res, 'Creating a demo issue');
  return (await res.json()).key;
}

// Create the demo design doc in the first space where the user is allowed to create pages.
async function createDemoPage() {
  const res = await api.asUser().requestConfluence(route`/wiki/api/v2/spaces?limit=25&status=current`, { headers: { Accept: 'application/json' } });
  if (!res.ok) await fail(res, 'Listing Confluence spaces');
  const spaces = (await res.json()).results || [];
  if (spaces.length === 0) throw new Error('No Confluence space found to put the example page in.');
  spaces.sort((x, y) => (x.type === 'global' ? -1 : 1) - (y.type === 'global' ? -1 : 1)); // prefer shared spaces
  let lastError = null;
  // A page title must be unique inside a space, so if the normal title is taken we retry with a fallback title.
  for (const title of [SAMPLE_PAGE_TITLE, SAMPLE_PAGE_TITLE_FALLBACK]) {
    for (const space of spaces.slice(0, 4)) {
      const create = await api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ spaceId: space.id, status: 'current', title, body: { representation: 'storage', value: SAMPLE_PAGE_BODY } }),
      });
      if (create.ok) return (await create.json()).id;
      lastError = `HTTP ${create.status}: ${(await create.text()).slice(0, 200)}`;
    }
  }
  throw new Error(`Could not create the example page (${lastError}).`);
}

// Newly created issues take a moment to become searchable, so wait (up to ~10 s) for the count to settle.
async function waitUntilSearchable(jql, expected) {
  for (let i = 0; i < 5; i += 1) {
    if ((await countIssues(jql, api.asUser())) >= expected) return;
    await sleep(2000);
  }
}

export async function getSampleStatus() {
  return { exists: Boolean(await kvs.get(META_KEY)) };
}

// ---- CREATE -----------------------------------------------------------------------------------
export async function generateSample(accountId) {
  await requireAdmin('load the example workspace');
  if (await kvs.get(META_KEY)) return { error: 'The example workspace is already loaded. Remove it first if you want a fresh copy.' };

  const meta = { pageId: null, issueKeys: [], assumptionIds: [], createdAt: new Date().toISOString() };
  const save = () => kvs.set(META_KEY, meta); // saved after every step, so a half-finished run can still be removed
  try {
    const projectKey = await pickProject();
    meta.projectKey = projectKey;
    await save();

    // 1) The design doc FIRST, so the Jira issues below are newer than the page ("possibly out of date" demo).
    meta.pageId = await createDemoPage();
    await save();

    // 2) The demo Jira issues.
    const issueType = await pickIssueType(projectKey);
    for (const issue of SAMPLE_ISSUES) {
      meta.issueKeys.push(await createDemoIssue(projectKey, issueType.id, issue.summary));
      await save();
    }

    // 3) Tell Hindsight which Jira area the doc covers (for the freshness check) and where to create Revisit tickets.
    await savePageConfig(meta.pageId, { scopeJql: sampleScopeJql(projectKey) });
    const settings = await getSettings();
    if (!settings.projectKey) await saveSettings({ projectKey });

    // 4) The four assumptions, then check three of them (the fourth stays "unchecked").
    const defs = sampleAssumptions(projectKey);
    await waitUntilSearchable(buildJql(defs[0].jql, defs[0].windowDays), 3);
    for (const def of defs) {
      const made = await createAssumption({ pageId: meta.pageId, text: def.text, jql: def.jql, windowDays: def.windowDays, threshold: def.threshold, template: 'sample', releaseKey: SAMPLE_RELEASE, accountId, requester: api.asUser() });
      if (made.error) throw new Error(made.error);
      meta.assumptionIds.push(made.assumption.id);
      await save();
      if (def.check) {
        const checked = await checkAssumption(made.assumption, api.asUser(), accountId);
        // The example's checkout claim is found by keyword, so the checker rates it "at risk" (related evidence). The way it
        // becomes "contradicted" is a person's review: we record that the payment-page failure contradicts it, exactly as a user would.
        if (def.confirmsFirstIssue && meta.issueKeys[0]) await reviewEvidence(checked, meta.issueKeys[0], 'contradicts', accountId);
      }
    }
    await addAudit({ type: 'sample-created', actor: accountId, detail: `Page ${meta.pageId}, ${meta.issueKeys.length} issues in ${projectKey}.` });
    return { ok: true, pageId: meta.pageId, projectKey, issueKeys: meta.issueKeys, assumptions: meta.assumptionIds.length };
  } catch (e) {
    return { error: `${e.message} (Anything already created can be removed with "Remove example workspace".)` };
  }
}

// ---- REMOVE -----------------------------------------------------------------------------------
async function tryDelete(label, fn, problems) {
  try { await fn(); } catch (e) { problems.push(`${label}: ${e.message}`); }
}

export async function removeSample(accountId) {
  await requireAdmin('remove the example workspace');
  const meta = await kvs.get(META_KEY);
  if (!meta) return { ok: true, removed: false };
  const problems = [];

  // Assumptions, and the "Revisit" tickets Hindsight created for them.
  const ticketKeys = [];
  for (const id of meta.assumptionIds || []) {
    const a = await getAssumption(id);
    if (!a) continue;
    if (a.ticketKey) ticketKeys.push(a.ticketKey);
    await deleteAssumption(a);
  }
  for (const key of [...ticketKeys, ...(meta.issueKeys || [])]) {
    await tryDelete(`issue ${key}`, async () => {
      const res = await api.asUser().requestJira(route`/rest/api/3/issue/${key}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) await fail(res, `Deleting ${key}`);
    }, problems);
  }
  if (meta.pageId) {
    await tryDelete('demo page', async () => {
      const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages/${meta.pageId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) await fail(res, 'Deleting the demo page');
    }, problems);
    await kvs.delete(`pageconfig:${meta.pageId}`);
  }
  if (problems.length === 0) await kvs.delete(META_KEY); // keep the record if something failed, so you can retry
  await addAudit({ type: 'sample-removed', actor: accountId, detail: problems.length ? `With problems: ${problems.join('; ')}` : 'Removed.' });
  return problems.length ? { ok: false, error: `Some items could not be removed: ${problems.join('; ')}` } : { ok: true, removed: true };
}
