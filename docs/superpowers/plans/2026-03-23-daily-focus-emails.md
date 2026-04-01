# P&I + Design Daily Focus Emails — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up two Claude scheduled tasks that send daily focus emails to P&I and Design leads every weekday morning, starting with a dry-run to Zach.

**Architecture:** Claude scheduled tasks query HubSpot via MCP, build HTML emails, and send via Gmail MCP. No code deployment needed — configuration only.

**Tech Stack:** Claude Code scheduled tasks, HubSpot MCP, Gmail MCP

**Spec:** `docs/superpowers/specs/2026-03-23-pi-daily-focus-email-design.md`

---

## Resolved Data

### Excluded Deal Stage IDs

| Stage | Project Pipeline | D&R Pipeline | Service Pipeline |
|-------|-----------------|--------------|-----------------|
| Cancelled | `68229433` | `52474745` | `56217769` |
| Complete | `20440343` | `68245827` | `76979603` |
| On-Hold | `20440344` | `72700977` | — |

Combined exclusion list (all pipelines): `68229433`, `52474745`, `56217769`, `20440343`, `68245827`, `76979603`, `20440344`, `72700977`

### Pipeline IDs

| Pipeline | ID | Label suffix in email |
|----------|----|-----------------------|
| Project | `6900017` | *(none — default)* |
| D&R | `21997330` | `(D&R)` |
| Service | `23928924` | `(Service)` |
| Roofing | `765928545` | `(Roofing)` |
| Sales | *(excluded)* | — |

### Stage Display Names (Project Pipeline)

| Stage ID | Display Name |
|----------|-------------|
| `20461935` | Project Rejected - Needs Review |
| `20461936` | Site Survey |
| `20461937` | Design & Engineering |
| `20461938` | Permitting & Interconnection |
| `71052436` | RTB - Blocked |
| `22580871` | Ready To Build |
| `20440342` | Construction |
| `22580872` | Inspection |
| `20461940` | Permission To Operate |
| `24743347` | Close Out |
| `52474739` | Kickoff |
| `52498440` | Closeout |
| `1058744644` | Project Preparation |
| `1058924076` | Install Visit Scheduled |
| `171758480` | Work In Progress |
| `1058924077` | Inspection |

### Lead Owner IDs

**P&I Leads:**
| Lead | Owner ID |
|------|----------|
| Peter Zaun | `78035785` |
| Kristofer Stuhff | `82539445` |
| Katlyyn Arnoldi | `212300376` |
| Layla Counts | `216565308` |
| Alexis Severson | `212300959` |
| Kaitlyn Martinez | `212298628` |

**Design Leads:**
| Lead | Owner ID |
|------|----------|
| Jacob Campbell | `85273950` |
| Zach Rosen | `2068088473` |
| Daniel Kelly | `216569623` |

### Email Addresses

**Required from Zach before Task 2:** Email addresses for all leads listed above. These will be hardcoded in the scheduled task prompt.

---

## Chunk 1: Setup and P&I Scheduled Task

### Task 1: Collect Email Addresses

- [ ] **Step 1: Ask Zach for email addresses**

Ask for the @photonbrothers.com email for each lead:
- Peter Zaun
- Kristofer Stuhff
- Katlyyn Arnoldi
- Layla Counts
- Alexis Severson
- Kaitlyn Martinez
- Jacob Campbell
- Daniel Kelly
- Zach's own email (for rollup + dry-run)

### Task 2: Create P&I Daily Focus Scheduled Task

**Files:**
- Create: Claude scheduled task via `/schedule` skill

- [ ] **Step 1: Invoke the schedule skill**

Use the `schedule` skill to create a new scheduled task with these parameters:
- **Name:** `pi-daily-focus`
- **Schedule:** Weekday mornings, 7:00 AM America/Denver
- **Mode:** DRY-RUN (all emails to Zach only)

- [ ] **Step 2: Set the task prompt**

The prompt must include ALL of the following (complete, self-contained — the scheduled task has no memory of this conversation):

```
You are running the P&I Daily Focus Email task. Query HubSpot for actionable P&I items and send personalized emails to each lead.

## MODE: DRY-RUN
Send ALL emails to Zach at {zach_email} only. Prefix subjects with [PREVIEW for {Lead Name}].

## LEADS
| Name | Owner ID | Email | Roles |
|------|----------|-------|-------|
| Peter Zaun | 78035785 | {email} | permit_tech, interconnections_tech |
| Kristofer Stuhff | 82539445 | {email} | permit_tech |
| Katlyyn Arnoldi | 212300376 | {email} | permit_tech, interconnections_tech |
| Layla Counts | 216565308 | {email} | permit_tech, interconnections_tech |
| Alexis Severson | 212300959 | {email} | permit_tech, interconnections_tech |
| Kaitlyn Martinez | 212298628 | {email} | permit_tech, interconnections_tech |

## QUERIES PER LEAD

For each lead, run the following queries using HubSpot MCP search_crm_objects. Properties to return: dealname, dealstage, permitting_status, interconnection_status, pto_status, hs_object_id, pb_location, pipeline.

### Excluded deal stages (NOT_IN for all queries):
68229433, 52474745, 56217769, 20440343, 68245827, 76979603, 20440344, 72700977

### Included pipelines (use OR filter groups):
6900017, 21997330, 23928924, 765928545

### Query 1: Permits Ready to Submit
- permit_tech = {ownerID}
- permitting_status IN: "Ready For Permitting", "Pending SolarApp", "Customer Signature Acquired", "Awaiting Utility Approval"

### Query 2: Permits Resubmissions Needed
- permit_tech = {ownerID}
- permitting_status IN: "As-Built Ready To Resubmit", "Returned from Design"

### Query 3: IC Ready to Submit
- interconnections_tech = {ownerID}
- interconnection_status IN: "Ready for Interconnection", "Signature Acquired By Customer"

### Query 4: IC Resubmissions Needed
- interconnections_tech = {ownerID}
- interconnection_status IN: "As-Built Ready to Resubmit", "Revision Returned From Design"

### Query 5: PTO Ready to Submit
- interconnections_tech = {ownerID}
- pto_status IN: "Inspection Passed - Ready for Utility", "Xcel Photos Ready to Submit"

### Query 6: PTO Resubmissions Needed
- interconnections_tech = {ownerID}
- pto_status IN: "Inspection Rejected By Utility", "Ops Related PTO Rejection", "Xcel Photos Rejected"

## DISPLAY NAME MAPPINGS
Show these display names instead of raw HubSpot values:
- "Returned from Design" → "Revision Ready To Resubmit"
- "Revision Returned From Design" → "Revision Ready To Resubmit"
- "Inspection Passed - Ready for Utility" → "Ready for PTO Submission"

## PIPELINE DISPLAY
- Pipeline 6900017: show stage only (e.g., "Construction")
- Pipeline 21997330: append "(D&R)" (e.g., "Construction (D&R)")
- Pipeline 23928924: append "(Service)"
- Pipeline 765928545: append "(Roofing)")

## STAGE DISPLAY NAMES
Map dealstage IDs to names:
20461935=Project Rejected, 20461936=Site Survey, 20461937=Design & Engineering, 20461938=Permitting & IC, 71052436=RTB - Blocked, 22580871=Ready To Build, 20440342=Construction, 22580872=Inspection, 20461940=PTO, 24743347=Close Out, 52474739=Kickoff, 52498440=Closeout, 1058744644=Project Prep, 1058924076=Install Visit, 171758480=Work In Progress, 1058924077=Inspection

## EMAIL FORMAT

### Individual Lead Email
Subject: [PREVIEW for {Full Name}] P&I Daily Focus — {ddd MMM D}

Build an HTML email with:
1. Greeting: "Good morning {First Name},"
2. "Here's what's ready for action today:"
3. For each category that has items (skip empty):
   - Section header (PERMITS / INTERCONNECTION / PTO)
   - "Ready to Submit ({count})" subsection with deal list
   - "Resubmissions Needed ({count})" subsection with deal list
4. Each deal line: hyperlinked deal name → https://app.hubspot.com/contacts/21710069/record/0-3/{dealId}
   Format: "• {dealname} | {pb_location}" (hyperlinked)
   Below: "Stage: {stage_display} | Status: {status_display}"
5. Footer: "Total action items: {total}"
6. Sort deals alphabetically within each subsection

### Manager Rollup Email
Subject: [PREVIEW — P&I Rollup] P&I Daily Rollup — {ddd MMM D}

Build an HTML email with:
1. TEAM SUMMARY table: each lead with permit/IC/PTO counts and total, sorted by total desc
2. TEAM TOTAL line
3. FULL DETAIL BY LEAD: each lead's full breakdown (same as individual emails)

## SEND RULES
- Use Gmail MCP to send each email
- If a lead has 0 total items: skip their individual email
- If ALL leads have 0 items: send Zach "All clear — no pending P&I actions today"
- Always send the rollup to Zach
- If any HubSpot query fails: note it in the rollup, skip that lead's section

## IMPORTANT CASING NOTES
- Permits "As-Built Ready To Resubmit" (capital T in To)
- IC "As-Built Ready to Resubmit" (lowercase t in to)
- These are DIFFERENT values. Use exact casing.
```

- [ ] **Step 3: Verify task was created**

Run: `Check scheduled tasks list to confirm pi-daily-focus exists with correct schedule`

- [ ] **Step 4: Commit spec and plan**

```bash
git add docs/superpowers/specs/2026-03-23-pi-daily-focus-email-design.md docs/superpowers/plans/2026-03-23-daily-focus-emails.md
git commit -m "Add P&I + Design daily focus email spec and implementation plan"
```

### Task 3: Test P&I Email (Dry Run)

- [ ] **Step 1: Trigger the task manually**

Run the scheduled task on-demand to send the dry-run emails to Zach.

- [ ] **Step 2: Review emails received**

Check Zach's inbox for:
- One `[PREVIEW for {Name}]` email per lead that has items
- One `[PREVIEW — P&I Rollup]` rollup email
- Verify: deal links work, stages display correctly, pipeline labels show for D&R/Service deals, status display names are correct, counts match, alphabetical sorting

- [ ] **Step 3: Note any issues for iteration**

If format/content issues found, update the task prompt and re-run.

---

## Chunk 2: Design Scheduled Task

### Task 4: Create Design Daily Focus Scheduled Task

**Files:**
- Create: Claude scheduled task via `/schedule` skill

- [ ] **Step 1: Invoke the schedule skill**

Create a new scheduled task:
- **Name:** `design-daily-focus`
- **Schedule:** Weekday mornings, 7:05 AM America/Denver (5 min after P&I to stagger)
- **Mode:** DRY-RUN

- [ ] **Step 2: Set the task prompt**

```
You are running the Design Daily Focus Email task. Query HubSpot for actionable design items and send personalized emails to each design lead.

## MODE: DRY-RUN
Send ALL emails to Zach at {zach_email} only. Prefix subjects with [PREVIEW for {Lead Name}].

## LEADS
| Name | Owner ID | Email |
|------|----------|-------|
| Jacob Campbell | 85273950 | {email} |
| Zach Rosen | 2068088473 | {email} |
| Daniel Kelly | 216569623 | {email} |

## QUERIES PER LEAD

Properties to return: dealname, dealstage, design_status, layout_status, hs_object_id, pb_location, pipeline, design.

### Excluded deal stages (NOT_IN for all queries):
68229433, 52474745, 56217769, 20440343, 68245827, 76979603, 20440344, 72700977

### Included pipelines (use OR filter groups):
6900017, 21997330, 23928924, 765928545

### Query 1: DA Ready to Send
- design = {ownerID}
- layout_status IN: "Ready", "Draft Created", "Revision Returned From Design"

### Query 2: Design Ready to Review
- design = {ownerID}
- design_status IN: "Initial Review", "Ready for Review", "DA Approved", "Revision Initial Review", "Revision Final Review"

### Query 3: Revisions Needed
- design = {ownerID}
- design_status IN: "Revision Needed - DA Rejected", "Revision Needed - Rejected by AHJ", "Revision Needed - Rejected by Utility", "Revision Needed - Rejected"

### Query 4: Revisions In Progress
- design = {ownerID}
- design_status IN: "DA Revision In Progress", "Permit Revision In Progress", "Utility Revision In Progress", "As-Built Revision In Progress", "In Revision", "Revision In Engineering"

## DISPLAY NAME MAPPINGS
- "Ready" (layout_status) → "Review In Progress"
- "Revision Returned From Design" (layout_status) → "DA Revision Ready To Send"
- "Initial Review" → "Initial Design Review"
- "Ready for Review" → "Final Review/Stamping"
- "DA Approved" → "Final Design Review"
- "Revision Final Review" → "Revision Final Review/Stamping"
- "Revision Needed - Rejected" → "Revision Needed - As-Built"
- "In Revision" → "Revision In Progress"

## PIPELINE DISPLAY
Same as P&I: Project = no suffix, D&R = "(D&R)", Service = "(Service)", Roofing = "(Roofing)"

## STAGE DISPLAY NAMES
Same as P&I: 20461935=Project Rejected, 20461936=Site Survey, 20461937=Design & Engineering, 20461938=Permitting & IC, 71052436=RTB - Blocked, 22580871=Ready To Build, 20440342=Construction, 22580872=Inspection, 20461940=PTO, 24743347=Close Out, 52474739=Kickoff, 52498440=Closeout, 1058744644=Project Prep, 1058924076=Install Visit, 171758480=Work In Progress, 1058924077=Inspection

## EMAIL FORMAT

### Individual Design Lead Email
Subject: [PREVIEW for {Full Name}] Design Daily Focus — {ddd MMM D}

Build an HTML email with:
1. Greeting: "Good morning {First Name},"
2. "Here's what's ready for action today:"
3. For each section that has items (skip empty):
   - DA READY TO SEND: deal list with DA status
   - DESIGN READY TO REVIEW: deal list with design status
   - REVISIONS NEEDED: deal list with design status
   - REVISIONS IN PROGRESS: deal list with design status
4. Each deal line: hyperlinked deal name → https://app.hubspot.com/contacts/21710069/record/0-3/{dealId}
   Format: "• {dealname} | {pb_location}" (hyperlinked)
   Below: "Stage: {stage_display} | Status: {status_display}"
5. Footer: "Total action items: {total}"
6. Sort deals alphabetically within each section

### Manager Rollup Email
Subject: [PREVIEW — Design Rollup] Design Daily Rollup — {ddd MMM D}

Build an HTML email with:
1. TEAM SUMMARY: each lead with DA/review/revisions/in-progress counts and total, sorted by total desc
2. TEAM TOTAL line
3. FULL DETAIL BY LEAD: each lead's full breakdown

## SEND RULES
- Use Gmail MCP to send each email
- If a lead has 0 total items: skip their individual email
- If ALL leads have 0 items: send Zach "All clear — no pending design actions today"
- Always send the rollup to Zach
- If any HubSpot query fails: note it in the rollup, skip that lead's section
```

- [ ] **Step 3: Verify task was created**

Check scheduled tasks list to confirm design-daily-focus exists.

### Task 5: Test Design Email (Dry Run)

- [ ] **Step 1: Trigger the task manually**

Run the design scheduled task on-demand.

- [ ] **Step 2: Review emails received**

Check Zach's inbox for:
- One `[PREVIEW for {Name}]` email per design lead with items
- One `[PREVIEW — Design Rollup]` rollup email
- Verify: deal links, stages, pipeline labels, status display names, counts, sorting, all 4 sections present where applicable

- [ ] **Step 3: Note issues and iterate**

Update task prompt and re-run if needed.

---

## Chunk 3: Go Live

### Task 6: Switch to Live Mode

After Zach approves both dry-run outputs:

- [ ] **Step 1: Update P&I task prompt**

Change MODE section from DRY-RUN to LIVE:
```
## MODE: LIVE
Send individual emails to each lead at their email address.
Send rollup to Zach at {zach_email}.
Remove [PREVIEW] prefix from subjects.
```

- [ ] **Step 2: Update Design task prompt**

Same change — switch from DRY-RUN to LIVE mode.

- [ ] **Step 3: Verify next morning**

Confirm emails arrive correctly the next weekday morning at 7:00/7:05 AM Denver.
