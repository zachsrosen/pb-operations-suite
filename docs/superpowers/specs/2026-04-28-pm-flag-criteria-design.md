# PM Flag Criteria — v1 + v2

**Status**: Draft for review
**Date**: 2026-04-28
**Owner**: Zach Rosen

## Context

The PM Flag System (PR #448) is live. PMs no longer own deals day-to-day — they get round-robin-assigned only when a flag fires. This spec defines **what triggers a flag**.

HubSpot workflows (built by Zach in HubSpot, not in code) own the rule logic. They POST to `/api/pm-flags` with `Authorization: Bearer $API_SECRET_TOKEN`. Each rule below maps to one or more HubSpot workflows.

Criteria are split into **v1** (ship in the first wave of HubSpot workflows) and **v2** (add after v1 calibrates and we see what fires most). All thresholds are conservative starting points — re-tune based on real flag volume.

## Decisions captured during brainstorming

1. Drop the **payment milestone** rules (DA/CC/PTO/PE M1/PE M2 invoicing) and AR aging rules. Payment ops doesn't go through PM flags.
2. Stage-stuck rules use **`daysSinceStageMovement`** (the canonical PB Ops field, used in `office-performance.ts:207`), not `lastModified`.
3. Drop noisy v2 rules: design clipping, equipment shortage, generic bug-report-on-deal.
4. Add to v2: **Site Surveys outstanding**, **DA outstanding**, **Inspections outstanding**.
5. The Change Order rule uses HubSpot **`layoutStatus === "Pending Sales Changes"`** (existing signal in `funnel-aggregation.ts:308`) — not generic "change order" event.

## V1 criteria — ship first

### 1. STAGE_STUCK · HIGH · Construction-phase stage stuck

- **Trigger**: Deal in any construction-phase stage with `daysSinceStageMovement > 14`.
- **Construction stages**: `Site Visit Scheduling`, `Work In Progress`, `Construction`, `Install Scheduled`, `Install In Progress`. (Final list to be confirmed against the active stage IDs in HubSpot when building the workflow.)
- **HubSpot workflow**: Daily scheduled enrollment on stage match + `hs_v2_time_in_current_stage` (or equivalent property) > 14 days.
- **`reason`**: `Stuck in {stage} for {N} days`
- **`externalRef`**: `stuck:{dealId}:{stage}:{weekOfYear}` — re-fires once per week if not resolved.

### 2. STAGE_STUCK · MEDIUM · Pre-construction stage stuck

- **Trigger**: Deal in pre-construction (Design, Permitting, Interconnection) with `daysSinceStageMovement > 21`.
- **HubSpot workflow**: Same shape as #1, different stage list, longer threshold.
- **`reason`**: `Pre-construction stuck in {stage} for {N} days`
- **`externalRef`**: `stuck-pc:{dealId}:{stage}:{weekOfYear}`

### 3. PERMIT_ISSUE · HIGH · Permit rejection unresolved

- **Trigger**: Permit rejection logged on a deal AND no resubmission within 5 days. (Existing PB Ops `PERMIT_REJECTION_LOGGED` activity event; resolution = `PERMIT_RESUBMITTED` event.)
- **HubSpot workflow**: Enroll on `permit_status` change → "Rejected"; delay 5 days; if-branch on `permit_status` still "Rejected"; POST flag.
- **`reason`**: `Permit rejected {date}; not resubmitted in 5 days. Reason: {rejection_reason}`
- **`externalRef`**: `permit-reject:{dealId}:{rejection_id_or_date}`

### 4. INTERCONNECT_ISSUE · HIGH · IC rejection unresolved

- **Trigger**: IC rejection logged AND no resubmission within 5 days. Mirror of #3 using `IC_REJECTION_LOGGED` / `IC_RESUBMITTED`.
- **`reason`**: `IC rejected {date}; not resubmitted in 5 days. Reason: {rejection_reason}`
- **`externalRef`**: `ic-reject:{dealId}:{rejection_id_or_date}`

### 5. DESIGN_ISSUE · MEDIUM · Excessive design revisions

- **Trigger**: Design revision count > 3 on a single deal. Existing signal: `/api/hubspot/da-rework-flags` already surfaces this.
- **HubSpot workflow**: Enroll on `design_revision_counter` change; if-branch `> 3`; POST flag once.
- **`reason`**: `{N} design revisions — design quality risk`
- **`externalRef`**: `design-revisions:{dealId}` — fires once total per deal (not weekly).

### 6. INSTALL_BLOCKED · CRITICAL · Install date passed without completion

- **Trigger**: `install_scheduled_date` is in the past AND no `INSTALL_COMPLETED` activity logged AND deal is not in a "rescheduled" state.
- **HubSpot workflow**: Daily cron-enrolled workflow scanning installs scheduled in the past 7 days; if no `install_complete_date` set, POST flag.
- **`reason`**: `Install was scheduled for {date} but not marked complete. {N} days overdue.`
- **`externalRef`**: `install-overdue:{dealId}:{install_scheduled_date}`

### 7. CUSTOMER_COMPLAINT · HIGH · Service ticket on active deal

- **Trigger**: A HubSpot service-pipeline ticket is opened (or escalates priority) on a deal that's still active in install/inspection/PTO. (Inactive deals already have a service-pipeline owner; this targets the case where the customer files a complaint mid-install.)
- **HubSpot workflow**: Ticket-pipeline workflow; on ticket creation, fetch associated deal; if deal stage is in active-install set, POST flag.
- **`reason`**: `Service ticket #{ticket_id} opened during active install. Subject: {ticket_subject}`
- **`externalRef`**: `complaint:{dealId}:{ticketId}`

### 8. MISSING_DATA · MEDIUM · Permitting started with no AHJ

- **Trigger**: Deal enters Permitting stage AND `ahj` field is empty.
- **HubSpot workflow**: Enroll on `dealstage` change to Permitting; if-branch `ahj is empty`; POST flag.
- **`reason`**: `Deal entered Permitting with no AHJ assigned`
- **`externalRef`**: `missing-ahj:{dealId}`

### 9. MISSING_DATA · MEDIUM · Interconnection started with no Utility

- **Trigger**: Deal enters Interconnection stage AND `utility_company` field is empty.
- **HubSpot workflow**: Same as #8, different field.
- **`reason`**: `Deal entered Interconnection with no Utility assigned`
- **`externalRef`**: `missing-utility:{dealId}`

## V2 criteria — add after calibration

### 10. MILESTONE_OVERDUE · HIGH · Site survey outstanding

- **Trigger**: `awaitingSurvey` bucket from `funnel-aggregation.ts:317` — deal closed, no `siteSurveyCompletionDate`, days-since-close > 7.
- **HubSpot workflow**: Daily cron; for each closed-won deal with no survey completion date and `closedate` > 7 days ago, POST flag.
- **`reason`**: `Site survey outstanding for {N} days since deal close`
- **`externalRef`**: `survey-overdue:{dealId}:{weekOfYear}`

### 11. MILESTONE_OVERDUE · MEDIUM · DA not sent after survey

- **Trigger**: `awaitingDaSend` bucket — surveyed, no `designApprovalSentDate`, days-since-survey-completion > 5.
- **`reason`**: `DA not sent {N} days after site survey`
- **`externalRef`**: `da-send-overdue:{dealId}:{weekOfYear}`

### 12. MILESTONE_OVERDUE · MEDIUM · DA sent but not approved

- **Trigger**: `awaitingApproval` bucket — DA sent, no `designApprovalDate`, days-since-DA-sent > 7.
- **`reason`**: `DA sent {N} days ago, customer has not approved`
- **`externalRef`**: `da-approval-overdue:{dealId}:{weekOfYear}`

### 13. CHANGE_ORDER · MEDIUM · DA pending sales change

- **Trigger**: `layoutStatus === "Pending Sales Changes"` AND that status set > 5 days ago. (Existing signal in `funnel-aggregation.ts:308`.)
- **`reason`**: `DA blocked on sales change for {N} days`
- **`externalRef`**: `pending-sales-change:{dealId}:{weekOfYear}`

### 14. MILESTONE_OVERDUE · HIGH · Inspection outstanding

- **Trigger**: `install_complete_date` set > 14 days ago AND no inspection scheduled / completed (no `inspection_scheduled_date` or `inspection_completion_date`).
- **`reason`**: `Inspection outstanding {N} days after install completion`
- **`externalRef`**: `inspection-overdue:{dealId}:{weekOfYear}`

## Severity philosophy

- **CRITICAL** = drop everything. v1 only uses it for **install date passed without completion** (#6) — the rare "deal is broken right now" event.
- **HIGH** = handle today. Stage stuck in construction, permit/IC rejection unresolved, customer complaint, surveys/inspections way overdue.
- **MEDIUM** = handle this week. Pre-construction stuck, missing data, design revisions, change orders, DA delays.
- **LOW** = not used in this catalog. (Intentional — every flag should warrant action. If it's truly low-priority, don't flag.)

## Idempotency notes

The `externalRef` patterns above lean on `weekOfYear` for repeating signals so that a stuck deal re-fires weekly until resolved (a stale flag that nobody touched should escalate by re-appearing in inbox), and lean on stable per-event keys (`{rejection_id}`, `{install_scheduled_date}`, `{ticketId}`) for one-shot signals.

`PmFlag.@@unique([source, externalRef])` enforces dedup at the DB level — repeat workflow runs within the same week produce 200s with `alreadyExisted: true`, no duplicate rows.

## What's NOT a PM flag

To prevent this catalog from sprawling:
- **Payment milestones** (DA/CC/PTO/PE M1/PE M2 invoicing) — ops/accounting handles via existing payment-action-queue.
- **AR aging** — accounting workflow.
- **Audit anomalies** (off-hours activity, new device/IP) — already in `AuditAnomalyEvent`; not deal-level.
- **Equipment shortages** — equipment-backlog dashboard handles; if blocking a specific scheduled install, surface via #6 only.
- **Design clipping % alerts** — quality metric, not blocking. Surfaces in design-engineering analytics, not PM queue.
- **Deal-level bug reports** — too generic; if a real issue, it goes through #7 (service ticket) or manual flag.
- **No-contact reminders** for non-service deals — high noise risk; service pipeline already has this via service-priority scoring.

## HubSpot workflow build order

Suggested ordering when you build these in HubSpot, easiest-first to fastest-iteration:

1. **#8, #9** (missing data) — single-property enrollment, no time component. Test the inbound endpoint quickly.
2. **#5** (design revisions) — single-property threshold check. Validates one-shot dedup.
3. **#6** (install overdue) — daily cron-style. Validates time-based scans.
4. **#1, #2** (stage stuck) — two more daily crons; reuse #6's pattern.
5. **#3, #4** (permit/IC rejection) — delay-then-check pattern.
6. **#7** (customer complaint) — ticket-pipeline workflow, slightly different shape.
7. **v2 (#10–#14)** — once v1 has 1–2 weeks of real flag volume to calibrate against.

## Verification

After each workflow goes live:
1. Trigger the condition deliberately on a test deal.
2. Verify a `PmFlag` row appears in `/dashboards/pm-action-queue` with the right `type`, `severity`, `reason`.
3. Re-trigger same condition → verify idempotent (no dupe).
4. Query the count by type after one week:
   ```bash
   npx tsx scripts/check-pm-flags.ts
   ```
5. If a single rule fires > 50 flags/week and PMs are ignoring most, lower severity or raise threshold.

## Open questions for HubSpot build time

These don't block the spec but will need answers when actually building each workflow:

- Exact stage IDs for the v1 stage-stuck buckets (need a quick `grep "stage_id"` against the HubSpot pipeline config when building).
- Confirm `hs_v2_time_in_current_stage` exists at the deal level in this portal (vs. needing a custom calc).
- Whether `permit_status` enum has a stable "Rejected" value or needs to be derived from rejection-log activities.
- The exact custom property name for `design_revision_counter` (per CLAUDE.md it's `permit_revision_counter`/`interconnection_revision_counter`/`da_revision_counter`/`as_built_revision_counter` — `da_revision_counter` is likely the one to use here).
