// format.js - PURE helpers that turn stored data into short, readable text for the screens (easy to test).

// "3 hours ago", "2 days ago", "just now".
export function timeAgo(iso, now = new Date()) {
  if (!iso) return 'never';
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const hasCount = (c) => c && c.matched !== null && c.matched !== undefined && Number.isFinite(Number(c.matched));

// How full the gauge is, from 0 to 1: matching issues (after a person's "unrelated" reviews) compared with the threshold.
export function gauge(counts) {
  if (!hasCount(counts)) return 0;
  const threshold = Number(counts.threshold) || 1;
  const effective = Number(counts.effective ?? counts.matched);
  return Math.max(0, Math.min(1, effective / threshold));
}

// "3 of 3 matching issues in the last 14 days", or "Not checked yet".
export function summaryLine(counts, windowDays) {
  if (!hasCount(counts)) return 'Not checked yet.';
  const effective = Number(counts.effective ?? counts.matched);
  const dismissed = Number(counts.dismissed) || 0;
  const base = `${effective} of ${counts.threshold} matching issue${Number(counts.threshold) === 1 ? '' : 's'} in the last ${windowDays} days`;
  return dismissed > 0 ? `${base} (${dismissed} marked unrelated)` : base;
}

// One quiet line of context: ticket, release, last check.
export function metaLine(a, now = new Date()) {
  return [
    a.ticketKey ? `Ticket ${a.ticketKey} (${a.ticketStatus || 'unknown'})` : null,
    a.releaseKey ? `Release ${a.releaseKey}` : null,
    a.lastCheckedAt ? `Checked ${timeAgo(a.lastCheckedAt, now)}` : 'Never checked',
  ].filter(Boolean).join('  |  ');
}

// The banner at the top of the dashboard: what needs attention first.
// Returns { appearance, title, text } or null when there is nothing to say.
export function attentionBanner(tiles) {
  if (!tiles || tiles.total === 0) return null;
  if (tiles.contradicted > 0) {
    return {
      appearance: 'error',
      title: `${tiles.contradicted} assumption${tiles.contradicted === 1 ? ' is' : 's are'} contradicted`,
      text: tiles.atRisk > 0 ? `${tiles.atRisk} more need${tiles.atRisk === 1 ? 's' : ''} investigating. Open an assumption to see its evidence.` : 'Open an assumption to see the evidence and decide what to do.',
    };
  }
  if (tiles.atRisk > 0) {
    return {
      appearance: 'warning',
      title: `${tiles.atRisk} assumption${tiles.atRisk === 1 ? ' needs' : 's need'} investigating`,
      text: 'Related Jira issues were found. Review them: confirm a contradiction, or mark the unrelated ones.',
    };
  }
  if (tiles.unverified + tiles.stale > 0) {
    return { appearance: 'information', title: `${tiles.unverified + tiles.stale} assumption${tiles.unverified + tiles.stale === 1 ? ' is' : 's are'} unverified or stale`, text: 'Run a check to refresh them.' };
  }
  return { appearance: 'success', title: 'Everything monitored looks healthy', text: `All ${tiles.total} assumption${tiles.total === 1 ? '' : 's'} were checked recently with no issues.` };
}

// The banner for one release.
const VERDICT_BANNER = { blocked: 'error', 'at-risk': 'warning', ready: 'success', unknown: 'information' };
const VERDICT_WORD = { blocked: 'Blocked', 'at-risk': 'At risk', ready: 'Ready', unknown: 'Unknown' };
export const releaseBanner = (release, verdict, sentence) => ({
  appearance: VERDICT_BANNER[verdict] || 'information',
  title: `${release}: ${VERDICT_WORD[verdict] || verdict}`,
  text: sentence,
});
