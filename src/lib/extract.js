// extract.js - DETERMINISTIC assumption extraction (no AI, so the demo never depends on one).
// It reads Confluence "storage format" (XHTML-like) text and proposes sentences that look like assumptions.
// A human always confirms each suggestion before anything is saved.

// Turn Confluence storage-format markup into plain text, one block per line.
export function storageToText(storage) {
  return String(storage || '')
    // Put a line break wherever a block ends, so sentences from different bullets do not merge.
    .replace(/<\/(p|li|h[1-6]|tr|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove every remaining tag (this also strips Confluence macros like <ac:structured-macro>).
    .replace(/<[^>]+>/g, ' ')
    // Decode the few HTML entities that matter.
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/[ \t]+/g, ' ');
}

// Words that signal "the author is assuming something".
const ASSUMPTION_WORDS = /\b(assum(e|es|ed|ing|ption)|expect(s|ed)?|should (handle|never|always|not|be able|support|stay|remain)|never (exceed|more|over|goes)|must (handle|support|stay)|will (never|always)|at most|no more than|up to)\b/i;

// A number followed by a unit (1,000 orders/min, 200 ms, 10 MB, 99.9%, 5k users ...).
const NUMBER_WITH_UNIT = /\b\d[\d,.]*\s?(k|m)?\s?(\/\s?(s|sec|min|hour|hr|day)|ms|seconds?|secs?|minutes?|mb|gb|kb|tb|%|percent|orders?|requests?|users?|rps|qps|tps)\b/i;

// Split text into sentences/lines worth considering.
function sentencesOf(text) {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((s) => s.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter((s) => s.length >= 15 && s.length <= 240);
}

// Returns [{ text, reason }] - at most `max` suggestions, no duplicates.
export function extractAssumptions(storage, max = 12) {
  const seen = new Set();
  const out = [];
  for (const sentence of sentencesOf(storageToText(storage))) {
    const hasWord = ASSUMPTION_WORDS.test(sentence);
    const hasNumber = NUMBER_WITH_UNIT.test(sentence);
    if (!hasWord && !hasNumber) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      text: sentence,
      reason: hasWord && hasNumber ? 'assumption wording + a number' : hasWord ? 'assumption wording' : 'a number with a unit',
    });
    if (out.length >= max) break;
  }
  return out;
}
