// drift.js - "is this doc still up to date?" Shared by the panel and the Rovo agent.
import { buildDriftJql, driftStatus, changedAfter } from './tripwire.js';
import { findEvidence } from './jira.js';
import { getPageBody } from './confluence.js';
import { getPageConfig } from './storage.js';

// Compares Jira changes in the doc's area with the page's last edit time.
// Returns { configured:false } if no Jira area was set, otherwise the verdict and up to `maxIssues` changed issues.
export async function computeDrift(pageId, requester, maxIssues = 5) {
  const { scopeJql } = await getPageConfig(pageId);
  if (!scopeJql) return { configured: false };
  const { lastEditedAt, title } = await getPageBody(pageId);
  if (!lastEditedAt) throw new Error('Could not read when this page was last edited.');
  const jql = buildDriftJql(scopeJql, lastEditedAt);
  // Day-level candidates from Jira (as the user: only issues they may see), then an exact timestamp filter.
  const candidates = await findEvidence(jql, 100, requester);
  const changed = changedAfter(candidates, lastEditedAt);
  return {
    configured: true,
    pageTitle: title,
    scopeJql,
    ...driftStatus(changed.length, lastEditedAt, new Date()),
    issues: changed.slice(0, maxIssues).map((i) => ({ key: i.key, summary: i.fields.summary, status: i.fields.status?.name })),
  };
}
