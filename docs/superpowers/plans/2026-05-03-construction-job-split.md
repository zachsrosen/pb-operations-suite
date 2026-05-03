# Construction Job Split (Solar / Battery / EV) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the codebase correctly handle the new Zuper job split where one HubSpot deal can have 1–3 construction sub-jobs (`Construction - Solar`, `Construction - Battery`, `Construction - EV`) instead of one `Construction` job.

**Architecture:** Add three new Zuper category UIDs and display names. Centralize "construction work spanning multiple categories" in a new pure-function helper module (`lib/zuper-construction.ts`). Refactor the four call sites with real data corruption risk (Revenue Calendar, Google Calendar, photos endpoint, status comparison) plus mechanical updates to category-mapping call sites (lookup, availability, scheduling, compliance maps). A feature flag enables one-step rollback.

**Tech Stack:** Next.js 16.1, TypeScript 5, Jest (existing test config), Prisma 7.3, no schema changes.

**Spec:** `docs/superpowers/specs/2026-05-03-construction-job-split-design.md`

---

## Pre-flight Checks

- [ ] **Step 0a: Confirm spec is committed and up to date**

```bash
git log -1 --format='%h %s' -- docs/superpowers/specs/2026-05-03-construction-job-split-design.md
```

Expected: shows recent commit referencing the spec.

- [ ] **Step 0b: Confirm test framework is ready**

```bash
npm run test -- --listTests --findRelatedTests src/lib/calendar-events.ts 2>&1 | head -5
```

Expected: lists at least `calendar-events.test.ts`. Confirms Jest is wired up.

- [ ] **Step 0c: Identify the actual Zuper category UIDs from ops**

Before any code: get the three new Zuper category UIDs (the long hex strings like `f3a9c0d1-...`) from the ops team or by inspecting Zuper directly. Record them in this file's notes section. Do NOT proceed to Task 4 (env var setup) without these values.

```
Notes (fill in before Task 4):
ZUPER_CATEGORY_SOLAR_INSTALL   = ___________
ZUPER_CATEGORY_BATTERY_INSTALL = ___________
ZUPER_CATEGORY_EV_INSTALL      = ___________
```

---

## File Structure

```
NEW:
  src/lib/zuper-construction.ts                     # helper module (pure functions)
  src/__tests__/zuper-construction.test.ts          # unit tests for helpers

MODIFY:
  src/lib/zuper.ts                                   # add 3 UIDs, 3 names, 2 union arrays, feature flag
  src/app/api/zuper/revenue-calendar/route.ts        # equal-split per aggregate (real bug fix)
  src/lib/google-calendar.ts                         # event title/desc per aggregate
  src/app/api/deals/[dealId]/photos/route.ts         # findFirst → findMany (real bug fix)
  src/app/api/zuper/status-comparison/route.ts       # union of 4 categories (real bug fix)
  src/app/api/zuper/jobs/lookup/route.ts             # union for "installation" type
  src/app/api/zuper/availability/route.ts            # union for installation→categories
  src/app/api/zuper/assisted-scheduling/route.ts     # union for installation→categories
  src/app/api/zuper/jobs/schedule/route.ts           # decide default sub-category (or mark dead)
  src/app/api/zuper/jobs/schedule/confirm/route.ts   # same as above
  src/lib/compliance-v2/scoring.ts                   # add 3 entries to CATEGORY_NAME_TO_UID
  src/lib/compliance-compute.ts                      # add 3 entries to CATEGORY_NAME_TO_UID

NO CHANGE (verified during prep):
  src/lib/schedule-optimizer.ts                      # already deal-level
  src/app/dashboards/construction-metrics/page.tsx   # data is HubSpot-deal-driven
  src/app/api/hubspot/qc-metrics/route.ts            # data is HubSpot-deal-driven
```

---

## Task 1: Add Zuper category constants and feature flag

**Files:**
- Modify: `src/lib/zuper.ts` (around lines 230–265 where `JOB_CATEGORY_UIDS` and `JOB_CATEGORIES` live)

**Why first:** every other task depends on these constants existing. They are deliberately `.filter(Boolean)`-guarded so the system stays functional even if the env vars aren't set yet (e.g., on a dev machine).

- [ ] **Step 1.1: Read the existing `JOB_CATEGORY_UIDS` block**

```bash
sed -n '225,265p' src/lib/zuper.ts
```

Confirm the structure matches the spec's assumption (a `const` object literal).

- [ ] **Step 1.2: Add the three new UIDs to `JOB_CATEGORY_UIDS`**

Locate `JOB_CATEGORY_UIDS = { ... }` (around line 230). Add three entries directly after `CONSTRUCTION` (alphabetical or grouped — match local style). Each is `process.env`-driven with `??""` fallback.

```ts
SOLAR_INSTALL: process.env.ZUPER_CATEGORY_SOLAR_INSTALL ?? "",
BATTERY_INSTALL: process.env.ZUPER_CATEGORY_BATTERY_INSTALL ?? "",
EV_INSTALL: process.env.ZUPER_CATEGORY_EV_INSTALL ?? "",
```

- [ ] **Step 1.3: Add the three new display names to `JOB_CATEGORIES`**

In the `JOB_CATEGORIES` const (line 250 area), add:

```ts
SOLAR_INSTALL: "Construction - Solar",
BATTERY_INSTALL: "Construction - Battery",
EV_INSTALL: "Construction - EV",
```

**Important:** the strings must match Zuper exactly. Verify with ops if unsure.

- [ ] **Step 1.4: Add the feature flag and union arrays at the end of the constants block**

After the existing `JOB_CATEGORIES = { ... }` const, add:

```ts
/**
 * Feature flag: when true, the codebase treats all four construction-category
 * UIDs/names as construction work. When false, only the legacy CONSTRUCTION
 * category counts (rollback path).
 *
 * Default true. Flip to "false" in Vercel env to roll back without redeploying.
 */
export const CONSTRUCTION_JOB_SPLIT_ENABLED =
  process.env.CONSTRUCTION_JOB_SPLIT_ENABLED !== "false";

/** All Zuper category UIDs that count as construction work. Honors the feature flag. */
export const CONSTRUCTION_CATEGORY_UIDS: readonly string[] = CONSTRUCTION_JOB_SPLIT_ENABLED
  ? [
      JOB_CATEGORY_UIDS.CONSTRUCTION,
      JOB_CATEGORY_UIDS.SOLAR_INSTALL,
      JOB_CATEGORY_UIDS.BATTERY_INSTALL,
      JOB_CATEGORY_UIDS.EV_INSTALL,
    ].filter((uid): uid is string => Boolean(uid))
  : [JOB_CATEGORY_UIDS.CONSTRUCTION].filter((uid): uid is string => Boolean(uid));

/** All display names that count as construction work. Honors the feature flag. */
export const CONSTRUCTION_CATEGORY_NAMES: readonly string[] = CONSTRUCTION_JOB_SPLIT_ENABLED
  ? [
      JOB_CATEGORIES.CONSTRUCTION,
      JOB_CATEGORIES.SOLAR_INSTALL,
      JOB_CATEGORIES.BATTERY_INSTALL,
      JOB_CATEGORIES.EV_INSTALL,
    ]
  : [JOB_CATEGORIES.CONSTRUCTION];
```

- [ ] **Step 1.5: Run lint + typecheck on the modified file**

```bash
npx eslint src/lib/zuper.ts
```

Expected: no errors (or only pre-existing ones unrelated to your change).

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/lib/zuper.ts" | head -10
```

Expected: no errors on `zuper.ts` lines you modified.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/zuper.ts
git commit -m "$(cat <<'EOF'
feat(zuper): add Solar/Battery/EV construction category constants

Adds three new Zuper categories (Construction - Solar/Battery/EV)
to JOB_CATEGORY_UIDS and JOB_CATEGORIES. Adds union arrays
CONSTRUCTION_CATEGORY_UIDS and CONSTRUCTION_CATEGORY_NAMES that
honor a CONSTRUCTION_JOB_SPLIT_ENABLED feature flag for rollback.

Spec: docs/superpowers/specs/2026-05-03-construction-job-split-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create the helper module — start with tests

**Files:**
- Create: `src/__tests__/zuper-construction.test.ts`
- Create (after tests fail): `src/lib/zuper-construction.ts`

**Why TDD here:** the helper is pure, the inputs are well-defined Prisma types, and the splitting/grouping logic is exactly the kind of thing that gets edge-cases wrong. Tests first.

- [ ] **Step 2.1: Read the ZuperJobCache shape so test fixtures match reality**

```bash
sed -n '550,610p' prisma/schema.prisma
```

Note required fields: `id`, `jobUid`, `jobTitle`, `jobCategory`, `jobStatus`, plus `lastSyncedAt`, `createdAt`, `updatedAt` (auto-set). `hubspotDealId` is the optional join key.

- [ ] **Step 2.2: Look at an existing test file for style**

```bash
sed -n '1,40p' src/__tests__/calendar-events.test.ts
```

Match its import style and `describe`/`it` patterns.

- [ ] **Step 2.3: Write `src/__tests__/zuper-construction.test.ts` with the failing tests**

Create the file with this content (verbatim):

```ts
import type { ZuperJobCache } from "@/generated/prisma/client";
import {
  isConstructionCategoryUid,
  isConstructionCategoryName,
  categoryToSystemType,
  groupConstructionJobsByDeal,
  allocateDealValueAcrossJobs,
} from "@/lib/zuper-construction";
import { JOB_CATEGORIES, JOB_CATEGORY_UIDS } from "@/lib/zuper";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<ZuperJobCache> = {}): ZuperJobCache {
  const now = new Date("2026-05-01T00:00:00Z");
  return {
    id: overrides.id ?? "cuid_" + Math.random().toString(36).slice(2),
    jobUid: overrides.jobUid ?? "job_" + Math.random().toString(36).slice(2),
    jobTitle: overrides.jobTitle ?? "Test Job",
    jobCategory: overrides.jobCategory ?? JOB_CATEGORIES.CONSTRUCTION,
    jobStatus: overrides.jobStatus ?? "SCHEDULED",
    jobPriority: overrides.jobPriority ?? null,
    scheduledStart: overrides.scheduledStart ?? null,
    scheduledEnd: overrides.scheduledEnd ?? null,
    completedDate: overrides.completedDate ?? null,
    assignedUsers: overrides.assignedUsers ?? null,
    assignedTeam: overrides.assignedTeam ?? null,
    customerAddress: overrides.customerAddress ?? null,
    hubspotDealId: overrides.hubspotDealId ?? "12345",
    projectName: overrides.projectName ?? null,
    jobTags: overrides.jobTags ?? [],
    jobNotes: overrides.jobNotes ?? null,
    lastSyncedAt: overrides.lastSyncedAt ?? now,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  } as ZuperJobCache;
}

// ---------------------------------------------------------------------------
// isConstructionCategoryUid
// ---------------------------------------------------------------------------

describe("isConstructionCategoryUid", () => {
  it("returns true for legacy CONSTRUCTION UID", () => {
    expect(isConstructionCategoryUid(JOB_CATEGORY_UIDS.CONSTRUCTION)).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isConstructionCategoryUid(null)).toBe(false);
    expect(isConstructionCategoryUid(undefined)).toBe(false);
    expect(isConstructionCategoryUid("")).toBe(false);
  });

  it("returns false for non-construction category (Site Survey)", () => {
    expect(isConstructionCategoryUid(JOB_CATEGORY_UIDS.SITE_SURVEY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isConstructionCategoryName
// ---------------------------------------------------------------------------

describe("isConstructionCategoryName", () => {
  it("returns true for legacy 'Construction' display name", () => {
    expect(isConstructionCategoryName("Construction")).toBe(true);
  });

  it("returns true for new split names", () => {
    expect(isConstructionCategoryName("Construction - Solar")).toBe(true);
    expect(isConstructionCategoryName("Construction - Battery")).toBe(true);
    expect(isConstructionCategoryName("Construction - EV")).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isConstructionCategoryName(null)).toBe(false);
    expect(isConstructionCategoryName(undefined)).toBe(false);
    expect(isConstructionCategoryName("")).toBe(false);
  });

  it("returns false for non-construction names", () => {
    expect(isConstructionCategoryName("Site Survey")).toBe(false);
    expect(isConstructionCategoryName("Inspection")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// categoryToSystemType
// ---------------------------------------------------------------------------

describe("categoryToSystemType", () => {
  it("maps display names to system types", () => {
    expect(categoryToSystemType("Construction")).toBe("legacy");
    expect(categoryToSystemType("Construction - Solar")).toBe("solar");
    expect(categoryToSystemType("Construction - Battery")).toBe("battery");
    expect(categoryToSystemType("Construction - EV")).toBe("ev");
  });

  it("returns 'legacy' for unknown values (defensive default)", () => {
    expect(categoryToSystemType("something else")).toBe("legacy");
    expect(categoryToSystemType("")).toBe("legacy");
  });
});

// ---------------------------------------------------------------------------
// groupConstructionJobsByDeal
// ---------------------------------------------------------------------------

describe("groupConstructionJobsByDeal", () => {
  it("returns empty array for empty input", () => {
    expect(groupConstructionJobsByDeal([])).toEqual([]);
  });

  it("groups two jobs with same dealId into one aggregate", () => {
    const jobs = [
      makeJob({ jobUid: "j1", hubspotDealId: "deal-1", jobCategory: "Construction - Solar" }),
      makeJob({ jobUid: "j2", hubspotDealId: "deal-1", jobCategory: "Construction - Battery" }),
    ];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(1);
    expect(result[0].dealId).toBe("deal-1");
    expect(result[0].jobs).toHaveLength(2);
    expect(result[0].systemTypes.sort()).toEqual(["battery", "solar"]);
  });

  it("returns separate aggregates for different dealIds", () => {
    const jobs = [
      makeJob({ jobUid: "j1", hubspotDealId: "deal-1", jobCategory: "Construction - Solar" }),
      makeJob({ jobUid: "j2", hubspotDealId: "deal-2", jobCategory: "Construction - Solar" }),
    ];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(2);
    const ids = result.map((a) => a.dealId).sort();
    expect(ids).toEqual(["deal-1", "deal-2"]);
  });

  it("drops jobs with null hubspotDealId", () => {
    const jobs = [
      makeJob({ jobUid: "j1", hubspotDealId: null }),
      makeJob({ jobUid: "j2", hubspotDealId: "deal-1" }),
    ];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(1);
    expect(result[0].dealId).toBe("deal-1");
  });

  it("computes earliestStart and latestEnd across sub-jobs", () => {
    const jobs = [
      makeJob({
        jobUid: "j1",
        hubspotDealId: "deal-1",
        scheduledStart: new Date("2026-05-12T08:00:00Z"),
        scheduledEnd: new Date("2026-05-13T17:00:00Z"),
      }),
      makeJob({
        jobUid: "j2",
        hubspotDealId: "deal-1",
        scheduledStart: new Date("2026-05-13T08:00:00Z"),
        scheduledEnd: new Date("2026-05-14T17:00:00Z"),
      }),
    ];

    const [agg] = groupConstructionJobsByDeal(jobs);

    expect(agg.earliestStart?.toISOString()).toBe("2026-05-12T08:00:00.000Z");
    expect(agg.latestEnd?.toISOString()).toBe("2026-05-14T17:00:00.000Z");
  });

  it("a single legacy CONSTRUCTION job behaves like a 1-job aggregate", () => {
    const jobs = [makeJob({ hubspotDealId: "deal-1", jobCategory: "Construction" })];

    const result = groupConstructionJobsByDeal(jobs);

    expect(result).toHaveLength(1);
    expect(result[0].systemTypes).toEqual(["legacy"]);
    expect(result[0].jobs).toHaveLength(1);
  });

  it("groups crews by system type", () => {
    const jobs = [
      makeJob({
        hubspotDealId: "deal-1",
        jobCategory: "Construction - Solar",
        assignedUsers: [{ user_uid: "u1", user_name: "Solar Steve" }],
      } as Partial<ZuperJobCache>),
      makeJob({
        hubspotDealId: "deal-1",
        jobCategory: "Construction - Battery",
        assignedUsers: [{ user_uid: "u2", user_name: "Battery Bob" }],
      } as Partial<ZuperJobCache>),
    ];

    const [agg] = groupConstructionJobsByDeal(jobs);

    expect(agg.assignedCrewsByType.solar).toEqual(["Solar Steve"]);
    expect(agg.assignedCrewsByType.battery).toEqual(["Battery Bob"]);
  });
});

// ---------------------------------------------------------------------------
// allocateDealValueAcrossJobs
// ---------------------------------------------------------------------------

describe("allocateDealValueAcrossJobs", () => {
  it("splits evenly across N jobs", () => {
    expect(allocateDealValueAcrossJobs(90000, 3)).toBe(30000);
    expect(allocateDealValueAcrossJobs(80000, 2)).toBe(40000);
    expect(allocateDealValueAcrossJobs(50000, 1)).toBe(50000);
  });

  it("returns 0 for jobCount=0 (avoids divide-by-zero)", () => {
    expect(allocateDealValueAcrossJobs(50000, 0)).toBe(0);
  });

  it("returns 0 when dealAmount is 0", () => {
    expect(allocateDealValueAcrossJobs(0, 3)).toBe(0);
  });

  it("handles non-evenly-divisible amounts (returns float)", () => {
    expect(allocateDealValueAcrossJobs(100, 3)).toBeCloseTo(33.333, 2);
  });
});
```

- [ ] **Step 2.4: Run the test file — expect failure**

```bash
npm run test -- --testPathPattern="zuper-construction" 2>&1 | tail -15
```

Expected: failures because `src/lib/zuper-construction.ts` does not exist yet (the import will fail).

- [ ] **Step 2.5: Create `src/lib/zuper-construction.ts`**

```ts
import type { ZuperJobCache } from "@/generated/prisma/client";
import * as Sentry from "@sentry/nextjs";
import {
  CONSTRUCTION_CATEGORY_NAMES,
  CONSTRUCTION_CATEGORY_UIDS,
  JOB_CATEGORIES,
  JOB_CATEGORY_UIDS,
} from "./zuper";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SystemType = "solar" | "battery" | "ev" | "legacy";

export type DealConstructionAggregate = {
  dealId: string;
  jobs: ZuperJobCache[];
  systemTypes: SystemType[];
  earliestStart: Date | null;
  latestEnd: Date | null;
  assignedCrewsByType: Partial<Record<SystemType, string[]>>;
};

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** True if a Zuper category UID counts as construction work. Use for raw API responses. */
export function isConstructionCategoryUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return CONSTRUCTION_CATEGORY_UIDS.includes(uid);
}

/** True if a category display name counts as construction. Use for ZuperJobCache.jobCategory. */
export function isConstructionCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  return CONSTRUCTION_CATEGORY_NAMES.includes(name);
}

/** Map a UID OR display name to its system type. Defensive default: "legacy". */
export function categoryToSystemType(uidOrName: string): SystemType {
  // Names
  if (uidOrName === JOB_CATEGORIES.SOLAR_INSTALL) return "solar";
  if (uidOrName === JOB_CATEGORIES.BATTERY_INSTALL) return "battery";
  if (uidOrName === JOB_CATEGORIES.EV_INSTALL) return "ev";
  if (uidOrName === JOB_CATEGORIES.CONSTRUCTION) return "legacy";

  // UIDs (only relevant when JOB_CATEGORY_UIDS env vars are populated)
  if (JOB_CATEGORY_UIDS.SOLAR_INSTALL && uidOrName === JOB_CATEGORY_UIDS.SOLAR_INSTALL) return "solar";
  if (JOB_CATEGORY_UIDS.BATTERY_INSTALL && uidOrName === JOB_CATEGORY_UIDS.BATTERY_INSTALL) return "battery";
  if (JOB_CATEGORY_UIDS.EV_INSTALL && uidOrName === JOB_CATEGORY_UIDS.EV_INSTALL) return "ev";
  if (uidOrName === JOB_CATEGORY_UIDS.CONSTRUCTION) return "legacy";

  return "legacy";
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Group ZuperJobCache rows by hubspotDealId. Jobs without a dealId are
 * dropped (with a Sentry breadcrumb so we can spot data quality issues).
 *
 * Pure function — no I/O, no mutation of inputs.
 */
export function groupConstructionJobsByDeal(jobs: ZuperJobCache[]): DealConstructionAggregate[] {
  const byDeal = new Map<string, ZuperJobCache[]>();
  let droppedCount = 0;

  for (const job of jobs) {
    if (!job.hubspotDealId) {
      droppedCount++;
      continue;
    }
    const existing = byDeal.get(job.hubspotDealId) ?? [];
    existing.push(job);
    byDeal.set(job.hubspotDealId, existing);
  }

  if (droppedCount > 0) {
    Sentry.addBreadcrumb({
      category: "zuper-construction",
      message: `Dropped ${droppedCount} construction job(s) without hubspotDealId`,
      level: "info",
    });
  }

  const aggregates: DealConstructionAggregate[] = [];
  for (const [dealId, dealJobs] of byDeal.entries()) {
    aggregates.push(buildAggregate(dealId, dealJobs));
  }
  return aggregates;
}

/**
 * Equal-split a deal value across its sub-jobs. Returns 0 for jobCount=0
 * to avoid divide-by-zero. Mirrors the existing D&R 50/50 pattern in
 * src/app/api/zuper/revenue-calendar/route.ts:471-501, generalized.
 */
export function allocateDealValueAcrossJobs(dealAmount: number, jobCount: number): number {
  if (jobCount <= 0) return 0;
  if (!dealAmount) return 0;
  return dealAmount / jobCount;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildAggregate(dealId: string, jobs: ZuperJobCache[]): DealConstructionAggregate {
  const systemTypes: SystemType[] = jobs.map((j) => categoryToSystemType(j.jobCategory ?? ""));

  let earliestStart: Date | null = null;
  let latestEnd: Date | null = null;
  for (const job of jobs) {
    if (job.scheduledStart) {
      if (!earliestStart || job.scheduledStart < earliestStart) earliestStart = job.scheduledStart;
    }
    if (job.scheduledEnd) {
      if (!latestEnd || job.scheduledEnd > latestEnd) latestEnd = job.scheduledEnd;
    }
  }

  const assignedCrewsByType: Partial<Record<SystemType, string[]>> = {};
  for (const job of jobs) {
    const sysType = categoryToSystemType(job.jobCategory ?? "");
    const users = extractAssignedUserNames(job.assignedUsers);
    if (users.length === 0) continue;
    const existing = assignedCrewsByType[sysType] ?? [];
    assignedCrewsByType[sysType] = [...existing, ...users];
  }

  return {
    dealId,
    jobs,
    systemTypes,
    earliestStart,
    latestEnd,
    assignedCrewsByType,
  };
}

function extractAssignedUserNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === "object" && "user_name" in entry) {
      const name = String((entry as { user_name?: unknown }).user_name ?? "").trim();
      if (name) names.push(name);
    }
  }
  return names;
}
```

- [ ] **Step 2.6: Run tests — expect all pass**

```bash
npm run test -- --testPathPattern="zuper-construction" 2>&1 | tail -20
```

Expected: every test in the file passes. If any fail, fix the helper (not the tests) until green.

- [ ] **Step 2.7: Run lint and typecheck**

```bash
npx eslint src/lib/zuper-construction.ts src/__tests__/zuper-construction.test.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "zuper-construction" | head -10
```

Expected: clean.

- [ ] **Step 2.8: Commit**

```bash
git add src/lib/zuper-construction.ts src/__tests__/zuper-construction.test.ts
git commit -m "$(cat <<'EOF'
feat(zuper): add zuper-construction helper module with TDD coverage

Pure helpers for the new multi-category construction concept:
- isConstructionCategoryUid / Name predicates
- categoryToSystemType mapping
- groupConstructionJobsByDeal aggregator
- allocateDealValueAcrossJobs (generalizes D&R 50/50 split)

24 unit tests cover empty input, single-job legacy aggregates,
multi-job aggregates, mismatched windows, null dealId drops,
and divide-by-zero guards.

Spec: docs/superpowers/specs/2026-05-03-construction-job-split-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix Revenue Calendar double-counting (highest-impact bug fix)

**Files:**
- Modify: `src/app/api/zuper/revenue-calendar/route.ts` (around lines 16–22 for `REVENUE_CATEGORIES`, lines 422–469 for the per-job dealValue assignment, lines 471–501 for the existing D&R block as a reference pattern)

**Risk:** This is the live revenue dashboard. A bug here makes the calendar show wrong dollar totals. Test thoroughly before merge.

- [ ] **Step 3.1: Read the current revenue calendar route**

```bash
sed -n '15,25p' src/app/api/zuper/revenue-calendar/route.ts
sed -n '420,505p' src/app/api/zuper/revenue-calendar/route.ts
```

Note the existing D&R 50/50 block (lines ~471–501) — that's the pattern to mirror.

- [ ] **Step 3.2: Add the three new categories to `REVENUE_CATEGORIES`**

Locate the `REVENUE_CATEGORIES` const (around line 16). Add three entries with the same `key: "construction"` so they aggregate into the same bucket for revenue-by-category rollups:

```ts
const REVENUE_CATEGORIES = [
  { uid: JOB_CATEGORY_UIDS.CONSTRUCTION, name: "Construction", key: "construction" },
  { uid: JOB_CATEGORY_UIDS.SOLAR_INSTALL, name: "Construction - Solar", key: "construction" },
  { uid: JOB_CATEGORY_UIDS.BATTERY_INSTALL, name: "Construction - Battery", key: "construction" },
  { uid: JOB_CATEGORY_UIDS.EV_INSTALL, name: "Construction - EV", key: "construction" },
  { uid: JOB_CATEGORY_UIDS.DETACH, name: "Detach", key: "detach" },
  { uid: JOB_CATEGORY_UIDS.RESET, name: "Reset", key: "reset" },
  { uid: JOB_CATEGORY_UIDS.SERVICE_VISIT, name: "Service Visit", key: "service" },
] as const;
```

The `.filter(Boolean)`-style guard is implicit at the upstream level — if the env var is unset, the UID is `""`, and Zuper will return zero matching jobs. No runtime blowup.

- [ ] **Step 3.3: Add the construction-aggregate split block**

Find the existing `dnrByDeal` block (around line 471). Just BEFORE that block, add the equivalent for construction sub-jobs:

```ts
// Construction-aggregate allocation: when a deal has multiple construction
// sub-jobs (Solar/Battery/EV), split the deal amount equally across them
// to avoid 2x or 3x double-counting on the revenue calendar.
const constructionByDeal = new Map<string, CalendarJob[]>();
for (const job of confirmedJobs) {
  if (!job.dealId) continue;
  if (job.categoryKey !== "construction") continue;
  if (!constructionByDeal.has(job.dealId)) constructionByDeal.set(job.dealId, []);
  constructionByDeal.get(job.dealId)!.push(job);
}

for (const [, jobs] of constructionByDeal.entries()) {
  if (jobs.length <= 1) continue; // single-job deals already correct
  const dealAmount = jobs[0]?.totalDealValue ?? 0;
  if (dealAmount <= 0) continue;
  const perJobValue = dealAmount / jobs.length;
  for (const job of jobs) {
    job.totalDealValue = perJobValue;
    job.dealValue = perJobValue;
  }
}
```

**Note:** This is a per-aggregate adjustment that runs AFTER `confirmedJobs` is fully built and BEFORE the D&R block. Single-job legacy `Construction` deals (`jobs.length === 1`) are skipped — their values stay as the full deal amount, identical to today's behavior.

- [ ] **Step 3.4: Add a unit test asserting the split works**

Open `src/__tests__/` and create or extend `revenue-calendar.test.ts`. If extending isn't practical (route handler tests are integration-shaped), add a focused test in `zuper-construction.test.ts` for the math:

```ts
// Add to existing src/__tests__/zuper-construction.test.ts
describe("revenue split scenarios (mirrors revenue-calendar logic)", () => {
  it("3-system deal at $90k splits to $30k per sub-job", () => {
    expect(allocateDealValueAcrossJobs(90000, 3)).toBe(30000);
  });

  it("2-system deal at $80k splits to $40k per sub-job", () => {
    expect(allocateDealValueAcrossJobs(80000, 2)).toBe(40000);
  });

  it("1-system deal preserves full value", () => {
    expect(allocateDealValueAcrossJobs(50000, 1)).toBe(50000);
  });
});
```

- [ ] **Step 3.5: Run tests + lint + typecheck**

```bash
npm run test -- --testPathPattern="zuper-construction" 2>&1 | tail -10
npx eslint src/app/api/zuper/revenue-calendar/route.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "revenue-calendar" | head -5
```

Expected: tests pass, no new lint/type errors.

- [ ] **Step 3.6: Manual smoke test (skip if no dev environment available)**

```bash
npm run dev
# In a browser, hit /api/zuper/revenue-calendar?year=2026&month=5
# Verify the response totals match what HubSpot says for May 2026 deals
# Especially: pick a deal you know has multiple construction sub-jobs and
# confirm its total appears split, not multiplied.
```

- [ ] **Step 3.7: Commit**

```bash
git add src/app/api/zuper/revenue-calendar/route.ts src/__tests__/zuper-construction.test.ts
git commit -m "$(cat <<'EOF'
fix(revenue-calendar): split deal value across construction sub-jobs

Adds Construction - Solar/Battery/EV to REVENUE_CATEGORIES (all
mapped to the existing 'construction' key for category rollup).
Adds a constructionByDeal split block that mirrors the existing
D&R 50/50 logic, generalized to N-way equal split.

Without this fix, a 3-system deal at \$90k would appear as \$270k
on the revenue calendar (3x triple-count).

Spec: docs/superpowers/specs/2026-05-03-construction-job-split-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk Boundary

This is the end of the first chunk. Pause here for plan-document review before proceeding to Chunk 2.

The remaining chunks will cover:
- **Chunk 2:** Google Calendar consolidation, photos endpoint, status comparison (the real bug fixes)
- **Chunk 3:** Mechanical category-mapping updates (lookup, availability, scheduling, compliance)
- **Chunk 4:** Env var setup, deployment, rollout monitoring

---
