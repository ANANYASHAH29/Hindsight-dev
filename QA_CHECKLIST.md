# QA checklist

Run on a fresh Atlassian site with **Jira and Confluence**, installed from the install link as a site admin.
Tick each box. Note any failure with a screenshot.

## Install
- [ ] The install link opens, lists the permissions, and installs on **both** Confluence and Jira.
- [ ] After a later update that adds permissions: the site admin sees **Update** under Manage apps and approves it.

## Demo mode (site admin, top right of the dashboard)
- [ ] Confluence > Apps > **Assumption Health** loads with four zero tiles and an empty-state message (no demo wording).
- [ ] **Demo mode** (top right) shows a spinner, then a green message. Tiles: Total 4, Healthy 2, Tripped 1, Unchecked 1.
- [ ] The demo page, four Jira issues and a Revisit ticket exist.
- [ ] Clicking Generate again is refused with a clear message (no duplicates).
- [ ] **Turn off** deletes the page, issues, and Revisit ticket; tiles return to 0.
- [ ] A non-admin gets "Only Jira site administrators can..." when trying either button.

## Page panel
- [ ] **Hindsight** appears under the page title; the popup shows tripped/healthy/unchecked counts and a doc status.
- [ ] **Open Hindsight** opens a large centered window with four tabs.
- [ ] Assumptions tab: each card shows status, tripwire, last count, ticket. The tripped card shows the impact note with real issue titles (no "undefined").
- [ ] **Check now** updates the count and time. Two clicks in a row create **no second ticket**.
- [ ] Mark the Revisit ticket Done, click Check now: a **new** ticket is created.
- [ ] Lower the count (delete evidence issues): the assumption turns healthy.
- [ ] **Delete** removes an assumption; a different non-admin user is refused.

## Add and suggest
- [ ] **Suggest assumptions from this page** lists sentences with a reason; **Use this** fills the form; **Dismiss** removes it.
- [ ] Add with a template (bug count in a component, incident count, label, text): the JQL is built and saved.
- [ ] Add with custom JQL `this is not jql`: a red error explains Jira could not run it.
- [ ] Empty text, window 0, threshold 0, JQL with ORDER BY: each gives a clear message.

## Freshness
- [ ] Doc freshness tab: enter `project = KEY`; the result shows how many issues changed since the last edit.
- [ ] Changing three or more issues makes it **Possibly out of date**; editing the page makes it **Looks current**.

## Dashboard
- [ ] Filters (status), search (text, page, ticket), and sort all work.
- [ ] Page and ticket links open the right page and ticket in a new tab.
- [ ] **Audit log** tab lists added/tripped/ticket-created/sample events with who and when.
- [ ] An assumption on a page the viewer cannot open is hidden and a message says so.

## Settings (Confluence admin > Apps > Hindsight)
- [ ] Changing window to 7 and saving shows "Settings saved"; new assumptions pre-fill 7.
- [ ] Threshold 0 or window 400 shows a clear error. Interval options: 1, 3, 6, 12, 24 hours.
- [ ] Comment toggle on, then a **new** ticket creation adds a footer comment on the page, once.
- [ ] A non-admin cannot save settings.

## Scheduler
- [ ] `forge logs -e production` shows "Hourly check done" about once an hour on each install.
- [ ] An assumption last checked more than the interval ago is re-checked automatically.

## Rovo (needs a Rovo-enabled site)
- [ ] Ask Rovo > agent picker > Hindsight appears with its description and starters.
- [ ] "Which assumptions are broken right now?" lists the tripped assumption with the right count, ticket, and working links.
- [ ] "Explain why this assumption tripped." judges each evidence issue and names the suggested owner.
- [ ] "What assumptions does this page make?" proposes assumptions with drafted JQL and **asks before saving**.
- [ ] Saying yes saves one; the dashboard shows it.
- [ ] "Is this doc still up to date?" reports freshness (after setting the Jira area).
- [ ] On a Revisit ticket: Agents > Hindsight finds the assumption, reports the count, and judges the evidence.
- [ ] No number or issue key in any answer differs from the dashboard.

## Quality
- [ ] No red errors in the browser console during normal use.
- [ ] Every empty state explains what to do. Every failure shows a plain-English message.
- [ ] `npm test` passes; `forge lint` reports no issues.

## Evidence and statuses (the central rules)
- [ ] A keyword-based tripwire that reaches its threshold shows **At risk**, never "Contradicted".
- [ ] Open an assumption (Assumptions tab): its reasons, counts, and matching issues are listed.
- [ ] Mark one matching issue **Contradicts**: the status becomes **Contradicted** and the audit log records the review.
- [ ] Mark an issue **Unrelated**: it stops counting; if the count falls below the threshold the status returns to **Healthy**.
- [ ] A single matching issue below the threshold stays **Healthy**.
- [ ] An assumption never checked shows **Unverified**; one not checked for 7 days shows **Stale**.
- [ ] Release **Blocked** only for a contradicted *critical* assumption; set it to **Standard** and the release becomes At risk.
- [ ] Accept a risk (admin, reason, days): Blocked becomes At risk; after it expires the warning returns.
- [ ] Check now twice in a row, and wait for an hourly run: still exactly one Revisit ticket.
- [ ] Agent: update the doc sentence; if the page did not really change, the agent reports a failure.
- [ ] Agent: approving the same follow-up task twice reports "already existed", not a second task.
