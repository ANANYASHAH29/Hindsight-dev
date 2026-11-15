# Final demo video: complete plan (target 3:00, hard limit under 5:00)

Judges may stop at 3 minutes, so the first 3 minutes carry the whole story. Record on the **Rovo-enabled VIT site** (installed
from the install link). The Rovo trial ends around **Dec 7**, so record the Rovo parts this week.

## A. Dry run first (off camera). Tick every box before you record
These are the parts that have not been seen working live yet. Do the whole story once, then reset.
- [ ] 1. Confluence admin > Apps > Hindsight > **Reset Hindsight data** > review > confirm. Assumption Health shows "No assumptions yet".
- [ ] 2. Create the page and the Jira issues from section B.
- [ ] 3. On the page: **Hindsight > Open Hindsight > Add assumption > Suggest assumptions from this page** lists your sentences. **Use this** fills the box.
- [ ] 4. Add the assumption (query + release). It appears with a status and a progress bar. **Check now** works.
- [ ] 5. With three matching issues the status is **At risk** (not Contradicted), and a Revisit ticket exists in Jira.
- [ ] 6. Assumption Health > Assumptions tab > click the assumption > **Contradicts** on one issue > status becomes **Contradicted**.
- [ ] 7. Releases tab > **Orders v1.0** shows a red **Blocked** banner with a "Required:" line.
- [ ] 8. Ask Rovo (Hindsight, new chat): "Is release Orders v1.0 safe to ship?" answers Blocked with real numbers and working links.
- [ ] 9. Ask Rovo: "Help me resolve this broken assumption." The agent says the plan is ready and nothing is done. On the page, the plan box appears; tick Comment and Assign; **Apply selected**; the Jira ticket shows the comment and the assignee.
- [ ] 10. Reset again (step 1). You are ready to record.

## B. Content to create (copy exactly)
**Confluence page title:** `Orders API design` (four normal paragraphs)
- We assume the orders API handles 500 requests per second.
- The payment provider should respond within 300 ms.
- Refunds never exceed 2% of orders.
- We expect the database to stay under 70% CPU on sale days.

**Jira (project KAN, any issue type). Every title must contain "Orders API":**
- `Orders API times out under load` (create BEFORE recording)
- `Orders API returns 500 during sale` (create BEFORE recording)
- `Orders API fails at 400 requests per second` (create ON CAMERA)

**Assumptions to add in Hindsight**
1. Text: `We assume the orders API handles 500 requests per second.` / Query: `project = KAN AND summary ~ "orders api"` / window 14 / trips at 3 / Release: `Orders v1.0`
2. Text: `Refunds never exceed 2% of orders.` / Query: `project = KAN AND summary ~ "refund"` / window 14 / trips at 3 / Release: `Orders v1.0`

## C. Recording setup
- Record each part separately (Windows Game Bar: Win + G, or OBS), 1080p. Trim waiting time when you edit.
- Browser zoom 110%, bookmarks bar hidden, no email or personal info on screen, one tab at a time.
- Settings first: project `KAN`, window 14, threshold 3 (Confluence admin > Apps > Hindsight).

## D. The video, shot by shot

**0:00 - 0:20  The problem**
Show the *Orders API design* page. Slowly highlight "We assume the orders API handles 500 requests per second."
> "Design docs are full of assumptions like this one. Months later Jira fills with bugs that contradict them, but nothing connects the
> two, so decisions stay in place until something breaks. Hindsight connects them."

**0:20 - 1:05  Capture the assumptions**
Click **Hindsight** under the title, then **Open Hindsight > Add assumption**. Click **Suggest assumptions from this page**.
Click **Use this** on the orders sentence, choose **Custom JQL**, type the query, set Release `Orders v1.0`, click **Add assumption**.
Repeat for the refunds sentence.
> "Hindsight reads the doc and drafts the assumptions. A person confirms each one. Each gets a tripwire: a Jira query, a threshold and a
> time window, checked every hour by plain code."
Open the **Assumptions** tab, click **Check now** on both. The orders card shows **2 of 3** with a progress bar and the status **Healthy**.

**1:05 - 1:40  Bugs pile up**
Switch to Jira (KAN) and create `Orders API fails at 400 requests per second`. Back in Hindsight click **Check now**.
The card shows **3 of 3**, status **At risk**, and a Revisit ticket.
> "Three issues match. But they only share words with the claim, so Hindsight calls this At risk, not proof. It never treats keyword
> similarity as a contradiction."

**1:40 - 2:10  A person decides, and the release reacts**
Open **Apps > Assumption Health**. Point at the banner. Open the **Assumptions** tab and click the assumption. Click **Contradicts** on
"fails at 400 requests per second". The status becomes **Contradicted**. Open the **Releases** tab > **Orders v1.0**.
> "A person confirmed it. Now the release is Blocked, by fixed rules, not an AI score, and it says what is required."

**2:10 - 2:50  The agent does the work**
Open **Ask Rovo > Hindsight**, new chat. Ask `Is release Orders v1.0 safe to ship?` (verdict Blocked, with reasons). Then ask
`Help me resolve this broken assumption.` Say: "It prepared a plan. Nothing has happened yet." Open the page > Hindsight: tick **Comment** and
**Assign**, click **Apply selected**. Show the Done labels, then the Jira ticket with the comment and assignee.
> "The agent drafts. I approve each step with a tick. Then Hindsight posts the comment and assigns the owner, as me."

**2:50 - 3:00  Trust and close**
Open the **Audit log** tab.
> "Every decision is recorded. Permissions are respected, and nothing leaves Atlassian. Install it from the link below."

**3:00 - 4:00  (optional) How it was built**
Show the README architecture diagram: Forge UI Kit, Forge storage, an hourly scheduled trigger, Jira and Confluence REST, a Rovo agent.
Say: counts and statuses come from code, AI only reads and judges, and the honest limit (a tripwire is only as good as its query).

## E. After recording
- [ ] Under 5 minutes, and the first 3 minutes carry the story.
- [ ] Upload to YouTube as **Public**. Open the link in a private window to check.
- [ ] No personal email, token or private data visible.
- [ ] You said that the agent drafts and a person approves.
- [ ] Paste the YouTube link and the install link into DEVPOST.md, then submit.

## F. Reset and start fresh (for a second take, or after the video)
1. **Confluence admin > Apps > Hindsight > Reset Hindsight data > Review what will be deleted > Yes, delete all Hindsight data.**
   This removes the assumptions, their history, the audit log and the Revisit tickets Hindsight created.
   It does NOT delete your page or your own Jira issues.
2. For a clean new scenario, either delete the three "Orders API" Jira issues by hand, or use new content ("Take 2"):
   - Page `Search service design`: "We assume search answers within 200 ms." and "We expect 10,000 queries per minute."
   - Jira titles containing "Search latency": `Search latency spikes under load`, `Search latency above 1 second on release day`, `Search latency timeouts at 5,000 queries per minute`
   - Query: `project = KAN AND summary ~ "search latency"`, Release `Search v1.0`.
3. **Backup:** Assumption Health > **Demo mode** (top right) creates a ready-made example in about 15 seconds. **Turn off** removes it.

## G. If something breaks while recording
| Problem | What to do |
|---|---|
| The plan (tick boxes) does not appear | Skip it. Show the agent's "Is it safe to ship?" and "Explain" answers, then close |
| The agent is slow or errors | Stop, start a new chat, and re-record that part. Cut the mistake |
| A status is not what the script says | Click **Check now** again. If still wrong, stop and tell me what you see |
| Jira issue not counted yet | Wait 10 seconds (Jira indexes new issues), then **Check now** |
| Anything is a mess | Reset (section F), recreate the content (section B), and record again |

