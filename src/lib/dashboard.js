// dashboard.js - PURE helpers for the Assumption Health dashboard and the settings page (easy to unit test).

import { STATUS_PRIORITY } from './assess.js';

// Counts for the summary. `status` on each item is the ASSESSED status: healthy, at-risk, contradicted, unverified or stale.
// "attention" is what needs a person first: contradicted plus at-risk.
export function summarize(items) {
  const count = (s) => items.filter((a) => a.status === s).length;
  const contradicted = count('contradicted');
  const atRisk = count('at-risk');
  return { total: items.length, healthy: count('healthy'), atRisk, contradicted, unverified: count('unverified'), stale: count('stale'), attention: contradicted + atRisk };
}

// Filter by status and search text, then sort.
//   status: 'all' | 'attention' | 'contradicted' | 'at-risk' | 'healthy' | 'unverified' | 'stale'
//   search: matches the assumption text, the page title, the ticket key, or the release
//   sort:   'priority' (what needs attention first) | 'checked' (most recently checked first) | 'text' (A to Z)
export function filterAssumptions(items, { status = 'all', search = '', sort = 'priority' } = {}) {
  const q = String(search || '').trim().toLowerCase();
  const matches = (a) => (status === 'all' ? true : status === 'attention' ? a.status === 'contradicted' || a.status === 'at-risk' : a.status === status);
  let out = items.filter(matches);
  if (q) {
    out = out.filter((a) => [a.text, a.pageTitle, a.ticketKey, a.releaseKey].some((v) => String(v || '').toLowerCase().includes(q)));
  }
  const time = (v) => (v ? new Date(v).getTime() : 0);
  const sorters = {
    priority: (x, y) => (STATUS_PRIORITY[x.status] ?? 9) - (STATUS_PRIORITY[y.status] ?? 9) || time(y.trippedAt) - time(x.trippedAt) || String(x.text).localeCompare(String(y.text)),
    checked: (x, y) => time(y.lastCheckedAt) - time(x.lastCheckedAt),
    text: (x, y) => String(x.text).localeCompare(String(y.text)),
  };
  return [...out].sort(sorters[sort] || sorters.priority);
}

// Allowed check intervals (minutes). The trigger itself runs hourly; longer intervals just skip recent checks.
export const INTERVAL_OPTIONS = [60, 180, 360, 720, 1440];

// Validates settings that came from the form. Returns an error string, or null if fine.
export function validateSettings({ defaultWindowDays, defaultThreshold, checkIntervalMinutes }) {
  if (defaultWindowDays !== undefined) {
    const w = Number(defaultWindowDays);
    if (!Number.isInteger(w) || w < 1 || w > 365) return 'Default window must be a whole number of days from 1 to 365.';
  }
  if (defaultThreshold !== undefined) {
    const t = Number(defaultThreshold);
    if (!Number.isInteger(t) || t < 1) return 'Default threshold must be a whole number of 1 or more.';
  }
  if (checkIntervalMinutes !== undefined && !INTERVAL_OPTIONS.includes(Number(checkIntervalMinutes))) {
    return 'Check interval must be one of: 1 hour, 3 hours, 6 hours, 12 hours, 24 hours.';
  }
  return null;
}

// Should the scheduler re-check this assumption now? (Used to honour the "check interval" setting.)
// A 5-minute grace avoids skipping an assumption because the last run finished a moment late.
export function isDueForCheck(lastCheckedAt, intervalMinutes, now = new Date()) {
  if (!lastCheckedAt) return true;
  const elapsedMin = (now.getTime() - new Date(lastCheckedAt).getTime()) / 60000;
  return elapsedMin >= Number(intervalMinutes) - 5;
}
