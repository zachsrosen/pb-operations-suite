# P&I + Design Daily Focus Email — Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Approach:** Hybrid — Claude Scheduled Task (Phase 1) → Vercel Cron Route (Phase 2)

## Overview

Two daily emails:
1. **P&I Focus** — sent to each P&I team lead showing their actionable permit/IC/PTO queue
2. **Design Focus** — sent to each design lead showing their DA, design review, revision, and revision-in-progress queue

Both include a manager rollup email to Zach consolidating all leads.

## Goals

- Each lead starts their day knowing exactly what to work on
- Manager (Zach) gets a single rollup of all leads' queues
- No manual data pulling — runs automatically on weekday mornings

## Phase 1: Claude Scheduled Task

Runs as a Claude Code scheduled task. Claude queries HubSpot via MCP, builds HTML emails, and sends via Gmail MCP. Easy to iterate on content, recipients, and format.

**Dry-run mode:** First run sends ALL emails (individual + rollup) to Zach only, so he can preview what each lead would receive before going live. Each email subject is prefixed with `[PREVIEW for {Lead Name}]`. Once approved, switch to live mode where emails go to actual recipients.

## Phase 2: Vercel Cron Route (Future)

Once the email format is dialed in, convert to a deployed `/api/cron/pi-daily-digest` route with a React Email template, dual-provider sending (Google Workspace primary, Resend fallback), and idempotency lock. Follows existing patterns from `audit-digest` and `pipeline-health` cron routes in `src/app/api/cron/`.

---

## Configured Lead List

| Lead | HubSpot Owner ID | Email | Notes |
|------|-------------------|-------|-------|
| Peter Zaun | 78035785 | (hardcode in task prompt) | Permit + IC lead |
| Kristofer Stuhff | 82539445 | (hardcode in task prompt) | Permit lead only (0 IC deals) |
| Katlyyn Arnoldi | 212300376 | (hardcode in task prompt) | IC lead + some permits |
| Layla Counts | 216565308 | (hardcode in task prompt) | IC lead + minor permits |
| Alexis Severson | 212300959 | (hardcode in task prompt) | Permit + IC lead |
| Kaitlyn Martinez | 212298628 | (hardcode in task prompt) | Permit + IC lead |
| Zach (Manager) | — | (hardcode in task prompt) | Receives rollup only |

Leads are a configured list maintained by Zach. Add/remove by editing the task prompt. Email addresses are hardcoded in the task prompt alongside owner IDs (not looked up at runtime).

## Schedule

- **Frequency:** Weekday mornings (Monday–Friday)
- **Time:** 7:00 AM America/Denver
- **Skip:** Weekends

---

## Query Logic

### Data Source

HubSpot CRM deals via MCP `search_crm_objects`.

### Pipeline Filter

Queries include deals from these pipelines:
- **Project Pipeline** (`6900017`) — primary P&I work
- **D&R Pipeline** (`21997330`) — D&R projects with permit/IC work
- **Service Pipeline** (`23928924`) — service projects with permit/IC work
- **Roofing Pipeline** (`765928545`) — roofing projects with permit/IC work

Excluded: **Sales Pipeline** (no P&I work).

The deal's pipeline is noted in the email alongside the deal stage (e.g., "Stage: Construction (D&R)" or "Stage: Pre-Construction (Service)") so leads can see at a glance which pipeline a deal belongs to.

### Per-Lead Queries

For each lead, run up to 3 query sets. No hardcoded role assumptions — if a person has items as both `permit_tech` and `interconnections_tech`, they see all relevant sections.

Each category (Permits, IC, PTO) requires two queries: one for "Ready to Submit" statuses and one for "Resubmissions Needed" statuses. This keeps each query within HubSpot's filter group limits (max 5 filter groups, 6 filters per group).

**1. Permits (where person is `permit_tech`):**
- Filter: `permit_tech = {ownerID}`
- Filter: `pipeline = 6900017`
- Filter: `permitting_status` IN action statuses (see below)
- Filter: `dealstage` NOT IN excluded stages

**2. Interconnection (where person is `interconnections_tech`):**
- Filter: `interconnections_tech = {ownerID}`
- Filter: `pipeline = 6900017`
- Filter: `interconnection_status` IN action statuses (see below)
- Filter: `dealstage` NOT IN excluded stages

**3. PTO (where person is `interconnections_tech`):**
- Filter: `interconnections_tech = {ownerID}`
- Filter: `pipeline = 6900017`
- Filter: `pto_status` IN action statuses (see below)
- Filter: `dealstage` NOT IN excluded stages

### Action Statuses

> **Important:** These are raw HubSpot property values, not display names. Some display names differ from raw values (noted below). The email should show the display name to users.

#### Permits — Ready to Submit
- `Ready For Permitting`
- `Pending SolarApp`
- `Customer Signature Acquired`
- `Awaiting Utility Approval`

#### Permits — Resubmissions Needed
- `As-Built Ready To Resubmit` (note: capital "To")
- `Returned from Design` (displays as "Revision Ready To Resubmit")

#### Interconnection — Ready to Submit
- `Ready for Interconnection`
- `Signature Acquired By Customer`

#### Interconnection — Resubmissions Needed
- `As-Built Ready to Resubmit` (note: lowercase "to" — differs from permits!)
- `Revision Returned From Design` (displays as "Revision Ready To Resubmit")

#### PTO — Ready to Submit
- `Inspection Passed - Ready for Utility` (displays as "Ready for PTO Submission")
- `Xcel Photos Ready to Submit`

#### PTO — Resubmissions Needed
- `Inspection Rejected By Utility`
- `Ops Related PTO Rejection`
- `Xcel Photos Rejected`

> **Casing note:** The "As-Built" status has different casing between permits (`To`) and interconnection (`to`). HubSpot search is case-sensitive — use exact values above.

### Excluded Deal Stages

Deals in these stages are excluded from all queries. Use HubSpot deal stage IDs (not display names) when filtering:
- Cancelled (stage ID to be resolved at query time)
- Project Complete (stage ID to be resolved at query time)
- On Hold (stage ID to be resolved at query time)

### Deduplication

A deal can appear in multiple sections if it has actionable statuses in more than one category (e.g., both permits and IC ready to submit). This is correct behavior — they are independent workstreams.

### Properties Returned Per Deal

- `dealname` — displayed as hyperlinked deal name
- `dealstage` — shown as human-readable stage name
- `permitting_status` / `interconnection_status` / `pto_status` — the action status
- `hs_object_id` — used to build the HubSpot deal URL
- `pb_location` — location context

---

## Email Structure

### Individual Lead Email

**Subject:** `P&I Daily Focus — [Full Name] — Mon Mar 24`
**Subject (dry-run):** `[PREVIEW for Full Name] P&I Daily Focus — Mon Mar 24`

**Date format:** `ddd MMM D` (e.g., Mon Mar 24)

**Body:**

```
Good morning [First Name],

Here's what's ready for action today:

━━ PERMITS ━━━━━━━━━━━━━━━━━━━━━━

Ready to Submit (3)
  • PROJ-9502 | McCammon, William | Colorado Springs    [hyperlinked]
    Stage: Construction  |  Status: Ready For Permitting

  • PROJ-9062 | Johnson, Erik | Centennial            [hyperlinked]
    Stage: Pre-Construction  |  Status: Ready For Permitting

  • D&R | PROJ-1663 | Guerrero, Shirley | Colorado Springs  [hyperlinked]
    Stage: Construction (D&R)  |  Status: Ready For Permitting
  ...

Resubmissions Needed (1)
  • PROJ-9034 | White, Frank | Centennial              [hyperlinked]
    Stage: Construction  |  Status: As-Built Ready To Resubmit

━━ INTERCONNECTION ━━━━━━━━━━━━━━

Ready to Submit (2)
  ...

━━ PTO ━━━━━━━━━━━━━━━━━━━━━━━━━━

Ready to Submit (4)
  ...

───────────────────────────────
Total action items: 10
```

**Rules:**
- Sections only appear if the lead has items in that category
- Empty categories are omitted entirely
- Deal names are hyperlinks to `https://app.hubspot.com/contacts/21710069/record/0-3/{dealId}`
- Within each section, "Ready to Submit" appears before "Resubmissions Needed"
- Deals sorted within each subsection by deal name (alphabetical)
- Status values shown as display names (e.g., "Ready for PTO Submission" not "Inspection Passed - Ready for Utility")

### Manager Rollup Email

**Subject:** `P&I Daily Rollup — Mon Mar 24`

**Body:**

```
━━ TEAM SUMMARY ━━━━━━━━━━━━━━━━━

  Peter Zaun:        5 permits, 3 IC, 4 PTO  = 12 total
  Kaitlyn Martinez:  4 permits, 8 IC, 2 PTO  = 14 total
  Katlyyn Arnoldi:   2 permits, 24 IC, 5 PTO = 31 total
  Layla Counts:      0 permits, 6 IC, 2 PTO  = 8 total
  Alexis Severson:   3 permits, 1 IC, 4 PTO  = 8 total
  Kristofer Stuhff:  8 permits, 0 IC, 0 PTO  = 8 total

  TEAM TOTAL: 81 action items

━━ FULL DETAIL BY LEAD ━━━━━━━━━━

[Peter Zaun]
  (same per-lead breakdown as individual emails)

[Kaitlyn Martinez]
  ...

[Katlyyn Arnoldi]
  ...
```

**Rules:**
- Summary table at top with per-lead counts
- Full detail for all leads below the summary
- Same deal hyperlinks and formatting as individual emails
- Leads sorted by total action items (highest first)

---

---

# Design Daily Focus Email

## Configured Design Lead List

| Lead | HubSpot Owner ID | Email | Status | Notes |
|------|-------------------|-------|--------|-------|
| Jacob Campbell | 85273950 | (hardcode in task prompt) | Active | |
| Zach Rosen | 2068088473 | (hardcode in task prompt) | Active | |
| Daniel Kelly | 216569623 | (hardcode in task prompt) | Active | |
| Zach (Manager) | — | (hardcode in task prompt) | — | Receives rollup only |

**Inactive leads with backlog** (may need reassignment):
- Adam Diehl (227498125) — inactive, ~43 items
- Jose Gaspar (609624749) — inactive, ~17 items

## Design Query Logic

### Data Source

Same as P&I: HubSpot CRM deals via MCP `search_crm_objects`.

### Pipeline Filter

Same as P&I: Project, D&R, Service, and Roofing pipelines. Exclude Sales.

### Per-Lead Queries

For each lead, query by `design = {ownerID}` with status filters. Four sections:

**1. DA Ready to Send** (`layout_status`):
- Filter: `design = {ownerID}`
- Filter: `layout_status` IN action statuses
- Filter: `dealstage` NOT IN excluded stages

**2. Design Ready to Review** (`design_status`):
- Filter: `design = {ownerID}`
- Filter: `design_status` IN action statuses
- Filter: `dealstage` NOT IN excluded stages

**3. Revisions Needed** (`design_status`):
- Filter: `design = {ownerID}`
- Filter: `design_status` IN revision statuses
- Filter: `dealstage` NOT IN excluded stages

**4. Revisions In Progress** (`design_status`):
- Filter: `design = {ownerID}`
- Filter: `design_status` IN in-progress statuses
- Filter: `dealstage` NOT IN excluded stages

### Action Statuses

> **Important:** These are raw HubSpot property values. Display names noted where they differ.

#### DA Ready to Send (`layout_status`)
- `Ready` (displays as "Review In Progress")
- `Draft Created`
- `Revision Returned From Design` (displays as "DA Revision Ready To Send")

#### Design Ready to Review (`design_status`)
- `Initial Review` (displays as "Initial Design Review")
- `Ready for Review` (displays as "Final Review/Stamping")
- `DA Approved` (displays as "Final Design Review")
- `Revision Initial Review`
- `Revision Final Review` (displays as "Revision Final Review/Stamping")

#### Revisions Needed (`design_status`)
- `Revision Needed - DA Rejected`
- `Revision Needed - Rejected by AHJ`
- `Revision Needed - Rejected by Utility`
- `Revision Needed - Rejected` (displays as "Revision Needed - As-Built")

#### Revisions In Progress (`design_status`)
- `DA Revision In Progress`
- `Permit Revision In Progress`
- `Utility Revision In Progress`
- `As-Built Revision In Progress`
- `In Revision` (displays as "Revision In Progress")
- `Revision In Engineering`

### Excluded Deal Stages

Same as P&I: Cancelled, Project Complete, On Hold (by stage ID).

## Design Email Structure

### Individual Design Lead Email

**Subject:** `Design Daily Focus — [Full Name] — Mon Mar 24`
**Subject (dry-run):** `[PREVIEW for Full Name] Design Daily Focus — Mon Mar 24`

**Body:**

```
Good morning [First Name],

Here's what's ready for action today:

━━ DA READY TO SEND ━━━━━━━━━━━━━

(3)
  • PROJ-9551 | Holmes, David | Westminster              [hyperlinked]
    Stage: Pre-Construction  |  DA Status: Draft Created

  • PROJ-6760 | Begin, Eric | Westminster                [hyperlinked]
    Stage: Cancelled  |  DA Status: DA Revision Ready To Send
  ...

━━ DESIGN READY TO REVIEW ━━━━━━━

(5)
  • PROJ-9583 | Uphoff, Jessica | Centennial              [hyperlinked]
    Stage: Pre-Construction  |  Design Status: Initial Design Review

  • PROJ-6610 | Giltner, Jim | Colorado Springs           [hyperlinked]
    Stage: Cancelled  |  Design Status: Final Review/Stamping
  ...

━━ REVISIONS NEEDED ━━━━━━━━━━━━━

(2)
  • PROJ-9480 | Holroyd, Edmond | Centennial              [hyperlinked]
    Stage: Pre-Construction  |  Design Status: Revision Needed - DA Rejected
  ...

━━ REVISIONS IN PROGRESS ━━━━━━━━

(1)
  • PROJ-XXXX | Name | Location                           [hyperlinked]
    Stage: Pre-Construction  |  Design Status: DA Revision In Progress
  ...

───────────────────────────────
Total action items: 11
```

**Rules:**
- Same rules as P&I email: sections omitted if empty, deal names hyperlinked, display names shown, alphabetical sort within sections
- Pipeline noted in parentheses for non-project-pipeline deals (e.g., "Construction (D&R)")

### Design Manager Rollup Email

**Subject:** `Design Daily Rollup — Mon Mar 24`

**Body:**

```
━━ TEAM SUMMARY ━━━━━━━━━━━━━━━━━

  Zach Rosen:       7 DA, 12 review, 16 revisions, 4 in progress = 39 total
  Jacob Campbell:   6 DA, 5 review, 8 revisions, 2 in progress  = 21 total
  Daniel Kelly:     0 DA, 2 review, 1 revision, 0 in progress   = 3 total

  TEAM TOTAL: 63 action items

━━ FULL DETAIL BY LEAD ━━━━━━━━━━

[Zach Rosen]
  (same per-lead breakdown as individual emails)

[Jacob Campbell]
  ...
```

**Rules:**
- Same rules as P&I rollup: summary at top, full detail below, sorted by total items (highest first)

---

## Implementation Notes (Phase 1 — Scheduled Task)

### Dry-Run Mode

The first run operates in dry-run mode:
- ALL emails (both individual lead emails and rollup) are sent to Zach only
- Individual lead emails have `[PREVIEW for {Lead Name}]` in the subject
- Zach reviews the output and approves before switching to live mode
- Switch to live mode by updating the task prompt

### Email Sending

Use Gmail MCP tool to send HTML emails directly. The scheduled task prompt will include:
- The configured lead list with owner IDs and hardcoded email addresses
- The action status lists (raw HubSpot values)
- Display name mappings for statuses that differ from raw values
- Instructions to query HubSpot, build HTML, and send via Gmail

### Query Volume

**P&I:** Per lead up to 6 queries (2 per category: ready + resubmissions). With 6 leads: up to 36 queries.
**Design:** Per lead up to 4 queries (one per section). With 3 leads: up to 12 queries.
**Total:** ~48 queries per run. In practice, many return 0 results quickly. Queries should be run sequentially per lead to stay within HubSpot rate limits.

### Error Handling

- If HubSpot queries fail, skip that lead and note the failure in the rollup
- If Gmail send fails for a lead, note in rollup email
- If no action items exist for any lead, send a short "All clear" email to manager only (skip individual emails for leads with 0 items)

### "All Clear" Behavior

- Individual leads with 0 action items: **no email sent** (don't spam with empty emails)
- If ALL leads have 0 items: send manager a short "All clear — no pending P&I actions today"

---

## Future Enhancements (Phase 2+)

- Convert to Vercel Cron Route with React Email template (reference `src/app/api/cron/audit-digest/` and `pipeline-health/` for patterns)
- Add idempotency lock via `SystemConfig` table (prevent double-send)
- Add "days in status" column to highlight stale items
- Add comparison to previous day (new items, resolved items)
- Add unassigned deals section (items with no permit_tech/interconnections_tech)
- Weekly summary with trend charts
