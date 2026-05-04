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

## Chunk 2: Cache helper + status comparison + metrics

The remaining bug-fix call sites (besides Revenue Calendar): `getCachedZuperJobsByDealIds(..., "Construction")` callers, and the Zuper Status Comparison route which fetches by single category UID.

Note: `src/app/api/deals/[dealId]/photos/route.ts` was reviewed and found to already use `findMany` without a category filter, so photos from all sub-jobs are naturally aggregated. **No change needed for photos.**

---

### Task 4: Update `getCachedZuperJobByDealId` and `getCachedZuperJobsByDealIds` to accept category arrays

**Files:**
- Modify: `src/lib/db.ts` (lines ~649–673)
- Modify: `src/app/api/hubspot/qc-metrics/route.ts:140`
- Modify: `src/app/api/hubspot/inspection-metrics/route.ts:347`
- Modify: `src/app/api/zuper/jobs/lookup/route.ts:339` (passes `categoryForDb` — verify upstream)

**Why:** these helpers currently take a single `category?: string`. Callers passing `"Construction"` silently miss the new sub-jobs. The cleanest fix is to accept either a string OR an array of strings, with backwards-compatible behavior.

- [ ] **Step 4.1: Read the current helpers**

```bash
sed -n '645,675p' src/lib/db.ts
```

- [ ] **Step 4.2: Widen the signature to accept `string | string[]`**

In `src/lib/db.ts`, replace the two helper functions:

```ts
/**
 * Get cached Zuper job by HubSpot deal ID.
 *
 * @param category - either a single category name (legacy) or an array of
 *   category names (e.g. all four construction categories). When passing a
 *   string, behavior is unchanged from before. When passing an array, returns
 *   the most recent matching job across any category in the array.
 */
export async function getCachedZuperJobByDealId(dealId: string, category?: string | string[]) {
  if (!prisma) return null;

  const categoryFilter = Array.isArray(category)
    ? { jobCategory: { in: category } }
    : category
      ? { jobCategory: category }
      : {};

  return prisma.zuperJobCache.findFirst({
    where: {
      hubspotDealId: dealId,
      ...categoryFilter,
    },
    orderBy: { lastSyncedAt: "desc" },
  });
}

/**
 * Get cached Zuper jobs by HubSpot deal IDs (bulk lookup).
 *
 * @param category - same semantics as getCachedZuperJobByDealId.
 */
export async function getCachedZuperJobsByDealIds(dealIds: string[], category?: string | string[]) {
  if (!prisma) return [];

  const categoryFilter = Array.isArray(category)
    ? { jobCategory: { in: category } }
    : category
      ? { jobCategory: category }
      : {};

  return prisma.zuperJobCache.findMany({
    where: {
      hubspotDealId: { in: dealIds },
      ...categoryFilter,
    },
  });
}
```

- [ ] **Step 4.3: Update QC metrics caller to pass the union**

In `src/app/api/hubspot/qc-metrics/route.ts` line 140:

```ts
// Before
const zuperJobs = await getCachedZuperJobsByDealIds(dealIds, "Construction");

// After — import CONSTRUCTION_CATEGORY_NAMES from lib/zuper, then:
const zuperJobs = await getCachedZuperJobsByDealIds(dealIds, [...CONSTRUCTION_CATEGORY_NAMES]);
```

Add the import at the top of the file:

```ts
import { CONSTRUCTION_CATEGORY_NAMES } from "@/lib/zuper";
```

- [ ] **Step 4.4: Update inspection metrics caller**

`src/app/api/hubspot/inspection-metrics/route.ts:347` is more nuanced — review the surrounding code first:

```bash
sed -n '340,360p' src/app/api/hubspot/inspection-metrics/route.ts
```

If it uses the result to compute "did construction happen for this deal?", the union pass is correct (any construction sub-job counts). Apply the same edit as Step 4.3.

- [ ] **Step 4.5: Update lookup endpoint**

`src/app/api/zuper/jobs/lookup/route.ts:339` passes a `categoryForDb` variable derived from a `type` query param. Read the upstream logic:

```bash
sed -n '40,75p' src/app/api/zuper/jobs/lookup/route.ts
```

Where `type === "installation"` maps to `JOB_CATEGORIES.CONSTRUCTION`, change it to map to the full `[...CONSTRUCTION_CATEGORY_NAMES]` array, and pass that array down to `getCachedZuperJobsByDealIds`. Adjust types as needed; `categoryForDb` becomes `string | string[]`.

- [ ] **Step 4.6: Run lint + typecheck**

```bash
npx eslint src/lib/db.ts src/app/api/hubspot/qc-metrics/route.ts src/app/api/hubspot/inspection-metrics/route.ts src/app/api/zuper/jobs/lookup/route.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "db.ts|qc-metrics|inspection-metrics|lookup/route" | head -20
```

Expected: clean.

- [ ] **Step 4.7: Commit**

```bash
git add src/lib/db.ts src/app/api/hubspot/qc-metrics/route.ts src/app/api/hubspot/inspection-metrics/route.ts src/app/api/zuper/jobs/lookup/route.ts
git commit -m "$(cat <<'EOF'
fix(cache): widen ZuperJobCache helpers to accept category arrays

getCachedZuperJobByDealId / getCachedZuperJobsByDealIds now
accept string | string[] for the category filter. Callers can
pass CONSTRUCTION_CATEGORY_NAMES to include legacy + Solar +
Battery + EV sub-jobs.

Updates QC metrics, inspection metrics, and the jobs/lookup
endpoint to use the union — these would have silently dropped
new sub-jobs otherwise.

Spec: docs/superpowers/specs/2026-05-03-construction-job-split-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Status Comparison route — fetch all four categories

**Files:**
- Modify: `src/app/api/zuper/status-comparison/route.ts:599, 734, 1020`

**Why:** the status comparison fetches Zuper jobs by single category UID. With three references to `JOB_CATEGORY_UIDS.CONSTRUCTION`, only legacy jobs are pulled. New sub-jobs are silently dropped from the dashboard.

- [ ] **Step 5.1: Inspect each call site**

```bash
sed -n '590,610p' src/app/api/zuper/status-comparison/route.ts
sed -n '725,745p' src/app/api/zuper/status-comparison/route.ts
sed -n '1010,1030p' src/app/api/zuper/status-comparison/route.ts
```

Determine for each:
- Is it filtering input or doing a simple UID equality?
- Is it fetching jobs from Zuper API (UID-keyed) or from cache (name-keyed)?

- [ ] **Step 5.2: Replace single-UID checks with array-includes**

Pattern:

```ts
// Before
} else if (categoryForMapping === JOB_CATEGORY_UIDS.CONSTRUCTION) {

// After
} else if (CONSTRUCTION_CATEGORY_UIDS.includes(categoryForMapping)) {
```

```ts
// Before
fetchAllZuperJobs(JOB_CATEGORY_UIDS.CONSTRUCTION, fromDate, toDate),

// After — fetch each construction UID, then concat. Assign to a variable
// first; `...await Promise.all(...).then(...)` inside a spread is invalid syntax.
const constructionJobArrays = await Promise.all(
  CONSTRUCTION_CATEGORY_UIDS.map((uid) => fetchAllZuperJobs(uid, fromDate, toDate))
);
const allConstructionJobs = constructionJobArrays.flat();
// then use allConstructionJobs in place of the original single-call result
```

The exact transformation depends on how the result is consumed downstream. **Do not** blindly apply; read the surrounding function signature first.

- [ ] **Step 5.3: Add the import**

```ts
import { CONSTRUCTION_CATEGORY_UIDS } from "@/lib/zuper";
```

- [ ] **Step 5.4: Run lint, typecheck, and any existing tests**

```bash
npx eslint src/app/api/zuper/status-comparison/route.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep status-comparison | head -10
npm run test -- --testPathPattern="status-comparison" 2>&1 | tail -10
```

Expected: clean. (No matching test file is fine.)

- [ ] **Step 5.5: Manual smoke test**

Hit `/dashboards/zuper-status-comparison` in dev and verify the construction column counts match expectations for a known multi-job deal.

- [ ] **Step 5.6: Commit**

```bash
git add src/app/api/zuper/status-comparison/route.ts
git commit -m "$(cat <<'EOF'
fix(status-comparison): include all four construction categories

Replaces three single-UID equality checks against
JOB_CATEGORY_UIDS.CONSTRUCTION with CONSTRUCTION_CATEGORY_UIDS
union membership. Without this, jobs in the new sub-categories
(Construction - Solar/Battery/EV) were silently dropped from
the status comparison dashboard.

Spec: docs/superpowers/specs/2026-05-03-construction-job-split-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Google Calendar event title and description

**Files:**
- Modify: `src/lib/google-calendar.ts` (the `upsertInstallationCalendarEvent` function and its event-body builder)

**Why:** currently the event ID is keyed on `dealId` (good — already deal-level), but the title and description don't reflect the new system breakdown. After the split, an installer reading the calendar should see "this property is getting Solar + Battery on May 12-13" not "Install: Smith Residence".

- [ ] **Step 6.1: Read the current function**

```bash
grep -n "upsertInstallationCalendarEvent\|install.*event" src/lib/google-calendar.ts | head -10
sed -n '730,800p' src/lib/google-calendar.ts
```

Note the current title/description format and the function signature.

- [ ] **Step 6.2: Find all call sites**

```bash
grep -rn "upsertInstallationCalendarEvent" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -10
```

You'll be updating these in the same PR (no transitional shim per spec).

- [ ] **Step 6.3: Decide on the integration approach**

Two viable options — pick whichever requires fewer call site changes:

**Option A:** Keep the current signature, but add an optional `systemTypes?: string[]` parameter. When provided, the title becomes `"Install — ${name} (${systemTypes.join(", ")})"`. Callers that have access to a `DealConstructionAggregate` pass the system types; callers that don't pass nothing (legacy behavior).

**Option B:** Take a `DealConstructionAggregate` directly. Cleaner semantics but requires every caller to construct or have access to one.

Given that not every calendar caller will have an aggregate handy (some come from raw HubSpot deal data), **Option A is preferred.**

- [ ] **Step 6.4: Implement Option A**

In `src/lib/google-calendar.ts`, add `systemTypes?: string[]` (or a similar named parameter) to the function. In the event title builder:

```ts
const baseTitle = `Install — ${dealName}`;
const titleWithSystems =
  systemTypes && systemTypes.length > 0
    ? `${baseTitle} (${systemTypes.join(", ")})`
    : baseTitle;
const title = titleWithSystems.length > 80 ? baseTitle : titleWithSystems;
```

In the description builder, append a "Systems:" line listing each system type with its assigned crew (if available).

- [ ] **Step 6.5: Update construction-scheduler caller(s)**

For each caller of `upsertInstallationCalendarEvent`, if construction sub-job context is available (e.g. via `groupConstructionJobsByDeal()` of the cache rows for the deal), pass `systemTypes`. Otherwise leave the new param undefined.

- [ ] **Step 6.6: Lint + typecheck**

```bash
npx eslint src/lib/google-calendar.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep google-calendar | head -10
```

- [ ] **Step 6.7: Manual test (skip if Google Calendar isn't reachable in dev)**

Trigger one calendar upsert path that you've changed and confirm the resulting event title in the calendar UI.

- [ ] **Step 6.8: Commit**

```bash
git add src/lib/google-calendar.ts $(git diff --name-only -- 'src/app/**/*calendar*')
git commit -m "$(cat <<'EOF'
feat(calendar): show system types on install events

Adds optional systemTypes param to upsertInstallationCalendarEvent.
Callers that have a DealConstructionAggregate pass the types, so
events are labeled "Install — Smith Residence (Solar, Battery)"
instead of just "Install — Smith Residence".

Falls back to the unlabeled title if the combined string exceeds
80 chars (per spec).

Spec: docs/superpowers/specs/2026-05-03-construction-job-split-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Mechanical category-mapping updates

These call sites currently map the `installation` job-type concept to a single `JOB_CATEGORY_UIDS.CONSTRUCTION` value. Each needs to expand to the full union. Most are one- or two-line edits.

---

### Task 7: Availability endpoint

**Files:**
- Modify: `src/app/api/zuper/availability/route.ts:385–386`

- [ ] **Step 7.1: Read the existing mapping**

```bash
sed -n '380,395p' src/app/api/zuper/availability/route.ts
```

- [ ] **Step 7.2: Determine consumer expectations**

The `installation` key likely returns capacity info for one category. With four categories now, decide:
- (a) Sum across the four categories (each capacity slot counts once)
- (b) Return per-category capacity (changes the response shape — high risk)

**Choose (a)** — preserves the existing API shape. Aggregate counts across the four UIDs.

- [ ] **Step 7.3: Edit the mapping to use the union**

Replace:
```ts
installation: JOB_CATEGORY_UIDS.CONSTRUCTION,
construction: JOB_CATEGORY_UIDS.CONSTRUCTION,
```
with logic that fetches/sums across `CONSTRUCTION_CATEGORY_UIDS`. Exact edit depends on the calling code structure — read before changing.

- [ ] **Step 7.4: Lint, typecheck, commit**

```bash
npx eslint src/app/api/zuper/availability/route.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep availability | head -5

git add src/app/api/zuper/availability/route.ts
git commit -m "fix(availability): aggregate capacity across all construction categories"
```

---

### Task 8: Assisted scheduling endpoint

**Files:**
- Modify: `src/app/api/zuper/assisted-scheduling/route.ts:40`

Same shape as Task 7 — mapping `installation: JOB_CATEGORY_UIDS.CONSTRUCTION` needs to expand. Apply the same pattern.

- [ ] **Step 8.1: Read, edit, lint, commit (one cycle, mirrors Task 7)**

```bash
sed -n '35,55p' src/app/api/zuper/assisted-scheduling/route.ts
# edit, then:
npx eslint src/app/api/zuper/assisted-scheduling/route.ts
git add src/app/api/zuper/assisted-scheduling/route.ts
git commit -m "fix(assisted-scheduling): map installation to all construction categories"
```

---

### Task 9: Job schedule + confirm routes — pick the default sub-category

**Files:**
- Modify: `src/app/api/zuper/jobs/schedule/route.ts:267, 274, 535, 1267`
- Modify: `src/app/api/zuper/jobs/schedule/confirm/route.ts:46, 53`

**Why this is different:** these routes CREATE jobs (or interact with creation flows). The HubSpot workflow now creates split jobs, so app-side creation paths may be dead code OR may still serve a purpose (manual scheduling fallback). Decision required.

- [ ] **Step 9.1: Determine if these creation paths are dead**

```bash
grep -rn "/api/zuper/jobs/schedule\b" src/app --include="*.ts" --include="*.tsx" | grep -v "schedule/" | head -10
```

Look for callers — UI buttons, programmatic invocations. If only triggered by a UI flow that also creates HubSpot deals (which would then trigger the workflow), consider these dead. If they support manual scheduling outside the workflow, they're alive.

- [ ] **Step 9.2: If dead → mark for removal in a follow-up PR**

Add a TODO comment at the top of each file:

```ts
// TODO(2026-05-XX): construction-job-split — verify these routes are dead
// post-cutover. The HubSpot workflow now owns Zuper construction job creation.
// If still needed, decide which sub-category default to create.
```

Skip Steps 9.3–9.5; proceed to Task 10.

- [ ] **Step 9.3: If alive → default to `Construction - Solar`**

Most installations include solar (per the user's earlier brainstorming answer that Solar is the most common system). Replace the hardcoded `JOB_CATEGORY_UIDS.CONSTRUCTION` with `JOB_CATEGORY_UIDS.SOLAR_INSTALL` and the matching display name.

- [ ] **Step 9.4: Lint + typecheck**

```bash
npx eslint src/app/api/zuper/jobs/schedule/route.ts src/app/api/zuper/jobs/schedule/confirm/route.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "jobs/schedule" | head -10
```

- [ ] **Step 9.5: Commit**

```bash
git add src/app/api/zuper/jobs/schedule/route.ts src/app/api/zuper/jobs/schedule/confirm/route.ts
git commit -m "feat(scheduling): default manual-schedule installation to Construction - Solar"
```

---

### Task 10: Compliance scoring maps

**Files:**
- Modify: `src/lib/compliance-v2/scoring.ts:37`
- Modify: `src/lib/compliance-compute.ts:111`

Both files contain a `CATEGORY_NAME_TO_UID` lookup map. Add three entries.

- [ ] **Step 10.1: Edit `src/lib/compliance-v2/scoring.ts`**

Locate `CATEGORY_NAME_TO_UID` and add:

```ts
"Construction - Solar": JOB_CATEGORY_UIDS.SOLAR_INSTALL,
"Construction - Battery": JOB_CATEGORY_UIDS.BATTERY_INSTALL,
"Construction - EV": JOB_CATEGORY_UIDS.EV_INSTALL,
```

- [ ] **Step 10.2: Edit `src/lib/compliance-compute.ts`**

Same edit pattern — add three entries to the existing map.

- [ ] **Step 10.3: Lint + typecheck**

```bash
npx eslint src/lib/compliance-v2/scoring.ts src/lib/compliance-compute.ts
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "compliance-v2|compliance-compute" | head -5
```

- [ ] **Step 10.4: Commit**

```bash
git add src/lib/compliance-v2/scoring.ts src/lib/compliance-compute.ts
git commit -m "feat(compliance): include new construction sub-categories in scoring map"
```

---

## Chunk 4: Env vars, deployment, monitoring

### Task 11: Add env vars and `.env.example`

**Files:**
- Modify: `.env.example`
- Vercel production env (manual via `vercel env add` or dashboard)

- [ ] **Step 11.1: Add three env var stubs to `.env.example`**

```bash
cat >> .env.example <<'EOF'

# Zuper construction sub-category UIDs (Solar/Battery/EV split)
# Set these to the UIDs from the Zuper admin panel.
ZUPER_CATEGORY_SOLAR_INSTALL=
ZUPER_CATEGORY_BATTERY_INSTALL=
ZUPER_CATEGORY_EV_INSTALL=

# Feature flag — set to "false" to disable the multi-category split
# (rollback path; default behavior is enabled)
CONSTRUCTION_JOB_SPLIT_ENABLED=true
EOF
```

- [ ] **Step 11.2: Set the production env vars**

Use the values you collected in Step 0c. `printf` (NOT echo — see memory `feedback_vercel_env_no_echo.md`):

```bash
# For each of the three:
printf '%s' '<actual-uid-from-zuper>' | vercel env add ZUPER_CATEGORY_SOLAR_INSTALL production
printf '%s' '<actual-uid-from-zuper>' | vercel env add ZUPER_CATEGORY_BATTERY_INSTALL production
printf '%s' '<actual-uid-from-zuper>' | vercel env add ZUPER_CATEGORY_EV_INSTALL production
printf '%s' 'true' | vercel env add CONSTRUCTION_JOB_SPLIT_ENABLED production
```

- [ ] **Step 11.3: Verify with `vercel env pull`**

```bash
vercel env pull .env.production.local --environment=production
grep -E "ZUPER_CATEGORY_(SOLAR|BATTERY|EV)|CONSTRUCTION_JOB_SPLIT" .env.production.local
rm .env.production.local
```

Expected: each var shows the value you set, no trailing newline garbage.

- [ ] **Step 11.4: Commit `.env.example`**

```bash
git add .env.example
git commit -m "docs(env): add construction sub-category UIDs and split feature flag"
```

---

### Task 12: PR, merge, monitor

- [ ] **Step 12.1: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create --title "Construction job split: Solar / Battery / EV" --body "$(cat <<'EOF'
## Summary
- Adds three new Zuper categories (Construction - Solar / Battery / EV) and treats them as construction work alongside the legacy Construction category.
- Fixes revenue calendar 2x/3x double-counting via N-way equal split (mirrors existing D&R 50/50 pattern).
- Fixes Zuper status comparison and cache helper queries that silently dropped sub-jobs.
- Updates Google Calendar install events to label system types in the title.
- Adds `CONSTRUCTION_JOB_SPLIT_ENABLED` feature flag for one-step rollback.

## Test plan
- [ ] `npm run test` — verify zuper-construction.test.ts passes (24 cases)
- [ ] Hit `/api/zuper/revenue-calendar?year=2026&month=5` and spot-check totals
- [ ] Visit `/dashboards/zuper-status-comparison` and confirm split-job deals appear
- [ ] Verify Google Calendar install event title includes "(Solar, Battery)" or similar
- [ ] Smoke test: a deal with no construction sub-jobs (legacy or unscoped) still works

## Rollback
Set `CONSTRUCTION_JOB_SPLIT_ENABLED=false` in Vercel env without redeploying.

Spec: docs/superpowers/specs/2026-05-03-construction-job-split-design.md
EOF
)"
```

- [ ] **Step 12.2: After merge, monitor for 7 days**

- Check Sentry for new "Dropped N construction job(s) without hubspotDealId" breadcrumbs.
- Compare Revenue Calendar monthly total against HubSpot deal-stage-filter sum.
- Spot-check the install Google Calendar weekly.

- [ ] **Step 12.3: After ~60–90 days, retire legacy Construction category**

When all in-flight legacy `Construction` Zuper jobs have completed:
- Remove `JOB_CATEGORY_UIDS.CONSTRUCTION` from `CONSTRUCTION_CATEGORY_UIDS`.
- Remove `JOB_CATEGORIES.CONSTRUCTION` from `CONSTRUCTION_CATEGORY_NAMES`.
- Remove `CONSTRUCTION_JOB_SPLIT_ENABLED` flag (no longer needed).

This is its own follow-up PR, not part of the initial rollout.

---

## Final Verification

- [ ] **All chunks complete**
- [ ] **All tests passing**
- [ ] **Production env vars confirmed**
- [ ] **PR merged**
- [ ] **7-day monitoring window started**

