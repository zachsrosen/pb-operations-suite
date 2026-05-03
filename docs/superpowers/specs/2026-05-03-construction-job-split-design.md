# Construction Job Split: Solar / Battery / EV — Design

**Status:** Draft
**Author:** Zach (with Claude)
**Date:** 2026-05-03

## Background

Photon Brothers is splitting the single Zuper "Construction" job per deal into up to three Zuper jobs — Construction - Solar, Construction - Battery, Construction - EV — created conditionally based on what the deal includes. A solar-only deal gets one job; a solar+battery+EV deal gets three.

The split is operationally driven: different crews handle each system type, with independent assignments in Zuper. Operationally, all sub-jobs for one deal are still scheduled for the same calendar date(s) at the same property — the deal is the unit of scheduling, the sub-jobs are units of work tracking and crew assignment.

A HubSpot workflow already creates the new Zuper jobs at the appropriate deal stage. **The codebase only needs to react to the new shape, not produce it.**

## Problem

Multiple subsystems assume one construction Zuper job per deal. Without changes, the split produces silent data corruption in production:

- **Revenue Calendar** (`/api/zuper/revenue-calendar`): each sub-job is linked to the same HubSpot deal and inherits the full deal amount, so a 3-system deal triple-counts revenue.
- **Schedule Optimizer** (`lib/schedule-optimizer.ts`): each sub-job consumes one location capacity slot, so a single property can appear to exceed Westminster's daily capacity (=2) on its own.
- **Google Calendar** (`lib/google-calendar.ts`): event ID is `SHA1("install:${projectId}")` — three sub-jobs either overwrite each other or produce three separate events for the same property.
- **Construction Metrics dashboard**: "X jobs in construction" inflates 1.5–3× because the count is per-job, not per-deal.
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
| `construction_complete_date` stamping | **Out of scope** — handled by existing HubSpot workflows |
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
  └─ allocateDealValueAcrossJobs(amount, jobCount)
                          │
                          ▼
Consumers
  ├─ api/zuper/revenue-calendar/route.ts        → equal-split per aggregate
  ├─ lib/schedule-optimizer.ts                  → 1 capacity unit per aggregate
  ├─ lib/google-calendar.ts                     → 1 calendar event per deal
  └─ dashboards/construction-metrics/page.tsx   → counts by deal, not by job
```

## Component Design

### 1. Zuper category configuration (`lib/zuper.ts`)

**Important context:** the codebase distinguishes two representations:

- **`JOB_CATEGORY_UIDS`** — Zuper API UIDs (hardcoded constants today, e.g. `"f3...c0d"`). The Zuper API returns these on `job.job_category`.
- **`JOB_CATEGORIES`** — human-readable names ("Construction", "Site Survey"). `ZuperJobCache.jobCategory` stores the **name**, not the UID — `zuper-sync.ts:216` calls `resolveCategory(job.job_category)` to convert UID → name before persisting.

Both representations need new entries:

```ts
export const JOB_CATEGORY_UIDS = {
  SITE_SURVEY: "...",                                                 // existing
  CONSTRUCTION: "...",                                                // legacy, retained
  SOLAR_INSTALL: process.env.ZUPER_CATEGORY_SOLAR_INSTALL ?? "",       // new (env-driven)
  BATTERY_INSTALL: process.env.ZUPER_CATEGORY_BATTERY_INSTALL ?? "",   // new (env-driven)
  EV_INSTALL: process.env.ZUPER_CATEGORY_EV_INSTALL ?? "",             // new (env-driven)
  // ...remaining entries unchanged
};

export const JOB_CATEGORIES = {
  CONSTRUCTION: "Construction",         // legacy
  SOLAR_INSTALL: "Construction - Solar",       // new — exact spelling matches Zuper category name
  BATTERY_INSTALL: "Construction - Battery",   // new
  EV_INSTALL: "Construction - EV",             // new
  // ...existing entries unchanged
};

export const CONSTRUCTION_CATEGORY_UIDS = [
  JOB_CATEGORY_UIDS.CONSTRUCTION,
  JOB_CATEGORY_UIDS.SOLAR_INSTALL,
  JOB_CATEGORY_UIDS.BATTERY_INSTALL,
  JOB_CATEGORY_UIDS.EV_INSTALL,
].filter(Boolean);

export const CONSTRUCTION_CATEGORY_NAMES = [
  JOB_CATEGORIES.CONSTRUCTION,
  JOB_CATEGORIES.SOLAR_INSTALL,
  JOB_CATEGORIES.BATTERY_INSTALL,
  JOB_CATEGORIES.EV_INSTALL,
];
```

The exact display names ("Construction - Solar", "Construction - Battery", "Construction - EV") must match what the Zuper categories were created with — confirm with ops before merging. `resolveCategory` in `zuper-sync.ts` already handles the UID→name lookup; adding the three entries to `JOB_CATEGORIES` plumbs them through automatically.

The `.filter(Boolean)` guard means the UID union shrinks gracefully if env vars are unset (e.g., in tests or before Zuper categories exist in dev).

### 2. New helper module (`lib/zuper-construction.ts`)

The helper exposes both UID-aware and name-aware predicates so callers can use whichever representation matches their data:

```ts
import type { ZuperJobCache } from "@/generated/prisma/client";
import {
  CONSTRUCTION_CATEGORY_UIDS,
  CONSTRUCTION_CATEGORY_NAMES,
  JOB_CATEGORIES,
  JOB_CATEGORY_UIDS,
} from "./zuper";

export type SystemType = "solar" | "battery" | "ev" | "legacy";

export type DealConstructionAggregate = {
  dealId: string;
  jobs: ZuperJobCache[];
  systemTypes: SystemType[];
  earliestStart: Date | null;
  latestEnd: Date | null;
  assignedCrewsByType: Partial<Record<SystemType, string[]>>;
};

/** True if a Zuper category UID counts as construction work. Use for raw API responses. */
export function isConstructionCategoryUid(uid: string | null | undefined): boolean;

/** True if a category display name counts as construction. Use for ZuperJobCache.jobCategory. */
export function isConstructionCategoryName(name: string | null | undefined): boolean;

/** Map a UID OR name to the system type. Accepts either representation. */
export function categoryToSystemType(uidOrName: string): SystemType;

/** Group cache rows by dealId. Skips jobs without a dealId (logs Sentry breadcrumb). */
export function groupConstructionJobsByDeal(jobs: ZuperJobCache[]): DealConstructionAggregate[];

/** Equal-split a deal value across its sub-jobs. Returns 0 for jobCount=0. */
export function allocateDealValueAcrossJobs(dealAmount: number, jobCount: number): number;
```

**Pure functions, no I/O.** Tests target this module directly with crafted `ZuperJobCache[]` fixtures.

Edge cases:
- A job with `hubspotDealId === null` is dropped from grouping output (logged via Sentry breadcrumb, not error).
- A deal with one job behaves identically to today's single-job pattern (backwards-compatible).
- The aggregate exposes `earliestStart`, `latestEnd`, and per-job completion data for consumers that want it (e.g., the metrics dashboard's combined duration calculation), but the helper does NOT itself compute or stamp `construction_complete_date` — that remains owned by existing HubSpot workflows.
- A deal with sub-jobs scheduled on **mismatched windows** (e.g. Solar May 12, Battery May 14) is permitted — `earliestStart`/`latestEnd` span the full range. Operationally this should not happen (the deal is the scheduling unit), but the helper does not reject it. A Sentry breadcrumb is emitted when the gap exceeds 2 business days as an early warning of a data quality issue.

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

**Scope:** grouping applies *only* to construction-category jobs (UIDs in `CONSTRUCTION_CATEGORY_UIDS`). Non-construction work — D&R Detach/Reset, Service Visit, Inspection, Site Survey — flows through the optimizer unchanged, one entry per job.

For construction work specifically:
- Group input by `hubspotDealId` via `groupConstructionJobsByDeal()` before the per-project optimization loop.
- The loop body operates on aggregates instead of individual jobs.
- `locationDayCount` increments once per aggregate per business day, not once per sub-job.
- Crew assignment runs once per aggregate (the rotation index advances by 1, not by N). Crew rotation tracks the deal, not individual sub-jobs.
- `BookedSlot` records remain one-per-aggregate (not one-per-sub-job) — schema unchanged.

The aggregate's date window is `[earliestStart, latestEnd]` (inclusive). For sub-jobs co-scheduled on identical days (the expected case), this collapses to the same single window. For mismatched windows (data quality issue), the optimizer treats the full span as occupied — which is conservative but correct for capacity planning.

If a deal has multiple sub-jobs but only one has `scheduled_start_time` set (edge case during rollout), the aggregate uses the available date and counts as one unit.

### 5. Google Calendar consolidation (`lib/google-calendar.ts`)

Event ID stays `SHA1("install:${projectId}")` — already keyed on dealId/projectId at line 745, not jobId. Required changes:

- Event title becomes `"Install — ${dealName} (${systemTypes.join(", ")})"` (e.g., "Install — Smith Residence (Solar, Battery)"). Truncate at 80 chars; fall back to `"Install — ${dealName}"` if needed.
- Event description lists each sub-job with its assigned crew.
- The function signature changes from `(projectId, ...)` to `(aggregate: DealConstructionAggregate, ...)`.

**No transitional period.** All callers of `upsertInstallationCalendarEvent` are updated to pass aggregates in the same PR. There is no shim that accepts both old and new signatures. The audit pass in section 8 enumerates these callers.

### 6. Construction Metrics dashboard (`dashboards/construction-metrics/page.tsx`)

The "X jobs in construction" headline becomes "X properties in construction." The underlying query goes through `groupConstructionJobsByDeal()` and counts aggregates.

Drill-down table shows one row per aggregate with sub-job badges (Solar / Battery / EV) and combined duration (earliestStart → latestEnd). Per-system filtering becomes available as a side filter for crew managers who want to see "all solar work in flight."

`avgConstructionDays` is computed from the aggregate's `latestEnd - earliestStart`, not from individual sub-job durations.

### 7. Call site audit — full enumeration

The grep pass identified the following construction-aware call sites. Each is in scope for this change.

**`JOB_CATEGORY_UIDS.CONSTRUCTION` references (UID-based filtering — must accept full union):**

- `src/app/api/zuper/jobs/lookup/route.ts:43-45,72,599` — installation→Construction mapping for job lookup. Accept all four categories; map "installation" type to all of them when searching.
- `src/app/api/zuper/jobs/schedule/route.ts:267,274,535,1267` — installation→Construction at job-creation paths. **Note:** if HubSpot workflow now creates jobs, audit whether these UI scheduling paths still create jobs. If they do, decide which sub-category is created (likely Construction - Solar as the default). If they don't, mark dead and remove.
- `src/app/api/zuper/jobs/schedule/confirm/route.ts:46,53` — same as above; same decision applies.
- `src/app/api/zuper/availability/route.ts:385-386` — `installation: JOB_CATEGORY_UIDS.CONSTRUCTION` mapping for capacity availability. Expand to accept all four UIDs.
- `src/app/api/zuper/assisted-scheduling/route.ts:40` — same mapping; same fix.
- `src/app/api/zuper/status-comparison/route.ts:599,734,1020` — three references for fetching + status mapping. Will undercount split deals if not expanded. Apply union and group by deal.
- `src/app/api/zuper/revenue-calendar/route.ts:18` — `REVENUE_CATEGORIES` array entry. Add three new entries (Construction - Solar, Construction - Battery, Construction - EV) all mapped to the `"construction"` `key` so they aggregate together for revenue-by-category rollups, but the per-job allocation uses the helper.

**`JOB_CATEGORIES.CONSTRUCTION` (display-name) references:**

- `src/app/api/zuper/jobs/lookup/route.ts:43,44,599` — name-based matching; accept all four display names.
- `src/lib/compliance-v2/scoring.ts:37` — `CATEGORY_NAME_TO_UID` map. Add three entries.
- `src/lib/compliance-compute.ts:111` — same `CATEGORY_NAME_TO_UID` pattern. Add three entries.

**Schema/storage references:**

- `prisma/schema.prisma:572` — `ZuperJobCache.jobCategory` stores the display name (no schema change required; new names just appear once `resolveCategory` learns them).

**`ZuperJobCache.findFirst({ where: { hubspotDealId } })` semantics:**

- `src/app/api/deals/[dealId]/photos/route.ts:29` — convert to `findMany` and aggregate photos across sub-jobs; otherwise photos from Battery/EV jobs are silently dropped.
- `src/lib/customer-resolver.ts` — already uses `findMany`; verify it surfaces all sub-jobs in customer detail view.
- `src/lib/service-contact-signals.ts` — review whether construction sub-jobs are read; if so, switch to `findMany` and use first/most-recent per system type.
- `src/lib/schedule-event-log.ts` — review for construction jobs; should pass through unchanged if just logging.

**Downstream consumers — unchanged-by-design (noted for clarity, not modified):**

- `src/lib/office-performance.ts` — reads HubSpot `construction_complete_date` directly (not Zuper jobs). Existing HubSpot workflows continue to set this field; this spec does not change that.
- `src/lib/payment-tracking.ts` — same; reads HubSpot deal property only.
- `src/lib/forecast-ghosts.ts` — operates on HubSpot deals, not Zuper jobs.
- `src/lib/property-sync.ts` — reads HubSpot `construction_complete_date` for property rollups.

**UI labels / static strings (no code change needed unless we want to relabel):**

The grep pass found ~15 places where the literal string `"Construction"` appears as a UI label, suite section heading, or stage display name (e.g., `src/app/dashboards/scheduler/page.tsx:432`, `src/app/dashboards/qc/page.tsx:17`). These reflect the HubSpot deal **stage**, not the Zuper job category, and remain accurate — a deal is still in the "Construction" stage regardless of how many Zuper sub-jobs exist for it. **No change** to these strings.

### 8. Compliance scoring impact (`lib/compliance-v2/scoring.ts`, `lib/compliance-compute.ts`)

Both files maintain a `CATEGORY_NAME_TO_UID` map used by status comparison and Zuper compliance scoring. Each map needs three new entries:

```ts
"Construction - Solar": JOB_CATEGORY_UIDS.SOLAR_INSTALL,
"Construction - Battery": JOB_CATEGORY_UIDS.BATTERY_INSTALL,
"Construction - EV": JOB_CATEGORY_UIDS.EV_INSTALL,
```

Compliance scoring is per-job today. Decision: it stays per-job — a battery install with a stuck status is its own compliance signal independent of the solar install at the same property. If ops later wants deal-level compliance rollup, that's a follow-up spec.

### 9. Feature flag

`CONSTRUCTION_JOB_SPLIT_ENABLED` env var, default `true`. Off-switch behavior:

- `CONSTRUCTION_CATEGORY_UIDS` and `CONSTRUCTION_CATEGORY_NAMES` collapse to legacy-only (`CONSTRUCTION` UID and `"Construction"` name).
- The helper module's predicates return `false` for the new UIDs/names.

The flag exists for **safe rollback**, not for opt-in adoption. We expect to ship enabled. During the legacy-only window (before ops flips the HubSpot workflow), the flag's `true` state is harmless because no split jobs exist yet — the helper sees only single-job aggregates and behaves identically to the pre-rollout code path. If a catastrophic issue surfaces post-flip, we set the flag to `false` in Vercel without redeploying.

## Data Flow Examples

### Example 1: Solar + Battery deal scheduled for May 12–13

```
HubSpot workflow creates 2 Zuper jobs (Construction - Solar, Construction - Battery)
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
  → existing HubSpot workflows (out of this spec's scope) handle
    construction_complete_date stamping and CC invoice trigger
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
Existing HubSpot workflows handle construction_complete_date as today
```

## Migration / Rollout

1. **Pre-deploy:** add three env vars (`ZUPER_CATEGORY_SOLAR_INSTALL`, `..._BATTERY_INSTALL`, `..._EV_INSTALL`) to Vercel production with the actual Zuper category UIDs. Verify with `vercel env pull`.
2. **Deploy code** with `CONSTRUCTION_JOB_SPLIT_ENABLED=true`.
3. **Smoke test** via the Construction Metrics dashboard: verify in-flight legacy deals still appear with one row, no double-counting.
4. **HubSpot workflow flip:** ops team enables the new workflow that creates split jobs. New deals start producing 2–3 Zuper jobs.
5. **Monitor** for 7 days:
   - Sentry breadcrumbs for `groupConstructionJobsByDeal` no-dealId drops.
   - Revenue Calendar totals match expected (compare against HubSpot deal sum for the month).
   - Spot-check the install Google Calendar to confirm one event per deal.
6. **Retire legacy `Construction` category** once all in-flight legacy jobs are completed (likely 60–90 days post-cutover). At that point, drop `CONSTRUCTION` from `CONSTRUCTION_CATEGORY_UIDS` and `CONSTRUCTION_CATEGORY_NAMES`.

## Testing Strategy

**Unit tests** (`__tests__/zuper-construction.test.ts`):
- `groupConstructionJobsByDeal` with 0, 1, 2, 3 jobs per deal.
- Mixed legacy + new categories on same deal (defensive — shouldn't happen but shouldn't crash).
- Jobs with `hubspotDealId === null` get dropped.
- `allocateDealValueAcrossJobs(0, ...)` → 0 (no division by zero).
- `isConstructionCategoryUid` and `isConstructionCategoryName` recognize all four UIDs/names.

**Integration tests:**
- Revenue Calendar API returns expected totals for fixtures with split deals (verify equal split mathematics).

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
- **HubSpot `construction_complete_date` stamping** — handled by existing HubSpot workflows; this spec does not modify or replace those workflows.

## Open Questions

None at design time. Implementation may surface additional callers of `findFirst({ where: { hubspotDealId } })` that need conversion; those are mechanical fixes during the audit pass.

## Risks

| Risk | Mitigation |
|---|---|
| Revenue Calendar miscounts during transition window | Feature flag off-switch; smoke test before HubSpot workflow flip |
| Optimizer over-schedules if grouping fails | Defensive logging in `groupConstructionJobsByDeal`; aggregate count must match input job count minus null-dealId drops |
| Calendar event title gets too long with 3 systems | Truncate at 80 chars; fall back to "Install — {dealName}" if needed |
| HubSpot workflow expecting old "Construction" category breaks once new categories are used | Out of scope here — handled by ops/HubSpot admin when the workflow is flipped. Spec assumes HubSpot side already handles all four categories. |

## References

- Existing D&R 50/50 logic: `src/app/api/zuper/revenue-calendar/route.ts:471-501`
- ZuperJobCache schema: `prisma/schema.prisma:572`
- Schedule optimizer: `src/lib/schedule-optimizer.ts`
