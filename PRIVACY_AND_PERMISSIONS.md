# Privacy and permissions

Hindsight keeps as little data as it can and keeps all of it inside Atlassian. It makes no calls to any outside service.

## What is stored, and where

| Data | Where | Contents |
|---|---|---|
| Assumptions | Forge storage (Atlassian-hosted) | The assumption sentence, the tripwire (JQL, window, threshold), status, last count, check time, the Revisit ticket key and status, up to 5 evidence issue keys and titles, the impact note, the account ID of who added it |
| Page settings | Forge storage | Per page: the Jira query that describes the work the doc covers |
| Settings | Forge storage | Ticket project key, default window and threshold, check interval, comment on/off |
| Audit log | Forge storage | The latest 200 events: added, deleted, tripped, recovered, ticket created, comment added, settings changed, sample data created or removed, with who and when |
| Sample-data record | Forge storage | Only the IDs of the demo page, issues and assumptions, so "Remove sample data" can undo exactly that |
| Ticket summary | A Jira issue property on each Revisit ticket | Assumption text, status, count, threshold, window, JQL, page ID. It lets a Rovo session started from the Jira side read the assumption |

**Not stored:** Confluence page text (it is read when needed and then discarded), full issue contents, any credentials.
The only personal data is Atlassian account IDs (in the audit log and the "added by" field).

## Who can see what

- **Reads shown to a person run as that person** (`asUser`). Jira and Confluence decide what they may see.
- **The dashboard hides assumptions on pages the viewer cannot open**, and says how many were hidden.
- **Evidence** (counts and issue titles) comes from a query run as the viewer, so issues from projects they cannot browse
  are not shown to them.
- **The hourly checker runs as the app** (`asApp`) because no person is present. It can only see projects the app user can
  browse. It writes the stored status, count and evidence, so a person with access to the page can see the stored result
  for that assumption. Choose tripwires on projects the whole audience of the doc may see.
- **Creating the Revisit ticket** runs as the app, in the project chosen in settings.
- **Settings, sample data:** Jira site administrators only (checked on the server, not just in the screen).
- **Deleting an assumption:** the person who added it, or a site administrator.

## Rovo agent

- The agent's actions run as the person asking (`asUser`) for reads.
- It reports only values returned by Hindsight's actions. It never saves an assumption without an explicit yes.
- The scheduler never calls an AI, so scheduled checks use no Rovo credits.
- Rovo's own handling of prompts follows Atlassian's Rovo terms.

## Scopes

See the table in [README.md](README.md). Optional ones (Confluence comments) are off by default.
The sample-data scopes (create and delete pages) are used only when an administrator clicks the sample-data buttons.

## Removing everything

Uninstalling the app removes its Forge storage. Revisit tickets are ordinary Jira issues and stay until deleted.
"Remove sample data" deletes the demo page, demo issues, and the tickets Hindsight made for the demo assumptions.
