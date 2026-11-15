# Devpost submission text

Copy the sections below into the Devpost form. Replace the placeholders in `[square brackets]`.

## Name
Hindsight

## Tagline
Your Confluence design docs, watching Jira: when reality contradicts an assumption, Hindsight raises the flag, links the evidence and opens a ticket.

## Category and bonus
- **Category:** Apps for Software Teams
- **Bonus track:** Best Agents (Rovo). The app includes a `rovo:agent` module and five `rovo:action` modules.
  *(Enter this bonus only if the agent works on the judges' site; see the note at the end.)*

## Inspiration
Design docs record assumptions: "checkout handles 1,000 orders a minute", "uploads never exceed 10 MB". After the project
is built, Jira fills with bugs and incidents that contradict those assumptions, but nobody connects the bug back to the claim.
The doc stays green and confident, and the team finds out in a postmortem, when it is expensive.

## What it does
Hindsight gives every assumption in a Confluence design doc a **tripwire**: a Jira query, a threshold and a time window.
- It suggests assumptions from the page text. A person confirms each one.
- It checks the tripwires on demand and every hour (plain code, no AI).
- When one trips it marks the assumption, opens **one** Jira "Revisit assumption" ticket with evidence and a suggested owner
  (never a duplicate while the ticket is open; a new one if it was resolved and trips again), writes a plain-English impact
  note, and can add a Confluence comment.
- **Doc freshness** compares a page's last edit with Jira changes in the area it covers.
- An **Assumption Health dashboard** shows every assumption on the site with filters, search, links and an audit log.
- **One-click sample data** gives a judge a working demo with no setup.
- A **Rovo agent** answers "Which assumptions are broken?", explains why one tripped by judging each evidence issue,
  proposes assumptions from a page (and saves only after a yes), and works as an agent on a Revisit ticket.

## How we built it
- **Forge** (nodejs24, UI Kit): `confluence:contentBylineItem`, `confluence:globalPage`, `confluence:globalSettings`,
  `scheduledTrigger` (hourly), `function`, `rovo:agent`, `action`.
- **Forge storage** (`@forge/kvs`) for assumptions, settings and a capped audit log.
- **Jira REST** (approximate-count, search/jql, issue create, issue properties) and **Confluence REST v2** (page body,
  version date, spaces, pages, footer comments).
- **Rovo agent** with actions `list-assumptions`, `explain-assumption`, `get-page-content`, `doc-freshness`, `save-assumption`.
- **Principle:** numbers come from code and judgement from AI. The scheduler never calls an AI. The agent is told to report
  only values our actions return and to save nothing without a yes.
- **Permissions first:** reads run as the viewing user; the dashboard hides assumptions on pages the viewer cannot open; settings
  and sample data are admin-only; the audit log records who did what. See `PRIVACY_AND_PERMISSIONS.md`.
- **Quality:** 35 unit tests (tripwire rules, duplicate-ticket rules, extraction, dashboard, retry and error handling), `forge lint`
  clean, retries on Atlassian rate limits, plain-English errors.

## Challenges we ran into
- Forge storage is **separate for the Jira and Confluence installations** of one app. A Rovo session started from a Jira ticket
  could not see data saved from Confluence. We now keep a small summary on the Revisit ticket (a Jira issue property) so both sides agree.
- Rovo agents invent details when not constrained (for example a made-up site address). We return real links from our actions and
  instruct the agent to use only those.
- Atlassian documents that Rovo needs a verified business domain, so we tested the agent on a separate, Rovo-enabled site.
- Some UI Kit styling crashed the app silently; we bisected it and removed it.

## Accomplishments we are proud of
A complete product shape (page panel, dashboard, settings, scheduler, agent, sample data, audit log) rather than a proof of concept,
with a demo that works in one click.

## What we learned
Keeping AI to the parts that need understanding, and code for everything that must be exactly right, makes an assistant you can trust.

## What is next
- Suggest tripwires from the sentence automatically (with confirmation).
- Use Jira issues already linked to a page as its "area", with no query to write.
- Teamwork Graph and a Marketplace listing, once the core is validated with real teams.

## Evidence the problem is real (public sources, not our own interviews)
We have **not yet validated Hindsight with working teams**. The need shows up in public sources:
- Survey and case-study evidence that documentation goes out of date: Lethbridge & Singer (2003); a case study of architecture and design documents at two companies.
- Engineers describing design docs that drift from reality after implementation starts, and teams relying on manual audits (Hacker News discussions, developer blog posts).
- An Atlassian Community post describing new Jira tickets while the related Confluence requirement docs were not updated; another asking for a way to track assumptions with a validated status.
- ADR guidance listing "decisions never revisited when their assumptions change" as a failure mode.

## Built with
Atlassian Forge, Forge UI Kit (React), Forge storage, Forge scheduled triggers, Rovo agent and actions, Jira REST API, Confluence REST API, Node.js.

## Try it out
- **Install link:** `[INSTALL_LINK]`
- **Setup:** see README.md. Install on Confluence and Jira, then Apps > Assumption Health > Generate sample data (site admin).
- **Video:** `[YOUTUBE_LINK]`
- **Code:** `[REPO_LINK if public]`

## Note for the submitter
- Technology explanation field: paste "How we built it".
- Rovo bonus requires judges to be able to use the agent. If your final test on a fresh Rovo-enabled site fails, leave the bonus out and say so honestly.
- Do not add quotes from people unless they said them and agreed to be quoted.
- Post a progress update on Devpost at least once before the deadline.
- Dates: aim to submit by **Dec 15**. The hard deadline is **Dec 22, 12:00 pm PT (Dec 23, 1:30 am IST)**.
