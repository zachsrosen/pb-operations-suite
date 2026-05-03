# Construction Job Split: Solar / Battery / EV — Design

**Status:** Draft
**Author:** Zach (with Claude)
**Date:** 2026-05-03

## Background

Photon Brothers is splitting the single Zuper "Construction" job per deal into up to three Zuper jobs — Solar Install, Battery Install, EV Install — created conditionally based on what the deal includes. A solar-only deal gets one job; a solar+battery+EV deal gets three.

The split is operationally driven: different crews handle each system type, with independent assignments in Zuper. Operationally, all sub-jobs for one deal are still scheduled for the same calendar date(s) at the same property — the deal is the unit of scheduling, the sub-jobs are units of work tracking and crew assignment.

A HubSpot workflow already creates the new Zuper jobs at the appropriate deal stage. **The codebase only needs to react to the new shape, not produce it.**

## Problem

Multiple subsystems assume one construction Zuper job per deal. Without changes, the split produces silent data corruption in production:

- **Revenue Calendar** (`/api/zuper/revenue-calendar`): each sub-job is linked to the same HubSpot deal and inherits the full deal amount, so a 3-system deal triple-counts revenue.
- **Schedule Optimizer** (`lib/schedule-optimizer.ts`): each sub-job consumes one location capacity slot, so a single property can appear to exceed Westminster's daily capacity (=2) on its own.
- **Google Calendar** (`lib/google-calendar.ts`): event ID is `SHA1("install:${projectId}")` — three sub-jobs either overwrite each other or produce three separate events for the same property.
- **Construction Metrics dashboard**: "X jobs in construction" inflates 1.5–3× because the count is per-job, not per-deal.
- **HubSpot `construction_complete_date`**: needs to fire only when all sub-jobs are complete, not on each sub-job's completion.
- **`ZuperJobCache.findFirst({ where: { hubspotDealId } })` queries**: silently return an arbitrary sub-job rather than failing or returning all of them.

## Decisions (already made during brainstorming)

| Decision | Choice |
|---|---|
| Why split | Different crews per system type, independent assignments |
| Conditional job creation | Only the relevant jobs are created (1, 2, or 3 per deal) |
| Revenue allocation | **Equal split** across sub-jobs sharing a deal (mirrors D&R 50/50) |
| Zuper categories | Three brand-new categories; legacy `Construction` retires naturally |
| Cutover | **Hard** — new deals get split, in-flight `Construction` jobs run to completion |
| Capacity model | **One deal = one capacity slot**, regardless of sub-job count |
| Sub-job scheduling | Co-scheduled — all sub-jobs of a deal share the same date window |
| `construction_complete_date` stamping | When **all** sub-jobs are complete; latest completion wins |
| Job creation | HubSpot workflow already handles it — out of scope |

## Architecture

A single new module — `src/lib/zuper-construction.ts` — encapsulates "construction work spanning multiple Zuper categories." All consumers route through it.

```
Zuper config (lib/zuper.ts)
  └─ JOB_CATEGORY_UIDS: + SOLAR_INSTALL, BATTERY_INSTALL, EV_INSTALL
  └─ CONSTRUCTION_CATEGORY_UIDS: array union
                          │
                          ▼
NEW: lib/zuper-construction.ts
  ├─ isConstructionCategory(uid)
  ├─ categoryToSystemType(uid) → "solar"|"battery"|"ev"|"legacy"
  ├─ groupConstructionJobsByDeal(jobs[]) → DealConstructionAggregate[]
  ├─ allocateDealValueAcrossJobs(amount, jobCount)
  └─ getDealCompletionStatus(aggregate)
                          │
                          ▼
Consumers
  ├─ api/zuper/revenue-calendar/route.ts        → equal-split per aggregate
  ├─ lib/schedule-optimizer.ts                  → 1 capacity unit per aggregate
  ├─ lib/google-calendar.ts                     → 1 calendar event per deal
  ├─ dashboards/construction-metrics/page.tsx   → counts by deal, not by job
  └─ NEW: api/cron/stamp-construction-complete  → cron stamps HubSpot when all done
```

## Component Design

### 1. Zuper category configuration (`lib/zuper.ts`)

Add three category UIDs sourced from environment variables:

```ts
export const JOB_CATEGORY_UIDS = {
  SITE_SURVEY: process.env.ZUPER_CATEGORY_SITE_SURVEY ?? "",
  CONSTRUCTION: process.env.ZUPER_CATEGORY_CONSTRUCTION ?? "", // legacy
  SOLAR_INSTALL: process.env.ZUPER_CATEGORY_SOLAR_INSTALL ?? "",   // new
  BATTERY_INSTALL: process.env.ZUPER_CATEGORY_BATTERY_INSTALL ?? "", // new
  EV_INSTALL: process.env.ZUPER_CATEGORY_EV_INSTALL ?? "",         // new
  // ...existing entries unchanged
};

export const CONSTRUCTION_CATEGORY_UIDS = [
  JOB_CATEGORY_UIDS.CONSTRUCTION,
  JOB_CATEGORY_UIDS.SOLAR_INSTALL,
  JOB_CATEGORY_UIDS.BATTERY_INSTALL,
  JOB_CATEGORY_UIDS.EV_INSTALL,
].filter(Boolean);
```

The `.filter(Boolean)` guard means the union shrinks gracefully if env vars are unset (e.g., in tests or before Zuper categories exist in dev).

### 2. New helper module (`lib/zuper-construction.ts`)

```ts
import type { ZuperJobCache } from "@/generated/prisma/client";
import { CONSTRUCTION_CATEGORY_UIDS, JOB_CATEGORY_UIDS } from "./zuper";

export type SystemType = "solar" | "battery" | "ev" | "legacy";

export type DealConstructionAggregate = {
  dealId: string;
  jobs: ZuperJobCache[];
  systemTypes: SystemType[];
  earliestStart: Date | null;
  latestEnd: Date | null;
  isFullyComplete: boolean;
  completedAt: Date | null;
  assignedCrewsByType: Partial<Record<SystemType, string[]>>;
};

export function isConstructionCategory(categoryUid: string | null | undefined): boolean;
export function categoryToSystemType(categoryUid: string): SystemType;
export function groupConstructionJobsByDeal(jobs: ZuperJobCache[]): DealConstructionAggregate[];
export function allocateDealValueAcrossJobs(dealAmount: number, jobCount: number): number;
export function getDealCompletionStatus(agg: DealConstructionAggregate): "complete" | "partial" | "not-started";
```

**Pure functions, no I/O.** Tests target this module directly with crafted `ZuperJobCache[]` fixtures.

Edge cases:
- A job with `hubspotDealId === null` is dropped from grouping output (logged via Sentry breadcrumb, not error).
- A deal with sub-jobs in mixed states (one complete, two scheduled) returns `isFullyComplete: false` and `completedAt: null`.
- A deal with one job behaves identically to today's single-job pattern (backwards-compatible).

### 3. Revenue Calendar refactor (`api/zuper/revenue-calendar/route.ts`)

Replace the current per-job dealValue assignment with aggregate-aware splitting. The existing D&R 50/50 logic generalizes naturally:

**Before:**
```ts
const dealAmount = deal?.amount || 0;
confirmedJobs.push({ ..., dealValue: dealAmount });
```

**After:**
```ts
const aggregates = groupConstructionJobsByDeal(constructionJobs);
for (const agg of aggregates) {
  const dealAmount = dealMap.get(agg.dealId)?.amount ?? 0;
  const perJobValue = allocateDealValueAcrossJobs(dealAmount, agg.jobs.length);
  for (const job of agg.jobs) {
    confirmedJobs.push({ ..., dealValue: perJobValue, totalDealValue: dealAmount });
  }
}
```

The legacy D&R block stays as-is (D&R isn't being split). Service Visit and other categories are untouched.

### 4. Schedule Optimizer refactor (`lib/schedule-optimizer.ts`)

Group by `hubspotDealId` before running the optimizer's existing per-project loop. The loop body operates on aggregates instead of individual jobs:

- `locationDayCount` increments once per aggregate per business day, not once per sub-job.
- Crew assignment runs once per aggregate (the rotation index advances by 1, not by 3).
- `BookedSlot` records continue to be one-per-aggregate (not one-per-sub-job) — the existing schema doesn't need changing.

If a deal has multiple sub-jobs but only one has `scheduled_start_time` set (edge case during rollout), the aggregate uses the available date and counts as one unit.

### 5. Google Calendar consolidation (`lib/google-calendar.ts`)

Event ID stays `SHA1("install:${dealId}")` — already keyed on dealId, not jobId. The change:

- Event title becomes `"Install — ${dealName} (${systemTypes.join(", ")})"` (e.g., "Install — Smith Residence (Solar, Battery)").
- Event description lists each sub-job with its assigned crew.
- The function signature changes from `(jobId, ...)` to `(aggregate: DealConstructionAggregate, ...)`.

Callers that previously passed individual jobs now pass the aggregate. Migration: the calendar update path runs after grouping, so each aggregate fires exactly one `upsertInstallationCalendarEvent` call.

### 6. New cron: `/api/cron/stamp-construction-complete`

Daily cron (cadence: every 4 hours during business days) that:

1. Pulls all `ZuperJobCache` rows where `category_uid ∈ CONSTRUCTION_CATEGORY_UIDS` AND `hubspotDealId IS NOT NULL` AND `lastSyncedAt > now - 7d`.
2. Calls `groupConstructionJobsByDeal()`.
3. For each aggregate where `isFullyComplete === true` AND the deal's HubSpot `construction_complete_date` is unset (or older than `aggregate.completedAt`):
   - Update the HubSpot deal property `construction_complete_date` to `aggregate.completedAt`.
   - Log via `ActivityLog` with `ActivityType.HUBSPOT_DEAL_UPDATED`.
4. Idempotent — re-running produces no duplicate updates because we compare against the existing HubSpot value.

Cron is registered in `vercel.json` and protected by the existing cron auth pattern.

### 7. Construction Metrics dashboard (`dashboards/construction-metrics/page.tsx`)

The "X jobs in construction" headline becomes "X properties in construction." The underlying query goes through `groupConstructionJobsByDeal()` and counts aggregates.

Drill-down table shows one row per aggregate with sub-job badges (Solar / Battery / EV) and combined duration (earliestStart → latestEnd). Per-system filtering becomes available as a side filter for crew managers who want to see "all solar work in flight."

`avgConstructionDays` is computed from the aggregate's `latestEnd - earliestStart`, not from individual sub-job durations.

### 8. `ZuperJobCache` query audit

Files containing `findFirst` against `ZuperJobCache` filtered by `hubspotDealId`:

- `src/app/api/deals/[dealId]/photos/route.ts:29` — review and convert to `findMany` if photos from multiple sub-jobs should aggregate.
- `src/lib/customer-resolver.ts` — already uses `findMany`; no change.
- `src/lib/service-contact-signals.ts` — review for service jobs (out of scope) but check construction filtering.

The audit is mechanical: any caller that semantically wanted "*the* construction job" needs to either pick deterministically (e.g., earliest start) or aggregate (sum, union, etc.). The helper module's `groupConstructionJobsByDeal` is the canonical answer.

### 9. Feature flag

`CONSTRUCTION_JOB_SPLIT_ENABLED` env var, default `true`. Off-switch behavior:

- `CONSTRUCTION_CATEGORY_UIDS` collapses to `[CONSTRUCTION]` only (legacy behavior).
- The completion-stamping cron skips deals with new categories.

The flag exists for **safe rollback**, not for opt-in adoption. We expect to ship enabled. If catastrophic, we flip it off without redeploying.

## Data Flow Examples

### Example 1: Solar + Battery deal scheduled for May 12–13

```
HubSpot workflow creates 2 Zuper jobs (Solar Install, Battery Install)
  → both linked to dealId=12345
  → both scheduled May 12–13
  → assigned to different crews (solar crew A, battery crew B)
ZuperJobCache sync pulls both rows
  → CONSTRUCTION_CATEGORY_UIDS contains both new category UIDs
Revenue Calendar
  → groupConstructionJobsByDeal() returns 1 aggregate with 2 jobs
  → deal value $80k → $40k per job (equal split)
  → calendar shows $40k Solar + $40k Battery on May 12 and May 13
Schedule Optimizer
  → 1 capacity unit consumed at the deal's location for May 12–13
  → crew rotation advances by 1, not 2
Google Calendar
  → 1 event "Install — Smith Residence (Solar, Battery)" on May 12–13
  → description lists both crews
Completion (May 14)
  → both sub-jobs marked Completed in Zuper
  → ZuperJobCache.completedDate populated for both
  → cron runs at 9 AM May 15
  → aggregate.isFullyComplete = true, completedAt = May 14
  → HubSpot construction_complete_date stamped to May 14
  → HubSpot CC invoice trigger fires (existing logic, unchanged)
```

### Example 2: Solar-only legacy deal mid-rollout

```
HubSpot workflow created the legacy Construction job before rollout
  → category = CONSTRUCTION (legacy UID)
ZuperJobCache contains 1 row for the deal
  → still in CONSTRUCTION_CATEGORY_UIDS (legacy preserved)
groupConstructionJobsByDeal returns 1 aggregate with 1 job
  → behaves identically to pre-rollout
Revenue split is 100% (1 job)
Optimizer counts 1 capacity unit
Calendar fires 1 event
Completion stamps once
```

## Migration / Rollout

1. **Pre-deploy:** add three env vars (`ZUPER_CATEGORY_SOLAR_INSTALL`, `..._BATTERY_INSTALL`, `..._EV_INSTALL`) to Vercel production with the actual Zuper category UIDs. Verify with `vercel env pull`.
2. **Deploy code** with `CONSTRUCTION_JOB_SPLIT_ENABLED=true`.
3. **Smoke test** via the Construction Metrics dashboard: verify in-flight legacy deals still appear with one row, no double-counting.
4. **HubSpot workflow flip:** ops team enables the new workflow that creates split jobs. New deals start producing 2–3 Zuper jobs.
5. **Monitor** for 7 days:
   - Sentry breadcrumbs for `groupConstructionJobsByDeal` no-dealId drops.
   - Revenue Calendar totals match expected (compare against HubSpot deal sum for the month).
   - Cron logs in Vercel for stamping job — verify no duplicate stamps.
6. **Retire legacy `Construction` category** once all in-flight legacy jobs are completed (likely 60–90 days post-cutover). At that point, drop `CONSTRUCTION` from `CONSTRUCTION_CATEGORY_UIDS`.

## Testing Strategy

**Unit tests** (`__tests__/zuper-construction.test.ts`):
- `groupConstructionJobsByDeal` with 0, 1, 2, 3 jobs per deal.
- Mixed legacy + new categories on same deal (defensive — shouldn't happen but shouldn't crash).
- Jobs with `hubspotDealId === null` get dropped.
- `allocateDealValueAcrossJobs(0, ...)` → 0 (no division by zero).
- `getDealCompletionStatus` for fully-complete, partial, not-started.

**Integration tests:**
- Revenue Calendar API returns expected totals for fixtures with split deals.
- Cron endpoint stamps `construction_complete_date` exactly once per fully-complete deal.

**Manual QA:**
- Schedule Optimizer dry-run on production data: verify capacity counts decrease for current-month deals (one count per deal, not per job).
- Google Calendar: verify exactly one event per deal in the install calendar.
- Construction Metrics dashboard: verify count matches HubSpot deal stage filter for "in construction."

## Out of Scope

- BOM line-item-based revenue allocation — deferred; equal split sufficient for v1.
- Per-crew-type capacity in optimizer — deferred; one-deal-one-slot is the agreed model.
- Backfill of existing in-flight `Construction` jobs into new categories — hard cutover only.
- Service / D&R / Roofing job category changes — only Construction is splitting.
- UI for PMs to override the equal-split allocation — deferred until requested.

## Open Questions

None at design time. Implementation may surface additional callers of `findFirst({ where: { hubspotDealId } })` that need conversion; those are mechanical fixes during the audit pass.

## Risks

| Risk | Mitigation |
|---|---|
| Revenue Calendar miscounts during transition window | Feature flag off-switch; smoke test before HubSpot workflow flip |
| Cron stamps wrong date for a deal with manually-completed sub-jobs | Compare against existing HubSpot value before overwriting; idempotent re-run |
| Optimizer over-schedules if grouping fails | Defensive logging in `groupConstructionJobsByDeal`; aggregate count must match input job count minus null-dealId drops |
| Calendar event title gets too long with 3 systems | Truncate at 80 chars; fall back to "Install — {dealName}" if needed |
| In-flight legacy jobs lose construction_complete_date stamping | Cron treats legacy `CONSTRUCTION` as a 1-job aggregate — same code path |

## References

- Existing D&R 50/50 logic: `src/app/api/zuper/revenue-calendar/route.ts:471-501`
- ZuperJobCache schema: `prisma/schema.prisma:572`
- HubSpot CC invoice trigger reference: memory `reference_payment_milestone_triggers.md`
- Schedule optimizer: `src/lib/schedule-optimizer.ts`
