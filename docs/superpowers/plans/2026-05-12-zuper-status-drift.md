# Zuper Status Drift Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PM-facing drift dashboard at `/dashboards/zuper-drift` that flags Zuper job ↔ HubSpot deal mismatches (status, inspection pass/fail disagreement, completion/pass/fail dates), modeled exactly on `/dashboards/da-drift`. Includes a 15-minute reconcile cron, a one-off backfill script, and a shared status-mapping lib that the existing admin comparison API also consumes.

**Architecture:** Four-piece pattern from DA drift: shared lib (`src/lib/zuper-status-mapping.ts`) → cron (`/api/cron/zuper-status-reconcile`) → drift table (`ZuperStatusDrift` Prisma model) → PM page + API. Shared lib is extracted from `src/app/api/zuper/status-comparison/route.ts` — the admin page re-imports from the lib, zero behavior change. Construction sub-categories (Solar/Battery/EV behind `CONSTRUCTION_JOB_SPLIT_ENABLED` flag) are evaluated independently per sub-job; the drift row preserves the sub-type label for PM display.

**Tech Stack:** Next.js 16.1 App Router, Prisma 7.3 on Neon Postgres, React 19.2, Tailwind v4, Jest, HubSpot SDK, Zuper API client.

**Spec:** `docs/superpowers/specs/2026-05-12-zuper-status-drift-design.md`

---

## Chunk 1: Migration + Prisma Model

### Task 1.1: Add ZuperStatusDrift model + enums to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma` (append at the end of the models section)

- [ ] **Step 1: Add the enums and model**

Find the end of the `enum` declarations in `prisma/schema.prisma` (search for the last `enum` block) and append:

```prisma
enum ZuperDriftType {
  STATUS
  FAIL_DISAGREEMENT
  COMPLETION_DATE
  INSPECTION_PASS_DATE
  INSPECTION_FAIL_DATE
}

enum ZuperDriftStatus {
  OPEN
  RESOLVED
  IGNORED
}
```

Find the end of the `model` declarations (search for the last `model` block) and append:

```prisma
/// PM-facing flag list of Zuper job ↔ HubSpot deal drift.
/// Written by /api/cron/zuper-status-reconcile every 15 min.
/// One row per Zuper job uid (any combination of drift types
/// fires into the same row via the driftTypes array).
model ZuperStatusDrift {
  id                  String              @id @default(cuid())
  zuperJobUid         String              @unique
  hubspotDealId       String?
  projectNumber       String?
  dealName            String?
  pbLocation          String?
  category            String              // site_survey | construction | solar_install | battery_install | ev_install | inspection
  zuperJobTitle       String?
  zuperStatus         String
  hubspotStatus       String?
  driftTypes          ZuperDriftType[]
  zuperCompletedAt    DateTime?
  hubspotCompletionAt DateTime?
  zuperFailedAt       DateTime?
  hubspotFailAt       DateTime?
  detectedAt          DateTime            @default(now())
  status              ZuperDriftStatus    @default(OPEN)
  resolvedAt          DateTime?
  resolvedBy          String?
  resolveNote         String?

  @@index([status])
  @@index([hubspotDealId])
  @@index([category])
}
```

- [ ] **Step 2: Generate the migration**

```bash
npx prisma migrate dev --name add-zuper-status-drift --create-only
```

Expected: creates `prisma/migrations/<timestamp>_add_zuper_status_drift/migration.sql`. Inspect the SQL — it MUST be additive only (CREATE TABLE, CREATE TYPE, CREATE INDEX — no ALTER TABLE on existing tables, no DROP).

- [ ] **Step 3: Apply locally and regenerate client**

```bash
npx prisma migrate deploy
npx prisma generate
```

Expected: migration applies cleanly. `src/generated/prisma/enums.ts` now exports `ZuperDriftType` and `ZuperDriftStatus`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add ZuperStatusDrift model + enums"
```

---

## Chunk 2: Shared Mapping Lib + Tests (TDD)

This is the highest-value chunk to TDD because `evaluateJobDrift` is the core decision function and the hardest to verify by inspection.

### Task 2.1: Create the lib with extracted helpers (no tests yet, just relocate)

**Files:**
- Create: `src/lib/zuper-status-mapping.ts`
- Reference: `src/app/api/zuper/status-comparison/route.ts:262-410, 514-552`

- [ ] **Step 1: Create the new lib with content copied from the comparison route**

The new file should export:

```ts
import type { HubSpotDealData } from "@/lib/types"; // placeholder — define minimal type below

// Minimal subset of HubSpotDealData the lib needs. Keep this lib free of
// HubSpot SDK imports so it can be used from any context.
export interface DriftEvalDeal {
  dealId: string;
  dealName: string | null;
  pbLocation: string | null;
  projectNumber: string | null;
  siteSurveyStatus: string | null;
  constructionStatus: string | null; // install_status
  inspectionStatus: string | null;   // final_inspection_status
  constructionCompleteDate: string | null;
  inspectionPassDate: string | null; // inspections_completion_date
  inspectionFailDate: string | null; // inspections_fail_date
}

export interface DriftEvalJob {
  jobUid: string;
  jobTitle: string;
  category: string;        // canonical sub-type label (site_survey | construction | solar_install | battery_install | ev_install | inspection)
  zuperStatus: string;     // current_job_status
  completedAt: string | null; // ZuperJobCache.completedDate ISO
}

export type DriftType =
  | "STATUS"
  | "FAIL_DISAGREEMENT"
  | "COMPLETION_DATE"
  | "INSPECTION_PASS_DATE"
  | "INSPECTION_FAIL_DATE";

// Move STATUS_MAPPING, HS_TERMINAL_STATUSES, POST_FAILURE_STATUSES,
// isStatusMismatch, checkHubspotAhead, zuperDateToLocal,
// hubspotDateToLocal, compareDates, dateDiffDays, markSupersededJobs
// VERBATIM from src/app/api/zuper/status-comparison/route.ts.

export const STATUS_MAPPING: Record<string, Record<string, string[]>> = {
  site_survey: { /* …copy from existing… */ },
  construction: { /* …copy from existing… */ },
  inspection: { /* …copy from existing… */ },
};

export const HS_TERMINAL_STATUSES = new Set([
  "completed", "passed", "construction complete", "partial pass",
]);

export const POST_FAILURE_STATUSES = new Set([
  "ready for inspection", "waiting on revisions", "scheduled",
]);

export function toMappingCategory(category: string): "site_survey" | "construction" | "inspection" {
  if (category === "site_survey") return "site_survey";
  if (category === "inspection") return "inspection";
  // All four construction sub-types collapse to "construction"
  return "construction";
}

export function isStatusMismatch(/* …copy signature… */) { /* …copy body… */ }
export function checkHubspotAhead(/* …copy signature… */) { /* …copy body… */ }
export function zuperDateToLocal(dateStr: string): string { /* …copy… */ }
export function hubspotDateToLocal(dateStr: string): string { /* …copy… */ }
export function compareDates(zuperDate: string | null, hubspotDate: string | null): boolean | null { /* …copy… */ }
export function dateDiffDays(zuperDate: string | null, hubspotDate: string | null): number | null { /* …copy… */ }
export function markSupersededJobs<T extends { /* … */ }>(jobs: T[]): void { /* …copy… */ }

// New: the core decision function. STUB FOR NOW, implemented in next task via TDD.
export function evaluateJobDrift(job: DriftEvalJob, deal: DriftEvalDeal): DriftType[] {
  throw new Error("not yet implemented");
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "zuper-status-mapping" | head
```

Expected: no errors in this file. (Other unrelated errors in the project are pre-existing.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/zuper-status-mapping.ts
git commit -m "refactor(zuper): extract status-mapping helpers to shared lib"
```

### Task 2.2: TDD — write failing tests for `evaluateJobDrift`

**Files:**
- Create: `src/__tests__/zuper-status-mapping.test.ts`

- [ ] **Step 1: Write failing tests covering each DriftType × category combo**

```ts
import {
  evaluateJobDrift,
  toMappingCategory,
  type DriftEvalDeal,
  type DriftEvalJob,
} from "@/lib/zuper-status-mapping";

const baseDeal: DriftEvalDeal = {
  dealId: "1",
  dealName: "PROJ-1234 Smith",
  pbLocation: "DTC",
  projectNumber: "PROJ-1234",
  siteSurveyStatus: null,
  constructionStatus: null,
  inspectionStatus: null,
  constructionCompleteDate: null,
  inspectionPassDate: null,
  inspectionFailDate: null,
};

function job(overrides: Partial<DriftEvalJob>): DriftEvalJob {
  return {
    jobUid: "j1",
    jobTitle: "Test Job",
    category: "construction",
    zuperStatus: "Scheduled",
    completedAt: null,
    ...overrides,
  };
}

describe("toMappingCategory", () => {
  it("collapses all construction sub-types to 'construction'", () => {
    expect(toMappingCategory("construction")).toBe("construction");
    expect(toMappingCategory("solar_install")).toBe("construction");
    expect(toMappingCategory("battery_install")).toBe("construction");
    expect(toMappingCategory("ev_install")).toBe("construction");
  });
  it("preserves site_survey and inspection", () => {
    expect(toMappingCategory("site_survey")).toBe("site_survey");
    expect(toMappingCategory("inspection")).toBe("inspection");
  });
});

describe("evaluateJobDrift — STATUS", () => {
  it("fires STATUS when zuper status doesn't map to hubspot status", () => {
    const j = job({ zuperStatus: "Construction Complete" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Scheduled" };
    expect(evaluateJobDrift(j, d)).toContain("STATUS");
  });

  it("does NOT fire STATUS when HubSpot is legitimately ahead (HS terminal, Zuper behind)", () => {
    const j = job({ zuperStatus: "Scheduled" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Construction Complete" };
    expect(evaluateJobDrift(j, d)).not.toContain("STATUS");
  });

  it("does NOT fire STATUS when statuses match per STATUS_MAPPING", () => {
    const j = job({ zuperStatus: "Construction Complete" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Construction Complete" };
    expect(evaluateJobDrift(j, d)).toEqual([]);
  });
});

describe("evaluateJobDrift — FAIL_DISAGREEMENT", () => {
  it("fires when Zuper Failed but HS Passed", () => {
    const j = job({ category: "inspection", zuperStatus: "Failed" });
    const d: DriftEvalDeal = { ...baseDeal, inspectionStatus: "Passed" };
    const drift = evaluateJobDrift(j, d);
    expect(drift).toContain("FAIL_DISAGREEMENT");
  });

  it("fires when Zuper Passed but HS Failed", () => {
    const j = job({ category: "inspection", zuperStatus: "Passed" });
    const d: DriftEvalDeal = { ...baseDeal, inspectionStatus: "Failed" };
    const drift = evaluateJobDrift(j, d);
    expect(drift).toContain("FAIL_DISAGREEMENT");
  });

  it("does NOT fire for non-inspection categories", () => {
    const j = job({ category: "construction", zuperStatus: "Failed" });
    const d: DriftEvalDeal = { ...baseDeal, constructionStatus: "Construction Complete" };
    expect(evaluateJobDrift(j, d)).not.toContain("FAIL_DISAGREEMENT");
  });
});

describe("evaluateJobDrift — COMPLETION_DATE (construction sub-types)", () => {
  it("fires for any construction sub-type when Zuper completed date differs from HubSpot >1 day", () => {
    for (const cat of ["construction", "solar_install", "battery_install", "ev_install"]) {
      const j = job({
        category: cat,
        zuperStatus: "Construction Complete",
        completedAt: "2026-05-01T18:00:00Z",
      });
      const d: DriftEvalDeal = {
        ...baseDeal,
        constructionStatus: "Construction Complete",
        constructionCompleteDate: "2026-05-05", // 4 days off
      };
      expect(evaluateJobDrift(j, d)).toContain("COMPLETION_DATE");
    }
  });

  it("does NOT fire if dates are within 1 day", () => {
    const j = job({
      category: "construction",
      zuperStatus: "Construction Complete",
      completedAt: "2026-05-01T18:00:00Z", // local: 2026-05-01
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      constructionStatus: "Construction Complete",
      constructionCompleteDate: "2026-05-01",
    };
    expect(evaluateJobDrift(j, d)).not.toContain("COMPLETION_DATE");
  });

  it("does NOT fire for site_survey or inspection categories", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      constructionCompleteDate: "2026-04-01", // would be drift if we checked
    };
    expect(evaluateJobDrift(j, d)).not.toContain("COMPLETION_DATE");
  });
});

describe("evaluateJobDrift — INSPECTION_PASS_DATE", () => {
  it("fires when inspection Passed and Zuper completedAt differs from HubSpot pass date >1 day", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      inspectionPassDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).toContain("INSPECTION_PASS_DATE");
  });

  it("does NOT fire when inspection NOT passed", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Failed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Failed",
      inspectionPassDate: "2026-05-10", // stale data; shouldn't fire pass-date drift
    };
    expect(evaluateJobDrift(j, d)).not.toContain("INSPECTION_PASS_DATE");
  });
});

describe("evaluateJobDrift — INSPECTION_FAIL_DATE", () => {
  it("fires when inspection Failed and Zuper completedAt differs from HubSpot fail date >1 day", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Failed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Failed",
      inspectionFailDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).toContain("INSPECTION_FAIL_DATE");
  });

  it("does NOT fire when inspection NOT failed", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      inspectionFailDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).not.toContain("INSPECTION_FAIL_DATE");
  });
});

describe("evaluateJobDrift — combined", () => {
  it("can return multiple drift types simultaneously", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Failed",
      completedAt: "2026-05-01T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed", // disagreement
      inspectionFailDate: "2026-05-10", // date drift
    };
    const drift = evaluateJobDrift(j, d);
    expect(drift).toEqual(expect.arrayContaining(["STATUS", "FAIL_DISAGREEMENT", "INSPECTION_FAIL_DATE"]));
  });

  it("returns empty array when fully in sync", () => {
    const j = job({
      category: "inspection",
      zuperStatus: "Passed",
      completedAt: "2026-05-10T18:00:00Z",
    });
    const d: DriftEvalDeal = {
      ...baseDeal,
      inspectionStatus: "Passed",
      inspectionPassDate: "2026-05-10",
    };
    expect(evaluateJobDrift(j, d)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npx jest src/__tests__/zuper-status-mapping.test.ts 2>&1 | tail -20
```

Expected: all tests fail with "not yet implemented" error from the stub.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/__tests__/zuper-status-mapping.test.ts
git commit -m "test(zuper-drift): failing tests for evaluateJobDrift across all drift types"
```

### Task 2.3: Implement `evaluateJobDrift` to make tests pass

**Files:**
- Modify: `src/lib/zuper-status-mapping.ts`

- [ ] **Step 1: Replace the stub with the real implementation**

```ts
const CONSTRUCTION_SUB_TYPES = new Set([
  "construction", "solar_install", "battery_install", "ev_install",
]);

export function evaluateJobDrift(job: DriftEvalJob, deal: DriftEvalDeal): DriftType[] {
  const out: DriftType[] = [];
  const mappingCategory = toMappingCategory(job.category);

  // Pick the right HubSpot status for this category.
  const hubspotStatus = (() => {
    switch (mappingCategory) {
      case "site_survey": return deal.siteSurveyStatus;
      case "construction": return deal.constructionStatus;
      case "inspection": return deal.inspectionStatus;
    }
  })();

  // STATUS — check the Zuper↔HubSpot status mapping, considering legit HS-ahead cases.
  const statusMismatched = isStatusMismatch(job.zuperStatus, hubspotStatus, mappingCategory);
  const hubspotAhead = checkHubspotAhead(job.zuperStatus, hubspotStatus);
  if (statusMismatched && !hubspotAhead) {
    out.push("STATUS");
  }

  // FAIL_DISAGREEMENT — inspection only, hard-disagree case.
  if (mappingCategory === "inspection") {
    const z = job.zuperStatus.toLowerCase();
    const h = (hubspotStatus ?? "").toLowerCase();
    if ((z === "failed" && h === "passed") || (z === "passed" && h === "failed")) {
      out.push("FAIL_DISAGREEMENT");
    }
  }

  // COMPLETION_DATE — construction sub-types only.
  if (CONSTRUCTION_SUB_TYPES.has(job.category) && job.completedAt && deal.constructionCompleteDate) {
    if (compareDates(job.completedAt, deal.constructionCompleteDate) === false) {
      out.push("COMPLETION_DATE");
    }
  }

  // INSPECTION_PASS_DATE — inspection Passed only.
  if (mappingCategory === "inspection" && job.zuperStatus.toLowerCase() === "passed") {
    if (job.completedAt && deal.inspectionPassDate) {
      if (compareDates(job.completedAt, deal.inspectionPassDate) === false) {
        out.push("INSPECTION_PASS_DATE");
      }
    }
  }

  // INSPECTION_FAIL_DATE — inspection Failed only.
  if (mappingCategory === "inspection" && job.zuperStatus.toLowerCase() === "failed") {
    if (job.completedAt && deal.inspectionFailDate) {
      if (compareDates(job.completedAt, deal.inspectionFailDate) === false) {
        out.push("INSPECTION_FAIL_DATE");
      }
    }
  }

  return out;
}
```

- [ ] **Step 2: Run tests and verify they pass**

```bash
npx jest src/__tests__/zuper-status-mapping.test.ts 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/zuper-status-mapping.ts
git commit -m "feat(zuper-drift): implement evaluateJobDrift decision function"
```

### Task 2.4: Refactor admin status-comparison API to import from the lib

**Files:**
- Modify: `src/app/api/zuper/status-comparison/route.ts`

- [ ] **Step 1: Replace local definitions with imports from the lib**

In the route file, at the top of the file, add:

```ts
import {
  STATUS_MAPPING,
  HS_TERMINAL_STATUSES,
  POST_FAILURE_STATUSES,
  isStatusMismatch,
  checkHubspotAhead,
  zuperDateToLocal,
  hubspotDateToLocal,
  compareDates,
  dateDiffDays,
  markSupersededJobs,
} from "@/lib/zuper-status-mapping";
```

Then delete the local definitions of all 10 symbols from the file (lines ~262-410 + ~514-552 in the v1 file).

- [ ] **Step 2: Typecheck the changed file**

```bash
npx tsc --noEmit 2>&1 | grep "status-comparison" | head
```

Expected: no errors in this file. Pre-existing errors elsewhere don't count.

- [ ] **Step 3: Smoke-test the admin endpoint locally (optional but recommended)**

```bash
# Start dev server in another terminal, then:
curl -sS "http://localhost:3000/api/zuper/status-comparison" -H "Cookie: ${YOUR_SESSION_COOKIE}" | head -c 500
```

Expected: same response shape as before refactor (records, projectRecords, stats, nonCoreAudit, etc.).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zuper/status-comparison/route.ts
git commit -m "refactor(zuper): use shared status-mapping lib in admin comparison API"
```

---

## Chunk 3: Cron Route + Middleware + vercel.json

### Task 3.1: Add cron route to `PUBLIC_API_ROUTES`

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Add the cron path**

Find `PUBLIC_API_ROUTES` array. Locate the existing `pandadoc-da-reconcile` entry (line 63 currently). Add the new entry directly after it:

```ts
"/api/cron/pandadoc-da-reconcile", // PandaDoc DA status drift detector — CRON_SECRET validated in route
"/api/cron/zuper-status-reconcile", // Zuper job status drift detector — CRON_SECRET validated in route
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware.ts
git commit -m "chore(middleware): public-route zuper-status-reconcile cron path"
```

### Task 3.2: Add cron schedule to vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the cron entry**

Find the existing `pandadoc-da-reconcile` entry in the `crons` array. Add immediately after:

```json
{
  "path": "/api/cron/zuper-status-reconcile",
  "schedule": "*/15 * * * *"
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore(vercel): schedule zuper-status-reconcile cron every 15min"
```

### Task 3.3: Write the cron route

**Files:**
- Create: `src/app/api/cron/zuper-status-reconcile/route.ts`

- [ ] **Step 1: Implement the cron**

```ts
/**
 * GET /api/cron/zuper-status-reconcile
 *
 * Scans ZuperJobCache for the three job categories (honoring
 * CONSTRUCTION_JOB_SPLIT_ENABLED), compares each surviving sub-job
 * against its HubSpot deal, and writes drift rows to ZuperStatusDrift.
 *
 * Auth: bearer CRON_SECRET (matches other crons).
 * Feature flag: ZUPER_RECONCILE_ENABLED=true to activate.
 * Flag-only — no writes back to Zuper or HubSpot.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import { CONSTRUCTION_CATEGORY_NAMES } from "@/lib/zuper";
import {
  evaluateJobDrift,
  markSupersededJobs,
  toMappingCategory,
  type DriftEvalDeal,
  type DriftEvalJob,
  type DriftType,
} from "@/lib/zuper-status-mapping";

export const maxDuration = 60;

const LOOKBACK_DAYS = 90;

type ReconcileSummary = {
  scanned: number;
  candidates: number;
  superseded: number;
  matched: number;
  drifted: number;
  autoHealed: number;
  newDriftIds: string[];
  errors: string[];
};

// Map ZuperJobCache.jobCategory display name → canonical sub-type label.
function categoryFromCache(jobCategory: string): string {
  switch (jobCategory) {
    case "Site Survey": return "site_survey";
    case "Construction": return "construction";
    case "Solar Install": return "solar_install";
    case "Battery Install": return "battery_install";
    case "EV Install": return "ev_install";
    case "Inspection": return "inspection";
    default: return jobCategory.toLowerCase().replace(/\s+/g, "_");
  }
}

const HUBSPOT_PROPS = [
  "dealname",
  "pb_location",
  "pb_project_number",
  "site_survey_status",
  "install_status",
  "final_inspection_status",
  "construction_complete_date",
  "inspections_completion_date",
  "inspections_fail_date",
];

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ZUPER_RECONCILE_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  if (!prisma) {
    return NextResponse.json({ status: "error", error: "Database not configured" }, { status: 500 });
  }

  const summary: ReconcileSummary = {
    scanned: 0,
    candidates: 0,
    superseded: 0,
    matched: 0,
    drifted: 0,
    autoHealed: 0,
    newDriftIds: [],
    errors: [],
  };

  try {
    // 1. Pull jobs from ZuperJobCache. Filter by the three top-level categories,
    //    construction expanded to honor CONSTRUCTION_JOB_SPLIT_ENABLED.
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const allowedCategories = ["Site Survey", "Inspection", ...CONSTRUCTION_CATEGORY_NAMES];

    const cached = await prisma.zuperJobCache.findMany({
      where: {
        jobCategory: { in: allowedCategories },
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: "desc" },
    });
    summary.scanned = cached.length;

    // 2. Build DriftEvalJob entries with canonical category labels.
    const jobs: Array<DriftEvalJob & { dealId: string | null; pbLocation: string | null; projectName: string | null }> = [];
    for (const c of cached) {
      if (!c.hubspotDealId) continue; // no deal → no drift to compute
      const category = categoryFromCache(c.jobCategory);
      jobs.push({
        jobUid: c.jobUid,
        jobTitle: c.jobTitle,
        category,
        zuperStatus: c.jobStatus,
        completedAt: c.completedDate ? c.completedDate.toISOString() : null,
        dealId: c.hubspotDealId,
        pbLocation: null,
        projectName: c.projectName,
      });
    }
    summary.candidates = jobs.length;

    // 3. Apply markSupersededJobs to drop older siblings within (deal, category).
    //    markSupersededJobs mutates in place — we expect it to set a `superseded` flag.
    //    The extracted helper's signature accepts items with { hubspotDealId, category, createdAt }.
    //    See the lib for the precise shape. After the call, filter out superseded.
    const supersedableJobs = jobs.map((j) => ({
      hubspotDealId: j.dealId ?? "",
      category: toMappingCategory(j.category),
      createdAt: null as string | null,
      isSuperseded: false,
      _ref: j,
    }));
    markSupersededJobs(supersedableJobs);
    const survivingJobs = supersedableJobs.filter((s) => !s.isSuperseded).map((s) => s._ref);
    summary.superseded = jobs.length - survivingJobs.length;

    // 4. Batch-fetch HubSpot deals (chunks of 100).
    const dealIds = Array.from(new Set(survivingJobs.map((j) => j.dealId!).filter(Boolean)));
    const dealsById = new Map<string, DriftEvalDeal>();
    const CHUNK = 100;
    for (let i = 0; i < dealIds.length; i += CHUNK) {
      const batch = dealIds.slice(i, i + CHUNK);
      try {
        const res = await hubspotClient.crm.deals.batchApi.read({
          properties: HUBSPOT_PROPS,
          propertiesWithHistory: [],
          inputs: batch.map((id) => ({ id })),
        });
        for (const d of res.results) {
          dealsById.set(d.id, {
            dealId: d.id,
            dealName: (d.properties.dealname as string) ?? null,
            pbLocation: (d.properties.pb_location as string) ?? null,
            projectNumber: (d.properties.pb_project_number as string) ?? null,
            siteSurveyStatus: (d.properties.site_survey_status as string) ?? null,
            constructionStatus: (d.properties.install_status as string) ?? null,
            inspectionStatus: (d.properties.final_inspection_status as string) ?? null,
            constructionCompleteDate: (d.properties.construction_complete_date as string) ?? null,
            inspectionPassDate: (d.properties.inspections_completion_date as string) ?? null,
            inspectionFailDate: (d.properties.inspections_fail_date as string) ?? null,
          });
        }
      } catch (err) {
        summary.errors.push(`hubspot batch read failed for ${batch.length} deals: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 5. For each surviving job, evaluate drift + upsert/heal.
    for (const job of survivingJobs) {
      const deal = dealsById.get(job.dealId!);
      if (!deal) continue; // deal vanished — skip silently

      const driftTypes: DriftType[] = evaluateJobDrift(job, deal);

      if (driftTypes.length === 0) {
        // Heal any existing open drift for this job.
        const healed = await prisma.zuperStatusDrift.updateMany({
          where: { zuperJobUid: job.jobUid, status: "OPEN" },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolvedBy: "system:healed",
            resolveNote: "Zuper and HubSpot now match",
          },
        });
        if (healed.count > 0) summary.autoHealed += healed.count;
        else summary.matched++;
        continue;
      }

      summary.drifted++;

      // Pick the relevant hubspotStatus for display.
      const mc = toMappingCategory(job.category);
      const hubspotStatus =
        mc === "site_survey" ? deal.siteSurveyStatus :
        mc === "construction" ? deal.constructionStatus :
        deal.inspectionStatus;

      // Pick the relevant HubSpot date for display.
      const hubspotCompletionAt =
        mc === "construction" ? deal.constructionCompleteDate :
        mc === "inspection" && job.zuperStatus.toLowerCase() === "passed" ? deal.inspectionPassDate :
        null;
      const hubspotFailAt =
        mc === "inspection" && job.zuperStatus.toLowerCase() === "failed" ? deal.inspectionFailDate :
        null;

      const drift = await prisma.zuperStatusDrift.upsert({
        where: { zuperJobUid: job.jobUid },
        update: {
          hubspotDealId: job.dealId,
          projectNumber: deal.projectNumber,
          dealName: deal.dealName,
          pbLocation: deal.pbLocation,
          category: job.category,
          zuperJobTitle: job.jobTitle,
          zuperStatus: job.zuperStatus,
          hubspotStatus,
          driftTypes,
          zuperCompletedAt: job.completedAt ? new Date(job.completedAt) : null,
          hubspotCompletionAt: hubspotCompletionAt ? new Date(hubspotCompletionAt) : null,
          zuperFailedAt: job.zuperStatus.toLowerCase() === "failed" && job.completedAt ? new Date(job.completedAt) : null,
          hubspotFailAt: hubspotFailAt ? new Date(hubspotFailAt) : null,
          // Re-open if previously resolved/ignored.
          status: "OPEN",
          resolvedAt: null,
          resolvedBy: null,
          resolveNote: null,
        },
        create: {
          zuperJobUid: job.jobUid,
          hubspotDealId: job.dealId,
          projectNumber: deal.projectNumber,
          dealName: deal.dealName,
          pbLocation: deal.pbLocation,
          category: job.category,
          zuperJobTitle: job.jobTitle,
          zuperStatus: job.zuperStatus,
          hubspotStatus,
          driftTypes,
          zuperCompletedAt: job.completedAt ? new Date(job.completedAt) : null,
          hubspotCompletionAt: hubspotCompletionAt ? new Date(hubspotCompletionAt) : null,
          zuperFailedAt: job.zuperStatus.toLowerCase() === "failed" && job.completedAt ? new Date(job.completedAt) : null,
          hubspotFailAt: hubspotFailAt ? new Date(hubspotFailAt) : null,
        },
      });
      summary.newDriftIds.push(drift.id);
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      lookbackDays: LOOKBACK_DAYS,
      ...summary,
    });
  } catch (err) {
    console.error("[zuper-status-reconcile] failed:", err);
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : "Unknown error", partial: summary },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "zuper-status-reconcile" | head
```

Expected: no errors. If `markSupersededJobs` signature doesn't match the wrapper above, adapt: read the actual extracted signature from `src/lib/zuper-status-mapping.ts` and adjust accordingly. (Hint: the original mutates `isSuperseded` boolean on jobs grouped by `(hubspotDealId, category)` — use a structurally compatible shape.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/zuper-status-reconcile/route.ts
git commit -m "feat(cron): add zuper-status-reconcile (flag-off by default)"
```

---

## Chunk 4: PM API + Page + Suite Card + Allowlists

### Task 4.1: API endpoint at `/api/zuper-drift`

**Files:**
- Create: `src/app/api/zuper-drift/route.ts`
- Reference: `src/app/api/da-drift/route.ts` for the exact shape

- [ ] **Step 1: Implement the GET + POST handlers mirroring da-drift**

```ts
/**
 * GET  /api/zuper-drift?status=open|resolved|ignored|all
 * POST /api/zuper-drift  { id, action: "resolve"|"ignore"|"reopen", note? }
 *
 * Lists and resolves Zuper status drift entries written by the
 * /api/cron/zuper-status-reconcile job. Flag-only — these endpoints
 * do not push corrections to HubSpot or Zuper; the user clicks through
 * to fix.
 *
 * Surfaced in the Project Management suite — PMs are the ones who
 * reconcile, so they get access alongside admin and executive.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import type { ZuperDriftStatus } from "@/generated/prisma/enums";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER"] as const;

async function requireAccess() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!prisma) {
    return { error: NextResponse.json({ error: "Database not configured" }, { status: 500 }) };
  }
  const user = await getUserByEmail(session.user.email);
  const roles = user?.roles ?? [];
  if (!user || !roles.some((r) => ALLOWED_ROLES.includes(r as typeof ALLOWED_ROLES[number]))) {
    return { error: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;

  const statusParam = (request.nextUrl.searchParams.get("status") ?? "open").toLowerCase();
  const where: { status?: ZuperDriftStatus } = {};
  if (statusParam === "open") where.status = "OPEN";
  else if (statusParam === "resolved") where.status = "RESOLVED";
  else if (statusParam === "ignored") where.status = "IGNORED";

  const rows = await prisma!.zuperStatusDrift.findMany({
    where,
    orderBy: [{ detectedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({ status: "ok", count: rows.length, rows });
}

export async function POST(request: NextRequest) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;

  let body: { id?: string; action?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, action, note } = body;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Missing 'id'" }, { status: 400 });
  }

  let nextStatus: ZuperDriftStatus;
  switch (action) {
    case "resolve": nextStatus = "RESOLVED"; break;
    case "ignore":  nextStatus = "IGNORED"; break;
    case "reopen":  nextStatus = "OPEN"; break;
    default:
      return NextResponse.json({ error: "action must be 'resolve' | 'ignore' | 'reopen'" }, { status: 400 });
  }

  try {
    const updated = await prisma!.zuperStatusDrift.update({
      where: { id },
      data: {
        status: nextStatus,
        resolvedAt: nextStatus === "OPEN" ? null : new Date(),
        resolvedBy: nextStatus === "OPEN" ? null : gate.user.email,
        resolveNote: note?.slice(0, 500) ?? null,
      },
    });
    return NextResponse.json({ status: "ok", row: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error && err.message.includes("Record to update not found") ? "Drift record not found" : "Update failed" },
      { status: 404 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "zuper-drift/route" | head
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/zuper-drift/route.ts
git commit -m "feat(api): zuper-drift GET/POST for PM dashboard"
```

### Task 4.2: Dashboard page + client component

**Files:**
- Create: `src/app/dashboards/zuper-drift/page.tsx`
- Create: `src/app/dashboards/zuper-drift/ZuperDriftClient.tsx`
- Reference: `src/app/dashboards/da-drift/page.tsx` and `DaDriftClient.tsx`

- [ ] **Step 1: Implement page.tsx — server component**

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import DashboardShell from "@/components/DashboardShell";
import ZuperDriftClient from "./ZuperDriftClient";
import type { ZuperDriftStatus } from "@/generated/prisma/enums";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "EXECUTIVE", "PROJECT_MANAGER"] as const;

export default async function ZuperDriftPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  const roles = (session?.user as { roles?: string[] } | undefined)?.roles ?? [];
  if (!session?.user) redirect("/");
  const hasAccess = roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r));
  if (!hasAccess) redirect("/");

  if (!prisma) {
    return (
      <DashboardShell title="Zuper Status Drift" accentColor="cyan">
        <div className="bg-surface border border-t-border rounded-lg p-6 text-foreground">
          Database not configured.
        </div>
      </DashboardShell>
    );
  }

  const { status: statusParam } = await searchParams;
  const filter: "OPEN" | "RESOLVED" | "IGNORED" | "all" =
    statusParam === "RESOLVED" || statusParam === "IGNORED" || statusParam === "all"
      ? statusParam
      : "OPEN";

  const where: { status?: ZuperDriftStatus } = filter === "all" ? {} : { status: filter };

  const [rows, openCount, resolvedCount, ignoredCount] = await Promise.all([
    prisma.zuperStatusDrift.findMany({ where, orderBy: { detectedAt: "desc" }, take: 200 }),
    prisma.zuperStatusDrift.count({ where: { status: "OPEN" } }),
    prisma.zuperStatusDrift.count({ where: { status: "RESOLVED" } }),
    prisma.zuperStatusDrift.count({ where: { status: "IGNORED" } }),
  ]);

  return (
    <DashboardShell title="Zuper Status Drift" accentColor="cyan">
      <ZuperDriftClient
        initialRows={rows.map((r) => ({
          ...r,
          detectedAt: r.detectedAt.toISOString(),
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          zuperCompletedAt: r.zuperCompletedAt?.toISOString() ?? null,
          hubspotCompletionAt: r.hubspotCompletionAt?.toISOString() ?? null,
          zuperFailedAt: r.zuperFailedAt?.toISOString() ?? null,
          hubspotFailAt: r.hubspotFailAt?.toISOString() ?? null,
        }))}
        currentFilter={filter}
        counts={{ open: openCount, resolved: resolvedCount, ignored: ignoredCount }}
      />
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Implement ZuperDriftClient.tsx**

Read `src/app/dashboards/da-drift/DaDriftClient.tsx` end-to-end, then copy that file as the template. Adapt:

1. Type definitions match `ZuperStatusDrift` row shape (category, driftTypes array, zuperJobTitle, etc.)
2. Filter chips identical (Open / Resolved / Ignored / All)
3. Table columns per spec: Detected at · Project # / Deal name · Category badge · Drift type chips · Zuper status · HubSpot status · Date diff (when applicable) · Actions
4. Category badge colors:
   - `site_survey` → blue
   - `construction` → orange
   - `solar_install` → yellow
   - `battery_install` → green
   - `ev_install` → cyan
   - `inspection` → purple
5. External links:
   - HubSpot: `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/deal/${hubspotDealId}` (use existing `getInternalDealUrl` helper if it exists)
   - Zuper: `https://web.zuperpro.com/jobs/${zuperJobUid}/details`
6. Action POST hits `/api/zuper-drift` (NOT `/api/da-drift`)

- [ ] **Step 3: Typecheck + lint**

```bash
npx tsc --noEmit 2>&1 | grep "zuper-drift" | head
npx eslint src/app/dashboards/zuper-drift/ src/app/api/zuper-drift/ 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboards/zuper-drift/
git commit -m "feat(dashboard): zuper-drift PM page modeled on da-drift"
```

### Task 4.3: Wire up suite card + page directory + breadcrumb map + role allowlist

**Files:**
- Modify: `src/app/suites/project-management/page.tsx`
- Modify: `src/lib/page-directory.ts`
- Modify: `src/components/DashboardShell.tsx`
- Modify: `src/lib/roles.ts`

- [ ] **Step 1: Add suite card to PM suite**

Find the DA Status Drift card in `src/app/suites/project-management/page.tsx` (search for `"DA Status Drift"`). Add immediately after it:

```ts
{
  href: "/dashboards/zuper-drift",
  title: "Zuper Status Drift",
  description: "Zuper jobs whose status, completion date, or inspection result doesn't match HubSpot — backup for the native HubSpot↔Zuper sync.",
  tag: "REVIEW",
  icon: "🔁",
  section: "Reviews",
},
```

- [ ] **Step 2: Add page directory entry**

In `src/lib/page-directory.ts`, find the `/dashboards/zuper-` neighborhood (or alphabetical position between `/dashboards/zuper-compliance` and `/dashboards/zuper-status-comparison`) and add:

```ts
"/dashboards/zuper-drift",
```

- [ ] **Step 3: Add parent-suite map entry in DashboardShell**

In `src/components/DashboardShell.tsx` `SUITE_MAP`, find the `/dashboards/da-drift` entry. Add immediately after:

```ts
"/dashboards/zuper-drift": { href: "/suites/project-management", label: "Project Management" },
```

- [ ] **Step 4: Add routes to PROJECT_MANAGER allowlist**

In `src/lib/roles.ts`, find the `PROJECT_MANAGER` block (`const PROJECT_MANAGER: RoleDefinition`). In its `allowedRoutes` array, find the existing `/dashboards/da-drift` + `/api/da-drift` entries (added in PR #603). Add immediately after:

```ts
"/dashboards/zuper-drift",
"/api/zuper-drift",
```

- [ ] **Step 5: Typecheck + lint**

```bash
npx tsc --noEmit 2>&1 | grep -E "project-management|page-directory|DashboardShell|roles\.ts" | head
npx eslint src/app/suites/project-management/page.tsx src/lib/page-directory.ts src/components/DashboardShell.tsx src/lib/roles.ts 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/suites/project-management/page.tsx src/lib/page-directory.ts src/components/DashboardShell.tsx src/lib/roles.ts
git commit -m "feat(zuper-drift): wire suite card, page directory, breadcrumb, PM allowlist"
```

---

## Chunk 5: Backfill Script

### Task 5.1: One-off backfill script

**Files:**
- Create: `scripts/backfill-zuper-drift.ts`
- Reference: `scripts/backfill-da-drift.ts`

- [ ] **Step 1: Implement the script**

```ts
/* eslint-disable no-console */
/**
 * One-off historical sweep for Zuper status drift.
 *
 * Mirrors /api/cron/zuper-status-reconcile but with a wider lookback
 * (default 90 days). Latest-job-per-(deal, category) dedup so older
 * superseded sibling jobs don't generate false positives.
 *
 * Usage:
 *   LOOKBACK_DAYS=90 npx tsx scripts/backfill-zuper-drift.ts
 *   WIPE=1 LOOKBACK_DAYS=90 npx tsx scripts/backfill-zuper-drift.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { CONSTRUCTION_CATEGORY_NAMES } from "../src/lib/zuper";
import {
  evaluateJobDrift,
  markSupersededJobs,
  toMappingCategory,
  type DriftEvalDeal,
  type DriftEvalJob,
  type DriftType,
} from "../src/lib/zuper-status-mapping";
import { hubspotClient } from "../src/lib/hubspot";

const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 90);
const WIPE = process.env.WIPE === "1";

function categoryFromCache(jobCategory: string): string {
  switch (jobCategory) {
    case "Site Survey": return "site_survey";
    case "Construction": return "construction";
    case "Solar Install": return "solar_install";
    case "Battery Install": return "battery_install";
    case "EV Install": return "ev_install";
    case "Inspection": return "inspection";
    default: return jobCategory.toLowerCase().replace(/\s+/g, "_");
  }
}

const HUBSPOT_PROPS = [
  "dealname", "pb_location", "pb_project_number",
  "site_survey_status", "install_status", "final_inspection_status",
  "construction_complete_date", "inspections_completion_date", "inspections_fail_date",
];

async function main() {
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  if (WIPE) {
    const wiped = await prisma.zuperStatusDrift.deleteMany({});
    console.log(`Wiped ${wiped.count} existing drift rows (WIPE=1).`);
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const allowedCategories = ["Site Survey", "Inspection", ...CONSTRUCTION_CATEGORY_NAMES];
  console.log(`Scanning ZuperJobCache modified since ${since.toISOString()} (${LOOKBACK_DAYS}d lookback)...`);

  const cached = await prisma.zuperJobCache.findMany({
    where: { jobCategory: { in: allowedCategories }, updatedAt: { gte: since } },
    orderBy: { updatedAt: "desc" },
  });
  console.log(`Found ${cached.length} Zuper jobs.`);

  // Build candidate jobs with deal linkage.
  const jobs: Array<DriftEvalJob & { dealId: string }> = [];
  for (const c of cached) {
    if (!c.hubspotDealId) continue;
    jobs.push({
      jobUid: c.jobUid,
      jobTitle: c.jobTitle,
      category: categoryFromCache(c.jobCategory),
      zuperStatus: c.jobStatus,
      completedAt: c.completedDate ? c.completedDate.toISOString() : null,
      dealId: c.hubspotDealId,
    });
  }
  console.log(`${jobs.length} jobs have HubSpot deal linkage.`);

  // Mark superseded siblings.
  const supersedable = jobs.map((j) => ({
    hubspotDealId: j.dealId,
    category: toMappingCategory(j.category),
    createdAt: null as string | null,
    isSuperseded: false,
    _ref: j,
  }));
  markSupersededJobs(supersedable);
  const survivors = supersedable.filter((s) => !s.isSuperseded).map((s) => s._ref);
  console.log(`After superseded dedup: ${survivors.length} jobs (${jobs.length - survivors.length} superseded).`);

  // Batch-fetch HubSpot deals.
  const dealIds = Array.from(new Set(survivors.map((j) => j.dealId)));
  const dealsById = new Map<string, DriftEvalDeal>();
  const CHUNK = 100;
  for (let i = 0; i < dealIds.length; i += CHUNK) {
    const batch = dealIds.slice(i, i + CHUNK);
    try {
      const res = await hubspotClient.crm.deals.batchApi.read({
        properties: HUBSPOT_PROPS, propertiesWithHistory: [],
        inputs: batch.map((id) => ({ id })),
      });
      for (const d of res.results) {
        dealsById.set(d.id, {
          dealId: d.id,
          dealName: (d.properties.dealname as string) ?? null,
          pbLocation: (d.properties.pb_location as string) ?? null,
          projectNumber: (d.properties.pb_project_number as string) ?? null,
          siteSurveyStatus: (d.properties.site_survey_status as string) ?? null,
          constructionStatus: (d.properties.install_status as string) ?? null,
          inspectionStatus: (d.properties.final_inspection_status as string) ?? null,
          constructionCompleteDate: (d.properties.construction_complete_date as string) ?? null,
          inspectionPassDate: (d.properties.inspections_completion_date as string) ?? null,
          inspectionFailDate: (d.properties.inspections_fail_date as string) ?? null,
        });
      }
    } catch (err) {
      console.warn(`HubSpot batch failed for ${batch.length} deals:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`Fetched ${dealsById.size} HubSpot deals.`);

  // Evaluate + upsert.
  let drifted = 0, matched = 0, autoHealed = 0;
  const errors: string[] = [];

  for (const job of survivors) {
    const deal = dealsById.get(job.dealId);
    if (!deal) continue;

    const driftTypes: DriftType[] = evaluateJobDrift(job, deal);

    if (driftTypes.length === 0) {
      const healed = await prisma.zuperStatusDrift.updateMany({
        where: { zuperJobUid: job.jobUid, status: "OPEN" },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedBy: "system:healed",
          resolveNote: "Zuper and HubSpot now match",
        },
      });
      if (healed.count > 0) autoHealed += healed.count;
      else matched++;
      continue;
    }

    drifted++;
    const mc = toMappingCategory(job.category);
    const hubspotStatus =
      mc === "site_survey" ? deal.siteSurveyStatus :
      mc === "construction" ? deal.constructionStatus :
      deal.inspectionStatus;

    const hubspotCompletionAt =
      mc === "construction" ? deal.constructionCompleteDate :
      mc === "inspection" && job.zuperStatus.toLowerCase() === "passed" ? deal.inspectionPassDate :
      null;
    const hubspotFailAt =
      mc === "inspection" && job.zuperStatus.toLowerCase() === "failed" ? deal.inspectionFailDate :
      null;

    await prisma.zuperStatusDrift.upsert({
      where: { zuperJobUid: job.jobUid },
      update: {
        hubspotDealId: job.dealId, projectNumber: deal.projectNumber,
        dealName: deal.dealName, pbLocation: deal.pbLocation,
        category: job.category, zuperJobTitle: job.jobTitle,
        zuperStatus: job.zuperStatus, hubspotStatus, driftTypes,
        zuperCompletedAt: job.completedAt ? new Date(job.completedAt) : null,
        hubspotCompletionAt: hubspotCompletionAt ? new Date(hubspotCompletionAt) : null,
        zuperFailedAt: job.zuperStatus.toLowerCase() === "failed" && job.completedAt ? new Date(job.completedAt) : null,
        hubspotFailAt: hubspotFailAt ? new Date(hubspotFailAt) : null,
        status: "OPEN", resolvedAt: null, resolvedBy: null, resolveNote: null,
      },
      create: {
        zuperJobUid: job.jobUid, hubspotDealId: job.dealId,
        projectNumber: deal.projectNumber, dealName: deal.dealName,
        pbLocation: deal.pbLocation, category: job.category,
        zuperJobTitle: job.jobTitle, zuperStatus: job.zuperStatus,
        hubspotStatus, driftTypes,
        zuperCompletedAt: job.completedAt ? new Date(job.completedAt) : null,
        hubspotCompletionAt: hubspotCompletionAt ? new Date(hubspotCompletionAt) : null,
        zuperFailedAt: job.zuperStatus.toLowerCase() === "failed" && job.completedAt ? new Date(job.completedAt) : null,
        hubspotFailAt: hubspotFailAt ? new Date(hubspotFailAt) : null,
      },
    });

    process.stdout.write(`  • drift: deal=${job.dealId} job=${job.jobUid} types=${driftTypes.join(",")} — ${(job.jobTitle ?? "").slice(0, 60)}\n`);
  }

  console.log("\n=== Summary ===");
  console.log(`Scanned (cache rows):     ${cached.length}`);
  console.log(`With deal linkage:        ${jobs.length}`);
  console.log(`After dedup:              ${survivors.length}`);
  console.log(`Matched (in sync):        ${matched}`);
  console.log(`Auto-healed open rows:    ${autoHealed}`);
  console.log(`Drifted (logged):         ${drifted}`);
  console.log(`Errors:                   ${errors.length}`);
  if (errors.length) errors.slice(0, 20).forEach((e) => console.log("  -", e));

  await prisma.$disconnect();
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
```

- [ ] **Step 2: Commit (don't run yet — running is part of rollout)**

```bash
git add scripts/backfill-zuper-drift.ts
git commit -m "feat(scripts): one-off backfill for zuper status drift"
```

---

## Chunk 6: Rollout to Production

### Task 6.1: Push PR and validate CI

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin claude/zuper-status-drift
gh pr create --title "feat(zuper-drift): PM dashboard for Zuper↔HubSpot status drift" --body "$(cat docs/superpowers/specs/2026-05-12-zuper-status-drift-design.md | head -60)"
```

- [ ] **Step 2: Verify CI passes**

```bash
gh pr checks $(gh pr view --json number -q .number)
```

Expected: lint + typecheck pass. The Vercel preview deploy succeeds with `ZUPER_RECONCILE_ENABLED` unset → cron returns `{status: 'disabled'}` if hit.

### Task 6.2: Apply migration to prod BEFORE merging code

Per memory rule `prisma_migration_before_code` and `migration_ordering` — migration must land in prod before the code that depends on it.

- [ ] **Step 1: Apply migration to production database**

```bash
# Confirm migration file is committed and only contains additive SQL
cat prisma/migrations/*_add_zuper_status_drift/migration.sql

# Apply to prod
./scripts/migrate-prod.sh
```

Expected: migration applies cleanly. New table `ZuperStatusDrift` exists in prod.

- [ ] **Step 2: Merge the PR**

```bash
gh pr merge $(gh pr view --json number -q .number) --squash --delete-branch
```

### Task 6.3: Seed the table with backfill

- [ ] **Step 1: Pull prod env and run backfill against prod**

```bash
# From the worktree root, pull prod DB URL
vercel env pull .env.prod-readonly --environment=production --force

# Run backfill with WIPE just to be safe (table is empty post-migration anyway)
WIPE=1 LOOKBACK_DAYS=90 DATABASE_URL=$(grep DATABASE_URL .env.prod-readonly | cut -d= -f2- | tr -d '"') npx tsx scripts/backfill-zuper-drift.ts
```

Expected: output summary with finite drift count. Spot-check a few rows in the prod DB to confirm shapes are sane.

### Task 6.4: Enable the cron

- [ ] **Step 1: Set the flag in Vercel prod env**

Per memory rule `vercel_env_no_echo` — use `printf`, not `echo`.

```bash
printf '%s' "true" | vercel env add ZUPER_RECONCILE_ENABLED production
```

- [ ] **Step 2: Trigger a redeploy so the new env is live**

The next git push to main will redeploy with the flag active. If no other PRs are pending, push an empty commit to trigger:

```bash
git checkout main && git pull
git commit --allow-empty -m "chore: trigger redeploy for ZUPER_RECONCILE_ENABLED"
git push
```

- [ ] **Step 3: Verify the cron is firing**

Wait 15 minutes, then query Vercel runtime logs via the MCP tool (mcp__vercel__get_runtime_logs):

```
project: prj_yEgk70Cfe2FOJOcc430YlaZzkJ5d
team: team_PESITHiSZlQrARikIrfOSmoH
environment: production
query: /api/cron/zuper-status-reconcile
since: 1h
```

Expected: 200s every 15 minutes.

### Task 6.5: Watch for 24 hours

- [ ] **Step 1: Spot-check the prod dashboard**

Visit `https://pbtechops.com/dashboards/zuper-drift` (signed in as a PM or admin). Confirm:
- Filter chips show counts
- Rows render with correct category badges and drift type chips
- HubSpot + Zuper external links work
- Resolve / Ignore / Reopen actions update the row

- [ ] **Step 2: Re-check Vercel logs the next day for error patterns**

If `errors[]` length is consistently >0, investigate the messages. Most likely cause: HubSpot 429/timeout on a deal batch; the next tick retries automatically.

- [ ] **Step 3: Update memory + post-mortem if needed**

Add a memory note if any rollout surprise — wrong property names, sub-type bugs, etc. Otherwise declare GA.

---

## File-by-file summary

| File | Action | Purpose |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `ZuperStatusDrift` model + 2 enums |
| `prisma/migrations/<ts>_add_zuper_status_drift/migration.sql` | Create (generated) | Additive migration |
| `src/lib/zuper-status-mapping.ts` | Create | Extract STATUS_MAPPING + helpers + new `evaluateJobDrift` |
| `src/__tests__/zuper-status-mapping.test.ts` | Create | TDD coverage for the decision function |
| `src/app/api/zuper/status-comparison/route.ts` | Modify | Re-import from new lib, drop local copies |
| `src/middleware.ts` | Modify | Add cron path to PUBLIC_API_ROUTES |
| `vercel.json` | Modify | Add cron schedule |
| `src/app/api/cron/zuper-status-reconcile/route.ts` | Create | The cron itself |
| `src/app/api/zuper-drift/route.ts` | Create | PM-facing GET/POST API |
| `src/app/dashboards/zuper-drift/page.tsx` | Create | Server component (auth + initial data) |
| `src/app/dashboards/zuper-drift/ZuperDriftClient.tsx` | Create | Client UI (filter chips + table + actions) |
| `src/app/suites/project-management/page.tsx` | Modify | Add suite card |
| `src/lib/page-directory.ts` | Modify | Register new page |
| `src/components/DashboardShell.tsx` | Modify | Breadcrumb parent map |
| `src/lib/roles.ts` | Modify | PROJECT_MANAGER allowlist additions |
| `scripts/backfill-zuper-drift.ts` | Create | One-off historical sweep |

## Memory rules honored

- `prisma_migration_before_code` — migration applied to prod before code merge
- `migration_ordering` — additive only; no destructive operations
- `vercel_env_no_echo` — `printf` used for env var creation
- `api_route_role_allowlist` — explicit /api/zuper-drift entry added to PROJECT_MANAGER.allowedRoutes
- `suite_card_implies_route` — suite card addition paired with route allowlist add
- `dont_delete_move_to_admin` — existing admin zuper-status-comparison page stays unchanged
- `claudemd_no_brittle_counts` — no exact line counts in CLAUDE.md or code comments
- `subagents_no_migrations` — `migrate-prod.sh` runs in the orchestrator's hands, not a subagent
