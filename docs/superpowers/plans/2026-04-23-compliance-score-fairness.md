# Compliance Score Fairness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace parent-job-level compliance attribution with per-service-task attribution, so techs are scored on the specific work they did rather than on unrelated delays by other teams on the same job. Plus fix status bucket coverage gaps. All behind a feature flag with shadow-compare before flip.

**Architecture:**
- New `src/lib/compliance-v2/` module implements the per-service-task scoring model (credit sets, 1/N fractional attribution, expanded status buckets).
- Existing `computeLocationCompliance` in `src/lib/compliance-compute.ts` delegates to v2 when `COMPLIANCE_V2_ENABLED=true`.
- A new `ComplianceScoreShadow` Prisma model captures v1 vs v2 scores for 30 days of comparison before the flag flips.
- UI updates in `ComplianceBlock.tsx` add a Tasks/Jobs column, Pass-rate column, follow-up badge, and a low-volume grade suppression.

**Tech Stack:**
- TypeScript, Next.js 16.1, Prisma 7, Jest, React 19, Tailwind v4
- Zuper REST API (`/service_tasks`, `/assets/inspection_form`)
- Existing `src/lib/compliance-compute.ts` scoring engine (v1)
- Feature flag: `COMPLIANCE_V2_ENABLED` env var

**Spec:** [docs/superpowers/specs/2026-04-23-compliance-score-fairness-design.md](../specs/2026-04-23-compliance-score-fairness-design.md)

**Reference skills:** @superpowers:test-driven-development, @superpowers:verification-before-completion

---

## File structure

### New files
| Path | Responsibility |
|---|---|
| `src/lib/compliance-v2/index.ts` | Public exports (computeLocationComplianceV2, types) |
| `src/lib/compliance-v2/types.ts` | V2-specific types (EmployeeComplianceV2, TaskCreditEntry) |
| `src/lib/compliance-v2/feature-flag.ts` | Single source of truth for reading `COMPLIANCE_V2_ENABLED` |
| `src/lib/compliance-v2/task-classification.ts` | `TASK_TITLE_CLASSIFICATION` constant (Work vs Paperwork) |
| `src/lib/compliance-v2/status-buckets.ts` | Expanded parent-job + task-level bucket sets |
| `src/lib/compliance-v2/service-tasks-fetcher.ts` | Fetch `/service_tasks` + linked form submissions per job, with per-request memoization |
| `src/lib/compliance-v2/credit-set.ts` | Pure function: compute credit set for a task (assignees ∪ form.created_by) |
| `src/lib/compliance-v2/task-timestamp.ts` | Pure function: "earliest of" task actual_end / form created_at / parent completion |
| `src/lib/compliance-v2/scoring.ts` | Main `computeLocationComplianceV2` — orchestrates fetch + credit + timestamps + per-tech accumulation |
| `src/__tests__/compliance-v2/fixtures/jobs.ts` | Hand-crafted Zuper job + task + form fixtures for each case in spec §9 |
| `src/__tests__/compliance-v2/scoring.test.ts` | All spec §9 test cases against computeLocationComplianceV2 |
| `src/__tests__/compliance-v2/credit-set.test.ts` | Pure unit tests for credit-set computation |
| `src/__tests__/compliance-v2/status-buckets.test.ts` | Pure unit tests for bucket classification, case variants |
| `src/__tests__/compliance-v2/task-timestamp.test.ts` | Pure unit tests for "earliest of" timestamp logic |
| `src/app/dashboards/office-performance/[location]/__tests__/ComplianceBlock.test.tsx` | Snapshot tests for new UI states |
| `src/app/api/cron/compliance-shadow-cleanup/route.ts` | Daily cron to prune rows > 60 days from ComplianceScoreShadow |
| `scripts/snapshot-compliance-baseline.ts` | PRE-CHANGE one-shot: capture v1 scores to markdown before any code lands (user request 2026-04-23) |
| `scripts/enumerate-service-task-titles.ts` | Throwaway: enumerate all distinct task titles for 90d (spec §8.2) |
| `scripts/enumerate-service-task-statuses.ts` | Throwaway: enumerate all distinct task statuses for 90d (spec §8.3) |
| `scripts/compliance-shadow-compare.ts` | One-shot: compute v1 + v2 for 30d, insert into ComplianceScoreShadow |
| `scripts/lucas-compliance-diff.ts` | One-shot: Lucas + CA crew v1 vs v2 analysis, writes markdown (spec §8.4) |
| `docs/superpowers/analyses/2026-04-23-compliance-baseline.md` | Immutable v1 baseline snapshot captured before any code changes |
| `docs/superpowers/analyses/2026-04-XX-lucas-compliance-diff.md` | Output of the sanity-check script; reviewed before flag flip |

### Modified files
| Path | Changes |
|---|---|
| `prisma/schema.prisma` | Add `ComplianceScoreShadow` model |
| `src/lib/compliance-helpers.ts` | **No behavior changes** — constants stay as legacy v1. V2 puts its expanded sets in `src/lib/compliance-v2/status-buckets.ts` so shadow-compare is a clean A/B. |
| `src/lib/compliance-compute.ts` | Add flag gate at top of `computeLocationCompliance` that delegates to `computeLocationComplianceV2` when flag is on |
| `src/lib/office-performance-types.ts` | Extend `EmployeeCompliance` with v2 optional fields (`tasksFractional?`, `distinctParentJobs?`, `passRate?`, `hasFollowUp?`, `lowVolume?`) — nullable so v1 output is unchanged |
| `src/app/api/zuper/compliance/route.ts` | Include flag value in response cache key; no compute changes (delegation happens inside `computeLocationCompliance`) |
| `src/app/dashboards/office-performance/[location]/ComplianceBlock.tsx` | New Tasks/Jobs column format, Pass-rate column, follow-up badge, low-volume grade suppression, legend update |
| `src/__tests__/compliance-compute.test.ts` | Add one test: flag OFF → v1 path unchanged (regression guard) |

### Dependency order
Chunks must be completed in order — later chunks depend on earlier modules.

---

## Chunk 1: Baseline snapshot, enumerations, shadow table

**Why first:** We need an immutable baseline of v1 scores captured before any code lands, so v2 comparison is against "what scores actually were at the time of the user complaint" — not a moving target. Task classification for Chunk 2 also depends on enumeration output.

### Task 1.0: Snapshot current (v1) scores BEFORE any code changes

**Files:**
- Create: `scripts/snapshot-compliance-baseline.ts`
- Create: `docs/superpowers/analyses/2026-04-23-compliance-baseline.md` (output)

Rationale: even if the shadow-compare script later runs v1 alongside v2, underlying Zuper data may have shifted by then. This baseline locks in what scores actually read today, so post-rollout comparisons reference a stable truth.

- [ ] **Step 1: Write the snapshot script**

Create `scripts/snapshot-compliance-baseline.ts`:

```ts
/**
 * ONE-SHOT: snapshot today's v1 compliance scores to a markdown file.
 * Runs BEFORE any Chunk 1.1+ changes land, so the baseline is immutable.
 *
 * Output: docs/superpowers/analyses/<today>-compliance-baseline.md
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";
import { computeLocationCompliance } from "../src/lib/compliance-compute";
import fs from "node:fs";
import path from "node:path";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];
const CATEGORIES = ["Site Survey", "Construction", "Inspection"];

async function main() {
  // Ensure v1 path (should be default but be explicit)
  delete process.env.COMPLIANCE_V2_ENABLED;

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

  const windowDays = 30;
  const rows: string[] = [
    `# Compliance v1 baseline — ${new Date().toISOString().split("T")[0]}`,
    ``,
    `**Captured:** ${new Date().toISOString()}`,
    `**Window:** last ${windowDays} days`,
    `**Flag state:** COMPLIANCE_V2_ENABLED is off (v1 path)`,
    ``,
    `| Location | Category | Employee | Grade | Score | On-time% | Jobs | Stuck | NS |`,
    `|---|---|---|---|---|---|---|---|---|`,
  ];

  for (const location of LOCATIONS) {
    for (const category of CATEGORIES) {
      const result = await computeLocationCompliance(category, location, windowDays);
      if (!result) continue;
      for (const e of result.byEmployee) {
        rows.push(
          `| ${location} | ${category} | ${e.name} | ${e.grade} | ${e.complianceScore} | ${e.onTimePercent} | ${e.totalJobs} | ${e.stuckCount} | ${e.neverStartedCount} |`
        );
      }
    }
  }

  rows.push(``, `## Raw JSON`, ``, "```json", JSON.stringify({ capturedAt: new Date().toISOString(), windowDays }, null, 2), "```");

  const outDir = path.join(process.cwd(), "docs/superpowers/analyses");
  fs.mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const outFile = path.join(outDir, `${today}-compliance-baseline.md`);
  fs.writeFileSync(outFile, rows.join("\n"));
  console.log(`Wrote ${outFile}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the snapshot**

```bash
set -a && source ../../../.env && set +a && npx tsx scripts/snapshot-compliance-baseline.ts
```

Expected: markdown file with rows for every (location × category × employee) that has data today.

- [ ] **Step 3: Commit both the script and the generated baseline**

```bash
git add scripts/snapshot-compliance-baseline.ts docs/superpowers/analyses/
git commit -m "chore(compliance-v2): pre-change v1 baseline snapshot"
```

After this task, the baseline exists on disk and in git history. Any subsequent v1 re-computation is a sanity check, but the *source of truth* for "what scores looked like before" is this committed file.

### Task 1.1: Add `COMPLIANCE_V2_ENABLED` env var + feature-flag helper

**Files:**
- Create: `src/lib/compliance-v2/feature-flag.ts`
- Modify: `.env.example:<append>`

- [ ] **Step 1: Add env var to `.env.example`**

Append:
```
# Compliance scoring v2 (per-service-task attribution). Set to "true" to enable.
# See docs/superpowers/specs/2026-04-23-compliance-score-fairness-design.md
COMPLIANCE_V2_ENABLED=false
```

- [ ] **Step 2: Write failing test**

Create `src/__tests__/compliance-v2/feature-flag.test.ts`:

```ts
import { isComplianceV2Enabled } from "@/lib/compliance-v2/feature-flag";

describe("isComplianceV2Enabled", () => {
  const origEnv = process.env.COMPLIANCE_V2_ENABLED;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.COMPLIANCE_V2_ENABLED;
    else process.env.COMPLIANCE_V2_ENABLED = origEnv;
  });

  it("returns true when env var is 'true'", () => {
    process.env.COMPLIANCE_V2_ENABLED = "true";
    expect(isComplianceV2Enabled()).toBe(true);
  });
  it("returns true when env var is 'TRUE'", () => {
    process.env.COMPLIANCE_V2_ENABLED = "TRUE";
    expect(isComplianceV2Enabled()).toBe(true);
  });
  it("returns false when env var is 'false'", () => {
    process.env.COMPLIANCE_V2_ENABLED = "false";
    expect(isComplianceV2Enabled()).toBe(false);
  });
  it("returns false when env var is unset", () => {
    delete process.env.COMPLIANCE_V2_ENABLED;
    expect(isComplianceV2Enabled()).toBe(false);
  });
  it("returns false when env var is any other string", () => {
    process.env.COMPLIANCE_V2_ENABLED = "yes";
    expect(isComplianceV2Enabled()).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm test -- feature-flag.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement feature-flag helper**

Create `src/lib/compliance-v2/feature-flag.ts`:

```ts
/**
 * Single source of truth for the COMPLIANCE_V2_ENABLED feature flag.
 * Used both for the scoring-path delegation and for cache key construction,
 * so stale v1 results are never served after the flag flips.
 */
export function isComplianceV2Enabled(): boolean {
  return (process.env.COMPLIANCE_V2_ENABLED ?? "").toLowerCase() === "true";
}

/** Short string form for cache keys. Changes when flag changes. */
export function complianceVersionTag(): "v1" | "v2" {
  return isComplianceV2Enabled() ? "v2" : "v1";
}
```

- [ ] **Step 5: Run test to verify pass**

Run: `npm test -- feature-flag.test.ts`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add .env.example src/lib/compliance-v2/feature-flag.ts src/__tests__/compliance-v2/feature-flag.test.ts
git commit -m "feat(compliance-v2): COMPLIANCE_V2_ENABLED feature flag helper"
```

### Task 1.2: Add `ComplianceScoreShadow` Prisma model

**Files:**
- Modify: `prisma/schema.prisma`

Read @feedback_subagents_no_migrations — subagents CAN write migration files but CANNOT run `prisma migrate deploy`. The orchestrator will run the migration manually with user approval.

- [ ] **Step 1: Add model to schema**

Append to `prisma/schema.prisma` (place after `ZuperJobCache`):

```prisma
// ===========================================
// COMPLIANCE SCORE SHADOW (v1 vs v2 compare)
// ===========================================

model ComplianceScoreShadow {
  id String @id @default(cuid())

  computedAt DateTime @default(now())

  userUid   String
  userName  String
  location  String // e.g. "Westminster", "San Luis Obispo"
  category  String // e.g. "Construction", "Site Survey", "Inspection"

  windowDays Int

  v1Score Float
  v1Grade String
  v2Score Float
  v2Grade String

  v1TotalJobs           Int
  v2TasksFractional     Float
  v2DistinctParentJobs  Int
  emptyCreditSetJobs    Int

  @@index([computedAt])
  @@index([userUid])
  @@index([location])
}
```

- [ ] **Step 2: Create the migration file**

Run: `npx prisma migrate dev --name add_compliance_score_shadow --create-only`
Expected: new directory `prisma/migrations/<timestamp>_add_compliance_score_shadow/migration.sql`.

- [ ] **Step 3: Inspect the migration**

Read the generated `migration.sql`. Verify it only `CREATE TABLE "ComplianceScoreShadow"` + indexes. No column drops elsewhere.

- [ ] **Step 4: Commit migration file**

```bash
git add prisma/schema.prisma prisma/migrations/<timestamp>_add_compliance_score_shadow/
git commit -m "feat(compliance-v2): ComplianceScoreShadow model for v1/v2 compare"
```

- [ ] **Step 5: SURFACE TO HUMAN (not subagent action)**

Print this block in the final report for the orchestrator to relay to the user:

> Migration file staged at `prisma/migrations/<timestamp>_add_compliance_score_shadow/migration.sql`. Per @feedback_subagents_no_migrations, I haven't run it. Approve `npx prisma migrate deploy` before Chunk 5 begins writing to this table.

### Task 1.3: Service task title enumeration script

**Files:**
- Create: `scripts/enumerate-service-task-titles.ts`

- [ ] **Step 1: Write the script**

Create `scripts/enumerate-service-task-titles.ts`:

```ts
/**
 * Enumerate distinct service_task_title values from Zuper across the last
 * 90 days, grouped by parent job_category. Output: a table the operator
 * uses to populate TASK_TITLE_CLASSIFICATION.
 *
 * Read-only (reads from DB + Zuper API). Safe to re-run.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

async function main() {
  const apiKey = process.env.ZUPER_API_KEY;
  const baseUrl = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  if (!apiKey) { console.error("ZUPER_API_KEY not set"); process.exit(1); }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Pull all Construction + Additional Visit + Service Visit + Service Revisit jobs
  // (other categories don't have service tasks worth scoring per spec §2.1)
  const jobs = await prisma.zuperJobCache.findMany({
    where: {
      lastSyncedAt: { gte: since },
      jobCategory: { in: ["Construction", "Additional Visit", "Service Visit", "Service Revisit"] },
    },
    select: { jobUid: true, jobCategory: true },
    take: 300, // sample, not exhaustive — enough to see all title variants
  });

  const byTitle = new Map<string, number>();
  const byCatTitle = new Map<string, Map<string, number>>();

  for (const j of jobs) {
    const url = `${baseUrl}/service_tasks?filter.module_uid=${encodeURIComponent(j.jobUid)}`;
    try {
      const r = await fetch(url, { headers: { "x-api-key": apiKey } });
      if (!r.ok) continue;
      const body = await r.json();
      const tasks = (body?.data ?? body?.service_tasks ?? body ?? []) as Array<{ service_task_title?: string }>;
      for (const t of tasks) {
        const title = (t.service_task_title ?? "(null)").trim();
        byTitle.set(title, (byTitle.get(title) ?? 0) + 1);
        if (!byCatTitle.has(j.jobCategory)) byCatTitle.set(j.jobCategory, new Map());
        const m = byCatTitle.get(j.jobCategory)!;
        m.set(title, (m.get(title) ?? 0) + 1);
      }
    } catch {
      // skip individual job failures
    }
  }

  console.log(`Sampled ${jobs.length} jobs\n`);
  console.log("=== All service task titles (overall) ===");
  for (const [title, n] of [...byTitle.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${title}`);
  }
  for (const [cat, m] of [...byCatTitle.entries()].sort()) {
    console.log(`\n=== ${cat} ===`);
    for (const [title, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${title}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the script**

Run:
```bash
set -a && source ../../../.env && set +a && npx tsx scripts/enumerate-service-task-titles.ts 2>&1 | tee /tmp/task-titles-enumeration.txt
```

Expected: table of titles with counts. Save the output — it's the source of truth for Chunk 2's classification.

- [ ] **Step 3: Classify each title**

Write the classification decision inline as a comment at the top of `scripts/enumerate-service-task-titles.ts` (the script becomes its own archive). Format:

```
// CLASSIFICATION (reviewed <date>):
//   WORK: PV Install - Colorado, PV Install - California, Electrical Install - Colorado,
//         Electrical Install - California, Loose Ends
//   PAPERWORK: JHA Form, Xcel PTO, Participate Energy Photos
//   UNKNOWN (needs human review): <any others>
```

- [ ] **Step 4: Commit**

```bash
git add scripts/enumerate-service-task-titles.ts
git commit -m "chore(compliance-v2): enumerate service task titles (spec §8.2)"
```

### Task 1.4: Service task status enumeration script

**Files:**
- Create: `scripts/enumerate-service-task-statuses.ts`

- [ ] **Step 1: Write the script**

Same shape as 1.3 but extracts `service_task_status` instead of `service_task_title`. Output grouped by category. Full code:

```ts
/**
 * Enumerate distinct service_task_status values from Zuper, 90-day window.
 * Read-only. Output used to populate task-level status bucket sets in
 * src/lib/compliance-v2/status-buckets.ts.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

async function main() {
  const apiKey = process.env.ZUPER_API_KEY!;
  const baseUrl = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const jobs = await prisma.zuperJobCache.findMany({
    where: { lastSyncedAt: { gte: since } },
    select: { jobUid: true, jobCategory: true },
    take: 300,
  });

  const byStatus = new Map<string, number>();
  const byCatStatus = new Map<string, Map<string, number>>();
  for (const j of jobs) {
    try {
      const r = await fetch(`${baseUrl}/service_tasks?filter.module_uid=${encodeURIComponent(j.jobUid)}`, { headers: { "x-api-key": apiKey } });
      if (!r.ok) continue;
      const body = await r.json();
      const tasks = (body?.data ?? body?.service_tasks ?? body ?? []) as Array<{ service_task_status?: string }>;
      for (const t of tasks) {
        const s = (t.service_task_status ?? "(null)").trim();
        byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
        if (!byCatStatus.has(j.jobCategory)) byCatStatus.set(j.jobCategory, new Map());
        const m = byCatStatus.get(j.jobCategory)!;
        m.set(s, (m.get(s) ?? 0) + 1);
      }
    } catch { /* skip */ }
  }

  console.log(`Sampled ${jobs.length} jobs`);
  console.log("\n=== All service task statuses ===");
  for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${s}`);
  }
  for (const [cat, m] of [...byCatStatus.entries()].sort()) {
    console.log(`\n=== ${cat} ===`);
    for (const [s, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${s}`);
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run and save output**

Run:
```bash
set -a && source ../../../.env && set +a && npx tsx scripts/enumerate-service-task-statuses.ts 2>&1 | tee /tmp/task-statuses-enumeration.txt
```

- [ ] **Step 3: Annotate the script with bucket classifications**

Prepend a comment block to `scripts/enumerate-service-task-statuses.ts`:

```
// BUCKET CLASSIFICATION (reviewed <date>):
//   COMPLETED: COMPLETED (add others if observed)
//   STUCK: IN_PROGRESS, STARTED (add others)
//   NEVER_STARTED: NEW, SCHEDULED (add others)
//   EXCLUDED: CANCELLED, SKIPPED (add others)
```

- [ ] **Step 4: Commit**

```bash
git add scripts/enumerate-service-task-statuses.ts
git commit -m "chore(compliance-v2): enumerate service task statuses (spec §8.3)"
```

---

## Chunk 2: Types, status buckets, task classification

### Task 2.1: V2 types

**Files:**
- Create: `src/lib/compliance-v2/types.ts`

- [ ] **Step 1: Write types**

Create `src/lib/compliance-v2/types.ts`:

```ts
/**
 * Types specific to the v2 per-service-task compliance scoring engine.
 *
 * Mirrors EmployeeCompliance from office-performance-types.ts but replaces
 * integer totalJobs with fractional tasksFractional (1/N-weighted credits).
 */

/** Status bucket assigned to a service task. */
export type TaskBucket =
  | "completed-full"
  | "completed-follow-up"
  | "completed-failed"
  | "stuck"
  | "never-started"
  | "excluded";

/** Classification of a service task by title. */
export type TaskClassification = "work" | "paperwork" | "unknown";

/** One row in a tech's per-task audit — used for the score-breakdown tooltip. */
export interface TaskCreditEntry {
  jobUid: string;
  jobTitle: string;
  taskUid: string;
  taskTitle: string;
  bucket: TaskBucket;
  weight: number;             // 1/N
  timestamp: string | null;   // ISO — the "earliest of" resolved value
  scheduledEnd: string | null;
  onTime: boolean | null;     // null when bucket is not a completion
  stuck: boolean;
  neverStarted: boolean;
  failed: boolean;
  followUp: boolean;
}

/** Per-employee stats produced by computeLocationComplianceV2. */
export interface EmployeeComplianceV2 {
  userUid: string;
  name: string;

  tasksFractional: number;      // Σ 1/N credits
  distinctParentJobs: number;   // count of distinct parent job UIDs touched

  onTimeCount: number;          // fractional (Σ onTime contributions)
  lateCount: number;            // fractional
  measurableCount: number;      // onTime + late
  onTimePercent: number;        // -1 if measurableCount == 0

  stuckCount: number;           // fractional
  neverStartedCount: number;    // fractional

  failedCount: number;          // fractional — for pass rate
  passRate: number;             // -1 if no Failed or non-Failed completions applicable

  hasFollowUp: boolean;         // any Completed - Follow-up in the window

  complianceScore: number;      // 0-100
  grade: string;                // A-F, or "—" when lowVolume
  lowVolume: boolean;           // tasksFractional < MIN_TASKS_THRESHOLD

  /** Per-task audit list for tooltip. */
  entries: TaskCreditEntry[];
}

export interface LocationComplianceV2Result {
  byEmployee: EmployeeComplianceV2[];
  emptyCreditSetJobs: number;   // diagnostic for spec §7.2
}

/** Minimum task credits before showing a grade letter (spec §6). */
export const MIN_TASKS_THRESHOLD = 5;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/compliance-v2/types.ts
git commit -m "feat(compliance-v2): types for per-task scoring"
```

### Task 2.2: Status bucket sets

**Files:**
- Create: `src/lib/compliance-v2/status-buckets.ts`
- Create: `src/__tests__/compliance-v2/status-buckets.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/compliance-v2/status-buckets.test.ts`:

```ts
import {
  classifyJobStatus,
  classifyTaskStatus,
  JOB_BUCKET,
  TASK_BUCKET,
} from "@/lib/compliance-v2/status-buckets";

describe("classifyJobStatus", () => {
  // Existing buckets stay correct
  it("classifies Completed as completed-full", () => {
    expect(classifyJobStatus("Completed")).toBe("completed-full");
  });
  it("classifies On Our Way as stuck", () => {
    expect(classifyJobStatus("On Our Way")).toBe("stuck");
  });

  // Bug fixes from spec §3.1
  it("classifies On My Way (variant) as stuck", () => {
    expect(classifyJobStatus("On My Way")).toBe("stuck");
  });
  it("classifies On My Way - AV as stuck", () => {
    expect(classifyJobStatus("On My Way - AV")).toBe("stuck");
  });
  it("classifies Started - AV as stuck", () => {
    expect(classifyJobStatus("Started - AV")).toBe("stuck");
  });
  it("classifies Completed - AV as completed-full", () => {
    expect(classifyJobStatus("Completed - AV")).toBe("completed-full");
  });
  it("classifies Scheduled - AV as never-started", () => {
    expect(classifyJobStatus("Scheduled - AV")).toBe("never-started");
  });

  // Follow-up closures
  it("classifies Return Visit Required as completed-follow-up", () => {
    expect(classifyJobStatus("Return Visit Required")).toBe("completed-follow-up");
  });
  it("classifies Loose Ends Remaining as completed-follow-up", () => {
    expect(classifyJobStatus("Loose Ends Remaining")).toBe("completed-follow-up");
  });
  it("classifies Needs Revisit as completed-follow-up", () => {
    expect(classifyJobStatus("Needs Revisit")).toBe("completed-follow-up");
  });

  // Failed bucket
  it("classifies Failed as completed-failed", () => {
    expect(classifyJobStatus("Failed")).toBe("completed-failed");
  });

  // Excluded
  it("classifies On Hold as excluded", () => {
    expect(classifyJobStatus("On Hold")).toBe("excluded");
  });
  it("classifies Scheduling On-Hold as excluded", () => {
    expect(classifyJobStatus("Scheduling On-Hold")).toBe("excluded");
  });
  it("classifies Ready To Forecast as excluded", () => {
    expect(classifyJobStatus("Ready To Forecast")).toBe("excluded");
  });

  // Case insensitivity
  it("handles upper-case SCHEDULED", () => {
    expect(classifyJobStatus("SCHEDULED")).toBe("never-started");
  });
  it("handles 'Ready to Build' case variant", () => {
    expect(classifyJobStatus("Ready to Build")).toBe("never-started");
  });

  // Unknown status defaults to excluded (safer than picking a bucket)
  it("classifies unknown as excluded", () => {
    expect(classifyJobStatus("Martian Landing")).toBe("excluded");
  });
});

describe("classifyTaskStatus", () => {
  it("classifies COMPLETED as completed-full", () => {
    expect(classifyTaskStatus("COMPLETED")).toBe("completed-full");
  });
  it("classifies lower-case 'completed' as completed-full", () => {
    expect(classifyTaskStatus("completed")).toBe("completed-full");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- status-buckets.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement status buckets**

Create `src/lib/compliance-v2/status-buckets.ts`:

```ts
import type { TaskBucket } from "./types";

/**
 * Expanded parent-job status bucket sets. Based on enumeration from spec §8.1
 * over 4,314 jobs in 90 days.
 *
 * All comparisons are case-insensitive via toLowerCase() at classification time.
 */

const COMPLETED_FULL = new Set([
  "completed",
  "completed - av",
  "construction complete",
  "passed",
  "partial pass",
].map((s) => s.toLowerCase()));

const COMPLETED_FOLLOW_UP = new Set([
  "return visit required",
  "loose ends remaining",
  "needs revisit",
].map((s) => s.toLowerCase()));

const COMPLETED_FAILED = new Set([
  "failed",
].map((s) => s.toLowerCase()));

const STUCK = new Set([
  "started",
  "started - av",
  "on our way",
  "on my way",
  "on my way - av",
  "in progress",
].map((s) => s.toLowerCase()));

const NEVER_STARTED = new Set([
  "new",
  "scheduled",
  "scheduled - av",
  "unassigned",
  "ready to schedule",
  "ready to build",
  "ready for inspection",
].map((s) => s.toLowerCase()));

const EXCLUDED = new Set([
  "on hold",
  "scheduling on-hold",
  "ready to forecast",
].map((s) => s.toLowerCase()));

export const JOB_BUCKET = {
  COMPLETED_FULL,
  COMPLETED_FOLLOW_UP,
  COMPLETED_FAILED,
  STUCK,
  NEVER_STARTED,
  EXCLUDED,
} as const;

/** Classify a parent job status string into a bucket. Unknown → excluded. */
export function classifyJobStatus(status: string): TaskBucket {
  const s = (status ?? "").toLowerCase().trim();
  if (COMPLETED_FULL.has(s)) return "completed-full";
  if (COMPLETED_FOLLOW_UP.has(s)) return "completed-follow-up";
  if (COMPLETED_FAILED.has(s)) return "completed-failed";
  if (STUCK.has(s)) return "stuck";
  if (NEVER_STARTED.has(s)) return "never-started";
  return "excluded";
}

/**
 * Task-level status buckets. Populated from spec §8.3 enumeration output.
 * Default values here — adjust after running scripts/enumerate-service-task-statuses.ts
 * and reviewing its output.
 */
const TASK_COMPLETED = new Set([
  "completed",
].map((s) => s.toLowerCase()));

const TASK_STUCK = new Set([
  "started",
  "in_progress",
  "in progress",
].map((s) => s.toLowerCase()));

const TASK_NEVER_STARTED = new Set([
  "new",
  "scheduled",
].map((s) => s.toLowerCase()));

const TASK_EXCLUDED = new Set([
  "cancelled",
  "skipped",
].map((s) => s.toLowerCase()));

export const TASK_BUCKET = {
  COMPLETED: TASK_COMPLETED,
  STUCK: TASK_STUCK,
  NEVER_STARTED: TASK_NEVER_STARTED,
  EXCLUDED: TASK_EXCLUDED,
} as const;

export function classifyTaskStatus(status: string): TaskBucket {
  const s = (status ?? "").toLowerCase().trim();
  if (TASK_COMPLETED.has(s)) return "completed-full";
  if (TASK_STUCK.has(s)) return "stuck";
  if (TASK_NEVER_STARTED.has(s)) return "never-started";
  return "excluded";
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- status-buckets.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance-v2/status-buckets.ts src/__tests__/compliance-v2/status-buckets.test.ts
git commit -m "feat(compliance-v2): expanded status bucket classification"
```

### Task 2.3: Task title classification constant

**Files:**
- Create: `src/lib/compliance-v2/task-classification.ts`

- [ ] **Step 1: Populate constant from Task 1.3 output**

Create `src/lib/compliance-v2/task-classification.ts`:

```ts
import type { TaskClassification } from "./types";

/**
 * Service task title → Work | Paperwork | Unknown classification.
 * Populated from scripts/enumerate-service-task-titles.ts output (spec §8.2).
 *
 * Work tasks: count toward scoring (numerator + denominator).
 * Paperwork tasks: excluded entirely — no credit, no penalty.
 * Unknown: defaults to paperwork (safe default — don't score things we can't classify).
 *
 * Update this table whenever the enumeration script surfaces a new title.
 */

const WORK_TITLES = new Set([
  "pv install - colorado",
  "pv install - california",
  "electrical install - colorado",
  "electrical install - california",
  "loose ends",
].map((s) => s.toLowerCase()));

const PAPERWORK_TITLES = new Set([
  "jha form",
  "xcel pto",
  "participate energy photos",
].map((s) => s.toLowerCase()));

export function classifyTaskTitle(title: string): TaskClassification {
  const s = (title ?? "").toLowerCase().trim();
  if (WORK_TITLES.has(s)) return "work";
  if (PAPERWORK_TITLES.has(s)) return "paperwork";
  return "unknown";
}

/** For compliance v2 scoring: work only. Unknown defaults to paperwork-equivalent (skipped). */
export function isScoredTaskTitle(title: string): boolean {
  return classifyTaskTitle(title) === "work";
}
```

- [ ] **Step 2: Write unit tests**

Create `src/__tests__/compliance-v2/task-classification.test.ts`:

```ts
import { classifyTaskTitle, isScoredTaskTitle } from "@/lib/compliance-v2/task-classification";

describe("classifyTaskTitle", () => {
  it("classifies PV Install - Colorado as work", () => {
    expect(classifyTaskTitle("PV Install - Colorado")).toBe("work");
  });
  it("classifies Electrical Install - California as work", () => {
    expect(classifyTaskTitle("Electrical Install - California")).toBe("work");
  });
  it("classifies Loose Ends as work", () => {
    expect(classifyTaskTitle("Loose Ends")).toBe("work");
  });
  it("classifies JHA Form as paperwork", () => {
    expect(classifyTaskTitle("JHA Form")).toBe("paperwork");
  });
  it("classifies Xcel PTO as paperwork", () => {
    expect(classifyTaskTitle("Xcel PTO")).toBe("paperwork");
  });
  it("classifies unknown title as unknown", () => {
    expect(classifyTaskTitle("Floofy Reticulation")).toBe("unknown");
  });
  it("handles case insensitivity", () => {
    expect(classifyTaskTitle("pv install - colorado")).toBe("work");
  });
});

describe("isScoredTaskTitle", () => {
  it("is true for work tasks", () => {
    expect(isScoredTaskTitle("PV Install - Colorado")).toBe(true);
  });
  it("is false for paperwork", () => {
    expect(isScoredTaskTitle("JHA Form")).toBe(false);
  });
  it("is false for unknown (safe default — don't score what we can't classify)", () => {
    expect(isScoredTaskTitle("Floofy Reticulation")).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- task-classification.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/compliance-v2/task-classification.ts src/__tests__/compliance-v2/task-classification.test.ts
git commit -m "feat(compliance-v2): TASK_TITLE_CLASSIFICATION constant"
```

---

## Chunk 3: Credit-set, task-timestamp, service-tasks fetcher

### Task 3.1: Credit-set computation (pure function, TDD)

**Files:**
- Create: `src/lib/compliance-v2/credit-set.ts`
- Create: `src/__tests__/compliance-v2/credit-set.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/compliance-v2/credit-set.test.ts`:

```ts
import { computeCreditSet, type CreditSetInputs } from "@/lib/compliance-v2/credit-set";

const mkTask = (opts: Partial<CreditSetInputs["task"]> = {}): CreditSetInputs["task"] => ({
  service_task_uid: "t1",
  service_task_title: "PV Install - Colorado",
  service_task_status: "COMPLETED",
  assigned_to: [],
  asset_inspection_submission_uid: null,
  ...opts,
});

const mkAssignee = (uid: string, name: string) => ({
  user: { user_uid: uid, first_name: name, last_name: "Test", is_active: true },
});

describe("computeCreditSet", () => {
  it("returns empty credit set when task has no assignees and no form", () => {
    const result = computeCreditSet({ task: mkTask(), form: null });
    expect(result.userUids).toEqual([]);
  });

  it("returns assigned users only", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice"), mkAssignee("u2", "Bob")] }),
      form: null,
    });
    expect(result.userUids.sort()).toEqual(["u1", "u2"]);
  });

  it("includes form created_by when no task assignees (form-filer-only case)", () => {
    const result = computeCreditSet({
      task: mkTask(),
      form: { created_by: { user_uid: "u3", first_name: "Carol", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.userUids).toEqual(["u3"]);
  });

  it("unions task assignees and form submitter", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice")] }),
      form: { created_by: { user_uid: "u3", first_name: "Carol", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.userUids.sort()).toEqual(["u1", "u3"]);
  });

  it("deduplicates when task assignee is also form submitter", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice")] }),
      form: { created_by: { user_uid: "u1", first_name: "Alice", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.userUids).toEqual(["u1"]);
  });

  it("excludes inactive assigned users", () => {
    const task = mkTask({
      assigned_to: [
        { user: { user_uid: "u1", first_name: "Active", last_name: "Tech", is_active: true } },
        { user: { user_uid: "u2", first_name: "Inactive", last_name: "Tech", is_active: false } },
      ],
    });
    const result = computeCreditSet({ task, form: null });
    expect(result.userUids).toEqual(["u1"]);
  });

  it("captures display name per user", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "Alice")] }),
      form: null,
    });
    expect(result.nameByUid.get("u1")).toBe("Alice Test");
  });

  it("prefers task-assigned name over form name for the same uid", () => {
    const result = computeCreditSet({
      task: mkTask({ assigned_to: [mkAssignee("u1", "AliceTask")] }),
      form: { created_by: { user_uid: "u1", first_name: "AliceForm", last_name: "Test" }, created_at: "2026-01-01T00:00:00Z" },
    });
    expect(result.nameByUid.get("u1")).toBe("AliceTask Test");
  });
});
```

- [ ] **Step 2: Run tests to verify fail**

Run: `npm test -- credit-set.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `credit-set.ts`**

Create `src/lib/compliance-v2/credit-set.ts`:

```ts
/**
 * Pure function: compute the credit set for a service task.
 *
 * Credit set = union of:
 *   1. service_task.assigned_to[] user_uids (active users only)
 *   2. linked form submission's created_by.user_uid (if form exists)
 *
 * Returns the user_uid list + a best-name lookup for display.
 *
 * Spec: §2.2
 */

export interface CreditSetInputs {
  task: {
    service_task_uid: string;
    service_task_title: string;
    service_task_status: string;
    assigned_to: Array<{
      user?: {
        user_uid?: string;
        first_name?: string;
        last_name?: string;
        is_active?: boolean;
      };
    }>;
    asset_inspection_submission_uid: string | null;
  };
  form: {
    created_by?: {
      user_uid?: string;
      first_name?: string;
      last_name?: string;
    };
    created_at: string;
  } | null;
}

export interface CreditSet {
  userUids: string[];
  nameByUid: Map<string, string>;
}

export function computeCreditSet(inputs: CreditSetInputs): CreditSet {
  const nameByUid = new Map<string, string>();
  const uids = new Set<string>();

  // 1. Task assignees (active only)
  for (const entry of inputs.task.assigned_to ?? []) {
    const u = entry?.user;
    if (!u?.user_uid) continue;
    if (u.is_active === false) continue;
    uids.add(u.user_uid);
    const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
    if (name) nameByUid.set(u.user_uid, name);
  }

  // 2. Form submitter — only add if not already in the task-assignee nameByUid
  //    (task-assignee name takes precedence per "prefers task-assigned name" test)
  const form = inputs.form;
  if (form?.created_by?.user_uid) {
    const uid = form.created_by.user_uid;
    uids.add(uid);
    if (!nameByUid.has(uid)) {
      const name = `${form.created_by.first_name ?? ""} ${form.created_by.last_name ?? ""}`.trim();
      if (name) nameByUid.set(uid, name);
    }
  }

  return { userUids: [...uids], nameByUid };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- credit-set.test.ts`
Expected: PASS (all 8).

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance-v2/credit-set.ts src/__tests__/compliance-v2/credit-set.test.ts
git commit -m "feat(compliance-v2): credit-set computation (assignees ∪ form submitter)"
```

### Task 3.2: Task-timestamp resolution (pure function, TDD)

**Files:**
- Create: `src/lib/compliance-v2/task-timestamp.ts`
- Create: `src/__tests__/compliance-v2/task-timestamp.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/compliance-v2/task-timestamp.test.ts`:

```ts
import { resolveTaskTimestamp } from "@/lib/compliance-v2/task-timestamp";

describe("resolveTaskTimestamp", () => {
  it("returns earliest of actual_end_time, form.created_at, parent completion", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: "2026-04-03T15:00:00Z",
      formCreatedAt: "2026-04-03T17:00:00Z",
      parentCompletedTime: "2026-04-03T20:00:00Z",
    });
    expect(result?.toISOString()).toBe("2026-04-03T15:00:00.000Z");
  });

  it("uses form.created_at when earlier than task actual_end_time (rare)", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: "2026-04-03T15:00:00Z",
      formCreatedAt: "2026-04-03T13:00:00Z",
      parentCompletedTime: null,
    });
    expect(result?.toISOString()).toBe("2026-04-03T13:00:00.000Z");
  });

  it("falls back to parent completion when task has no timestamps", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: null,
      formCreatedAt: null,
      parentCompletedTime: "2026-04-03T20:00:00Z",
    });
    expect(result?.toISOString()).toBe("2026-04-03T20:00:00.000Z");
  });

  it("returns null when all signals are missing", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: null,
      formCreatedAt: null,
      parentCompletedTime: null,
    });
    expect(result).toBeNull();
  });

  it("ignores invalid date strings", () => {
    const result = resolveTaskTimestamp({
      actualEndTime: "not-a-date",
      formCreatedAt: "2026-04-03T13:00:00Z",
      parentCompletedTime: null,
    });
    expect(result?.toISOString()).toBe("2026-04-03T13:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run tests (fail)**

Run: `npm test -- task-timestamp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/compliance-v2/task-timestamp.ts`:

```ts
/**
 * Resolve the "earliest of" task timestamp per spec §2.3.
 *
 * Returns null when no signal is populated.
 */
export interface TaskTimestampInputs {
  actualEndTime: string | null;
  formCreatedAt: string | null;
  parentCompletedTime: string | null;
}

export function resolveTaskTimestamp(inputs: TaskTimestampInputs): Date | null {
  const candidates: Date[] = [];
  for (const raw of [inputs.actualEndTime, inputs.formCreatedAt, inputs.parentCompletedTime]) {
    if (!raw) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) candidates.push(d);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}
```

- [ ] **Step 4: Run tests (pass)**

Run: `npm test -- task-timestamp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/compliance-v2/task-timestamp.ts src/__tests__/compliance-v2/task-timestamp.test.ts
git commit -m "feat(compliance-v2): earliest-of task timestamp resolution"
```

### Task 3.3: Service tasks fetcher with per-request memoization

**Files:**
- Create: `src/lib/compliance-v2/service-tasks-fetcher.ts`

No tests for this module — it's a thin Zuper wrapper already tested by the existing `zuper.ts` client. The fetcher's logic is cache/dedup, which gets covered end-to-end via Task 4.1 integration tests.

- [ ] **Step 1: Implement**

Create `src/lib/compliance-v2/service-tasks-fetcher.ts`:

```ts
/**
 * Fetches service tasks + linked form submissions for a set of parent jobs.
 *
 * Memoizes per-batch so the same job isn't queried twice in one
 * computeLocationComplianceV2 call. Caller is responsible for constructing
 * a fresh fetcher per request (no cross-request leakage).
 */
import { zuper } from "@/lib/zuper";

export interface ServiceTaskRaw {
  service_task_uid: string;
  service_task_title: string;
  service_task_status: string;
  assigned_to: Array<{
    user?: {
      user_uid?: string;
      first_name?: string;
      last_name?: string;
      is_active?: boolean;
    };
  }>;
  asset_inspection_submission_uid: string | null;
  actual_end_time?: string | null;
  actual_start_time?: string | null;
}

export interface FormSubmissionRaw {
  created_by?: {
    user_uid?: string;
    first_name?: string;
    last_name?: string;
  };
  created_at: string;
}

export interface ServiceTasksBundle {
  tasks: ServiceTaskRaw[];
  formByTaskUid: Map<string, FormSubmissionRaw | null>;
}

export function createServiceTasksFetcher() {
  const bundleCache = new Map<string, Promise<ServiceTasksBundle | null>>();

  async function fetchBundle(jobUid: string): Promise<ServiceTasksBundle | null> {
    const existing = bundleCache.get(jobUid);
    if (existing) return existing;

    const promise = (async () => {
      const tasksResult = await zuper.getJobServiceTasks(jobUid);
      if (tasksResult.type !== "success") return null;
      const raw = tasksResult.data;
      const tasksArr = Array.isArray(raw) ? raw : (raw?.data ?? raw?.service_tasks ?? []);
      const tasks: ServiceTaskRaw[] = Array.isArray(tasksArr) ? tasksArr : [];

      const formByTaskUid = new Map<string, FormSubmissionRaw | null>();

      // Fetch form submissions in parallel (bounded — typically ≤6 per job)
      await Promise.all(
        tasks.map(async (t) => {
          const uid = t.asset_inspection_submission_uid;
          if (!uid) {
            formByTaskUid.set(t.service_task_uid, null);
            return;
          }
          const r = await zuper.getFormSubmission(uid);
          if (r.type !== "success") {
            formByTaskUid.set(t.service_task_uid, null);
            return;
          }
          const body = r.data;
          const form = (body?.data ?? body) as FormSubmissionRaw | null;
          formByTaskUid.set(t.service_task_uid, form);
        })
      );

      return { tasks, formByTaskUid };
    })();

    bundleCache.set(jobUid, promise);
    return promise;
  }

  return { fetchBundle };
}

export type ServiceTasksFetcher = ReturnType<typeof createServiceTasksFetcher>;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/compliance-v2/service-tasks-fetcher.ts
git commit -m "feat(compliance-v2): service-tasks + form-submission fetcher"
```

---

## Chunk 4: V2 scoring engine + integration

### Task 4.1: `computeLocationComplianceV2` main function

**Files:**
- Create: `src/lib/compliance-v2/scoring.ts`
- Create: `src/lib/compliance-v2/index.ts`
- Create: `src/__tests__/compliance-v2/fixtures/jobs.ts`
- Create: `src/__tests__/compliance-v2/scoring.test.ts`

This is the largest task. Break into sub-steps.

#### 4.1.a: Hand-crafted fixtures

- [ ] **Step 1: Create fixtures file**

Create `src/__tests__/compliance-v2/fixtures/jobs.ts` with Zuper-shape payloads covering each spec §9 case. Helper + cases:

```ts
import type { ServiceTaskRaw, FormSubmissionRaw, ServiceTasksBundle } from "@/lib/compliance-v2/service-tasks-fetcher";

export interface FixtureJob {
  // Zuper "searchJobs" payload shape
  job_uid: string;
  job_title: string;
  job_category: { category_uid: string };
  current_job_status: { status_name: string };
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  assigned_to: Array<{ user: { user_uid: string; first_name: string; last_name: string; is_active: boolean } }>;
  assigned_to_team: Array<{ team: { team_uid: string; team_name: string } }>;
  job_status: Array<{ status_name: string; created_at: string }>;
  custom_fields?: unknown[];
  job_tags?: string[];
}

export interface FixtureBundle {
  job: FixtureJob;
  taskBundle: ServiceTasksBundle;
}

export const CONSTRUCTION_UID = "construction-uid";

// Helper for building assignees
function mkAssignee(uid: string, name: string, active = true) {
  const [first, ...rest] = name.split(" ");
  return {
    user: { user_uid: uid, first_name: first, last_name: rest.join(" "), is_active: active },
  };
}

// === Fixture A: PV/Battery split — PV on-time, Electrical late ===
export function buildPvBatterySplitFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "pvbat",
    job_title: "PROJ-9999 PV/Battery multi-day",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z", // day-3 deadline
    assigned_to: [
      mkAssignee("u-pv", "Tyler Guerra"),
      mkAssignee("u-elec", "Chris Kahl"),
    ],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-08T20:00:00Z" }], // parent late
  };
  const pvTask: ServiceTaskRaw = {
    service_task_uid: "pv-task",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-pv", "Tyler Guerra")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-01T23:00:00Z", // day-1: on-time
  };
  const elecTask: ServiceTaskRaw = {
    service_task_uid: "elec-task",
    service_task_title: "Electrical Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-elec", "Chris Kahl")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-08T20:00:00Z", // day-8: late
  };
  return {
    job,
    taskBundle: {
      tasks: [pvTask, elecTask],
      formByTaskUid: new Map([["pv-task", null], ["elec-task", null]]),
    },
  };
}

// === Fixture B: Form-filer-only ===
export function buildFormFilerOnlyFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "form-only",
    job_title: "form-only job",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-parent", "ParentOnly Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-02T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [], // no task assignees
    asset_inspection_submission_uid: "form-uid",
    actual_end_time: "2026-04-02T22:00:00Z",
  };
  const form: FormSubmissionRaw = {
    created_by: { user_uid: "u-filer", first_name: "Filer", last_name: "Tech" },
    created_at: "2026-04-02T22:30:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", form]]),
    },
  };
}

// === Fixture C: Paperwork-only tech (JHA Form filer) ===
export function buildPaperworkOnlyFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "paper-only",
    job_title: "paperwork job",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-paper", "Paperwork Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-02T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "jha",
    service_task_title: "JHA Form",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-paper", "Paperwork Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-02T22:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["jha", null]]),
    },
  };
}

// === Fixture D: Empty credit set — no one to blame ===
export function buildEmptyCreditSetFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "empty",
    job_title: "empty credit set",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-parent", "ParentOnly")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-05T00:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "orphan",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [], // empty
    asset_inspection_submission_uid: null, // no form
    actual_end_time: null,
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["orphan", null]]),
    },
  };
}

// === Fixture E: Fractional 1/N — 3 techs on one task, late ===
export function buildFractionalLateFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "frac",
    job_title: "3-tech fractional",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u1", "Alpha"), mkAssignee("u2", "Bravo"), mkAssignee("u3", "Charlie")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-06T23:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u1", "Alpha"), mkAssignee("u2", "Bravo"), mkAssignee("u3", "Charlie")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-06T23:00:00Z", // late
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture F: Parent-only (tech assigned at parent but not in any task) ===
export function buildParentOnlyFixture(): FixtureBundle {
  // same as empty-credit-set but with a task that HAS a credit set
  // parent tech is separate and shouldn't be scored
  const job: FixtureJob = {
    job_uid: "parent-only",
    job_title: "parent-only tech",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [
      mkAssignee("u-real", "Real Worker"),
      mkAssignee("u-ghost", "Ghost Assignee"),
    ],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-03T20:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-real", "Real Worker")], // ghost not in task
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-03T20:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture G: Follow-up status (Return Visit Required, on-time) ===
export function buildFollowUpFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "follow",
    job_title: "follow-up",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Return Visit Required" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-f", "Followup Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Return Visit Required", created_at: "2026-04-03T12:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-f", "Followup Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-03T12:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture H: Failed status ===
export function buildFailedFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "failed",
    job_title: "failed inspection",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Failed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-f", "Failed Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Failed", created_at: "2026-04-02T12:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-f", "Failed Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-02T12:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture I: Ready To Forecast — excluded entirely ===
export function buildExcludedStatusFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "excluded",
    job_title: "ready to forecast",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Ready To Forecast" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-exc", "Excluded Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Ready To Forecast", created_at: "2026-04-01T00:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "NEW",
    assigned_to: [mkAssignee("u-exc", "Excluded Tech")],
    asset_inspection_submission_uid: null,
    actual_end_time: null,
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", null]]),
    },
  };
}

// === Fixture K: Central fairness scenario — PV completed, Electrical stuck on same parent ===
// PV tech does their work on time; Electrical team is stuck (in progress past scheduledEnd).
// PV tech MUST NOT receive any stuck penalty. Electrical tech gets stuck 1/N.
export function buildPvCompletedElectricalStuckFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "pvok-elecstuck",
    job_title: "PROJ-fair | PV ok, Electrical stuck",
    job_category: { category_uid: CONSTRUCTION_UID },
    // Parent status is "Started" (stuck if past scheduledEnd). Electrical is still in progress.
    current_job_status: { status_name: "Started" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z", // parent scheduledEnd
    assigned_to: [
      mkAssignee("u-pv", "Tyler Guerra"),
      mkAssignee("u-elec", "Chris Kahl"),
    ],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Started", created_at: "2026-04-01T16:00:00Z" }],
  };
  const pvTask: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED", // PV done
    assigned_to: [mkAssignee("u-pv", "Tyler Guerra")],
    asset_inspection_submission_uid: null,
    actual_end_time: "2026-04-01T23:00:00Z", // on-time
  };
  const elecTask: ServiceTaskRaw = {
    service_task_uid: "elec",
    service_task_title: "Electrical Install - Colorado",
    service_task_status: "IN_PROGRESS", // stuck
    assigned_to: [mkAssignee("u-elec", "Chris Kahl")],
    asset_inspection_submission_uid: null,
    actual_end_time: null,
    actual_start_time: "2026-04-02T16:00:00Z",
  };
  return {
    job,
    taskBundle: {
      tasks: [pvTask, elecTask],
      formByTaskUid: new Map([["pv", null], ["elec", null]]),
    },
  };
}

// === Fixture J: Timestamp tie-break — form later than actual_end ===
export function buildTimestampTieBreakFixture(): FixtureBundle {
  const job: FixtureJob = {
    job_uid: "tie",
    job_title: "tiebreak",
    job_category: { category_uid: CONSTRUCTION_UID },
    current_job_status: { status_name: "Completed" },
    scheduled_start_time: "2026-04-01T15:00:00Z",
    scheduled_end_time: "2026-04-03T23:00:00Z",
    assigned_to: [mkAssignee("u-t", "Tie Tech")],
    assigned_to_team: [{ team: { team_uid: "t-cent", team_name: "Centennial" } }],
    job_status: [{ status_name: "Completed", created_at: "2026-04-05T12:00:00Z" }],
  };
  const task: ServiceTaskRaw = {
    service_task_uid: "pv",
    service_task_title: "PV Install - Colorado",
    service_task_status: "COMPLETED",
    assigned_to: [mkAssignee("u-t", "Tie Tech")],
    asset_inspection_submission_uid: "form-uid",
    actual_end_time: "2026-04-03T23:00:00Z", // exactly on scheduledEnd; with 24h grace this is on-time
  };
  const form: FormSubmissionRaw = {
    created_by: { user_uid: "u-t", first_name: "Tie", last_name: "Tech" },
    created_at: "2026-04-05T12:00:00Z", // form filed 2 days later — should NOT tip into late via earliest-of rule
  };
  return {
    job,
    taskBundle: {
      tasks: [task],
      formByTaskUid: new Map([["pv", form]]),
    },
  };
}
```

- [ ] **Step 2: Commit fixtures**

```bash
git add src/__tests__/compliance-v2/fixtures/
git commit -m "test(compliance-v2): scoring fixtures for spec §9 cases"
```

#### 4.1.b: Scoring tests (written before the implementation)

- [ ] **Step 3: Write failing scoring tests**

Create `src/__tests__/compliance-v2/scoring.test.ts`:

```ts
jest.mock("@/lib/db", () => ({
  prisma: null,
  getActiveCrewMembers: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/zuper", () => ({
  zuper: { isConfigured: () => false, searchJobs: jest.fn(), getJobServiceTasks: jest.fn(), getFormSubmission: jest.fn() },
  JOB_CATEGORY_UIDS: { SITE_SURVEY: "survey-uid", CONSTRUCTION: "construction-uid", INSPECTION: "inspection-uid" },
  JOB_CATEGORIES: { SITE_SURVEY: "Site Survey", CONSTRUCTION: "Construction", INSPECTION: "Inspection" },
}));

const mockFetchJobsForCategory = jest.fn();
jest.mock("@/lib/compliance-helpers", () => {
  const actual = jest.requireActual("@/lib/compliance-helpers");
  return {
    ...actual,
    fetchJobsForCategory: (...args: unknown[]) => mockFetchJobsForCategory(...args),
  };
});

import { computeLocationComplianceV2 } from "@/lib/compliance-v2/scoring";
import type { ServiceTasksBundle } from "@/lib/compliance-v2/service-tasks-fetcher";
import {
  buildPvBatterySplitFixture,
  buildFormFilerOnlyFixture,
  buildPaperworkOnlyFixture,
  buildEmptyCreditSetFixture,
  buildFractionalLateFixture,
  buildParentOnlyFixture,
  buildFollowUpFixture,
  buildFailedFixture,
  buildExcludedStatusFixture,
  buildTimestampTieBreakFixture,
  buildPvCompletedElectricalStuckFixture,
  type FixtureBundle,
} from "./fixtures/jobs";

function mkFetcher(fixtures: FixtureBundle[]): () => { fetchBundle: (jobUid: string) => Promise<ServiceTasksBundle | null> } {
  return () => ({
    async fetchBundle(jobUid: string) {
      const f = fixtures.find((x) => x.job.job_uid === jobUid);
      return f?.taskBundle ?? null;
    },
  });
}

async function compute(fixtures: FixtureBundle[]) {
  mockFetchJobsForCategory.mockResolvedValueOnce(fixtures.map((f) => f.job));
  return computeLocationComplianceV2("Construction", "Centennial", 30, {
    createFetcher: mkFetcher(fixtures),
  });
}

describe("computeLocationComplianceV2", () => {
  beforeEach(() => mockFetchJobsForCategory.mockReset());

  it("PV/Battery case: PV tech on-time, Electrical tech late", async () => {
    const result = await compute([buildPvBatterySplitFixture()]);
    const pv = result!.byEmployee.find((e) => e.userUid === "u-pv")!;
    const elec = result!.byEmployee.find((e) => e.userUid === "u-elec")!;
    expect(pv.onTimePercent).toBe(100);
    expect(elec.onTimePercent).toBe(0);
  });

  it("Form-filer-only case: filer is scored symmetrically", async () => {
    const result = await compute([buildFormFilerOnlyFixture()]);
    const filer = result!.byEmployee.find((e) => e.userUid === "u-filer")!;
    expect(filer).toBeDefined();
    expect(filer.tasksFractional).toBe(1); // sole credit-set member
    expect(filer.onTimePercent).toBe(100);
    // Parent-only tech should not appear
    expect(result!.byEmployee.find((e) => e.userUid === "u-parent")).toBeUndefined();
  });

  it("Paperwork task: JHA Form filer is not scored", async () => {
    const result = await compute([buildPaperworkOnlyFixture()]);
    expect(result!.byEmployee.find((e) => e.userUid === "u-paper")).toBeUndefined();
  });

  it("Empty credit set: job excluded entirely", async () => {
    const result = await compute([buildEmptyCreditSetFixture()]);
    expect(result!.byEmployee).toEqual([]);
    expect(result!.emptyCreditSetJobs).toBe(1);
  });

  it("Fractional math: 3 techs on one late task each get 1/3 late", async () => {
    const result = await compute([buildFractionalLateFixture()]);
    for (const uid of ["u1", "u2", "u3"]) {
      const emp = result!.byEmployee.find((e) => e.userUid === uid)!;
      expect(emp.tasksFractional).toBeCloseTo(1 / 3, 5);
      expect(emp.lateCount).toBeCloseTo(1 / 3, 5);
      expect(emp.onTimeCount).toBe(0);
    }
  });

  it("Parent-only tech: ghost not in task credit set is not scored", async () => {
    const result = await compute([buildParentOnlyFixture()]);
    expect(result!.byEmployee.find((e) => e.userUid === "u-real")).toBeDefined();
    expect(result!.byEmployee.find((e) => e.userUid === "u-ghost")).toBeUndefined();
  });

  it("Follow-up status: tagged hasFollowUp + on-time credit", async () => {
    const result = await compute([buildFollowUpFixture()]);
    const emp = result!.byEmployee.find((e) => e.userUid === "u-f")!;
    expect(emp.hasFollowUp).toBe(true);
    expect(emp.onTimePercent).toBe(100);
  });

  it("Failed status: on-time credit + counts toward pass rate", async () => {
    const result = await compute([buildFailedFixture()]);
    const emp = result!.byEmployee.find((e) => e.userUid === "u-f")!;
    expect(emp.onTimePercent).toBe(100); // on-time (showed up on schedule)
    expect(emp.failedCount).toBeCloseTo(1, 5);
    expect(emp.passRate).toBe(0);
  });

  it("Ready To Forecast: excluded entirely from scoring", async () => {
    const result = await compute([buildExcludedStatusFixture()]);
    expect(result!.byEmployee).toEqual([]);
    expect(result!.emptyCreditSetJobs).toBe(0); // excluded, not "empty"
  });

  it("Timestamp tie-break: earliest of signals is used", async () => {
    const result = await compute([buildTimestampTieBreakFixture()]);
    const emp = result!.byEmployee.find((e) => e.userUid === "u-t")!;
    // actual_end_time (2026-04-03T23:00:00Z) is earlier than form.created_at (2026-04-05)
    // scheduledEnd is 2026-04-03T23:00:00Z; with 24h grace this is on-time
    expect(emp.onTimePercent).toBe(100);
  });

  it("Low-volume threshold: <5 credits → grade is '—' + lowVolume flag", async () => {
    // Single fixture with 3 techs on one task → each gets 1/3 < 5
    const result = await compute([buildFractionalLateFixture()]);
    const emp = result!.byEmployee[0];
    expect(emp.lowVolume).toBe(true);
    expect(emp.grade).toBe("—");
  });

  it("CENTRAL FAIRNESS: PV completed on time, Electrical stuck on same parent → PV tech gets no stuck penalty", async () => {
    const result = await compute([buildPvCompletedElectricalStuckFixture()]);
    const pv = result!.byEmployee.find((e) => e.userUid === "u-pv")!;
    const elec = result!.byEmployee.find((e) => e.userUid === "u-elec")!;

    // PV: completed on time, NO stuck penalty (task is completed-full)
    expect(pv).toBeDefined();
    expect(pv.onTimePercent).toBe(100);
    expect(pv.stuckCount).toBe(0);

    // Electrical: stuck 1/1
    expect(elec).toBeDefined();
    expect(elec.stuckCount).toBeCloseTo(1, 5);
    // Electrical has no completion → measurable is 0, onTimePercent is -1
    expect(elec.onTimePercent).toBe(-1);
  });
});
```

- [ ] **Step 4: Run tests to verify fail**

Run: `npm test -- scoring.test.ts`
Expected: FAIL (module not found).

#### 4.1.c: Implement `scoring.ts`

- [ ] **Step 5: Implement main scoring function**

Create `src/lib/compliance-v2/scoring.ts`:

```ts
/**
 * computeLocationComplianceV2 — per-service-task compliance scoring.
 *
 * Spec: docs/superpowers/specs/2026-04-23-compliance-score-fairness-design.md
 *
 * Flow per parent job:
 *   1. Classify parent status → bucket.
 *   2. If bucket = "excluded" → skip job entirely.
 *   3. Fetch service tasks + form submissions.
 *   4. For each task whose title is a Work task:
 *      a. Compute credit set (§2.2). If empty → increment emptyCreditSetJobs and skip.
 *      b. Resolve timestamp (§2.3 earliest-of).
 *      c. For each tech in credit set, accumulate 1/N weighted metrics.
 */
import {
  computeCreditSet,
  type CreditSet,
} from "./credit-set";
import { resolveTaskTimestamp } from "./task-timestamp";
import { classifyJobStatus, classifyTaskStatus } from "./status-buckets";
import { isScoredTaskTitle } from "./task-classification";
import {
  createServiceTasksFetcher,
  type ServiceTasksFetcher,
  type ServiceTasksBundle,
} from "./service-tasks-fetcher";
import {
  type EmployeeComplianceV2,
  type LocationComplianceV2Result,
  type TaskCreditEntry,
  MIN_TASKS_THRESHOLD,
} from "./types";
import { fetchJobsForCategory, getCompletedTimeFromHistory, getStatusName, GRACE_MS } from "@/lib/compliance-helpers";
import { JOB_CATEGORY_UIDS } from "@/lib/zuper";
import { computeGrade } from "@/lib/compliance-helpers";

const CATEGORY_NAME_TO_UID: Record<string, string> = {
  "Site Survey": JOB_CATEGORY_UIDS.SITE_SURVEY,
  Construction: JOB_CATEGORY_UIDS.CONSTRUCTION,
  Inspection: JOB_CATEGORY_UIDS.INSPECTION,
};

export interface ComputeV2Options {
  /** Injection point for tests — defaults to production fetcher factory. */
  createFetcher?: () => ServiceTasksFetcher;
}

interface Accumulator {
  userUid: string;
  name: string;
  tasksFractional: number;
  distinctParentJobs: Set<string>;
  onTimeCount: number;
  lateCount: number;
  stuckCount: number;
  neverStartedCount: number;
  failedCount: number;
  hasFollowUp: boolean;
  entries: TaskCreditEntry[];
}

function ensureAcc(acc: Map<string, Accumulator>, userUid: string, name: string): Accumulator {
  let a = acc.get(userUid);
  if (!a) {
    a = {
      userUid,
      name,
      tasksFractional: 0,
      distinctParentJobs: new Set(),
      onTimeCount: 0,
      lateCount: 0,
      stuckCount: 0,
      neverStartedCount: 0,
      failedCount: 0,
      hasFollowUp: false,
      entries: [],
    };
    acc.set(userUid, a);
  }
  return a;
}

export async function computeLocationComplianceV2(
  categoryName: string,
  location: string,
  days: number = 30,
  options: ComputeV2Options = {}
): Promise<LocationComplianceV2Result | null> {
  const categoryUid = CATEGORY_NAME_TO_UID[categoryName];
  if (!categoryUid) return null;

  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - days);
  const fromDateStr = fromDate.toISOString().split("T")[0];
  const toDateStr = now.toISOString().split("T")[0];

  const jobs = await fetchJobsForCategory(categoryUid, fromDateStr, toDateStr);
  if (jobs.length === 0) return null;

  const fetcher = (options.createFetcher ?? createServiceTasksFetcher)();
  const acc = new Map<string, Accumulator>();
  let emptyCreditSetJobs = 0;

  for (const job of jobs) {
    const parentStatus = getStatusName(job);
    const parentBucket = classifyJobStatus(parentStatus);
    if (parentBucket === "excluded") continue;

    const scheduledEnd = job.scheduled_end_time ? new Date(job.scheduled_end_time) : null;
    const parentCompletedTime = getCompletedTimeFromHistory(job);

    const bundle = await fetcher.fetchBundle(job.job_uid);
    if (!bundle) continue;

    for (const task of bundle.tasks) {
      if (!isScoredTaskTitle(task.service_task_title)) continue;

      const form = bundle.formByTaskUid.get(task.service_task_uid) ?? null;
      const creditSet = computeCreditSet({ task, form });

      if (creditSet.userUids.length === 0) {
        emptyCreditSetJobs++;
        continue;
      }

      const timestamp = resolveTaskTimestamp({
        actualEndTime: task.actual_end_time ?? null,
        formCreatedAt: form?.created_at ?? null,
        parentCompletedTime: parentCompletedTime ? parentCompletedTime.toISOString() : null,
      });

      // Compute metrics for this task×parent combination
      const weight = 1 / creditSet.userUids.length;
      const taskBucket = classifyTaskStatus(task.service_task_status);
      const isCompleted = parentBucket === "completed-full" || parentBucket === "completed-follow-up" || parentBucket === "completed-failed" || taskBucket === "completed-full";
      const isStuck = parentBucket === "stuck" && taskBucket !== "completed-full";
      const isNeverStarted = parentBucket === "never-started" && !task.actual_start_time;
      const isFailed = parentBucket === "completed-failed";
      const isFollowUp = parentBucket === "completed-follow-up";

      let onTime: boolean | null = null;
      if (isCompleted && scheduledEnd && timestamp) {
        const deadline = new Date(scheduledEnd.getTime() + GRACE_MS);
        onTime = timestamp.getTime() <= deadline.getTime();
      } else if (isCompleted && !scheduledEnd) {
        onTime = true; // no schedule target: count as on-time (consistent with v1 behavior)
      }

      for (const uid of creditSet.userUids) {
        const name = creditSet.nameByUid.get(uid) ?? "Unknown";
        const a = ensureAcc(acc, uid, name);
        a.tasksFractional += weight;
        a.distinctParentJobs.add(job.job_uid);

        if (isCompleted && onTime === true) a.onTimeCount += weight;
        if (isCompleted && onTime === false) a.lateCount += weight;
        if (isStuck) a.stuckCount += weight;
        if (isNeverStarted) a.neverStartedCount += weight;
        if (isFailed) a.failedCount += weight;
        if (isFollowUp) a.hasFollowUp = true;

        a.entries.push({
          jobUid: job.job_uid,
          jobTitle: job.job_title ?? "",
          taskUid: task.service_task_uid,
          taskTitle: task.service_task_title,
          bucket: parentBucket,
          weight,
          timestamp: timestamp ? timestamp.toISOString() : null,
          scheduledEnd: scheduledEnd ? scheduledEnd.toISOString() : null,
          onTime,
          stuck: isStuck,
          neverStarted: isNeverStarted,
          failed: isFailed,
          followUp: isFollowUp,
        });
      }
    }
  }

  // Fold accumulators into EmployeeComplianceV2
  const byEmployee: EmployeeComplianceV2[] = [];
  for (const a of acc.values()) {
    const measurable = a.onTimeCount + a.lateCount;
    const onTimePercent = measurable > 0 ? Math.round((a.onTimeCount / measurable) * 100) : -1;
    const stuckRate = a.tasksFractional > 0 ? a.stuckCount / a.tasksFractional : 0;
    const neverStartedRate = a.tasksFractional > 0 ? a.neverStartedCount / a.tasksFractional : 0;
    const rawOnTime = onTimePercent >= 0 ? onTimePercent : 0;
    const complianceScore = Math.max(
      0,
      Math.round((rawOnTime - stuckRate * 100 - neverStartedRate * 100) * 10) / 10
    );
    // Pass rate: failed vs non-failed completions
    const allCompletions = a.onTimeCount + a.lateCount;
    const passRate = allCompletions > 0 ? Math.round(((allCompletions - a.failedCount) / allCompletions) * 100) : -1;

    const lowVolume = a.tasksFractional < MIN_TASKS_THRESHOLD;
    const grade = lowVolume ? "—" : computeGrade(complianceScore);

    byEmployee.push({
      userUid: a.userUid,
      name: a.name,
      tasksFractional: Math.round(a.tasksFractional * 100) / 100,
      distinctParentJobs: a.distinctParentJobs.size,
      onTimeCount: Math.round(a.onTimeCount * 100) / 100,
      lateCount: Math.round(a.lateCount * 100) / 100,
      measurableCount: Math.round(measurable * 100) / 100,
      onTimePercent,
      stuckCount: Math.round(a.stuckCount * 100) / 100,
      neverStartedCount: Math.round(a.neverStartedCount * 100) / 100,
      failedCount: Math.round(a.failedCount * 100) / 100,
      passRate,
      hasFollowUp: a.hasFollowUp,
      complianceScore,
      grade,
      lowVolume,
      entries: a.entries,
    });
  }

  byEmployee.sort((x, y) => x.complianceScore - y.complianceScore);

  return { byEmployee, emptyCreditSetJobs };
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npm test -- scoring.test.ts`
Expected: PASS (all 11). If any fail, diagnose and fix before moving on.

- [ ] **Step 7: Export from index**

Create `src/lib/compliance-v2/index.ts`:

```ts
export { computeLocationComplianceV2 } from "./scoring";
export { isComplianceV2Enabled, complianceVersionTag } from "./feature-flag";
export type {
  EmployeeComplianceV2,
  LocationComplianceV2Result,
  TaskBucket,
  TaskClassification,
  TaskCreditEntry,
} from "./types";
export { MIN_TASKS_THRESHOLD } from "./types";
```

- [ ] **Step 8: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/compliance-v2/scoring.ts src/lib/compliance-v2/index.ts src/__tests__/compliance-v2/scoring.test.ts
git commit -m "feat(compliance-v2): per-service-task scoring engine with fractional attribution"
```

### Task 4.2: Flag-gated integration in `computeLocationCompliance`

**Files:**
- Modify: `src/lib/compliance-compute.ts`
- Modify: `src/__tests__/compliance-compute.test.ts`
- Modify: `src/lib/office-performance-types.ts`

- [ ] **Step 1: Extend both employee types with optional v2 fields**

V1 route uses `EmployeeComplianceFull` (declared in `src/lib/compliance-compute.ts`), and UI uses `EmployeeCompliance` (declared in `src/lib/office-performance-types.ts`). Both need the new optional fields so the adapter in Step 4 typechecks.

In `src/lib/office-performance-types.ts`, append to `EmployeeCompliance`:

```ts
  // === v2 fields (populated when COMPLIANCE_V2_ENABLED=true) ===
  /** Fractional task-weighted total. Present only in v2. */
  tasksFractional?: number;
  /** Distinct parent jobs touched. Present only in v2. */
  distinctParentJobs?: number;
  /** Inspector pass rate (0-100, or -1 if no failed/passed jobs). Present only in v2. */
  passRate?: number;
  /** Tech has any "Completed - Follow-up" status (Return Visit / Loose Ends / Needs Revisit) in window. Present only in v2. */
  hasFollowUp?: boolean;
  /** True when tasksFractional < MIN_TASKS_THRESHOLD. Present only in v2. */
  lowVolume?: boolean;
  /** Stable identifier for v2 tooling (score breakdown, shadow compare). Present only in v2. */
  userUid?: string;
```

In `src/lib/compliance-compute.ts`, append the same block to `EmployeeComplianceFull`. Keep both in sync — if you add a field to one, add it to the other.

- [ ] **Step 2: Write regression test for v1 path**

Append to `src/__tests__/compliance-compute.test.ts`:

```ts
describe("flag gating (COMPLIANCE_V2_ENABLED=false)", () => {
  it("uses v1 scoring path when flag is off", async () => {
    const origFlag = process.env.COMPLIANCE_V2_ENABLED;
    delete process.env.COMPLIANCE_V2_ENABLED;

    mockFetchJobsForCategory.mockResolvedValueOnce([makeZuperJob()]);
    const result = await computeLocationCompliance("Construction", "Westminster", 30);

    // v1 output shape: byEmployee[].totalJobs is an integer, tasksFractional is undefined
    expect(result!.byEmployee[0]).toMatchObject({ totalJobs: expect.any(Number) });
    expect(result!.byEmployee[0].tasksFractional).toBeUndefined();

    if (origFlag !== undefined) process.env.COMPLIANCE_V2_ENABLED = origFlag;
  });
});
```

- [ ] **Step 3: Run it to verify pass (should already pass since v1 is unchanged)**

Run: `npm test -- compliance-compute.test.ts`
Expected: PASS.

- [ ] **Step 4: Add flag gate at top of `computeLocationCompliance` with test-injection option**

`computeLocationCompliance` needs to accept the same `ComputeV2Options` so tests (and any caller wanting to control fetching) can pass through to v2.

First, update the function signature in `src/lib/compliance-compute.ts`:

```ts
export async function computeLocationCompliance(
  categoryName: string,
  location: string,
  days: number = 30,
  locationDealIds?: Set<string>,
  v2Options?: import("@/lib/compliance-v2/scoring").ComputeV2Options
): Promise<LocationComplianceResult | null> {
```

At the top of the function (after the `if (!categoryUid) return null;` line), add:

```ts
  // === Flag gate: delegate to v2 if enabled ===
  if (isComplianceV2Enabled()) {
    const v2 = await computeLocationComplianceV2(categoryName, location, days, v2Options);
    if (!v2) return null;
    return adaptV2ToV1Shape(v2);
  }
```

Add imports at top:
```ts
import { computeLocationComplianceV2, type ComputeV2Options } from "@/lib/compliance-v2/scoring";
import { isComplianceV2Enabled } from "@/lib/compliance-v2/feature-flag";
import type { LocationComplianceV2Result } from "@/lib/compliance-v2/types";
```

Add adapter at bottom of file:
```ts
/**
 * Convert v2 result to the v1 LocationComplianceResult shape expected by the
 * existing API route + UI. Extra v2 fields ride along as optional EmployeeCompliance
 * props (see office-performance-types.ts).
 */
function adaptV2ToV1Shape(v2: LocationComplianceV2Result): LocationComplianceResult {
  const byEmployee: EmployeeComplianceFull[] = v2.byEmployee.map((e) => ({
    name: e.name,
    totalJobs: Math.round(e.tasksFractional), // best-effort int for v1 downstream
    completedJobs: Math.round(e.onTimeCount + e.lateCount),
    onTimePercent: e.onTimePercent,
    measurableCount: Math.round(e.measurableCount),
    lateCount: Math.round(e.lateCount),
    stuckCount: Math.round(e.stuckCount),
    neverStartedCount: Math.round(e.neverStartedCount),
    avgDaysToComplete: 0, // v2 doesn't compute these; safe to leave 0 for now
    avgDaysLate: 0,
    oowUsagePercent: -1, // v2 doesn't compute OOW yet; safe no-op (column renders as "—")
    oowOnTimePercent: -1,
    statusUsagePercent: 0,
    complianceScore: e.complianceScore,
    grade: e.grade,
    // v2-only fields ride along
    userUid: e.userUid,
    tasksFractional: e.tasksFractional,
    distinctParentJobs: e.distinctParentJobs,
    passRate: e.passRate,
    hasFollowUp: e.hasFollowUp,
    lowVolume: e.lowVolume,
  }));

  // Aggregate: recompute from v2 by-employee
  const totalTasks = v2.byEmployee.reduce((s, e) => s + e.tasksFractional, 0);
  const totalOnTime = v2.byEmployee.reduce((s, e) => s + e.onTimeCount, 0);
  const totalLate = v2.byEmployee.reduce((s, e) => s + e.lateCount, 0);
  const totalStuck = v2.byEmployee.reduce((s, e) => s + e.stuckCount, 0);
  const totalNeverStarted = v2.byEmployee.reduce((s, e) => s + e.neverStartedCount, 0);
  const aggOnTimePercent = (totalOnTime + totalLate) > 0 ? Math.round((totalOnTime / (totalOnTime + totalLate)) * 100) : -1;
  const aggStuckRate = totalTasks > 0 ? totalStuck / totalTasks : 0;
  const aggNeverStartedRate = totalTasks > 0 ? totalNeverStarted / totalTasks : 0;
  const aggRawOnTime = aggOnTimePercent >= 0 ? aggOnTimePercent : 0;
  const aggregateScore = Math.max(
    0,
    Math.round((aggRawOnTime - aggStuckRate * 100 - aggNeverStartedRate * 100) * 10) / 10
  );

  return {
    summary: {
      totalJobs: Math.round(totalTasks),
      completedJobs: Math.round(totalOnTime + totalLate),
      onTimePercent: aggOnTimePercent,
      stuckCount: Math.round(totalStuck),
      neverStartedCount: Math.round(totalNeverStarted),
      avgDaysToComplete: 0,
      avgDaysLate: 0,
      oowUsagePercent: -1,
      oowOnTimePercent: -1,
      aggregateScore,
      aggregateGrade: computeGrade(aggregateScore),
    },
    byEmployee,
    stuckJobs: [],
  };
}
```

- [ ] **Step 5: Write flag-ON integration test (with injected fetcher — no real API calls)**

Append to `src/__tests__/compliance-compute.test.ts`:

```ts
describe("flag gating (COMPLIANCE_V2_ENABLED=true)", () => {
  it("delegates to v2 when flag is on — uses injected fetcher, no real API", async () => {
    const origFlag = process.env.COMPLIANCE_V2_ENABLED;
    process.env.COMPLIANCE_V2_ENABLED = "true";

    // Build a v2 fixture from existing helpers
    const v2Job = {
      ...makeZuperJob(),
      assigned_to: [
        { user: { user_uid: "u1", first_name: "Mike", last_name: "Torres", is_active: true } },
      ],
    };
    mockFetchJobsForCategory.mockResolvedValueOnce([v2Job]);

    // Inject a fetcher that returns a single PV task for this job
    const injectedFetcher = () => ({
      async fetchBundle(_jobUid: string) {
        return {
          tasks: [{
            service_task_uid: "t1",
            service_task_title: "PV Install - Colorado",
            service_task_status: "COMPLETED",
            assigned_to: [{ user: { user_uid: "u1", first_name: "Mike", last_name: "Torres", is_active: true } }],
            asset_inspection_submission_uid: null,
            actual_end_time: v2Job.scheduled_end_time!,
          }],
          formByTaskUid: new Map([["t1", null]]),
        };
      },
    });

    const result = await computeLocationCompliance("Construction", "Westminster", 30, undefined, {
      createFetcher: injectedFetcher,
    });

    // v2 path: employee row carries tasksFractional
    expect(result!.byEmployee[0]?.tasksFractional).toBeDefined();

    if (origFlag === undefined) delete process.env.COMPLIANCE_V2_ENABLED;
    else process.env.COMPLIANCE_V2_ENABLED = origFlag;
  });
});
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all tests in both v1 and v2 suites PASS. If any v1 tests break due to `EmployeeCompliance` optional field additions, there's an import inconsistency — fix before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/lib/compliance-compute.ts src/__tests__/compliance-compute.test.ts src/lib/office-performance-types.ts
git commit -m "feat(compliance-v2): flag-gated delegation from computeLocationCompliance"
```

### Task 4.3: Cache key includes flag version

**Files:**
- Modify: `src/app/api/zuper/compliance/route.ts`

- [ ] **Step 1: Read current cache key construction**

Run: `grep -n "cache" src/app/api/zuper/compliance/route.ts`
Identify the existing cache key (e.g., `compliance:${location}:${days}`).

- [ ] **Step 2: Append version tag**

Modify the cache key construction to include `complianceVersionTag()`:

```ts
import { complianceVersionTag } from "@/lib/compliance-v2/feature-flag";
// ...
const cacheKey = `compliance:${location}:${days}:${complianceVersionTag()}`;
```

- [ ] **Step 3: Verify no React Query key refs use bare "compliance"**

Run: `grep -rn "compliance:" src/lib/query-keys.ts src/hooks/`
If query key factory exists for compliance, update to include the flag version.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/zuper/compliance/route.ts
git commit -m "fix(compliance-v2): cache key includes version tag to prevent stale serving"
```

---

## Chunk 5: UI changes

### Task 5.1: ComplianceBlock column updates

**Files:**
- Modify: `src/app/dashboards/office-performance/[location]/ComplianceBlock.tsx`

- [ ] **Step 1: Replace column header grid**

Current header `grid-cols-[1fr_40px_48px_72px_48px_48px_48px_80px]` — 8 columns. Add one more column for Pass rate and widen the Jobs column to fit "3.5 / 7" format.

New layout:
- Name (1fr)
- Grade (40px)
- On-time (48px)
- OOW u/p (72px)
- Tasks/Jobs (64px, was Jobs at 48px)
- Pass (40px, NEW)
- Stuck (48px)
- Avg d (48px)
- Score (80px)

Change the two `grid-cols-[...]` occurrences to:
```
grid-cols-[1fr_40px_48px_72px_64px_40px_48px_48px_80px]
```

Update header row:
```tsx
<span>Name</span>
<span className="text-center">Grade</span>
<span className="text-right">On-time</span>
<span className="text-right">OOW u/p</span>
<span className="text-right">Tasks/Jobs</span>
<span className="text-right">Pass</span>
<span className="text-right">Stuck</span>
<span className="text-right">Avg d</span>
<span className="text-right">Score</span>
```

- [ ] **Step 2: Update Jobs column render**

Replace:
```tsx
<span className="text-right text-slate-400">
  {emp.completedJobs}/{emp.totalJobs}
</span>
```

With:
```tsx
<span className="text-right text-slate-400 whitespace-nowrap">
  {emp.tasksFractional !== undefined && emp.distinctParentJobs !== undefined
    ? `${emp.tasksFractional.toFixed(1)} / ${emp.distinctParentJobs}`
    : `${emp.completedJobs}/${emp.totalJobs}`}
</span>
```

- [ ] **Step 3: Add Pass rate column (between Jobs and Stuck)**

Insert:
```tsx
{emp.passRate !== undefined && emp.passRate >= 0 ? (
  <span
    className="text-right font-semibold"
    style={{ color: onTimeColor(emp.passRate) }}
  >
    {emp.passRate}%
  </span>
) : (
  <span className="text-right text-slate-600">—</span>
)}
```

- [ ] **Step 4: Add Follow-up badge next to Name**

Replace the Name `<span>` with:
```tsx
<span className="text-slate-300 font-medium truncate flex items-center gap-1">
  {emp.name}
  {emp.hasFollowUp && (
    <span
      title="Completed with follow-up (Return Visit / Loose Ends / Needs Revisit)"
      className="text-[8px] px-1 py-[1px] rounded bg-yellow-900/40 text-yellow-300 font-semibold"
    >
      FU
    </span>
  )}
</span>
```

- [ ] **Step 5: Low-volume grade suppression**

Replace the Grade `<span>` with:
```tsx
{emp.lowVolume ? (
  <span
    className="text-center text-[9px] text-slate-500 font-semibold"
    title="Low volume (<5 task credits in window); grade hidden to reduce noise"
  >
    LV
  </span>
) : (
  <span
    className="text-center font-bold text-sm"
    style={{ color: gradeColor(emp.grade) }}
  >
    {emp.grade}
  </span>
)}
```

- [ ] **Step 6: Update legend text**

In the legend block around line 144-160, change the first legend div to match §5.3:

```tsx
<div>
  Score is computed per service task you were assigned to or submitted.
  If you worked a job but weren't assigned to a specific task in Zuper, it won't count.
</div>
```

Keep the existing score formula line.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/office-performance/[location]/ComplianceBlock.tsx
git commit -m "feat(compliance-v2): UI — Tasks/Jobs, Pass rate, Follow-up badge, low-volume"
```

### Task 5.2: Snapshot test for ComplianceBlock

**Files:**
- Create: `src/app/dashboards/office-performance/[location]/__tests__/ComplianceBlock.test.tsx`

- [ ] **Step 1: Write snapshot tests**

Create the test file (use React Testing Library — verify the project already has it via `grep testing-library package.json`; if not, note as a blocker).

```tsx
import { render } from "@testing-library/react";
import ComplianceBlock from "../ComplianceBlock";
import type { SectionCompliance } from "@/lib/office-performance-types";

const baseCompliance: SectionCompliance = {
  totalJobs: 10,
  completedJobs: 8,
  onTimePercent: 80,
  stuckJobs: [],
  neverStartedCount: 1,
  avgDaysToComplete: 2.5,
  avgDaysLate: 0,
  oowUsagePercent: 60,
  oowOnTimePercent: 75,
  aggregateGrade: "B",
  aggregateScore: 85,
  byEmployee: [],
};

describe("ComplianceBlock", () => {
  it("renders v1 shape (tasksFractional undefined)", () => {
    const { container } = render(
      <ComplianceBlock
        compliance={{
          ...baseCompliance,
          byEmployee: [
            {
              name: "Jane",
              totalJobs: 10,
              completedJobs: 8,
              onTimePercent: 80,
              measurableCount: 8,
              lateCount: 2,
              stuckCount: 0,
              neverStartedCount: 0,
              avgDaysToComplete: 2,
              avgDaysLate: 0,
              oowUsagePercent: 50,
              oowOnTimePercent: 60,
              statusUsagePercent: 40,
              complianceScore: 80,
              grade: "B",
            },
          ],
        }}
      />
    );
    expect(container).toMatchSnapshot();
  });

  it("renders v2 shape with hasFollowUp + low-volume", () => {
    const { container } = render(
      <ComplianceBlock
        compliance={{
          ...baseCompliance,
          byEmployee: [
            {
              name: "Jane",
              totalJobs: 4,
              completedJobs: 4,
              onTimePercent: 75,
              measurableCount: 4,
              lateCount: 1,
              stuckCount: 0,
              neverStartedCount: 0,
              avgDaysToComplete: 2,
              avgDaysLate: 0,
              oowUsagePercent: -1,
              oowOnTimePercent: -1,
              statusUsagePercent: 0,
              complianceScore: 75,
              grade: "—",
              tasksFractional: 2.5,
              distinctParentJobs: 4,
              passRate: 100,
              hasFollowUp: true,
              lowVolume: true,
            },
          ],
        }}
      />
    );
    expect(container).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run snapshot**

Run: `npm test -- ComplianceBlock.test`
Expected: PASS, snapshot file created.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/office-performance/[location]/__tests__/ComplianceBlock.test.tsx src/app/dashboards/office-performance/[location]/__tests__/__snapshots__/
git commit -m "test(compliance-v2): snapshot coverage for new UI columns"
```

---

## Chunk 6: Shadow compare, Lucas sanity-check, cleanup cron

### Task 6.1: Shadow-compare script

**Files:**
- Create: `scripts/compliance-shadow-compare.ts`

- [ ] **Step 1: Write the script**

```ts
/**
 * One-shot: compute v1 and v2 compliance scores for the last 30 days,
 * write both into ComplianceScoreShadow. Diffs are analyzed manually
 * from the DB (or via lucas-compliance-diff.ts).
 *
 * Run via: npx tsx scripts/compliance-shadow-compare.ts
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";
import { computeLocationCompliance } from "../src/lib/compliance-compute";
import { computeLocationComplianceV2 } from "../src/lib/compliance-v2/scoring";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

const LOCATIONS = ["Westminster", "Centennial", "Colorado Springs", "San Luis Obispo", "Camarillo"];
const CATEGORIES = ["Site Survey", "Construction", "Inspection"];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error("DATABASE_URL not set"); process.exit(1); }
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });

  const windowDays = 30;

  for (const location of LOCATIONS) {
    for (const category of CATEGORIES) {
      console.log(`\nComputing ${location} / ${category}...`);

      // Force v1 (explicitly set the env var)
      const origFlag = process.env.COMPLIANCE_V2_ENABLED;
      delete process.env.COMPLIANCE_V2_ENABLED;
      const v1 = await computeLocationCompliance(category, location, windowDays);
      if (origFlag !== undefined) process.env.COMPLIANCE_V2_ENABLED = origFlag;

      // v2 (bypass flag by calling directly)
      const v2 = await computeLocationComplianceV2(category, location, windowDays);

      if (!v1 || !v2) {
        console.log(`  skipping (no data)`);
        continue;
      }

      // Match v1 and v2 employees by userUid where possible, or by name
      const v2ByUid = new Map(v2.byEmployee.map((e) => [e.userUid, e]));

      for (const v1e of v1.byEmployee) {
        // v1 doesn't track userUid on EmployeeCompliance (it's by name only), so we approximate by name
        const v2e = [...v2ByUid.values()].find((x) => x.name === v1e.name);
        if (!v2e) continue;

        await prisma.complianceScoreShadow.create({
          data: {
            userUid: v2e.userUid,
            userName: v1e.name,
            location,
            category,
            windowDays,
            v1Score: v1e.complianceScore,
            v1Grade: v1e.grade,
            v2Score: v2e.complianceScore,
            v2Grade: v2e.grade,
            v1TotalJobs: v1e.totalJobs,
            v2TasksFractional: v2e.tasksFractional,
            v2DistinctParentJobs: v2e.distinctParentJobs,
            emptyCreditSetJobs: v2.emptyCreditSetJobs,
          },
        });
      }
      console.log(`  wrote ${v1.byEmployee.length} rows`);
    }
  }

  await prisma.$disconnect();
  console.log("\nDone. Query with: SELECT * FROM \"ComplianceScoreShadow\" ORDER BY ABS(\"v2Score\" - \"v1Score\") DESC LIMIT 30;");
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Don't run yet — the migration must be applied first**

Commit without running.

- [ ] **Step 3: Commit**

```bash
git add scripts/compliance-shadow-compare.ts
git commit -m "feat(compliance-v2): shadow-compare script writes v1 vs v2 to DB"
```

### Task 6.2: Lucas sanity-check analysis script

**Files:**
- Create: `scripts/lucas-compliance-diff.ts`

- [ ] **Step 1: Write script that queries ComplianceScoreShadow and generates markdown**

```ts
/**
 * Generates docs/superpowers/analyses/<date>-lucas-compliance-diff.md from
 * ComplianceScoreShadow rows. Pass criteria from spec §8.4.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { config as dotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv({ path: ".env" });
dotenv({ path: ".env.local", override: false });

const CA_LOCATIONS = new Set(["San Luis Obispo", "Camarillo"]);

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

  const since = new Date();
  since.setDate(since.getDate() - 2); // latest shadow rows
  const rows = await prisma.complianceScoreShadow.findMany({
    where: { computedAt: { gte: since } },
    orderBy: { computedAt: "desc" },
  });

  const ca = rows.filter((r) => CA_LOCATIONS.has(r.location));
  const lucas = ca.find((r) => r.userName.toLowerCase().includes("lucas"));
  const caDrops = ca.filter((r) => r.v2Score < r.v1Score - 10);
  const caConstruction = ca.filter((r) => r.category === "Construction");
  const totalCaConstructionWork = caConstruction.reduce((s, r) => s + r.v2TasksFractional, 0);
  const emptyRate = caConstruction.length > 0
    ? caConstruction.reduce((s, r) => s + r.emptyCreditSetJobs, 0) / Math.max(1, caConstruction.length)
    : 0;

  const criteria = [
    { id: 1, name: "Lucas's v2 ≥ v1", pass: lucas ? lucas.v2Score >= lucas.v1Score : false },
    { id: 2, name: "No CA tech drops >10 points", pass: caDrops.length === 0 },
    { id: 3, name: "CA empty-credit-set rate <20%", pass: emptyRate < 0.20 },
  ];
  const allPass = criteria.every((c) => c.pass);

  const md = [
    `# Lucas Scarpellino compliance v1 vs v2 sanity-check`,
    ``,
    `**Generated:** ${new Date().toISOString()}`,
    `**Source:** ComplianceScoreShadow (last 2 days)`,
    ``,
    `## Pass criteria (spec §8.4)`,
    ``,
    ...criteria.map((c) => `- ${c.pass ? "✅" : "❌"} Criterion ${c.id}: ${c.name}`),
    ``,
    `**Overall:** ${allPass ? "✅ UNBLOCKED for flag flip" : "❌ BLOCKED pending investigation"}`,
    ``,
    `## Lucas detail`,
    ``,
    lucas
      ? `| Location | Category | v1 | v2 | Δ | Tasks (v2) |\n|---|---|---|---|---|---|\n| ${lucas.location} | ${lucas.category} | ${lucas.v1Score} | ${lucas.v2Score} | ${(lucas.v2Score - lucas.v1Score).toFixed(1)} | ${lucas.v2TasksFractional.toFixed(1)} |`
      : `No Lucas row found in shadow table.`,
    ``,
    `## California crew >10 point drops`,
    ``,
    caDrops.length > 0
      ? caDrops.map((r) => `- ${r.userName} (${r.location}/${r.category}): ${r.v1Score} → ${r.v2Score}`).join("\n")
      : `(none)`,
    ``,
    `## Raw CA rows`,
    ``,
    `| Name | Location | Category | v1 | v2 | Tasks (v2) | Empty credit jobs |`,
    `|---|---|---|---|---|---|---|`,
    ...ca.map((r) => `| ${r.userName} | ${r.location} | ${r.category} | ${r.v1Score} | ${r.v2Score} | ${r.v2TasksFractional.toFixed(1)} | ${r.emptyCreditSetJobs} |`),
  ].join("\n");

  const outDir = path.join(process.cwd(), "docs/superpowers/analyses");
  fs.mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().split("T")[0];
  const outFile = path.join(outDir, `${today}-lucas-compliance-diff.md`);
  fs.writeFileSync(outFile, md);
  console.log(`Wrote ${outFile}`);
  console.log(`Result: ${allPass ? "PASS" : "FAIL"}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add scripts/lucas-compliance-diff.ts
git commit -m "feat(compliance-v2): Lucas sanity-check analysis generator"
```

### Task 6.3: Shadow cleanup cron

**Files:**
- Create: `src/app/api/cron/compliance-shadow-cleanup/route.ts`

- [ ] **Step 1: Write cron route**

```ts
/**
 * Daily cron: prune ComplianceScoreShadow rows older than 60 days.
 * Configured in vercel.json alongside other crons.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Vercel cron auth header check
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);

  const result = await prisma.complianceScoreShadow.deleteMany({
    where: { computedAt: { lt: cutoff } },
  });

  return NextResponse.json({ deleted: result.count, cutoff: cutoff.toISOString() });
}
```

- [ ] **Step 2: Register cron in vercel.json**

Read current vercel.json; append to `crons` array:
```json
{ "path": "/api/cron/compliance-shadow-cleanup", "schedule": "0 6 * * *" }
```

- [ ] **Step 3: Add route to middleware PUBLIC_API_ROUTES allowlist**

Location verified: `src/middleware.ts` defines `PUBLIC_API_ROUTES` at the top (~line 21-51). Every cron route is listed there with a `// CRON_SECRET validated in route` comment.

Add the new route to that array (keep alphabetical/grouping with other `/api/cron/*` entries):

```ts
  "/api/cron/compliance-shadow-cleanup", // Compliance v2 shadow table TTL cleanup — CRON_SECRET validated in route
```

Verify before moving on:
```bash
grep -n "compliance-shadow-cleanup" src/middleware.ts
```
Expected: one hit inside the `PUBLIC_API_ROUTES` array.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/compliance-shadow-cleanup/route.ts vercel.json src/middleware.ts
git commit -m "feat(compliance-v2): daily cleanup cron for shadow table"
```

---

## Chunk 7: Self-review, run full suite, summary

### Task 7.1: Self-review pass

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Run preflight**

Run: `npm run preflight`
Expected: no errors.

- [ ] **Step 5: Read the full diff**

```bash
git log --stat main..HEAD
git diff main..HEAD --stat
```

Verify: no unintended files touched, no CLAUDE.md changes, no env secrets committed.

- [ ] **Step 6: Sanity-check critical paths by reading the code**

Spot-check:
- [ ] `computeLocationComplianceV2` → task loop → credit-set computation → 1/N math is correct
- [ ] Empty-credit-set jobs increment the diagnostic counter and do NOT assign any attribution
- [ ] Status buckets include all spec §8.1 statuses
- [ ] `TASK_TITLE_CLASSIFICATION` has Work/Paperwork splits that match the enumeration output
- [ ] Feature flag gate in `computeLocationCompliance` is reachable
- [ ] UI columns render without crashing when v2 fields are undefined (backward compat)

### Task 7.2: Prepare merge confirmation

- [ ] **Step 1: Write a summary for the user**

Output (this goes to the human):

> Implementation complete on branch `claude/adoring-napier-3975cc`. Ready to merge after:
>
> **Prerequisites (human action required):**
> 1. Approve migration: `npx prisma migrate deploy` — creates `ComplianceScoreShadow` table.
> 2. Set `COMPLIANCE_V2_ENABLED=false` in Vercel prod env (default behavior; spec §7 rollout).
>
> **Post-merge verification steps:**
> 1. Run `npx tsx scripts/compliance-shadow-compare.ts` in prod for 30 days of data.
> 2. Run `npx tsx scripts/lucas-compliance-diff.ts` and read the output markdown.
> 3. If pass criteria (spec §8.4) pass, flip `COMPLIANCE_V2_ENABLED=true` for internal admins first (48h), then public.
>
> **Safety nets:**
> - Flag defaults OFF. Zero production behavior change until explicitly enabled.
> - v1 path unchanged — regression test guards this.
> - Cache key includes flag version tag — no stale v1 results served after flip.
> - Daily cleanup cron prunes shadow rows >60 days.

- [ ] **Step 2: Confirm merge with user**

Surface the summary. Wait for explicit "merge" or "ship it" confirmation before opening a PR.

---

## Done

Every chunk is self-contained and testable. The plan should produce a feature flag'd, shadow-compared, per-service-task compliance scoring system with legibility and fairness improvements the user asked for, and zero default-on behavior changes.
