// docedit.js - PURE helpers for the agent's "do the work" actions (no network), so they are easy to test.

const escapeEntities = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const countOccurrences = (haystack, needle) => (needle ? haystack.split(needle).length - 1 : 0);

// Replace ONE sentence in a Confluence page body (storage format). It only edits when the sentence appears exactly once,
// so it can never change the wrong place. Returns { value } (the new body) or { error } with a clear reason.
export function replaceSentence(storage, oldSentence, newSentence) {
  const oldS = String(oldSentence || '').trim();
  const newS = String(newSentence || '').trim();
  if (!oldS) return { error: 'There is no sentence to replace.' };
  if (!newS) return { error: 'The new sentence is empty.' };
  if (newS.length > 500) return { error: 'The new sentence is too long (500 characters at most).' };
  const body = String(storage || '');

  // The sentence may be stored with HTML entities, and the page may lack its final full stop, so try a few spellings.
  const bare = oldS.replace(/[.!?\s]+$/, '');
  const candidates = [...new Set([oldS, escapeEntities(oldS), bare, escapeEntities(bare)].filter(Boolean))];
  for (const candidate of candidates) {
    const n = countOccurrences(body, candidate);
    if (n === 1) {
      // Keep the original ending: if we matched without the final full stop, the page's own full stop stays.
      const replacement = candidate === bare || candidate === escapeEntities(bare) ? escapeEntities(newS.replace(/[.!?\s]+$/, '')) : escapeEntities(newS);
      return { value: body.replace(candidate, replacement) };
    }
    if (n > 1) return { error: 'That sentence appears more than once on the page, so it was not changed. Please edit it by hand.' };
  }
  return { error: 'That exact sentence was not found on the page (it may be formatted, for example bold or linked). Please edit it by hand.' };
}

// Who should the Revisit ticket go to? The most frequent assignee among the evidence issues, else the most frequent reporter.
// Returns { accountId, displayName } or null.
export function suggestOwnerDetails(issues) {
  const tally = (field) => {
    const counts = {};
    for (const i of issues || []) {
      const person = i.fields?.[field];
      if (person?.accountId) {
        counts[person.accountId] = counts[person.accountId] || { accountId: person.accountId, displayName: person.displayName || null, n: 0 };
        counts[person.accountId].n += 1;
      }
    }
    return Object.values(counts).sort((a, b) => b.n - a.n)[0] || null;
  };
  const best = tally('assignee') || tally('reporter');
  return best ? { accountId: best.accountId, displayName: best.displayName } : null;
}

// Turns plain text (with blank lines between paragraphs) into Jira's rich-text format for a comment.
export function toAdf(text) {
  const paragraphs = String(text || '').split(/\n{1,}/).map((p) => p.trim()).filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p.slice(0, 2000) }] })),
  };
}

// Jira project key from an issue key: "KAN-12" -> "KAN". Returns '' if it does not look like an issue key.
export const projectKeyOf = (issueKey) => {
  const m = String(issueKey || '').trim().toUpperCase().match(/^([A-Z][A-Z0-9_]+)-\d+$/);
  return m ? m[1] : '';
};

// A title with punctuation and capitals ignored, so "Investigate: the 500s!" matches "investigate the 500s".
export const normalizeTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// After saving a page we re-read it and confirm the change really happened. True if the sentence is in the body
// (as written, or HTML-escaped, and with or without its final full stop).
export function containsSentence(storage, sentence) {
  const body = String(storage || '');
  const s = String(sentence || '').trim();
  if (!s) return false;
  const bare = s.replace(/[.!?\s]+$/, '');
  return [s, escapeEntities(s), bare, escapeEntities(bare)].filter(Boolean).some((c) => body.includes(c));
}
