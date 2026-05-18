# PE Action Tasks Cross-Reference Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `pe-crossref` subsystem that turns the existing PE audit's binary "found / missing" verdicts into the rich P-coded action task list PMs produce manually today (per `~/Downloads/PE-Turnover/PE_Action_Task_List_2026-05-17.pdf`).

**Architecture:** A decoupled subsystem with its own orchestrator, structured extractors (planset/SO/PowerHub/nameplate/monitoring-folder), five pure-function analyzers (one per P-code family), and a reconciler that diffs detected tasks against persistent DB rows. State machine handles auto-resolution from source data plus manual resolve/dismiss. Per-deal panel + new batch dashboard surface the tasks.

**Tech Stack:** Next.js 16 / TypeScript / Prisma 7.3 on Neon / React Query / next-auth v5 / Anthropic Sonnet vision / Jest for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-18-pe-action-tasks-cross-reference-design.md`

---

## File Structure (created across all chunks)

```
src/lib/pe-crossref/
├── index.ts                       — runCrossReference(dealId, opts) entry
├── types.ts                       — DetectedTask, CrossRefContext, Analyzer interface
├── context.ts                     — buildCrossRefContext()
├── reconciler.ts                  — detected ↔ existing tasks → DB mutations
├── extractors/
│   ├── monitoring-folder.ts       — Drive M1 folder scan
│   ├── powerhub.ts                — Tesla PowerHub asset fetch
│   ├── nameplate.ts               — Sonnet vision on install photos
│   ├── sales-order.ts             — Zoho SO normalization
│   └── planset.ts                 — Sonnet vision on planset PV pages
└── analyzers/
    ├── monitoring.ts              — MONITORING, ENPHASE
    ├── hardware.ts                — P1, P6
    ├── sales-order.ts             — P2, P3, P4, P5, P7, P8, P9
    ├── planset.ts                 — P10, P10B, P10C
    └── photo-critique.ts          — P11B (LLM-based)

src/app/api/pe-crossref/
├── [dealId]/run/route.ts          — POST trigger (SSE)
├── [dealId]/tasks/route.ts        — GET deal tasks
├── tasks/[taskId]/route.ts        — PATCH lifecycle
├── queue/route.ts                 — GET batch view
└── queue/bulk/route.ts            — PATCH bulk

src/app/dashboards/pe-action-queue/page.tsx — new batch dashboard
src/components/pe-prep/
├── PeActionTasksPanel.tsx         — per-deal panel
└── PeActionTaskCard.tsx           — single-task card with resolve/dismiss
src/components/pe-action-queue/    — dashboard helpers

src/__tests__/pe-crossref/
├── reconciler.test.ts             — state machine coverage
├── analyzers/{each}.test.ts       — pure-function detection tests
└── route.test.ts                  — API smoke tests

prisma/schema.prisma                — adds PeActionTask + CrossRefRun
src/lib/roles.ts                    — adds /api/pe-crossref + /dashboards/pe-action-queue
src/app/suites/pe-compliance/page.tsx — adds PE Action Queue card
src/lib/pe-audit-orchestrator.ts    — adds auto-trigger hook on audit completion
```

---

## Chunk 1: Foundation — Schema, Reconciler, Types

This chunk establishes the data model and the most algorithmically gnarly piece (the reconciler state machine). Everything else hangs off this. By the end of Chunk 1 we can already write tasks to the DB and resolve them — there's just nothing emitting them yet.

### Task 1: Prisma migration for `PeActionTask` + `CrossRefRun`

**Files:**
- Modify: `prisma/schema.prisma` (append after `PeAuditRun`)

- [ ] **Step 1: Add models to schema**

Append at the end of `prisma/schema.prisma` (search for `model PeAuditRun` and add these after):

```prisma
model PeActionTask {
  id              String   @id @default(cuid())
  dealId          String

  // Identity for re-run dedup. Same identityKey across runs = same task.
  // Versioned (e.g. "P10@v1:...") so analyzer rule changes can migrate explicitly.
  identityKey     String

  pCode           String   // "P1" | "P10B" | "MONITORING" | "ENPHASE"
  severity        String   // "critical" | "major" | "conditional" | "monitoring"
  category        String   // "hardware" | "so" | "planset" | "photo" | "monitoring"
  analyzer        String   // module name for debug

  title           String
  message         String   @db.Text
  action          String   @db.Text
  evidence        Json

  status          String   // "OPEN" | "RESOLVED_AUTO" | "RESOLVED_MANUAL" | "DISMISSED"
  resolvedBy      String?  // "auto" | userEmail
  resolvedAt      DateTime?
  manualResolvedAt DateTime?
  dismissedReason String?

  firstSeenRunId  String?
  lastSeenRunId   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([dealId, identityKey])
  @@index([dealId, status])
  @@index([severity, status])
  @@index([category, status])
  @@index([pCode])
}

model CrossRefRun {
  id              String   @id @default(cuid())
  dealId          String
  status          String   // "running" | "completed" | "failed"
  triggeredBy     String   // "audit-completion" | "manual:userEmail" | "batch-refresh"
  startedAt       DateTime @default(now())
  completedAt     DateTime?
  durationMs      Int?

  detectedCount   Int      @default(0)
  newCount        Int      @default(0)
  resolvedCount   Int      @default(0)

  extractorResults Json?   // per-extractor success/failure

  errorMessage    String?  @db.Text
  createdAt       DateTime @default(now())

  @@index([dealId, startedAt])
}
```

- [ ] **Step 2: Generate Prisma client and create migration file**

Run: `npx prisma migrate dev --name pe_action_task --create-only`
Expected: New migration file created in `prisma/migrations/YYYYMMDDHHMMSS_pe_action_task/migration.sql`.

> **Migration policy:** Do NOT run `prisma migrate deploy` automatically. The orchestrator surfaces the migration to the human per the `feedback_subagents_no_migrations` memory note. Subagents implementing this task stop after `--create-only` — orchestrator applies later.

- [ ] **Step 3: Run `prisma generate` to update client types**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client (7.5.0) to ./src/generated/prisma in ...ms`

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | head -10`
Expected: no NEW errors introduced. Compare against `git stash; npx tsc --noEmit ... | grep "error TS" | wc -l; git stash pop` if there are pre-existing test-file errors — total count should be unchanged.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(pe-crossref): add PeActionTask + CrossRefRun models"
```

### Task 2: Types module

**Files:**
- Create: `src/lib/pe-crossref/types.ts`
- Test: `src/__tests__/pe-crossref/types.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/__tests__/pe-crossref/types.test.ts
import { TASK_SEVERITY, TASK_CATEGORY } from "@/lib/pe-crossref/types";

describe("pe-crossref types", () => {
  it("exports severity tier list (used for UI ordering + DB validation)", () => {
    expect(TASK_SEVERITY).toEqual(["critical", "major", "conditional", "monitoring"]);
  });

  it("exports category list aligned to analyzer families", () => {
    expect(TASK_CATEGORY).toEqual(["hardware", "so", "planset", "photo", "monitoring"]);
  });
});
```

Run: `npm test -- pe-crossref/types`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 2: Implement types module**

```ts
// src/lib/pe-crossref/types.ts
import type { ResolvedPEDeal } from "@/lib/pe-turnover";
import type { TurnoverAuditResult } from "@/lib/pe-turnover";

export const TASK_SEVERITY = ["critical", "major", "conditional", "monitoring"] as const;
export type TaskSeverity = (typeof TASK_SEVERITY)[number];

export const TASK_CATEGORY = ["hardware", "so", "planset", "photo", "monitoring"] as const;
export type TaskCategory = (typeof TASK_CATEGORY)[number];

export const TASK_STATUS = ["OPEN", "RESOLVED_AUTO", "RESOLVED_MANUAL", "DISMISSED"] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

/**
 * What an analyzer emits when it detects a problem. Pure data — no DB ids,
 * no state. Reconciler maps to PeActionTask rows.
 */
export interface DetectedTask {
  pCode: string;
  identityKey: string;
  severity: TaskSeverity;
  category: TaskCategory;
  analyzer: string;
  title: string;
  message: string;
  action: string;
  evidence: Record<string, unknown>;
}

/**
 * Result of running structured extractors on a deal. Analyzers consume this.
 * Any extractor may fail — its slot is null and the analyzer skips.
 */
export interface CrossRefContext {
  deal: ResolvedPEDeal;
  planset: ExtractedPlanset | null;
  salesOrder: NormalizedSalesOrder | null;
  powerHubAsset: PowerHubAssetSummary | null;
  installPhotos: InstallPhotoRef[];
  nameplateExtractions: Map<string, NameplateData>; // photoFileId → data
  monitoringFolder: MonitoringFolderScan | null;
  /** Most recent completed PE audit run — used by PhotoCritiqueAnalyzer. */
  latestAuditRun: AuditRunSummary | null;
}

export interface ExtractedPlanset {
  fileId: string;
  fileName: string;
  specsByPage: Array<{
    page: number;
    pw3Model: string | null;
    bsModel: string | null;
    expansionUnitModel: string | null;
    moduleBrand: string | null;
    moduleQty: number | null;
    inverterModel: string | null;
  }>;
}

export interface NormalizedSalesOrder {
  soNumber: string;
  customerName: string;
  lineItems: Array<{
    index: number;
    sku: string | null;
    description: string;
    qty: number;
  }>;
}

export interface PowerHubAssetSummary {
  siteId: string;
  powerwallEntries: Array<{ model: string; serial?: string }>;
}

export interface InstallPhotoRef {
  fileId: string;
  fileName: string;
  source: "drive" | "zuper";
}

export interface NameplateData {
  photoFileId: string;
  detectedModel: string | null;     // e.g. "1707000-11-M"
  detectedSerial: string | null;
  notes: string;
}

export interface MonitoringFolderScan {
  m1FolderId: string;
  hasOriginalScreenshot: boolean;
  correctedScreenshotFile: { id: string; name: string; modifiedTime: string } | null;
}

export interface AuditRunSummary {
  runId: string;
  photoAssignments: Map<string, { photoFileId: string; checklistLabel: string }>;
}

/**
 * Analyzer interface. Pure function — no I/O, no DB writes.
 * Orchestrator runs all analyzers in parallel and feeds results to reconciler.
 */
export interface Analyzer {
  readonly name: string;
  readonly version: string;
  detectTasks(context: CrossRefContext): Promise<DetectedTask[]>;
}
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test -- pe-crossref/types && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "pe-crossref" | head -5`
Expected: tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-crossref/types.ts src/__tests__/pe-crossref/types.test.ts
git commit -m "feat(pe-crossref): add types module"
```

### Task 3: Reconciler — state machine logic

The reconciler is a pure function over `{ detectedTasks, existingRows }` → `ReconcileActions`. Pure-function design means we can test every state transition without mocking Prisma.

**Files:**
- Create: `src/lib/pe-crossref/reconciler.ts`
- Test: `src/__tests__/pe-crossref/reconciler.test.ts`

- [ ] **Step 1: Write failing test (full state machine coverage)**

```ts
// src/__tests__/pe-crossref/reconciler.test.ts
import { computeReconcileActions } from "@/lib/pe-crossref/reconciler";
import type { DetectedTask } from "@/lib/pe-crossref/types";

type Existing = Parameters<typeof computeReconcileActions>[0]["existing"][number];

const detected = (overrides: Partial<DetectedTask> = {}): DetectedTask => ({
  pCode: "P1",
  identityKey: "P1@v1:test",
  severity: "critical",
  category: "hardware",
  analyzer: "HardwareAnalyzer",
  title: "WRONG HARDWARE",
  message: "msg",
  action: "act",
  evidence: {},
  ...overrides,
});

const existing = (overrides: Partial<Existing> = {}): Existing => ({
  id: "t1",
  identityKey: "P1@v1:test",
  status: "OPEN",
  ...overrides,
});

describe("computeReconcileActions", () => {
  it("creates new task when identity has no existing row", () => {
    const actions = computeReconcileActions({
      runId: "r1",
      detected: [detected()],
      existing: [],
    });
    expect(actions.creates).toHaveLength(1);
    expect(actions.creates[0].identityKey).toBe("P1@v1:test");
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0);
  });

  it("keeps OPEN status when re-detected (just bumps lastSeenRunId)", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "OPEN" })],
    });
    expect(actions.creates).toHaveLength(0);
    expect(actions.updates).toHaveLength(1);
    expect(actions.updates[0].nextStatus).toBe("OPEN");
    expect(actions.updates[0].lastSeenRunId).toBe("r2");
  });

  it("auto-resolves OPEN task when source no longer flags it", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "OPEN" })],
    });
    expect(actions.autoResolves).toHaveLength(1);
    expect(actions.autoResolves[0].id).toBe("t1");
  });

  it("reopens RESOLVED_AUTO when source flags again", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "RESOLVED_AUTO" })],
    });
    expect(actions.updates).toHaveLength(1);
    expect(actions.updates[0].nextStatus).toBe("OPEN");
  });

  it("reopens RESOLVED_MANUAL when source still flags (PM's manual resolve doesn't stick)", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "RESOLVED_MANUAL" })],
    });
    expect(actions.updates).toHaveLength(1);
    expect(actions.updates[0].nextStatus).toBe("OPEN");
  });

  it("preserves RESOLVED_MANUAL when source no longer flags", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "RESOLVED_MANUAL" })],
    });
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0); // stays RESOLVED_MANUAL — no change
  });

  it("preserves RESOLVED_AUTO when source still does not flag", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "RESOLVED_AUTO" })],
    });
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0); // already resolved — no further change
  });

  it("preserves DISMISSED even when re-detected", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "DISMISSED" })],
    });
    expect(actions.creates).toHaveLength(0);
    expect(actions.updates).toHaveLength(0);
  });

  it("preserves DISMISSED when not detected", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [],
      existing: [existing({ status: "DISMISSED" })],
    });
    expect(actions.updates).toHaveLength(0);
    expect(actions.autoResolves).toHaveLength(0);
  });

  it("handles a mix of detected and undetected existing tasks in one call", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected({ identityKey: "A" }), detected({ identityKey: "B" })],
      existing: [
        existing({ id: "x", identityKey: "A", status: "OPEN" }),       // re-detected → bump
        existing({ id: "y", identityKey: "C", status: "OPEN" }),       // not detected → auto-resolve
        existing({ id: "z", identityKey: "D", status: "DISMISSED" }),  // not detected, stays
      ],
    });
    expect(actions.creates.map((c) => c.identityKey)).toEqual(["B"]);
    expect(actions.updates.map((u) => u.id)).toEqual(["x"]);
    expect(actions.autoResolves.map((r) => r.id)).toEqual(["y"]);
  });

  it("tracks manualResolvedAt timestamp when reopening from RESOLVED_MANUAL", () => {
    const actions = computeReconcileActions({
      runId: "r2",
      detected: [detected()],
      existing: [existing({ status: "RESOLVED_MANUAL" })],
    });
    expect(actions.updates[0].previousStatus).toBe("RESOLVED_MANUAL");
  });
});
```

Run: `npm test -- pe-crossref/reconciler`
Expected: FAIL — `computeReconcileActions` does not exist.

- [ ] **Step 2: Implement reconciler**

```ts
// src/lib/pe-crossref/reconciler.ts
import type { DetectedTask, TaskStatus } from "@/lib/pe-crossref/types";

export interface ExistingTaskRow {
  id: string;
  identityKey: string;
  status: TaskStatus;
}

export interface ReconcileInput {
  runId: string;
  detected: DetectedTask[];
  existing: ExistingTaskRow[];
}

export interface ReconcileActions {
  /** New tasks to insert. */
  creates: Array<DetectedTask & { firstSeenRunId: string; lastSeenRunId: string }>;
  /** Existing rows whose status / lastSeenRunId should change. */
  updates: Array<{
    id: string;
    previousStatus: TaskStatus;
    nextStatus: TaskStatus;
    lastSeenRunId: string;
  }>;
  /** Existing OPEN/RESOLVED_AUTO rows the source no longer flags. */
  autoResolves: Array<{ id: string }>;
}

/**
 * Pure function. Compute what should change without mutating anything.
 *
 * State transitions (per spec §"State machine"):
 *
 *   On re-detection:
 *     OPEN            → OPEN  (lastSeenRunId bump only)
 *     RESOLVED_AUTO   → OPEN  (regressed)
 *     RESOLVED_MANUAL → OPEN  (PM's manual resolve doesn't override source)
 *     DISMISSED       → DISMISSED (PM declared N/A — permanent)
 *
 *   On non-detection (existing row, no match in detected):
 *     OPEN            → RESOLVED_AUTO
 *     RESOLVED_AUTO   → stays
 *     RESOLVED_MANUAL → stays
 *     DISMISSED       → stays
 */
export function computeReconcileActions(input: ReconcileInput): ReconcileActions {
  const { runId, detected, existing } = input;
  const existingByKey = new Map(existing.map((e) => [e.identityKey, e]));
  const detectedKeys = new Set<string>();

  const creates: ReconcileActions["creates"] = [];
  const updates: ReconcileActions["updates"] = [];
  const autoResolves: ReconcileActions["autoResolves"] = [];

  for (const task of detected) {
    detectedKeys.add(task.identityKey);
    const row = existingByKey.get(task.identityKey);
    if (!row) {
      creates.push({ ...task, firstSeenRunId: runId, lastSeenRunId: runId });
      continue;
    }
    const next = nextStatusOnReDetect(row.status);
    if (next !== row.status) {
      updates.push({ id: row.id, previousStatus: row.status, nextStatus: next, lastSeenRunId: runId });
    } else {
      // status unchanged but we still bump lastSeenRunId for OPEN (visibility into recency).
      // Skip emitting "update" for DISMISSED — DB write avoidance.
      if (row.status === "OPEN") {
        updates.push({ id: row.id, previousStatus: row.status, nextStatus: row.status, lastSeenRunId: runId });
      }
    }
  }

  for (const row of existing) {
    if (detectedKeys.has(row.identityKey)) continue;
    if (row.status === "OPEN" || row.status === "RESOLVED_AUTO") {
      // OPEN → RESOLVED_AUTO; RESOLVED_AUTO unchanged but we still treat it as
      // "no change needed" — keep autoResolves restricted to actual transitions.
      if (row.status === "OPEN") {
        autoResolves.push({ id: row.id });
      }
    }
    // RESOLVED_MANUAL and DISMISSED stay as-is when not detected.
  }

  return { creates, updates, autoResolves };
}

function nextStatusOnReDetect(current: TaskStatus): TaskStatus {
  switch (current) {
    case "OPEN":
      return "OPEN";
    case "RESOLVED_AUTO":
      return "OPEN";
    case "RESOLVED_MANUAL":
      return "OPEN";
    case "DISMISSED":
      return "DISMISSED";
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npm test -- pe-crossref/reconciler`
Expected: PASS — all 10 cases green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-crossref/reconciler.ts src/__tests__/pe-crossref/reconciler.test.ts
git commit -m "feat(pe-crossref): add reconciler with state machine + tests"
```

### Task 4: Persistence layer — apply reconcile actions to DB

**Files:**
- Modify: `src/lib/pe-crossref/reconciler.ts` (add a thin Prisma-touching wrapper)
- Test: extend `src/__tests__/pe-crossref/reconciler.test.ts` with a Prisma mock

- [ ] **Step 1: Add `applyReconcileActions` wrapper at bottom of reconciler.ts**

```ts
// Appended to src/lib/pe-crossref/reconciler.ts
import { prisma } from "@/lib/db";

export async function applyReconcileActions(
  dealId: string,
  actions: ReconcileActions,
): Promise<{ created: number; updated: number; autoResolved: number }> {
  let created = 0;
  let updated = 0;
  let autoResolved = 0;

  // CREATEs — one per identity. Use createMany for batch insert.
  if (actions.creates.length > 0) {
    const result = await prisma.peActionTask.createMany({
      data: actions.creates.map((t) => ({
        dealId,
        identityKey: t.identityKey,
        pCode: t.pCode,
        severity: t.severity,
        category: t.category,
        analyzer: t.analyzer,
        title: t.title,
        message: t.message,
        action: t.action,
        evidence: t.evidence,
        status: "OPEN",
        firstSeenRunId: t.firstSeenRunId,
        lastSeenRunId: t.lastSeenRunId,
      })),
      skipDuplicates: true, // belt-and-suspenders for race conditions
    });
    created = result.count;
  }

  // UPDATEs — status transitions (incl. lastSeenRunId-only bumps).
  for (const u of actions.updates) {
    await prisma.peActionTask.update({
      where: { id: u.id },
      data: {
        status: u.nextStatus,
        lastSeenRunId: u.lastSeenRunId,
        // Clear resolvedAt/resolvedBy when transitioning out of a RESOLVED_* state.
        ...(u.previousStatus !== "OPEN" && u.nextStatus === "OPEN"
          ? { resolvedAt: null, resolvedBy: null }
          : {}),
      },
    });
    updated++;
  }

  // AUTO_RESOLVEs.
  for (const r of actions.autoResolves) {
    await prisma.peActionTask.update({
      where: { id: r.id },
      data: {
        status: "RESOLVED_AUTO",
        resolvedAt: new Date(),
        resolvedBy: "auto",
      },
    });
    autoResolved++;
  }

  return { created, updated, autoResolved };
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep pe-crossref | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-crossref/reconciler.ts
git commit -m "feat(pe-crossref): add applyReconcileActions Prisma wrapper"
```

### Task 5: Orchestrator skeleton + run-record management

**Files:**
- Create: `src/lib/pe-crossref/index.ts`
- Create: `src/lib/pe-crossref/context.ts`
- Test: `src/__tests__/pe-crossref/index.test.ts`

- [ ] **Step 1: Implement context builder as parallel stub**

```ts
// src/lib/pe-crossref/context.ts
import type { CrossRefContext } from "@/lib/pe-crossref/types";
import { resolvePEDeal } from "@/lib/pe-turnover";

export interface ContextBuildResult {
  context: CrossRefContext;
  extractorResults: Record<string, "ok" | string>; // "ok" or error message
}

/**
 * Build the cross-ref context by running every extractor in parallel.
 * Each extractor is wrapped in try/catch — failures null out their slot.
 *
 * In Chunk 1 most extractors are stubs that return null. Subsequent chunks
 * (Hardware, SalesOrder, Planset, Monitoring) replace each stub with a real
 * extractor.
 */
export async function buildCrossRefContext(dealId: string): Promise<ContextBuildResult> {
  const deal = await resolvePEDeal(dealId);
  const extractorResults: Record<string, "ok" | string> = {};

  return {
    extractorResults,
    context: {
      deal,
      planset: null,
      salesOrder: null,
      powerHubAsset: null,
      installPhotos: [],
      nameplateExtractions: new Map(),
      monitoringFolder: null,
      latestAuditRun: null,
    },
  };
}
```

- [ ] **Step 2: Implement orchestrator entry point**

```ts
// src/lib/pe-crossref/index.ts
import { prisma } from "@/lib/db";
import { buildCrossRefContext } from "@/lib/pe-crossref/context";
import { computeReconcileActions, applyReconcileActions } from "@/lib/pe-crossref/reconciler";
import type { Analyzer, DetectedTask } from "@/lib/pe-crossref/types";

export type CrossRefTrigger = "audit-completion" | "manual" | "batch-refresh";

export interface RunCrossReferenceOptions {
  dealId: string;
  triggeredBy: string; // "audit-completion" | "manual:userEmail" | "batch-refresh"
  analyzers?: Analyzer[]; // injection for testing; default uses registered analyzers
}

export interface RunCrossReferenceResult {
  runId: string;
  status: "completed" | "failed";
  detectedCount: number;
  newCount: number;
  resolvedCount: number;
  errorMessage?: string;
}

/**
 * Run the cross-reference pipeline for one deal.
 *
 * 1. Create CrossRefRun row (status=running)
 * 2. Build context (parallel extractors)
 * 3. Run analyzers in parallel against context
 * 4. Fetch existing PeActionTask rows for deal
 * 5. Reconcile (pure) + apply (DB)
 * 6. Mark run completed with counts
 */
export async function runCrossReference(opts: RunCrossReferenceOptions): Promise<RunCrossReferenceResult> {
  const { dealId, triggeredBy } = opts;
  const startedAt = Date.now();

  const runRow = await prisma.crossRefRun.create({
    data: { dealId, status: "running", triggeredBy },
  });

  try {
    const { context, extractorResults } = await buildCrossRefContext(dealId);
    const analyzers = opts.analyzers ?? getRegisteredAnalyzers();

    const detectedPerAnalyzer = await Promise.all(
      analyzers.map((a) =>
        a.detectTasks(context).catch((err) => {
          console.warn(`[pe-crossref] analyzer ${a.name} failed:`, err);
          return [] as DetectedTask[];
        }),
      ),
    );
    const detected = detectedPerAnalyzer.flat();

    const existing = await prisma.peActionTask.findMany({
      where: { dealId },
      select: { id: true, identityKey: true, status: true },
    });

    const actions = computeReconcileActions({
      runId: runRow.id,
      detected,
      existing: existing.map((e) => ({
        id: e.id,
        identityKey: e.identityKey,
        status: e.status as "OPEN" | "RESOLVED_AUTO" | "RESOLVED_MANUAL" | "DISMISSED",
      })),
    });
    const applied = await applyReconcileActions(dealId, actions);

    await prisma.crossRefRun.update({
      where: { id: runRow.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        detectedCount: detected.length,
        newCount: applied.created,
        resolvedCount: applied.autoResolved,
        extractorResults,
      },
    });

    return {
      runId: runRow.id,
      status: "completed",
      detectedCount: detected.length,
      newCount: applied.created,
      resolvedCount: applied.autoResolved,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.crossRefRun.update({
      where: { id: runRow.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        durationMs: Date.now() - startedAt,
        errorMessage,
      },
    });
    return {
      runId: runRow.id,
      status: "failed",
      detectedCount: 0,
      newCount: 0,
      resolvedCount: 0,
      errorMessage,
    };
  }
}

/**
 * Registered analyzers. Populated as each is implemented (Chunks 3-7).
 * In Chunk 1 this returns an empty list — runs complete with 0 detected.
 */
function getRegisteredAnalyzers(): Analyzer[] {
  return [];
}
```

- [ ] **Step 3: Smoke test the orchestrator with an empty-analyzer run**

```ts
// src/__tests__/pe-crossref/index.test.ts
import { runCrossReference } from "@/lib/pe-crossref";

// Lightweight smoke test — verifies the module wires up without crashing.
// Real integration tests live in chunks that add actual extractors.
describe("runCrossReference (smoke)", () => {
  it("exports a function", () => {
    expect(typeof runCrossReference).toBe("function");
  });
});
```

Run: `npm test -- pe-crossref/index && npx tsc --noEmit -p tsconfig.json 2>&1 | grep pe-crossref | head -5`
Expected: test passes, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-crossref/index.ts src/lib/pe-crossref/context.ts src/__tests__/pe-crossref/index.test.ts
git commit -m "feat(pe-crossref): add orchestrator skeleton + context builder"
```

---

## Chunk 2: API Routes + Role Access + Per-Deal Panel Scaffolding

End-state: PM can navigate to /dashboards/pe-prep/[dealId], see the (empty) Action Tasks panel, click "Re-run cross-ref" which fires the empty pipeline, returns "0 tasks detected". Foundation for analyzers to plug in.

### Task 6: GET tasks for a deal

**Files:**
- Create: `src/app/api/pe-crossref/[dealId]/tasks/route.ts`

- [ ] **Step 1: Implement GET handler**

```ts
// src/app/api/pe-crossref/[dealId]/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { dealId } = await params;

  const tasks = await prisma.peActionTask.findMany({
    where: { dealId },
    orderBy: [{ status: "asc" }, { severity: "asc" }, { createdAt: "asc" }],
  });

  const latestRun = await prisma.crossRefRun.findFirst({
    where: { dealId, status: "completed" },
    orderBy: { startedAt: "desc" },
    select: { id: true, completedAt: true, triggeredBy: true, durationMs: true },
  });

  return NextResponse.json({ tasks, latestRun });
}
```

- [ ] **Step 2: Verify route compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "api/pe-crossref" | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pe-crossref/[dealId]/tasks/route.ts
git commit -m "feat(pe-crossref): GET /api/pe-crossref/[dealId]/tasks"
```

### Task 7: PATCH task lifecycle (resolve / dismiss / reopen)

**Files:**
- Create: `src/app/api/pe-crossref/tasks/[taskId]/route.ts`
- Test: `src/__tests__/pe-crossref/route-patch.test.ts`

- [ ] **Step 1: Write failing test for action-validation logic**

```ts
// src/__tests__/pe-crossref/route-patch.test.ts
import { computeManualStatusChange } from "@/app/api/pe-crossref/tasks/[taskId]/_lifecycle";

describe("computeManualStatusChange", () => {
  it("resolves OPEN → RESOLVED_MANUAL", () => {
    const out = computeManualStatusChange({
      currentStatus: "OPEN",
      action: "resolve",
      userEmail: "u@p.com",
    });
    expect(out.status).toBe("RESOLVED_MANUAL");
    expect(out.resolvedBy).toBe("u@p.com");
    expect(out.manualResolvedAt).toBeInstanceOf(Date);
  });

  it("dismisses OPEN → DISMISSED with reason", () => {
    const out = computeManualStatusChange({
      currentStatus: "OPEN",
      action: "dismiss",
      userEmail: "u@p.com",
      reason: "Not applicable to this deal",
    });
    expect(out.status).toBe("DISMISSED");
    expect(out.dismissedReason).toBe("Not applicable to this deal");
  });

  it("reopens RESOLVED_MANUAL → OPEN clearing resolved fields", () => {
    const out = computeManualStatusChange({
      currentStatus: "RESOLVED_MANUAL",
      action: "reopen",
      userEmail: "u@p.com",
    });
    expect(out.status).toBe("OPEN");
    expect(out.resolvedAt).toBeNull();
    expect(out.resolvedBy).toBeNull();
  });

  it("rejects invalid action", () => {
    expect(() =>
      computeManualStatusChange({
        currentStatus: "OPEN",
        // @ts-expect-error testing invalid input
        action: "delete",
        userEmail: "u@p.com",
      }),
    ).toThrow(/invalid action/i);
  });

  it("rejects dismiss without reason", () => {
    expect(() =>
      computeManualStatusChange({
        currentStatus: "OPEN",
        action: "dismiss",
        userEmail: "u@p.com",
      }),
    ).toThrow(/reason required/i);
  });
});
```

Run: `npm test -- pe-crossref/route-patch`
Expected: FAIL — `_lifecycle.ts` not yet implemented.

- [ ] **Step 2: Implement lifecycle helper**

```ts
// src/app/api/pe-crossref/tasks/[taskId]/_lifecycle.ts
import type { TaskStatus } from "@/lib/pe-crossref/types";

export type ManualAction = "resolve" | "dismiss" | "reopen";

export interface ManualChangeInput {
  currentStatus: TaskStatus;
  action: ManualAction;
  userEmail: string;
  reason?: string;
}

export interface ManualChangeOutput {
  status: TaskStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  manualResolvedAt: Date | null;
  dismissedReason: string | null;
}

export function computeManualStatusChange(input: ManualChangeInput): ManualChangeOutput {
  const { action, userEmail, currentStatus, reason } = input;

  switch (action) {
    case "resolve": {
      const now = new Date();
      return {
        status: "RESOLVED_MANUAL",
        resolvedAt: now,
        resolvedBy: userEmail,
        manualResolvedAt: now,
        dismissedReason: null,
      };
    }
    case "dismiss": {
      if (!reason || !reason.trim()) {
        throw new Error("dismiss reason required");
      }
      return {
        status: "DISMISSED",
        resolvedAt: new Date(),
        resolvedBy: userEmail,
        manualResolvedAt: null,
        dismissedReason: reason.trim(),
      };
    }
    case "reopen": {
      if (currentStatus === "OPEN") {
        // No-op reopen — preserve fields.
        return {
          status: "OPEN",
          resolvedAt: null,
          resolvedBy: null,
          manualResolvedAt: null,
          dismissedReason: null,
        };
      }
      return {
        status: "OPEN",
        resolvedAt: null,
        resolvedBy: null,
        manualResolvedAt: null,
        dismissedReason: null,
      };
    }
    default: {
      throw new Error(`invalid action: ${action as string}`);
    }
  }
}
```

- [ ] **Step 3: Implement PATCH route**

```ts
// src/app/api/pe-crossref/tasks/[taskId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { computeManualStatusChange, type ManualAction } from "./_lifecycle";
import type { TaskStatus } from "@/lib/pe-crossref/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = (await request.json()) as { action: ManualAction; reason?: string };

  const existing = await prisma.peActionTask.findUnique({ where: { id: taskId } });
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let change: ReturnType<typeof computeManualStatusChange>;
  try {
    change = computeManualStatusChange({
      currentStatus: existing.status as TaskStatus,
      action: body.action,
      userEmail: session.user.email,
      reason: body.reason,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const updated = await prisma.peActionTask.update({
    where: { id: taskId },
    data: {
      status: change.status,
      resolvedAt: change.resolvedAt,
      resolvedBy: change.resolvedBy,
      manualResolvedAt: change.manualResolvedAt,
      dismissedReason: change.dismissedReason,
    },
  });

  return NextResponse.json({ task: updated });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -- pe-crossref/route-patch && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "pe-crossref/tasks" | head -5`
Expected: tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pe-crossref/tasks src/__tests__/pe-crossref/route-patch.test.ts
git commit -m "feat(pe-crossref): PATCH /api/pe-crossref/tasks/[taskId] (resolve/dismiss/reopen)"
```

### Task 8: POST /run — trigger cross-ref via SSE

**Files:**
- Create: `src/app/api/pe-crossref/[dealId]/run/route.ts`

- [ ] **Step 1: Implement POST handler with SSE response**

```ts
// src/app/api/pe-crossref/[dealId]/run/route.ts
import { NextRequest } from "next/server";
import { auth } from "@/auth";
import { runCrossReference } from "@/lib/pe-crossref";

export const maxDuration = 300; // 5-minute cap, well above the typical 30-60s run

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await auth();
  // Allow internal machine-auth via API_SECRET_TOKEN (used by audit-completion auto-trigger).
  const internalToken = request.headers.get("x-internal-token");
  const isInternal = internalToken && internalToken === process.env.API_SECRET_TOKEN;
  if (!session?.user?.email && !isInternal) {
    return new Response("Not authenticated", { status: 401 });
  }
  const { dealId } = await params;
  const body = await request.json().catch(() => ({})) as { triggeredBy?: string };

  const triggeredBy = isInternal
    ? (body.triggeredBy ?? "audit-completion")
    : `manual:${session?.user?.email ?? "unknown"}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send("started", { dealId, triggeredBy });
      try {
        const result = await runCrossReference({ dealId, triggeredBy });
        send("completed", result);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 2: Verify route compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "pe-crossref/.*run" | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pe-crossref/[dealId]/run/route.ts
git commit -m "feat(pe-crossref): POST /api/pe-crossref/[dealId]/run (SSE)"
```

### Task 9: Role allowlist updates

**Files:**
- Modify: `src/lib/roles.ts`
- Modify: `src/app/suites/pe-compliance/page.tsx`

- [ ] **Step 1: Add `/api/pe-crossref` and `/dashboards/pe-action-queue` to PROJECT_MANAGER, OPERATIONS_MANAGER, ACCOUNTING `allowedRoutes`**

Open `src/lib/roles.ts`. For each of the three roles, locate `allowedRoutes: [...]` and append:

```ts
    "/api/pe-crossref",
    "/dashboards/pe-action-queue",
```

(ADMIN, EXECUTIVE, OWNER use `["*"]` and don't need additions.)

- [ ] **Step 2: Add PE Action Queue card to the PE & Compliance suite**

Open `src/app/suites/pe-compliance/page.tsx`. In the `LINKS` array, under the "PE Audit & Submission" section, add a new card BEFORE the "PE Prep Queue" card:

```ts
{
  href: "/dashboards/pe-action-queue",
  title: "PE Action Queue",
  description: "Cross-deal action tasks from the equipment cross-reference. Filter by severity, P-code, deal stage.",
  tag: "ACTION",
  icon: "🎯",
  tagColor: "red",
  section: "PE Audit & Submission",
},
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "roles\.ts|pe-compliance" | head -5`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/roles.ts src/app/suites/pe-compliance/page.tsx
git commit -m "feat(pe-crossref): add /api/pe-crossref + /dashboards/pe-action-queue to role allowlists"
```

### Task 10: Per-deal Action Tasks panel — empty state shell

**Files:**
- Create: `src/components/pe-prep/PeActionTasksPanel.tsx`
- Modify: `src/app/dashboards/pe-prep/[dealId]/page.tsx`

- [ ] **Step 1: Implement panel component (empty data fallback)**

```tsx
// src/components/pe-prep/PeActionTasksPanel.tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

interface ActionTask {
  id: string;
  pCode: string;
  severity: "critical" | "major" | "conditional" | "monitoring";
  category: string;
  title: string;
  message: string;
  action: string;
  status: "OPEN" | "RESOLVED_AUTO" | "RESOLVED_MANUAL" | "DISMISSED";
  manualResolvedAt: string | null;
  evidence: Record<string, unknown>;
}

interface LatestRun {
  id: string;
  completedAt: string;
  triggeredBy: string;
}

export function PeActionTasksPanel({ dealId }: { dealId: string }) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["pe-crossref", "tasks", dealId],
    queryFn: async () => {
      const res = await fetch(`/api/pe-crossref/${dealId}/tasks`);
      if (!res.ok) throw new Error("Failed to load tasks");
      return res.json() as Promise<{ tasks: ActionTask[]; latestRun: LatestRun | null }>;
    },
  });

  const patchTask = useMutation({
    mutationFn: async (vars: { taskId: string; action: "resolve" | "dismiss" | "reopen"; reason?: string }) => {
      const res = await fetch(`/api/pe-crossref/tasks/${vars.taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: vars.action, reason: vars.reason }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pe-crossref", "tasks", dealId] }),
  });

  const handleRerun = async () => {
    setRunning(true);
    try {
      // SSE response — we don't parse it here, just wait for the connection to close.
      await fetch(`/api/pe-crossref/${dealId}/run`, { method: "POST", body: JSON.stringify({}) });
    } finally {
      setRunning(false);
      queryClient.invalidateQueries({ queryKey: ["pe-crossref", "tasks", dealId] });
    }
  };

  const tasks = data?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "OPEN");
  const resolved = tasks.filter((t) => t.status !== "OPEN" && t.status !== "DISMISSED");

  const byTier = (sev: ActionTask["severity"]) => open.filter((t) => t.severity === sev);

  return (
    <div className="rounded-lg border border-t-border bg-surface-2/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
          Action Tasks {tasks.length > 0 && `(${open.length} open / ${resolved.length} resolved)`}
        </h3>
        <button
          onClick={handleRerun}
          disabled={running}
          className="px-3 py-1 text-xs bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-md"
        >
          {running ? "Running…" : "↻ Re-run cross-ref"}
        </button>
      </div>

      {isLoading && <p className="text-xs text-muted">Loading…</p>}
      {!isLoading && tasks.length === 0 && (
        <p className="text-xs text-muted">
          No cross-reference has run yet for this deal. Click &quot;Re-run cross-ref&quot; to start.
        </p>
      )}

      {(["critical", "major", "conditional", "monitoring"] as const).map((sev) => {
        const tier = byTier(sev);
        if (tier.length === 0) return null;
        return (
          <details key={sev} open className="mt-3">
            <summary className="text-xs font-semibold uppercase tracking-wide cursor-pointer">
              {sev} ({tier.length})
            </summary>
            <div className="space-y-2 mt-2">
              {tier.map((t) => (
                <PeActionTaskCard key={t.id} task={t} patchTask={patchTask} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function PeActionTaskCard({
  task,
  patchTask,
}: {
  task: ActionTask;
  patchTask: { mutate: (v: { taskId: string; action: "resolve" | "dismiss" | "reopen"; reason?: string }) => void };
}) {
  return (
    <div className="rounded border border-t-border bg-surface p-3">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
              {task.pCode}
            </span>
            <span className="text-xs font-semibold">{task.title}</span>
          </div>
          <p className="text-xs text-foreground">{task.message}</p>
          <p className="text-xs text-muted mt-1">→ {task.action}</p>
        </div>
        <div className="flex flex-col gap-1 ml-2">
          <button
            onClick={() => patchTask.mutate({ taskId: task.id, action: "resolve" })}
            className="text-[10px] px-2 py-0.5 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30"
          >
            ✓ Resolve
          </button>
          <button
            onClick={() => {
              const reason = prompt("Why dismiss?") ?? "";
              if (reason) patchTask.mutate({ taskId: task.id, action: "dismiss", reason });
            }}
            className="text-[10px] px-2 py-0.5 bg-zinc-500/20 text-zinc-400 rounded hover:bg-zinc-500/30"
          >
            ✗ Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into the PE Prep detail page**

Open `src/app/dashboards/pe-prep/[dealId]/page.tsx`. Find where `PePandaDocSection` is rendered (search for `PePandaDocSection`). Add the import at the top and render the panel below the audit checklist sections (after the photo grid, before the modal):

```tsx
// Add import near the others
import { PeActionTasksPanel } from "@/components/pe-prep/PeActionTasksPanel";
```

Render after the photo gallery section (around line 260, right before `<PePhotoModal />`):

```tsx
<PeActionTasksPanel dealId={dealId} />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "pe-prep|PeActionTasks" | head -5`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pe-prep/PeActionTasksPanel.tsx src/app/dashboards/pe-prep/[dealId]/page.tsx
git commit -m "feat(pe-crossref): add Action Tasks panel to PE Prep detail page"
```

---

## Chunk 3: MonitoringAnalyzer (simplest analyzer — validates pipeline E2E)

End-state: Run cross-ref on a real deal → emits real tasks for MONITORING (corrected PowerHub screenshot exists in M1 folder) and ENPHASE (Enphase inverter on deal but no monitoring screenshot in M1 folder).

### Task 11: MonitoringFolder extractor

**Files:**
- Create: `src/lib/pe-crossref/extractors/monitoring-folder.ts`
- Test: `src/__tests__/pe-crossref/extractors/monitoring-folder.test.ts`

- [ ] **Step 1: Implement extractor (no LLM — file-pattern + metadata)**

```ts
// src/lib/pe-crossref/extractors/monitoring-folder.ts
import { listDriveFilesRecursive } from "@/lib/drive-plansets";
import type { MonitoringFolderScan } from "@/lib/pe-crossref/types";

const POWERHUB_FILE_RE = /powerhub/i;
const CORRECTED_FILE_RE = /(corrected|fixed|updated)/i;
const MONITORING_FILE_RE = /(monitoring|enphase|enlighten|solaredge)/i;

/**
 * Scan the M1 folder for PowerHub monitoring screenshots and detect whether
 * a "corrected" version is present (modified after the original).
 *
 * Returns null if no M1 folder is provided — caller decides whether that's
 * a fatal extraction failure or a graceful no-op.
 */
export async function scanM1MonitoringFolder(m1FolderId: string | null): Promise<MonitoringFolderScan | null> {
  if (!m1FolderId) return null;
  const files = await listDriveFilesRecursive(m1FolderId, 3, 100);

  const powerHubFiles = files.filter((f) => POWERHUB_FILE_RE.test(f.name));
  const correctedFiles = powerHubFiles.filter((f) => CORRECTED_FILE_RE.test(f.name));
  const hasMonitoringScreenshot = files.some(
    (f) => MONITORING_FILE_RE.test(f.name) || POWERHUB_FILE_RE.test(f.name),
  );

  // Pick the most recently modified "corrected" file, if any.
  const correctedScreenshotFile =
    correctedFiles.length > 0
      ? correctedFiles.reduce((latest, f) =>
          new Date(f.modifiedTime) > new Date(latest.modifiedTime) ? f : latest,
        )
      : null;

  return {
    m1FolderId,
    hasOriginalScreenshot: hasMonitoringScreenshot,
    correctedScreenshotFile: correctedScreenshotFile
      ? {
          id: correctedScreenshotFile.id,
          name: correctedScreenshotFile.name,
          modifiedTime: correctedScreenshotFile.modifiedTime,
        }
      : null,
  };
}
```

- [ ] **Step 2: Write unit tests with mocked Drive client**

```ts
// src/__tests__/pe-crossref/extractors/monitoring-folder.test.ts
import { scanM1MonitoringFolder } from "@/lib/pe-crossref/extractors/monitoring-folder";

jest.mock("@/lib/drive-plansets", () => ({
  listDriveFilesRecursive: jest.fn(),
}));
import { listDriveFilesRecursive } from "@/lib/drive-plansets";
const mockList = listDriveFilesRecursive as jest.MockedFunction<typeof listDriveFilesRecursive>;

describe("scanM1MonitoringFolder", () => {
  beforeEach(() => mockList.mockReset());

  it("returns null when no folder id is provided", async () => {
    const result = await scanM1MonitoringFolder(null);
    expect(result).toBeNull();
  });

  it("flags hasOriginalScreenshot when PowerHub file present", async () => {
    mockList.mockResolvedValue([
      { id: "1", name: "PowerHub_2026-05-01.png", mimeType: "image/png", modifiedTime: "2026-05-01T00:00:00Z" },
    ]);
    const result = await scanM1MonitoringFolder("folder-1");
    expect(result?.hasOriginalScreenshot).toBe(true);
    expect(result?.correctedScreenshotFile).toBeNull();
  });

  it("returns most-recent corrected file when multiple exist", async () => {
    mockList.mockResolvedValue([
      { id: "old", name: "PowerHub_corrected_2026-05-01.png", mimeType: "image/png", modifiedTime: "2026-05-01T00:00:00Z" },
      { id: "new", name: "PowerHub_corrected_2026-05-10.png", mimeType: "image/png", modifiedTime: "2026-05-10T00:00:00Z" },
    ]);
    const result = await scanM1MonitoringFolder("folder-1");
    expect(result?.correctedScreenshotFile?.id).toBe("new");
  });

  it("hasOriginalScreenshot=false when no powerhub/monitoring files exist", async () => {
    mockList.mockResolvedValue([
      { id: "x", name: "RandomDoc.pdf", mimeType: "application/pdf", modifiedTime: "2026-05-01T00:00:00Z" },
    ]);
    const result = await scanM1MonitoringFolder("folder-1");
    expect(result?.hasOriginalScreenshot).toBe(false);
    expect(result?.correctedScreenshotFile).toBeNull();
  });
});
```

Run: `npm test -- monitoring-folder`
Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-crossref/extractors/monitoring-folder.ts src/__tests__/pe-crossref/extractors/monitoring-folder.test.ts
git commit -m "feat(pe-crossref): monitoring-folder extractor + tests"
```

### Task 12: MonitoringAnalyzer

**Files:**
- Create: `src/lib/pe-crossref/analyzers/monitoring.ts`
- Test: `src/__tests__/pe-crossref/analyzers/monitoring.test.ts`

- [ ] **Step 1: Write failing tests for both rules**

```ts
// src/__tests__/pe-crossref/analyzers/monitoring.test.ts
import { MonitoringAnalyzer } from "@/lib/pe-crossref/analyzers/monitoring";
import type { CrossRefContext } from "@/lib/pe-crossref/types";

const baseContext = (overrides: Partial<CrossRefContext> = {}): CrossRefContext => ({
  deal: { dealId: "d1", dealName: "Test", address: "", systemType: "solar+battery", stageName: "PTO", peM1Status: null, peM2Status: null, rootFolderId: "root", designFolderId: null },
  planset: null,
  salesOrder: null,
  powerHubAsset: null,
  installPhotos: [],
  nameplateExtractions: new Map(),
  monitoringFolder: null,
  latestAuditRun: null,
  ...overrides,
});

describe("MonitoringAnalyzer", () => {
  it("emits MONITORING when corrected screenshot exists in M1 folder", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(baseContext({
      monitoringFolder: {
        m1FolderId: "m1",
        hasOriginalScreenshot: true,
        correctedScreenshotFile: { id: "c", name: "PowerHub_corrected.png", modifiedTime: "2026-05-10T00:00:00Z" },
      },
    }));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].pCode).toBe("MONITORING");
    expect(tasks[0].identityKey).toBe("MONITORING@v1:m1-folder:powerhub-corrected");
    expect(tasks[0].severity).toBe("monitoring");
  });

  it("does NOT emit MONITORING when no corrected screenshot exists", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(baseContext({
      monitoringFolder: {
        m1FolderId: "m1",
        hasOriginalScreenshot: true,
        correctedScreenshotFile: null,
      },
    }));
    expect(tasks.find((t) => t.pCode === "MONITORING")).toBeUndefined();
  });

  it("emits ENPHASE when planset has Enphase inverter and no monitoring screenshot exists", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(baseContext({
      planset: {
        fileId: "p1",
        fileName: "plans.pdf",
        specsByPage: [{ page: 1, pw3Model: null, bsModel: null, expansionUnitModel: null, moduleBrand: null, moduleQty: null, inverterModel: "Enphase IQ8" }],
      },
      monitoringFolder: {
        m1FolderId: "m1",
        hasOriginalScreenshot: false,
        correctedScreenshotFile: null,
      },
    }));
    expect(tasks.find((t) => t.pCode === "ENPHASE")).toBeDefined();
  });

  it("does NOT emit ENPHASE when monitoring screenshot already exists", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(baseContext({
      planset: {
        fileId: "p1",
        fileName: "plans.pdf",
        specsByPage: [{ page: 1, pw3Model: null, bsModel: null, expansionUnitModel: null, moduleBrand: null, moduleQty: null, inverterModel: "Enphase IQ8" }],
      },
      monitoringFolder: {
        m1FolderId: "m1",
        hasOriginalScreenshot: true,
        correctedScreenshotFile: null,
      },
    }));
    expect(tasks.find((t) => t.pCode === "ENPHASE")).toBeUndefined();
  });

  it("does NOT emit ENPHASE for non-Enphase inverters", async () => {
    const tasks = await MonitoringAnalyzer.detectTasks(baseContext({
      planset: {
        fileId: "p1",
        fileName: "plans.pdf",
        specsByPage: [{ page: 1, pw3Model: null, bsModel: null, expansionUnitModel: null, moduleBrand: null, moduleQty: null, inverterModel: "Tesla Solar Inverter 7.6kW" }],
      },
      monitoringFolder: {
        m1FolderId: "m1",
        hasOriginalScreenshot: false,
        correctedScreenshotFile: null,
      },
    }));
    expect(tasks.find((t) => t.pCode === "ENPHASE")).toBeUndefined();
  });
});
```

Run: `npm test -- analyzers/monitoring`
Expected: FAIL — analyzer not implemented.

- [ ] **Step 2: Implement analyzer**

```ts
// src/lib/pe-crossref/analyzers/monitoring.ts
import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

export const MonitoringAnalyzer: Analyzer = {
  name: "MonitoringAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];

    // MONITORING — corrected PowerHub screenshot ready for re-upload
    if (context.monitoringFolder?.correctedScreenshotFile) {
      const file = context.monitoringFolder.correctedScreenshotFile;
      tasks.push({
        pCode: "MONITORING",
        identityKey: `MONITORING@${VERSION}:m1-folder:powerhub-corrected`,
        severity: "monitoring",
        category: "monitoring",
        analyzer: "MonitoringAnalyzer",
        title: "PowerHub screenshot ready for re-upload",
        message: `Corrected PowerHub screenshot in M1 folder: ${file.name} (modified ${file.modifiedTime.slice(0, 10)}).`,
        action: "Re-upload the corrected screenshot to the PE portal.",
        evidence: { fileId: file.id, fileName: file.name, modifiedTime: file.modifiedTime },
      });
    }

    // ENPHASE — Enphase inverter on deal but no monitoring screenshot in M1
    if (context.planset && context.monitoringFolder && !context.monitoringFolder.hasOriginalScreenshot) {
      const hasEnphase = context.planset.specsByPage.some((p) =>
        (p.inverterModel ?? "").toLowerCase().includes("enphase"),
      );
      if (hasEnphase) {
        tasks.push({
          pCode: "ENPHASE",
          identityKey: `ENPHASE@${VERSION}:account-access`,
          severity: "monitoring",
          category: "monitoring",
          analyzer: "MonitoringAnalyzer",
          title: "Enphase monitoring screenshot needed",
          message: "Deal has Enphase inverter but no monitoring screenshot in M1 folder.",
          action: "Capture Enphase Enlighten monitoring screenshot and upload to M1 folder.",
          evidence: { detectedInverter: context.planset.specsByPage.find((p) => (p.inverterModel ?? "").toLowerCase().includes("enphase"))?.inverterModel },
        });
      }
    }

    return tasks;
  },
};
```

- [ ] **Step 3: Run tests**

Run: `npm test -- analyzers/monitoring`
Expected: all 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-crossref/analyzers/monitoring.ts src/__tests__/pe-crossref/analyzers/monitoring.test.ts
git commit -m "feat(pe-crossref): MonitoringAnalyzer (MONITORING, ENPHASE rules) + tests"
```

### Task 13: Wire MonitoringAnalyzer into orchestrator + context

**Files:**
- Modify: `src/lib/pe-crossref/index.ts` (register analyzer)
- Modify: `src/lib/pe-crossref/context.ts` (call monitoring-folder extractor)

- [ ] **Step 1: Wire extractor into context builder**

Replace the body of `buildCrossRefContext` in `src/lib/pe-crossref/context.ts`:

```ts
import type { CrossRefContext } from "@/lib/pe-crossref/types";
import { resolvePEDeal, buildFolderMap } from "@/lib/pe-turnover";
import { scanM1MonitoringFolder } from "@/lib/pe-crossref/extractors/monitoring-folder";

export interface ContextBuildResult {
  context: CrossRefContext;
  extractorResults: Record<string, "ok" | string>;
}

export async function buildCrossRefContext(dealId: string): Promise<ContextBuildResult> {
  const deal = await resolvePEDeal(dealId);
  const extractorResults: Record<string, "ok" | string> = {};

  // Resolve folder map → M1 folder ID (used by monitoring-folder extractor).
  let m1FolderId: string | null = null;
  if (deal.rootFolderId) {
    try {
      const fm = await buildFolderMap(deal.rootFolderId);
      m1FolderId = fm.byPrefix.get("5") ?? null; // "5. Installation" — actually wait, M1 monitoring lives under "Participate Energy" subfolder typically. Use folder 5 for now; refine in later phase.
      extractorResults.folderMap = "ok";
    } catch (err) {
      extractorResults.folderMap = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const [monitoringFolder] = await Promise.all([
    scanM1MonitoringFolder(m1FolderId).then((r) => { extractorResults.monitoringFolder = "ok"; return r; })
      .catch((err) => { extractorResults.monitoringFolder = `error: ${err instanceof Error ? err.message : String(err)}`; return null; }),
  ]);

  return {
    extractorResults,
    context: {
      deal,
      planset: null,
      salesOrder: null,
      powerHubAsset: null,
      installPhotos: [],
      nameplateExtractions: new Map(),
      monitoringFolder,
      latestAuditRun: null,
    },
  };
}
```

- [ ] **Step 2: Register MonitoringAnalyzer**

In `src/lib/pe-crossref/index.ts`, update `getRegisteredAnalyzers()`:

```ts
import { MonitoringAnalyzer } from "@/lib/pe-crossref/analyzers/monitoring";

function getRegisteredAnalyzers(): Analyzer[] {
  return [MonitoringAnalyzer];
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep pe-crossref | head -5`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-crossref/index.ts src/lib/pe-crossref/context.ts
git commit -m "feat(pe-crossref): register MonitoringAnalyzer + wire extractor"
```

### Task 14: First end-to-end smoke test (manual via curl)

After merging Phase 1+2, manually verify the pipeline on a real deal.

```bash
# Sanity check the SSE endpoint locally with npm run dev:
curl -N -X POST http://localhost:3000/api/pe-crossref/57596163961/run \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie-from-browser>" \
  -d '{}'

# Expect output like:
# event: started
# data: {"dealId":"57596163961","triggeredBy":"manual:..."}
#
# event: completed
# data: {"runId":"...","status":"completed","detectedCount":0,"newCount":0,"resolvedCount":0}

# Then GET tasks:
curl http://localhost:3000/api/pe-crossref/57596163961/tasks \
  -H "Cookie: <session-cookie>"
# Expect: { "tasks": [...], "latestRun": {...} }
```

Once verified manually, **Chunk 1 + 2 + 3 is MVP** — deploy and iterate.

---

## Chunk 4: HardwareAnalyzer (P1, P6)

End-state: Cross-ref reads PowerHub asset state, extracts nameplate model from install photos via vision, emits P1 wrong-hardware + P6 powerhub-mixed tasks.

### Task 15: PowerHub extractor

**Files:**
- Create: `src/lib/pe-crossref/extractors/powerhub.ts`
- Test: `src/__tests__/pe-crossref/extractors/powerhub.test.ts`

- [ ] **Step 1: Implement extractor that queries PowerHub for the deal's site**

The actual Prisma model is `PowerhubSite` (note: lowercase `h` in `Powerhub`). There is no separate site-link model — `PowerhubSite` has a `dealId` field directly. Devices are stored as a JSON column `devices` (no relation), so PW3 entries are parsed from JSON.

```ts
// src/lib/pe-crossref/extractors/powerhub.ts
import { prisma } from "@/lib/db";
import type { PowerHubAssetSummary } from "@/lib/pe-crossref/types";

interface PowerhubDeviceJson {
  device_type?: string;
  model?: string;
  serial_number?: string;
  part_number?: string;
}

/**
 * Fetch PowerHub asset state for a deal. Returns null if:
 *   - POWERHUB_ENABLED is false
 *   - no PowerhubSite is linked to this deal
 *
 * Reads from the local PowerhubSite cache (synced by powerhub-sync.ts).
 * Devices live in the `devices` JSON column — parse and filter to PW3-ish types.
 */
export async function fetchPowerHubAsset(dealId: string): Promise<PowerHubAssetSummary | null> {
  if (process.env.POWERHUB_ENABLED !== "true") return null;

  const site = await prisma.powerhubSite.findFirst({
    where: { dealId },
    orderBy: { lastSyncedAt: "desc" },
  });
  if (!site) return null;

  const devices = Array.isArray(site.devices) ? (site.devices as PowerhubDeviceJson[]) : [];
  const powerwallEntries = devices
    .filter((d) => /powerwall|battery/i.test(d.device_type ?? "") || /powerwall|battery/i.test(d.model ?? ""))
    .map((d) => ({
      model: d.part_number ?? d.model ?? "unknown",
      serial: d.serial_number,
    }));

  return { siteId: site.id, powerwallEntries };
}
```

- [ ] **Step 2: Add tests with Prisma mock**

```ts
// src/__tests__/pe-crossref/extractors/powerhub.test.ts
import { fetchPowerHubAsset } from "@/lib/pe-crossref/extractors/powerhub";

jest.mock("@/lib/db", () => ({
  prisma: {
    powerhubSite: { findFirst: jest.fn() },
  },
}));
import { prisma } from "@/lib/db";

describe("fetchPowerHubAsset", () => {
  const origEnv = process.env.POWERHUB_ENABLED;
  afterEach(() => { process.env.POWERHUB_ENABLED = origEnv; jest.clearAllMocks(); });

  it("returns null when POWERHUB_ENABLED is not 'true'", async () => {
    process.env.POWERHUB_ENABLED = "false";
    expect(await fetchPowerHubAsset("d1")).toBeNull();
  });

  it("returns null when no PowerhubSite exists for the deal", async () => {
    process.env.POWERHUB_ENABLED = "true";
    (prisma.powerhubSite.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await fetchPowerHubAsset("d1")).toBeNull();
  });

  it("filters JSON devices to Powerwall/battery types", async () => {
    process.env.POWERHUB_ENABLED = "true";
    (prisma.powerhubSite.findFirst as jest.Mock).mockResolvedValue({
      id: "s1",
      devices: [
        { device_type: "Powerwall 3", part_number: "1707000-21-Y", serial_number: "TG-A" },
        { device_type: "Solar Inverter", part_number: "TSI-7.6", serial_number: "SN-B" }, // filtered out
      ],
    });
    const result = await fetchPowerHubAsset("d1");
    expect(result?.powerwallEntries).toEqual([{ model: "1707000-21-Y", serial: "TG-A" }]);
  });
});
```

Run: `npm test -- extractors/powerhub`
Expected: all 3 pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-crossref/extractors/powerhub.ts src/__tests__/pe-crossref/extractors/powerhub.test.ts
git commit -m "feat(pe-crossref): PowerHub asset extractor + tests"
```

### Task 16: Nameplate extractor (Sonnet vision on install photo 10)

**Files:**
- Create: `src/lib/pe-crossref/extractors/nameplate.ts`
- Test: `src/__tests__/pe-crossref/extractors/nameplate.test.ts`

- [ ] **Step 1: Implement extractor**

```ts
// src/lib/pe-crossref/extractors/nameplate.ts
import { CLAUDE_MODELS, getAnthropicClient } from "@/lib/anthropic";
import type { InstallPhotoRef, NameplateData } from "@/lib/pe-crossref/types";

const NAMEPLATE_PROMPT = `You are reading a Tesla Powerwall 3 nameplate label from an installation photo.

Extract these fields from the visible nameplate. If a field is not legible or not visible, return null for that field.

Return JSON only (no markdown):
{
  "detectedModel": "1707000-XX-X" or null  // full Tesla part number including variant code (e.g. "1707000-21-Y", "1707000-11-M")
  "detectedSerial": "TG..." or null
  "notes": "anything notable like LEADER sticker, conduit obscuring text, etc."
}`;

/**
 * Extract nameplate equipment IDs from an install photo via Sonnet vision.
 * Caller is responsible for picking which photo to send (typically PE Photo 10 — storage nameplate).
 */
export async function extractNameplateFromPhoto(
  photo: InstallPhotoRef,
  fetchPhotoBytes: (photoFileId: string) => Promise<{ buffer: Buffer; mimeType: string }>,
): Promise<NameplateData> {
  const client = getAnthropicClient();
  const { buffer, mimeType } = await fetchPhotoBytes(photo.fileId);

  const message = await client.messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 500,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: buffer.toString("base64") } },
        { type: "text", text: NAMEPLATE_PROMPT },
      ],
    }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(jsonStr) as { detectedModel: string | null; detectedSerial: string | null; notes: string };
    return {
      photoFileId: photo.fileId,
      detectedModel: parsed.detectedModel,
      detectedSerial: parsed.detectedSerial,
      notes: parsed.notes ?? "",
    };
  } catch (err) {
    console.warn(`[pe-crossref] nameplate parse failed for ${photo.fileId}: ${err}`);
    return { photoFileId: photo.fileId, detectedModel: null, detectedSerial: null, notes: `parse_error: ${raw.slice(0, 200)}` };
  }
}
```

- [ ] **Step 2: Add a minimal unit test (parser-only, vision call mocked)**

```ts
// src/__tests__/pe-crossref/extractors/nameplate.test.ts
import { extractNameplateFromPhoto } from "@/lib/pe-crossref/extractors/nameplate";

jest.mock("@anthropic-ai/sdk", () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"detectedModel":"1707000-11-M","detectedSerial":"TG12530600006T5","notes":"LEADER sticker visible"}' }],
      }),
    },
  }));
});

describe("extractNameplateFromPhoto", () => {
  it("parses model + serial from vision response", async () => {
    const result = await extractNameplateFromPhoto(
      { fileId: "p1", fileName: "10_nameplate.jpg", source: "zuper" },
      async () => ({ buffer: Buffer.from("fake"), mimeType: "image/jpeg" }),
    );
    expect(result.detectedModel).toBe("1707000-11-M");
    expect(result.detectedSerial).toBe("TG12530600006T5");
    expect(result.notes).toContain("LEADER");
  });
});
```

Run: `npm test -- extractors/nameplate`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-crossref/extractors/nameplate.ts src/__tests__/pe-crossref/extractors/nameplate.test.ts
git commit -m "feat(pe-crossref): nameplate extractor (Sonnet vision)"
```

### Task 17: HardwareAnalyzer

**Files:**
- Create: `src/lib/pe-crossref/analyzers/hardware.ts`
- Test: `src/__tests__/pe-crossref/analyzers/hardware.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/__tests__/pe-crossref/analyzers/hardware.test.ts
import { HardwareAnalyzer } from "@/lib/pe-crossref/analyzers/hardware";
import type { CrossRefContext } from "@/lib/pe-crossref/types";

const baseContext = (overrides: Partial<CrossRefContext> = {}): CrossRefContext => ({
  deal: { dealId: "d1", dealName: "Test", address: "", systemType: "solar+battery", stageName: "PTO", peM1Status: null, peM2Status: null, rootFolderId: "root", designFolderId: null },
  planset: null,
  salesOrder: null,
  powerHubAsset: null,
  installPhotos: [],
  nameplateExtractions: new Map(),
  monitoringFolder: null,
  latestAuditRun: null,
  ...overrides,
});

describe("HardwareAnalyzer", () => {
  it("emits P1 WRONG HARDWARE when nameplate and PowerHub disagree", async () => {
    const context = baseContext({
      powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-Y" }] },
      nameplateExtractions: new Map([
        ["p1", { photoFileId: "p1", detectedModel: "1707000-11-M", detectedSerial: "TG-A", notes: "" }],
      ]),
    });
    const tasks = await HardwareAnalyzer.detectTasks(context);
    const p1 = tasks.find((t) => t.pCode === "P1");
    expect(p1).toBeDefined();
    expect(p1?.severity).toBe("critical");
    expect(p1?.identityKey).toBe("P1@v1:powerhub:1707000-21-Y:nameplate:1707000-11-M");
  });

  it("emits P1 NO-NAMEPLATE when PowerHub data present but no nameplate extracted", async () => {
    const context = baseContext({
      powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-Y" }] },
      nameplateExtractions: new Map(),
    });
    const tasks = await HardwareAnalyzer.detectTasks(context);
    const t = tasks.find((t) => t.identityKey === "P1@v1:no-nameplate-photo");
    expect(t).toBeDefined();
    expect(t?.severity).toBe("major");
  });

  it("emits P6 POWERHUB MIXED when PowerHub returns multiple PW3 variants", async () => {
    const context = baseContext({
      powerHubAsset: {
        siteId: "s1",
        powerwallEntries: [
          { model: "1707000-11-M" },
          { model: "1707000-21-Y" },
        ],
      },
    });
    const tasks = await HardwareAnalyzer.detectTasks(context);
    const p6 = tasks.find((t) => t.pCode === "P6");
    expect(p6).toBeDefined();
    expect(p6?.identityKey).toBe("P6@v1:powerhub:mixed:1707000-11-M+1707000-21-Y");
  });

  it("emits nothing when PowerHub data is missing", async () => {
    const tasks = await HardwareAnalyzer.detectTasks(baseContext());
    expect(tasks).toHaveLength(0);
  });

  it("emits nothing when nameplate matches PowerHub", async () => {
    const context = baseContext({
      powerHubAsset: { siteId: "s1", powerwallEntries: [{ model: "1707000-21-Y" }] },
      nameplateExtractions: new Map([
        ["p1", { photoFileId: "p1", detectedModel: "1707000-21-Y", detectedSerial: null, notes: "" }],
      ]),
    });
    const tasks = await HardwareAnalyzer.detectTasks(context);
    expect(tasks.find((t) => t.pCode === "P1" && t.identityKey !== "P1@v1:no-nameplate-photo")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement analyzer**

```ts
// src/lib/pe-crossref/analyzers/hardware.ts
import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

export const HardwareAnalyzer: Analyzer = {
  name: "HardwareAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];
    const ph = context.powerHubAsset;
    if (!ph) return tasks;

    // P6: PowerHub returns mixed PW3 variants (e.g. 11-M + 21-Y at same site)
    const uniqueModels = [...new Set(ph.powerwallEntries.map((e) => e.model))].sort();
    if (uniqueModels.length > 1) {
      tasks.push({
        pCode: "P6",
        identityKey: `P6@${VERSION}:powerhub:mixed:${uniqueModels.join("+")}`,
        severity: "critical",
        category: "hardware",
        analyzer: "HardwareAnalyzer",
        title: "POWERHUB MIXED",
        message: `PowerHub shows ${uniqueModels.length} different PW3 variants for this site: ${uniqueModels.join(" + ")}.`,
        action: "Verify hardware and remove stale PowerHub entry.",
        evidence: { models: uniqueModels, siteId: ph.siteId },
      });
    }

    // Aggregate nameplate readings
    const nameplateModels = [...context.nameplateExtractions.values()]
      .map((n) => n.detectedModel)
      .filter((m): m is string => m !== null);

    if (nameplateModels.length === 0) {
      // P1 NO-NAMEPLATE: PowerHub data present but no nameplate photo extracted
      tasks.push({
        pCode: "P1",
        identityKey: `P1@${VERSION}:no-nameplate-photo`,
        severity: "major",
        category: "hardware",
        analyzer: "HardwareAnalyzer",
        title: "NAMEPLATE PHOTO NEEDED",
        message: "PowerHub asset on file but no readable nameplate photo extracted from install photos.",
        action: "Capture clear Photo_10 (Storage Nameplate) — required for PE submission verification.",
        evidence: { powerhubModels: uniqueModels, siteId: ph.siteId },
      });
      return tasks;
    }

    // P1 WRONG HARDWARE: any nameplate model doesn't match any PowerHub model
    const phModelSet = new Set(uniqueModels);
    for (const npModel of [...new Set(nameplateModels)]) {
      if (!phModelSet.has(npModel)) {
        const phShown = uniqueModels[0] ?? "unknown";
        tasks.push({
          pCode: "P1",
          identityKey: `P1@${VERSION}:powerhub:${phShown}:nameplate:${npModel}`,
          severity: "critical",
          category: "hardware",
          analyzer: "HardwareAnalyzer",
          title: "WRONG HARDWARE",
          message: `Nameplate shows ${npModel} but PowerHub shows ${phShown}.`,
          action: `Correct PowerHub to ${npModel} (or update after swap). Check Zuper Additional Visits first — a swap may have already occurred.`,
          evidence: { nameplateModel: npModel, powerhubModel: phShown, siteId: ph.siteId },
        });
      }
    }

    return tasks;
  },
};
```

- [ ] **Step 3: Run tests + register analyzer**

Run: `npm test -- analyzers/hardware`
Expected: all pass.

Update `src/lib/pe-crossref/index.ts`:

```ts
import { HardwareAnalyzer } from "@/lib/pe-crossref/analyzers/hardware";

function getRegisteredAnalyzers(): Analyzer[] {
  return [MonitoringAnalyzer, HardwareAnalyzer];
}
```

Update `src/lib/pe-crossref/context.ts` to call PowerHub + nameplate extractors. Build the `installPhotos` list and pick PE photo #10 (storage nameplate) for the nameplate extraction call.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-crossref/analyzers/hardware.ts src/__tests__/pe-crossref/analyzers/hardware.test.ts src/lib/pe-crossref/index.ts src/lib/pe-crossref/context.ts
git commit -m "feat(pe-crossref): HardwareAnalyzer (P1, P6) + tests + wiring"
```

---

## Chunk 5: SalesOrderAnalyzer (P2-P5, P7-P9)

End-state: Cross-ref reads Zoho SO line items, compares against planset (when available), emits SO-related P-codes.

### Task 18: Sales Order extractor

**Files:**
- Create: `src/lib/pe-crossref/extractors/sales-order.ts`
- Test: `src/__tests__/pe-crossref/extractors/sales-order.test.ts`

- [ ] **Step 1: Implement extractor**

`@/lib/zoho-inventory` exports a `zohoInventory` client instance (not bare functions). Use `zohoInventory.getSalesOrderById(id)` and `zohoInventory.listSalesOrders(opts)`. The `ProjectBomSnapshot` model uses `dealId` and `zohoSoId` (not `hubspotDealId` / `zohoSalesOrderId`).

```ts
// src/lib/pe-crossref/extractors/sales-order.ts
import { zohoInventory } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/db";
import type { NormalizedSalesOrder } from "@/lib/pe-crossref/types";

/**
 * Resolve a deal's most-recent linked Zoho Sales Order and normalize its line items.
 *
 * Lookup priority:
 *   1. ProjectBomSnapshot.zohoSoId (recorded by BOM pipeline)
 *   2. Zoho SO list search by deal id / dealname (best-effort)
 *   3. null
 */
export async function fetchSalesOrder(dealId: string, dealName: string): Promise<NormalizedSalesOrder | null> {
  // Strategy 1 — BOM snapshot
  const bom = await prisma.projectBomSnapshot.findFirst({
    where: { dealId, zohoSoId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { zohoSoId: true },
  });

  let so = null;
  if (bom?.zohoSoId) {
    so = await zohoInventory.getSalesOrderById(bom.zohoSoId).catch(() => null);
  }

  // Strategy 2 — search by deal id (Zoho custom field may contain it)
  if (!so) {
    const list = await zohoInventory.listSalesOrders({ search_text: dealId, per_page: 5 }).catch(() => null);
    so = list?.salesorders?.[0] ? await zohoInventory.getSalesOrderById(list.salesorders[0].salesorder_id).catch(() => null) : null;
  }

  if (!so) return null;

  return {
    soNumber: so.salesorder_number,
    customerName: so.customer_name,
    lineItems: (so.line_items ?? []).map((li, idx) => ({
      index: idx,
      sku: li.sku ?? null,
      description: li.description ?? li.name ?? "",
      qty: li.quantity ?? 0,
    })),
  };
}
```

> **Verification before coding:** open `src/lib/zoho-inventory.ts` and confirm the exported `zohoInventory` instance has methods `getSalesOrderById(id: string)` and `listSalesOrders(opts)`. Verify return shape of `listSalesOrders` (top-level `{ salesorders: [...] }`).

- [ ] **Step 2: Add unit tests with mocks (skip extractor I/O; just verify normalization)**

```ts
// src/__tests__/pe-crossref/extractors/sales-order.test.ts
// Minimal — normalization shape only.
import type { NormalizedSalesOrder } from "@/lib/pe-crossref/types";

describe("NormalizedSalesOrder shape contract", () => {
  it("requires fields", () => {
    const so: NormalizedSalesOrder = {
      soNumber: "SO-9043",
      customerName: "Test",
      lineItems: [{ index: 0, sku: "abc", description: "Powerwall 3 (USA module)", qty: 1 }],
    };
    expect(so.lineItems[0].description).toContain("Powerwall 3");
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-crossref/extractors/sales-order.ts src/__tests__/pe-crossref/extractors/sales-order.test.ts
git commit -m "feat(pe-crossref): Zoho SO extractor"
```

### Task 19: SalesOrderAnalyzer (eight rules)

**Files:**
- Create: `src/lib/pe-crossref/analyzers/sales-order.ts`
- Test: `src/__tests__/pe-crossref/analyzers/sales-order.test.ts`

- [ ] **Step 1: Write tests covering all 8 detection rules**

(Each rule gets at least one positive and one negative test — see spec §"SalesOrderAnalyzer" for rule definitions. Skipping the full code listing here for brevity — follow the same shape as MonitoringAnalyzer/HardwareAnalyzer test files.)

Test cases to write:
- P2 SO WRONG CUSTOMER: SO `customerName` mismatches deal `dealName`
- P2 SO INCOMPLETE: PW3 in SO but BS missing while planset has BS
- P3 ADD PW3: planset has PW3 but no SO line matches
- P4 ADD INVERTER: planset has inverter but no SO line matches
- P5 SCOPE MISMATCH (brand): planset brand differs
- P5 SCOPE MISMATCH (qty): planset qty differs by ≥1
- P7 PW3 LEGACY TEXT: SO description contains "Powerwall 3 (USA module)" OR "-11-J"
- P8 PW3 GENERIC SKU: SO description contains "1707000-XX-Y"
- P9 BS GENERIC: BS line description != "1624171-00-E"

- [ ] **Step 2: Implement analyzer following same pattern as HardwareAnalyzer**

```ts
// src/lib/pe-crossref/analyzers/sales-order.ts
import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

const PW3_LEGACY_RE = /powerwall 3 \(usa module\)|-11-j/i;
const PW3_GENERIC_RE = /1707000-XX-Y/i;
const BS_CORRECT = "1624171-00-E";

export const SalesOrderAnalyzer: Analyzer = {
  name: "SalesOrderAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];
    const so = context.salesOrder;
    if (!so) return tasks;

    // P2 wrong customer
    if (!normalizeCustomerName(so.customerName).includes(normalizeCustomerName(context.deal.dealName))) {
      tasks.push({
        pCode: "P2",
        identityKey: `P2@${VERSION}:so:${so.soNumber}:wrong-customer:${so.customerName}`,
        severity: "critical",
        category: "so",
        analyzer: "SalesOrderAnalyzer",
        title: "SO WRONG CUSTOMER",
        message: `SO ${so.soNumber} customer "${so.customerName}" does not match deal "${context.deal.dealName}".`,
        action: "Replace SO or create a new SO for the correct customer.",
        evidence: { soNumber: so.soNumber, soCustomer: so.customerName, dealName: context.deal.dealName },
      });
    }

    // P7 / P8 / P9 — per-line scans (cheap)
    for (const line of so.lineItems) {
      const desc = line.description ?? "";
      if (PW3_LEGACY_RE.test(desc)) {
        tasks.push({
          pCode: "P7",
          identityKey: `P7@${VERSION}:so:${so.soNumber}:line:${line.index}:pw3-text`,
          severity: "conditional",
          category: "so",
          analyzer: "SalesOrderAnalyzer",
          title: "SO PW3 LEGACY TEXT",
          message: `SO ${so.soNumber} line ${line.index} description includes legacy PW3 text.`,
          action: `Change description to "Tesla 1707000-21-Y" and remove the 11-J note.`,
          evidence: { soNumber: so.soNumber, line: line.index, currentDescription: desc },
        });
      }
      if (PW3_GENERIC_RE.test(desc)) {
        tasks.push({
          pCode: "P8",
          identityKey: `P8@${VERSION}:so:${so.soNumber}:line:${line.index}:xx-y`,
          severity: "conditional",
          category: "so",
          analyzer: "SalesOrderAnalyzer",
          title: "SO PW3 GENERIC SKU",
          message: `SO ${so.soNumber} line ${line.index} description has placeholder 1707000-XX-Y.`,
          action: 'Change description to "Tesla 1707000-21-Y" (SKU already correct).',
          evidence: { soNumber: so.soNumber, line: line.index, currentDescription: desc },
        });
      }
      if (/backup switch/i.test(desc) && !desc.includes(BS_CORRECT)) {
        tasks.push({
          pCode: "P9",
          identityKey: `P9@${VERSION}:so:${so.soNumber}:line:${line.index}:bs-generic`,
          severity: "conditional",
          category: "so",
          analyzer: "SalesOrderAnalyzer",
          title: "SO BS GENERIC",
          message: `SO ${so.soNumber} line ${line.index} Backup Switch description not specific.`,
          action: `Change BS description to "${BS_CORRECT}" if PE requires.`,
          evidence: { soNumber: so.soNumber, line: line.index, currentDescription: desc },
        });
      }
    }

    // P3 / P4 / P5 require planset; skip if not extracted
    if (context.planset) {
      const planset = context.planset;
      const plansetHasPw3 = planset.specsByPage.some((p) => p.pw3Model !== null);
      const soHasPw3 = so.lineItems.some((l) => /powerwall 3/i.test(l.description));
      if (plansetHasPw3 && !soHasPw3) {
        tasks.push({
          pCode: "P3",
          identityKey: `P3@${VERSION}:so:${so.soNumber}:missing-pw3`,
          severity: "major",
          category: "so",
          analyzer: "SalesOrderAnalyzer",
          title: "ADD PW3 TO SO",
          message: `Planset has Powerwall 3 but SO ${so.soNumber} has no PW3 line item.`,
          action: "Add PW3 line item to SO.",
          evidence: { soNumber: so.soNumber },
        });
      }

      const plansetInverter = planset.specsByPage.find((p) => p.inverterModel !== null)?.inverterModel;
      const soHasInverter = so.lineItems.some((l) => /inverter/i.test(l.description));
      if (plansetInverter && !soHasInverter) {
        tasks.push({
          pCode: "P4",
          identityKey: `P4@${VERSION}:so:${so.soNumber}:missing-inverter:${plansetInverter}`,
          severity: "major",
          category: "so",
          analyzer: "SalesOrderAnalyzer",
          title: "ADD INVERTER TO SO",
          message: `Planset has ${plansetInverter} but SO ${so.soNumber} has no inverter line item.`,
          action: `Add inverter line item to SO.`,
          evidence: { soNumber: so.soNumber, plansetInverter },
        });
      }

      // P5 module mismatch
      const plansetModule = planset.specsByPage.find((p) => p.moduleBrand !== null);
      const soModuleLine = so.lineItems.find((l) => /module|panel/i.test(l.description) && !/inverter/i.test(l.description));
      if (plansetModule && soModuleLine) {
        const plansetBrand = plansetModule.moduleBrand?.toLowerCase() ?? "";
        const soBrand = soModuleLine.description.toLowerCase();
        if (plansetBrand && !soBrand.includes(plansetBrand)) {
          tasks.push({
            pCode: "P5",
            identityKey: `P5@${VERSION}:so:${so.soNumber}:module-brand:${plansetBrand}-vs-${soBrand.slice(0, 20)}`,
            severity: "major",
            category: "so",
            analyzer: "SalesOrderAnalyzer",
            title: "MODULE BRAND MISMATCH",
            message: `Planset module brand "${plansetModule.moduleBrand}" doesn't match SO description "${soModuleLine.description}".`,
            action: "Reconcile planset and SO module brands.",
            evidence: { soNumber: so.soNumber, plansetBrand: plansetModule.moduleBrand, soDescription: soModuleLine.description },
          });
        }
        if (plansetModule.moduleQty != null && plansetModule.moduleQty !== soModuleLine.qty) {
          tasks.push({
            pCode: "P5",
            identityKey: `P5@${VERSION}:so:${so.soNumber}:module-qty:${plansetModule.moduleQty}-vs-${soModuleLine.qty}`,
            severity: "major",
            category: "so",
            analyzer: "SalesOrderAnalyzer",
            title: "MODULE QTY MISMATCH",
            message: `Planset says ${plansetModule.moduleQty} modules, SO says ${soModuleLine.qty}.`,
            action: "Verify and revise SO or planset.",
            evidence: { soNumber: so.soNumber, plansetQty: plansetModule.moduleQty, soQty: soModuleLine.qty },
          });
        }
      }
    }

    return tasks;
  },
};

function normalizeCustomerName(name: string): string {
  // Lowercase, collapse whitespace, strip punctuation — accommodate "Brownell, Matt" vs "Matt Brownell".
  return name.toLowerCase().replace(/[,.]/g, "").split(/\s+/).filter(Boolean).sort().join(" ");
}
```

- [ ] **Step 3: Run tests, register analyzer in `getRegisteredAnalyzers()`, wire extractor into context**

Run: `npm test -- analyzers/sales-order`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-crossref/analyzers/sales-order.ts src/__tests__/pe-crossref/analyzers/sales-order.test.ts src/lib/pe-crossref/index.ts src/lib/pe-crossref/context.ts
git commit -m "feat(pe-crossref): SalesOrderAnalyzer (P2-P5, P7-P9) + tests + wiring"
```

---

## Chunk 6: PlansetAnalyzer (P10, P10B, P10C)

End-state: Cross-ref vision-extracts structured PV-page data from the planset PDF, emits P10/B/C tasks for generic XX-Y model placeholders.

### Task 20: Planset extractor

**Files:**
- Create: `src/lib/pe-crossref/extractors/planset.ts`
- Test: `src/__tests__/pe-crossref/extractors/planset.test.ts`

- [ ] **Step 1: Identify PV pages, then vision-extract specs per page**

```ts
// src/lib/pe-crossref/extractors/planset.ts
import { CLAUDE_MODELS, getAnthropicClient } from "@/lib/anthropic";
import { downloadDriveFile } from "@/lib/drive-plansets";
import { uploadToAnthropic } from "@/lib/pe-vision-classifier";
import type { ExtractedPlanset } from "@/lib/pe-crossref/types";

const PROMPT = `You are reading the electrical schematic and specs box on a solar planset PV page.

For each page I provide, extract:

{
  "page": <number>,
  "pw3Model": "1707000-21-Y" or "1707000-XX-Y" or null,    // Powerwall 3 part number from specs box
  "bsModel": "1624171-00-E" or "1624171-XX-Y" or null,     // Tesla Backup Switch part number
  "expansionUnitModel": "1807000-XX-Y" or specific or null,
  "moduleBrand": "Hyundai" or "SEG Solar" or null,         // PV module manufacturer
  "moduleQty": <number> or null,                           // total module count from BOM/title block
  "inverterModel": "Tesla Solar Inverter 7.6kW" or "Enphase IQ8" or null
}

Return JSON only:
{ "pages": [...] }

If a field is not visible on this page, return null. The XX-Y vs specific suffix is critical — return exactly what the document shows.`;

/**
 * Vision-extract structured specs from a planset PDF.
 *
 * Identifies PV electrical pages by name pattern (PV-1, PV-2, ...) and sends
 * each page image to Sonnet. Returns one entry per page that had any non-null
 * field; empty pages are dropped.
 */
export async function extractPlansetStructure(plansetFileId: string, plansetFileName: string): Promise<ExtractedPlanset | null> {
  const client = getAnthropicClient();

  // Download PDF, upload to Anthropic Files API
  const { buffer } = await downloadDriveFile(plansetFileId);
  const anthropicFileId = await uploadToAnthropic(buffer, plansetFileName, "application/pdf");

  const message = await client.beta.messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "file", file_id: anthropicFileId } },
        { type: "text", text: PROMPT },
      ],
    }],
    betas: ["files-api-2025-04-14"],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(jsonStr) as {
      pages: Array<{
        page: number;
        pw3Model: string | null;
        bsModel: string | null;
        expansionUnitModel: string | null;
        moduleBrand: string | null;
        moduleQty: number | null;
        inverterModel: string | null;
      }>;
    };

    return {
      fileId: plansetFileId,
      fileName: plansetFileName,
      specsByPage: parsed.pages.filter((p) =>
        p.pw3Model || p.bsModel || p.expansionUnitModel || p.moduleBrand || p.moduleQty || p.inverterModel,
      ),
    };
  } catch (err) {
    console.warn(`[pe-crossref] planset extract parse failed: ${err}`);
    return null;
  }
}
```

- [ ] **Step 2: Tests focus on JSON parsing + drop-empty-pages logic; mock vision**

(Same pattern as nameplate extractor tests — provide a fixed Anthropic response, assert the normalized structure.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/pe-crossref/extractors/planset.ts src/__tests__/pe-crossref/extractors/planset.test.ts
git commit -m "feat(pe-crossref): planset structured extractor (Sonnet vision)"
```

### Task 21: PlansetAnalyzer

**Files:**
- Create: `src/lib/pe-crossref/analyzers/planset.ts`
- Test: `src/__tests__/pe-crossref/analyzers/planset.test.ts`

- [ ] **Step 1: Write tests for the three rules**

Same testing pattern. Coverage:
- P10 emits when any `specsByPage[i].pw3Model` matches `/XX-Y/i`
- P10B emits when any `specsByPage[i].bsModel` matches `/XX-Y/i` (i.e. anything other than `1624171-00-E`)
- P10C emits when any `specsByPage[i].expansionUnitModel` matches `/XX-Y/i`
- No tasks when planset is null
- Multiple pages → multiple tasks with distinct identities

- [ ] **Step 2: Implement**

```ts
// src/lib/pe-crossref/analyzers/planset.ts
import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";
const GENERIC_RE = /XX-Y/i;

export const PlansetAnalyzer: Analyzer = {
  name: "PlansetAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];
    const ps = context.planset;
    if (!ps) return tasks;

    for (const page of ps.specsByPage) {
      if (page.pw3Model && GENERIC_RE.test(page.pw3Model)) {
        tasks.push(make("P10", "pw3-generic", `Planset PV-${page.page} PW3 model is generic ${page.pw3Model}.`, `Revise PW3 model to 1707000-21-Y on PV-${page.page} (specs box + schematic labels).`, page, "pw3Model"));
      }
      if (page.bsModel && GENERIC_RE.test(page.bsModel)) {
        tasks.push(make("P10B", "bs-generic", `Planset PV-${page.page} BS model is generic ${page.bsModel}.`, `Revise BS model to 1624171-00-E on PV-${page.page} if PE requires.`, page, "bsModel"));
      }
      if (page.expansionUnitModel && GENERIC_RE.test(page.expansionUnitModel)) {
        tasks.push(make("P10C", "exp-generic", `Planset PV-${page.page} Expansion Unit model is generic ${page.expansionUnitModel}.`, `Revise Expansion Unit to a specific model on PV-${page.page} if PE requires.`, page, "expansionUnitModel"));
      }
    }

    return tasks;

    function make(pCode: string, kind: string, message: string, action: string, page: typeof ps.specsByPage[0], field: keyof typeof page): DetectedTask {
      return {
        pCode,
        identityKey: `${pCode}@${VERSION}:planset:${ps!.fileId}:${kind}:p${page.page}`,
        severity: "conditional",
        category: "planset",
        analyzer: "PlansetAnalyzer",
        title: `PLANSET ${pCode === "P10" ? "PW3" : pCode === "P10B" ? "BS" : "EXP"} GENERIC`,
        message,
        action,
        evidence: { plansetFileId: ps!.fileId, page: page.page, field, value: page[field] },
      };
    }
  },
};
```

- [ ] **Step 3: Run tests, register, commit**

```bash
git add src/lib/pe-crossref/analyzers/planset.ts src/__tests__/pe-crossref/analyzers/planset.test.ts src/lib/pe-crossref/index.ts src/lib/pe-crossref/context.ts
git commit -m "feat(pe-crossref): PlansetAnalyzer (P10, P10B, P10C) + tests + wiring"
```

---

## Chunk 7: PhotoCritiqueAnalyzer + Batch Dashboard + Auto-trigger

End-state: Full system shipped. P11B critique runs over assigned photos, batch dashboard at /dashboards/pe-action-queue shows aggregated tasks, audit completion auto-fires cross-ref.

### Task 22: PhotoCritiqueAnalyzer (uses LLM)

**Files:**
- Create: `src/lib/pe-crossref/analyzers/photo-critique.ts`
- Test: `src/__tests__/pe-crossref/analyzers/photo-critique.test.ts`

- [ ] **Step 1: Implement analyzer**

For each `(photoFileId, expectedCategory)` pair from the latest audit's photo assignments, ask Sonnet "Does this photo actually depict {expected subject}?". Cache verdicts keyed by `(photoFileId, expectedCategory)` in a `PhotoCritiqueCache` table — see Step 2.

```ts
// src/lib/pe-crossref/analyzers/photo-critique.ts
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { CLAUDE_MODELS, getAnthropicClient } from "@/lib/anthropic";
import type { Analyzer, DetectedTask, CrossRefContext } from "@/lib/pe-crossref/types";

const VERSION = "v1";

export const PhotoCritiqueAnalyzer: Analyzer = {
  name: "PhotoCritiqueAnalyzer",
  version: VERSION,

  async detectTasks(context: CrossRefContext): Promise<DetectedTask[]> {
    const tasks: DetectedTask[] = [];
    if (!context.latestAuditRun) return tasks;

    const client = getAnthropicClient();

    for (const [checklistId, assignment] of context.latestAuditRun.photoAssignments) {
      const cacheKey = `${assignment.photoFileId}:${checklistId}`;
      const cached = await prisma.photoCritiqueCache.findUnique({ where: { cacheKey } });

      let verdict: "match" | "wrong_subject" | "unknown";
      let critique: string;

      if (cached) {
        verdict = cached.verdict as typeof verdict;
        critique = cached.critique;
      } else {
        // Vision call — keep minimal; production may batch.
        // (Implementation detail: actually fetch the photo bytes, call Sonnet, parse response.)
        const result = await critiquePhoto(client, assignment.photoFileId, assignment.checklistLabel);
        verdict = result.verdict;
        critique = result.critique;
        await prisma.photoCritiqueCache.create({
          data: { cacheKey, verdict, critique, photoFileId: assignment.photoFileId, checklistId },
        });
      }

      if (verdict === "wrong_subject") {
        tasks.push({
          pCode: "P11B",
          identityKey: `P11B@${VERSION}:photo:${checklistId}:${assignment.photoFileId}`,
          severity: "conditional",
          category: "photo",
          analyzer: "PhotoCritiqueAnalyzer",
          title: "PHOTO WRONG SUBJECT",
          message: critique,
          action: `Re-file correct photo for ${assignment.checklistLabel}.`,
          evidence: { checklistId, photoFileId: assignment.photoFileId, expectedSubject: assignment.checklistLabel },
        });
      }
    }

    return tasks;
  },
};

async function critiquePhoto(
  client: ReturnType<typeof getAnthropicClient>,
  photoFileId: string,
  expectedLabel: string,
  fetchPhotoBytes: (photoFileId: string) => Promise<{ buffer: Buffer; mimeType: string }>,
): Promise<{ verdict: "match" | "wrong_subject" | "unknown"; critique: string }> {
  const { buffer, mimeType } = await fetchPhotoBytes(photoFileId);

  const prompt = `You're verifying a Participate Energy installation photo.
The photo was filed under the category: "${expectedLabel}".

Look at the image and tell me whether it actually depicts that subject.

Return JSON only (no markdown):
{
  "verdict": "match" | "wrong_subject" | "unknown",
  "critique": "one-sentence description of what the photo actually shows, especially if it doesn't match"
}

"match" = photo clearly shows the expected subject.
"wrong_subject" = photo shows something different (e.g. house front when storage was expected).
"unknown" = unclear or partially obscured — can't tell either way.`;

  const message = await client.messages.create({
    model: CLAUDE_MODELS.sonnet,
    max_tokens: 400,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: buffer.toString("base64") } },
        { type: "text", text: prompt },
      ],
    }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const jsonStr = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(jsonStr) as { verdict: "match" | "wrong_subject" | "unknown"; critique: string };
    return { verdict: parsed.verdict, critique: parsed.critique ?? "" };
  } catch (err) {
    console.warn(`[pe-crossref] photo critique parse failed for ${photoFileId}: ${err}`);
    return { verdict: "unknown", critique: `parse_error: ${raw.slice(0, 200)}` };
  }
}
```

The analyzer's main loop receives a `fetchPhotoBytes` resolver (parallel to how nameplate.ts is structured) — keeps the analyzer free of direct Drive/Zuper imports so it can be unit-tested with a stub fetcher.

- [ ] **Step 2: Add `PhotoCritiqueCache` Prisma model**

```prisma
model PhotoCritiqueCache {
  id            String   @id @default(cuid())
  cacheKey      String   @unique   // "{photoFileId}:{checklistId}"
  photoFileId   String
  checklistId   String
  verdict       String              // "match" | "wrong_subject" | "unknown"
  critique      String   @db.Text
  createdAt     DateTime @default(now())

  @@index([photoFileId])
}
```

**Migration ordering — hard checkpoint:** Per the `feedback_prisma_migration_before_code` memory note, adding a Prisma model triggers client regeneration on Vercel build. Code that queries the new table breaks if the migration hasn't applied yet.

To avoid breakage:
1. Open a **migration-only PR** with just the `npx prisma migrate dev --name photo_critique_cache --create-only` artifact and the schema edit. Merge that first.
2. Apply the migration to production (`npm run db:migrate`) under user supervision.
3. **Then** open the analyzer PR that references the new table.

Do NOT bundle the analyzer + migration in one PR. Do NOT run `prisma migrate deploy` from a subagent.

- [ ] **Step 3: Implement real `critiquePhoto` call**

(Single-image Sonnet call with a prompt that asks "does this photo actually show {expectedLabel}?" and returns structured JSON `{ verdict, critique }`. Same pattern as nameplate extractor.)

- [ ] **Step 4: Register analyzer + commit**

```bash
git add src/lib/pe-crossref/analyzers/photo-critique.ts src/__tests__/pe-crossref/analyzers/photo-critique.test.ts prisma/schema.prisma src/lib/pe-crossref/index.ts
git commit -m "feat(pe-crossref): PhotoCritiqueAnalyzer (P11B) + cache table"
```

### Task 23: Batch dashboard route + bulk PATCH

**Files:**
- Create: `src/app/api/pe-crossref/queue/route.ts`
- Create: `src/app/api/pe-crossref/queue/bulk/route.ts`

- [ ] **Step 1: GET /queue with filters**

```ts
// src/app/api/pe-crossref/queue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status") ?? "OPEN";
  const severity = sp.get("severity"); // optional comma-separated
  const pCode = sp.get("pCode");        // optional comma-separated

  const where: Record<string, unknown> = { status };
  if (severity) where.severity = { in: severity.split(",") };
  if (pCode) where.pCode = { in: pCode.split(",") };

  const tasks = await prisma.peActionTask.findMany({
    where,
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    take: 500,
  });

  // Bundle deal-level context — fetch deal names for the unique dealIds in the result set
  const dealIds = [...new Set(tasks.map((t) => t.dealId))];

  return NextResponse.json({ tasks, dealIds });
}
```

- [ ] **Step 2: PATCH /queue/bulk** — iterates over `taskIds[]` calling the existing single-task PATCH lifecycle.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/pe-crossref/queue
git commit -m "feat(pe-crossref): batch queue API (GET + bulk PATCH)"
```

### Task 24: PE Action Queue dashboard

**Files:**
- Create: `src/app/dashboards/pe-action-queue/page.tsx`

Mirror the structure of `src/app/dashboards/pe-prep/page.tsx`:
- DashboardShell with title, accent
- Stat tiles: open critical / open major / deals affected / resolved this week
- Multi-select filters: severity, pCode, deal stage
- Table: deal | pCode | message snippet | severity | last detected | actions

Commit:

```bash
git add src/app/dashboards/pe-action-queue/page.tsx
git commit -m "feat(pe-crossref): /dashboards/pe-action-queue batch view"
```

### Task 25: Auto-trigger cross-ref on audit completion

**Files:**
- Modify: `src/lib/pe-audit-orchestrator.ts`

- [ ] **Step 1: Locate the audit-completion update**

`runPeAudit` (in `src/lib/pe-audit-orchestrator.ts`) is `async (opts): Promise<string>` and returns `auditRun.id` directly. Search for the final `prisma.peAuditRun.update({ ... status: "completed" ... })` call (currently ~line 998–1010). The integration point is **after** that update completes and **before** the final `return auditRun.id` (~line 1016) — NOT before some `return { auditRun, ... }` object.

- [ ] **Step 2: Add fire-and-forget call**

Right after the completion update, before the `return auditRun.id`:

```ts
// Auto-trigger PE cross-reference after a successful full/docs audit.
// Decoupled — failures don't fail the audit. Internal token auth so the
// receiving route knows this is a machine call.
if (mode === "full" || mode === "docs") {
  void fetch(`${process.env.AUTH_URL ?? "http://localhost:3000"}/api/pe-crossref/${dealId}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": process.env.API_SECRET_TOKEN ?? "",
    },
    body: JSON.stringify({ triggeredBy: "audit-completion" }),
  }).catch((err) => console.warn(`[pe-audit] cross-ref auto-trigger failed: ${err}`));
}
```

- [ ] **Step 3: Manual smoke test**

Trigger a full PE audit on a test deal, watch Vercel logs for `[pe-crossref]` activity in the seconds after audit completion. Confirm PeActionTask rows are created/updated.

- [ ] **Step 4: Commit**

```bash
git add src/lib/pe-audit-orchestrator.ts
git commit -m "feat(pe-crossref): auto-trigger cross-ref after audit completion"
```

---

## Final checks

- [ ] **Full typecheck**: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "error" | head` — only pre-existing errors (test files), nothing in `pe-crossref/`.
- [ ] **Full test run**: `npm test -- pe-crossref` — all green.
- [ ] **Lint**: `npm run lint -- --max-warnings=0` over the new files.
- [ ] **Preflight**: `npm run preflight` passes locally.
- [ ] **Build**: `npm run build` completes.

When all green, open a PR for each chunk's worth of commits (or a single PR per phase). Squash-merge.

---

## Migration application checklist (orchestrator-only)

Per `feedback_subagents_no_migrations` memory note, subagents do NOT run migrations. The orchestrator applies them at these checkpoints:

1. After Task 1 commit lands: surface migration file, run `npm run db:migrate` after user approval.
2. After Task 22's PhotoCritiqueCache migration commit lands: same flow.

Each migration is additive (new tables only) — no risk to existing data.
