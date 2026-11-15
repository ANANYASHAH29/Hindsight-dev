// sampleData.js - PURE description of the "example workspace" (no network), so it is easy to test.
// It is one Confluence design doc, a few Jira issues, and four assumptions, written like a normal project:
//   - "Checkout handles 1,000 orders/min": 3 related issues, one confirmed by a person as contradicting -> CONTRADICTED (a Revisit ticket is created)
//   - "Vendor API never exceeds 200 ms":   1 matching issue   -> HEALTHY   (a near miss)
//   - "Users never upload over 10 MB":     0 matching issues  -> HEALTHY
//   - "99.9% uptime during sales":         never checked      -> UNCHECKED

// The release all four assumptions belong to (so the release check has something to show).
export const SAMPLE_RELEASE = 'Checkout v2.0';

export const SAMPLE_PAGE_TITLE = 'Checkout redesign: design doc';
// Used only if a page with the title above already exists in the space.
export const SAMPLE_PAGE_TITLE_FALLBACK = 'Checkout redesign: design doc (example)';

// Confluence "storage format" body (simple HTML-like markup).
export const SAMPLE_PAGE_BODY = [
  '<h1>Checkout redesign</h1>',
  '<p>This design doc describes the new checkout flow and the assumptions it depends on.</p>',
  '<p>We assume checkout handles 1,000 orders/min.</p>',
  '<ul>',
  '<li>The vendor API should never exceed 200 ms.</li>',
  '<li>Users never upload files over 10 MB.</li>',
  '<li>We expect 99.9% uptime during sales.</li>',
  '</ul>',
].join('');

// Each issue title starts with a distinctive phrase, so a tripwire can find exactly these issues.
export const SAMPLE_ISSUES = [
  { phrase: 'checkout v2', summary: 'Checkout v2: payment page returns 500 under load' },
  { phrase: 'checkout v2', summary: 'Checkout v2: cart total shows the wrong amount' },
  { phrase: 'checkout v2', summary: 'Checkout v2: coupon code fails at the last step' },
  { phrase: 'vendor api', summary: 'Vendor API: slow response seen once during a promotion' },
];

// JQL that finds the issues with one phrase inside one project (quoted phrase search on the summary).
export const phraseJql = (projectKey, phrase) => `project = ${projectKey} AND summary ~ "\\"${phrase}\\""`;

// The Jira area the example doc covers (for the "is this doc still up to date?" check).
export const sampleScopeJql = (projectKey) => `project = ${projectKey} AND (summary ~ "\\"checkout v2\\"" OR summary ~ "\\"vendor api\\"")`;

// The four assumptions. `check` says whether we run a check right after creating them.
export function sampleAssumptions(projectKey) {
  return [
    { text: 'Checkout handles 1,000 orders/min.', jql: phraseJql(projectKey, 'checkout v2'), windowDays: 14, threshold: 3, check: true, confirmsFirstIssue: true },
    { text: 'The vendor API should never exceed 200 ms.', jql: phraseJql(projectKey, 'vendor api'), windowDays: 14, threshold: 3, check: true },
    { text: 'Users never upload files over 10 MB.', jql: phraseJql(projectKey, 'upload limit'), windowDays: 14, threshold: 3, check: true },
    { text: 'We expect 99.9% uptime during sales.', jql: phraseJql(projectKey, 'sales outage'), windowDays: 14, threshold: 3, check: false },
  ];
}

// Valid Jira project keys: 2 to 10 letters/numbers, starting with a letter.
export const isValidProjectKey = (key) => /^[A-Z][A-Z0-9_]{1,9}$/.test(String(key || ''));
