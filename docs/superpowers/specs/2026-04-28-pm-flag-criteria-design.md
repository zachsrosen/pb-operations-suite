# PM Flag Criteria — v1 + v2

**Status**: Implemented
**Date**: 2026-04-28
**Owner**: Zach Rosen

## Context

The PM Flag System (PR #448) is live. PMs no longer own deals day-to-day — they get round-robin-assigned only when a flag fires. This spec defines **what triggers a flag** and how the rules evaluate.

**No HubSpot workflows are in the loop.** All flag-triggering data is already in the local Deal mirror (`prisma/schema.prisma`'s `Deal` model + `DealStatusSnapshot` for stage history). A daily Vercel cron at `/api/cron/pm-flag-rules` evaluates every rule and creates flags for matches via `createFlag` (idempotent on `(source, externalRef)`).

The `/api/pm-flags` POST endpoint with `API_SECRET_TOKEN` remains available for manual integrations or one-off webhook callouts but is **not used by the catalog rules**.

## Decisions captured during brainstorming

1. **Drop** the payment milestone rules (DA/CC/PTO/PE M1/M2 invoicing) and AR aging — accounting workflow handles those.
2. **Stage-stuck** uses `daysInCurrentStage(dealId, currentStage)` derived from `DealStatusSnapshot`. The function returns days since the most recent snapshot where the stage was different (or earliest snapshot if the deal has only ever been in this stage).
3. **Change-order** uses HubSpot `layoutStatus = "Pending Sales Changes"` (existing signal in `funnel-aggregation.ts:308`).
4. **Survey/DA/inspection outstanding** reuse the `awaitingSurvey` / `awaitingDaSend` / `awaitingApproval` patterns from `funnel-aggregation.ts:317`, computed directly off Deal date fields.
5. **Cut** from earlier draft: design clipping %, equipment shortage, generic deal bug reports, no-contact reminders.
6. **CRITICAL severity** is reserved strictly for "drop everything" — only #6 in v1 uses it.
7. **No HubSpot workflows.** All rules run as a single in-app cron because all data is already mirrored locally.

## Architecture

```
Vercel cron (07:00 Denver / 13:00 UTC)
  ↓
GET /api/cron/pm-flag-rules           [CRON_SECRET-validated]
  ↓
runAllRules() in src/lib/pm-flag-rules.ts
  ├─ rule fn 1 → RuleMatch[]
  ├─ rule fn 2 → RuleMatch[]
  ├─ ...
  └─ rule fn 14 → RuleMatch[]
  ↓
For each match:
  createFlag({ source: ADMIN_WORKFLOW, externalRef, ... })
  ↓ (if newly created)
  void sendFlagAssignedEmail(flag)
```

Each rule function is pure async — takes the prisma client, returns `RuleMatch[]`. Rules don't call `createFlag` themselves — the runner does, so a single rule failing doesn't block the rest.

## V1 rules (active)

### R1. STAGE_STUCK · HIGH · Construction-phase stage stuck

- **Trigger**: `Deal.stage` normalized to `RTB | Install | Inspect` AND `daysInCurrentStage > 14`.
- **Implementation**: `ruleConstructionStageStuck()` in `src/lib/pm-flag-rules.ts`.
- **`reason`**: `Stuck in "{stage}" for {N} days`
- **`externalRef`**: `stage-stuck:{dealId}:{stage}:{isoWeek}` — re-fires once per ISO week if not resolved.

### R2. STAGE_STUCK · MEDIUM · Pre-construction stage stuck

- **Trigger**: `Deal.stage` normalized to `Design | Permit` AND `daysInCurrentStage > 21`.
- **`reason`**: `Pre-construction stuck in "{stage}" for {N} days`
- **`externalRef`**: `stage-stuck-pc:{dealId}:{stage}:{isoWeek}`

### R3. PERMIT_ISSUE · HIGH · Permit rejection unresolved

- **Trigger**: `Deal.permittingStatus` matches `/reject/i` AND `Deal.updatedAt < now - 5 days`.
- **`reason`**: `Permit status "{permittingStatus}"; {N} days without resolution`
- **`externalRef`**: `permit-reject:{dealId}:{isoWeek}`
- **Heuristic note**: Uses `Deal.updatedAt` as proxy for "how long has this rejection been unresolved." Imperfect (any field change resets the clock) but conservative — false-negatives over false-positives.

### R4. INTERCONNECT_ISSUE · HIGH · IC rejection unresolved

- **Trigger**: `Deal.icStatus` matches `/reject/i` AND `Deal.updatedAt < now - 5 days`.
- Mirror of R3 with the IC field. Same heuristic note applies.

### R5. DESIGN_ISSUE · MEDIUM · Excessive design revisions

- **Trigger**: `Deal.daRevisionCount > 3`.
- **`externalRef`**: `design-revisions:{dealId}` — **one-shot per deal** (not weekly). Once flagged, doesn't re-flag — this is a state, not a recurring concern.

### R6. INSTALL_BLOCKED · CRITICAL · Install date passed without completion

- **Trigger**: `Deal.installScheduleDate < now` AND `Deal.constructionCompleteDate IS NULL` AND deal not terminal.
- **`reason`**: `Install was scheduled {N} days ago ({date}) but not marked complete`
- **`externalRef`**: `install-overdue:{dealId}:{installScheduleDate}` — tied to the specific scheduled date, so a rescheduled-then-overdue install raises a fresh flag.

### R7. CUSTOMER_COMPLAINT · HIGH · Service ticket on active deal

- **Status in v1 cron**: **Skipped.** Requires HubSpot tickets join not yet materialized locally.
- **Manual workaround**: `<RaiseFlagButton dealId={...} />` on the ticket detail page lets ops/service raise this flag manually for now. Revisit when the ticket-deal join lands.

### R8. MISSING_DATA · MEDIUM · Permit started, no AHJ

- **Trigger**: Deal stage normalized to `Permit` or `RTB` AND `Deal.ahj IS NULL/empty` AND `Deal.isPermitSubmitted = false`.
- **`externalRef`**: `missing-ahj:{dealId}` — one-shot per deal.

### R9. MISSING_DATA · MEDIUM · Interconnection started, no Utility

- **Trigger**: Deal stage normalized to `Permit | RTB | Install` AND `Deal.utility IS NULL/empty` AND `Deal.isIcSubmitted = false`.
- **`externalRef`**: `missing-utility:{dealId}` — one-shot per deal.

## V2 rules (active)

### R10. MILESTONE_OVERDUE · HIGH · Site survey outstanding

- **Trigger**: `Deal.closeDate < now - 7 days` AND `Deal.siteSurveyCompletionDate IS NULL` AND deal not terminal.
- **`externalRef`**: `survey-overdue:{dealId}:{isoWeek}`

### R11. MILESTONE_OVERDUE · MEDIUM · DA not sent after survey

- **Trigger**: `Deal.siteSurveyCompletionDate < now - 5 days` AND `Deal.designApprovalSentDate IS NULL`.
- **`externalRef`**: `da-send-overdue:{dealId}:{isoWeek}`

### R12. MILESTONE_OVERDUE · MEDIUM · DA sent but not approved

- **Trigger**: `Deal.designApprovalSentDate < now - 7 days` AND `Deal.isLayoutApproved = false` AND `Deal.layoutStatus != "Pending Sales Changes"` (the change-order rule below catches that case).
- **`externalRef`**: `da-approval-overdue:{dealId}:{isoWeek}`

### R13. CHANGE_ORDER · MEDIUM · DA pending sales change

- **Trigger**: `Deal.layoutStatus = "Pending Sales Changes"` AND `Deal.updatedAt < now - 5 days`.
- **`reason`**: `DA blocked on sales change for {N}+ days`
- **`externalRef`**: `pending-sales-change:{dealId}:{isoWeek}`

### R14. MILESTONE_OVERDUE · HIGH · Inspection outstanding

- **Trigger**: `Deal.constructionCompleteDate < now - 14 days` AND `Deal.inspectionScheduleDate IS NULL` AND `Deal.inspectionPassDate IS NULL`.
- **`externalRef`**: `inspection-overdue:{dealId}:{isoWeek}`

## Severity philosophy

- **CRITICAL** — drop everything. v1 only uses it for **install date passed without completion** (R6) — the rare "deal is broken right now" event.
- **HIGH** — handle today. Stage stuck in construction, permit/IC rejection unresolved, surveys/inspections way overdue, customer complaints (when wired).
- **MEDIUM** — handle this week. Pre-construction stuck, missing data, design revisions, change orders, DA delays.
- **LOW** — not used. (Intentional — every flag should warrant action. If it's truly low-priority, don't flag.)

## Idempotency philosophy

`PmFlag.@@unique([source, externalRef])` enforces dedup at the DB level. Two patterns:

1. **Repeating signals** (stuck deals, outstanding milestones) — `externalRef` includes `{isoWeek}`. Re-fires weekly until resolved, surfacing flags PMs ignored.
2. **One-shot signals** (design revisions, missing data, install-overdue) — stable per-event key. Raised once; PM resolves or admin cancels.

The runner calls `createFlag` for every match every day. Idempotency means duplicate calls return `alreadyExisted: true` — no DB churn, no email spam.

## Schedule

`vercel.json` cron:

```json
{ "path": "/api/cron/pm-flag-rules", "schedule": "0 13 * * *" }
```

Daily at 13:00 UTC = 07:00 Denver. PMs see fresh flags when they start their day.

## Configuration

- **`CRON_SECRET`** — required. Vercel Cron sends as `Authorization: Bearer {secret}`. Validated at the top of the route.
- **`PM_FLAG_RULES_ENABLED`** — kill switch. Set to `"false"` to silence rule firing without removing the cron entry. Defaults to enabled.

## What's NOT a PM flag

To prevent the catalog from sprawling:

- **Payment milestones** (DA/CC/PTO/PE M1/PE M2 invoicing) — accounting handles via existing payment-action-queue.
- **AR aging** — accounting workflow.
- **Audit anomalies** (off-hours activity, new device/IP) — already in `AuditAnomalyEvent`; not deal-level.
- **Equipment shortages** — equipment-backlog dashboard handles; if blocking a specific scheduled install, R6 will fire on the install date passing.
- **Design clipping % alerts** — quality metric, not blocking.
- **Deal-level bug reports** — too generic; if real, it goes through R7 (manual flag) or service ticket.
- **No-contact reminders** for non-service deals — high noise risk.

## Verification

After deploy:

1. **Migration check**: PR #448 already migrated `PmFlag` + `PmFlagEvent` tables to prod.
2. **Manual test invocation** of the cron (in dev or prod):
   ```bash
   curl -X GET "$APP/api/cron/pm-flag-rules" \
     -H "Authorization: Bearer $CRON_SECRET" | jq
   ```
   Expected response shape:
   ```json
   {
     "status": "ok",
     "totalMatches": N,
     "totalCreated": M,
     "totalAlreadyExisted": 0,
     "byRule": [{ "rule": "...", "matches": N, "durationMs": ms }, ...],
     "errors": []
   }
   ```
3. **Visit `/dashboards/pm-action-queue`** — flags appear distributed across PMs by round-robin.
4. **Re-run cron** — `totalAlreadyExisted` should match prior `totalCreated` (idempotent).
5. **Sanity check via diagnostic**:
   ```bash
   npx tsx scripts/check-pm-flags.ts
   ```
6. **Calibration**: After 1–2 weeks, if any rule fires > 50/week and PMs are ignoring most, raise the threshold or lower severity.

## Tuning the rules over time

When real flag volume comes in, expect to adjust:

- **Stage-stuck thresholds** (R1: 14d, R2: 21d) — likely the first to need tuning. Different stages may need different thresholds; consider per-stage SLA tables if a single threshold is too coarse.
- **Permit/IC rejection 5-day clock** — switching from `Deal.updatedAt` to an explicit "rejection logged at" timestamp (via `ActivityLog` query) improves accuracy. Worth doing if R3/R4 generate too much noise.
- **DA approval threshold** (R12: 7d) — depends on how long customers typically take. Watch the median in real data.

Tuning happens in `src/lib/pm-flag-rules.ts`. No schema changes needed.

## Future extensions

- **R7 customer complaint** — wire when ticket-deal join lands locally.
- **Per-stage thresholds** — replace single `> 14` / `> 21` with a stage-specific SLA map.
- **Auto-escalation** — HIGH+ flag stuck > N hours → notify lead PM via separate channel.
- **HubSpot workflow callouts** for events that aren't in the Deal mirror (e.g., real-time customer-property changes from a contact webhook). The `/api/pm-flags` POST + machine-token auth is already wired and ready when needed.
