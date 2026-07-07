# Bottleneck Monitor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute age/volume/flow bottleneck signals per pipeline stage from the Prisma `Deal` mirror, show them on a new Operations dashboard, and DM a change-driven digest to Zach via the Tech Ops bot.

**Architecture:** A pure-function engine (`src/lib/bottlenecks.ts`) reads fixture-friendly `Deal` rows and SystemConfig-stored thresholds; a digest module (`src/lib/bottleneck-digest.ts`) renders scoped plain-text digests with change detection; thin API/cron routes and a React Query dashboard page wrap them. The existing tech-ops-bot daily digest loses its "Stuck deals" section (superseded).

**Tech Stack:** Next.js 16 app router, Prisma (`Deal`, `SystemConfig`), React Query v5, Jest, Google Chat via existing `postGoogleChatMessage`, Vercel cron.

**Spec:** `docs/superpowers/specs/2026-07-07-bottleneck-monitor-design.md` — read it first.

**Working conventions for every task:**
- Run single test files with `npm test -- src/__tests__/lib/<file>.test.ts`.
- `prisma` from `@/lib/db` is **nullable** — guard `if (!prisma)` in any function that touches it.
- After the final task, run **unfiltered** `npx tsc --noEmit` (project rule: interface changes have broken unrelated files before).
- Commit after every green test cycle. Do NOT run any prisma migrate commands (none are needed — no schema changes).

---

## Chunk 1: Engine

### Task 1: PE properties into the sync map

**Files:**
- Modify: `src/lib/deal-property-map.ts:265-275` (the `DEAL_SYNC_PROPERTIES` array)

The PE milestone statuses/remittance dates have no `Deal` columns. Adding them here makes the deal-sync engine request them from HubSpot so they land in `Deal.rawProperties` (JSON) — the exact `tesla_portal_url` precedent already in the array.

- [ ] **Step 1: Edit `DEAL_SYNC_PROPERTIES`**

Append after the `tesla_site_id` entry:

```ts
  // PE milestone status + remittance dates (no Deal columns — surfaced via
  // rawProperties for the bottleneck engine; backfilled by the next full sync)
  "pe_m1_status",
  "pe_m2_status",
  "pe_m1_remittance_date",
  "pe_m2_remittance_date",
```

- [ ] **Step 2: Verify the HubSpot property names exist before trusting them**

`pe_m1_status`/`pe_m2_status` are confirmed real (used in `src/lib/pe-reference-library.ts:81`, `src/lib/pe-rejection-advance.ts:100`). The remittance dates are referenced in docs but not code — verify with:

```bash
curl -s "https://api.hubapi.com/crm/v3/properties/deals/pe_m1_remittance_date" \
  -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" | head -c 300
```

Expected: JSON with `"name":"pe_m1_remittance_date"` (repeat for `pe_m2_remittance_date`). If a 404 comes back, STOP and surface to Zach — do not invent a different property name.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/deal-property-map.ts
git commit -m "feat(bottlenecks): sync PE milestone status + remittance props into Deal.rawProperties"
```

### Task 2: Engine — stage registry, dwell, flagging

**Files:**
- Create: `src/lib/bottlenecks.ts`
- Test: `src/__tests__/lib/bottlenecks.test.ts`

The engine is pure functions over plain row objects (so tests need no DB), plus one thin `loadBottleneckDeals()` Prisma reader and threshold config read/write.

- [ ] **Step 1: Write failing tests for stage membership + dwell**

Create `src/__tests__/lib/bottlenecks.test.ts`:

```ts
jest.mock("@/lib/db", () => ({
  prisma: {
    deal: { findMany: jest.fn() },
    systemConfig: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

import {
  STAGES,
  computeStageSnapshots,
  deriveThresholds,
  type BottleneckDealRow,
} from "@/lib/bottlenecks";

const NOW = new Date("2026-07-07T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);

/** Minimal fixture row; spread overrides per test. */
function deal(overrides: Partial<BottleneckDealRow>): BottleneckDealRow {
  return {
    hubspotDealId: "1",
    dealName: "PROJ-1000 | Test, Casey | 1 Main St",
    projectNumber: "PROJ-1000",
    pbLocation: "Westminster",
    dealOwnerName: "Jane Owner",
    hubspotOwnerId: "42",
    stage: "Permitting & Interconnection",
    isParticipateEnergy: false,
    rawProperties: null,
    designStatus: null,
    permittingStatus: null,
    icStatus: null,
    installStatus: null,
    finalInspectionStatus: null,
    ptoStatus: null,
    siteSurveyCompletionDate: null,
    designStartDate: null,
    designCompletionDate: null,
    permitSubmitDate: null,
    permitIssueDate: null,
    icSubmitDate: null,
    icApprovalDate: null,
    rtbDate: null,
    installScheduleDate: null,
    constructionCompleteDate: null,
    inspectionPassDate: null,
    ptoStartDate: null,
    ptoCompletionDate: null,
    ...overrides,
  };
}

const THRESHOLDS = Object.fromEntries(
  STAGES.map((s) => [s.key, { medianDays: 10, p90Days: 20, thresholdDays: 20, source: "derived" as const }])
);

describe("computeStageSnapshots", () => {
  it("flags a permitting deal past threshold, using permitSubmitDate as entry", () => {
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(30) })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const permitting = snap.stages.find((s) => s.key === "permitting")!;
    expect(permitting.totalInStage).toBe(1);
    expect(permitting.flagged).toHaveLength(1);
    expect(permitting.flagged[0].dwellDays).toBe(30);
  });

  it("does not flag a deal under threshold", () => {
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(5) })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.flagged).toHaveLength(0);
  });

  it("falls back through the entry chain (construction: installScheduleDate → rtbDate → permitIssueDate)", () => {
    const rows = [deal({
      installStatus: "In Progress",
      installScheduleDate: null,
      rtbDate: daysAgo(25),
      permitIssueDate: daysAgo(60),
    })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const construction = snap.stages.find((s) => s.key === "construction")!;
    expect(construction.flagged[0].dwellDays).toBe(25); // rtbDate, not permitIssueDate
  });

  it("buckets deals with no entry stamp as unknown-age, never flags them", () => {
    const rows = [deal({ designStatus: "In Design" })]; // no design dates at all
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const design = snap.stages.find((s) => s.key === "design")!;
    expect(design.unknownAgeCount).toBe(1);
    expect(design.flagged).toHaveLength(0);
  });

  it("excludes completed statuses from stage membership", () => {
    const rows = [deal({ permittingStatus: "Complete", permitSubmitDate: daysAgo(90) })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.totalInStage).toBe(0);
  });

  it("only counts PE stages for isParticipateEnergy deals, reading status from rawProperties", () => {
    const pe = deal({
      isParticipateEnergy: true,
      inspectionPassDate: daysAgo(45),
      rawProperties: { pe_m1_status: "Submitted" },
    });
    const nonPe = deal({ hubspotDealId: "2", rawProperties: { pe_m1_status: "Submitted" }, inspectionPassDate: daysAgo(45) });
    const snap = computeStageSnapshots([pe, nonPe], THRESHOLDS, NOW);
    const m1 = snap.stages.find((s) => s.key === "pe_m1")!;
    expect(m1.totalInStage).toBe(1);
    expect(m1.flagged[0].dwellDays).toBe(45);
  });

  it("treats PE approved/paid buckets as out of stage", () => {
    const rows = [deal({ isParticipateEnergy: true, inspectionPassDate: daysAgo(45), rawProperties: { pe_m1_status: "Paid" } })];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "pe_m1")!.totalInStage).toBe(0);
  });

  it("sorts flagged deals by dwell descending", () => {
    const rows = [
      deal({ hubspotDealId: "a", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(25) }),
      deal({ hubspotDealId: "b", permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(40) }),
    ];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.flagged.map((f) => f.hubspotDealId)).toEqual(["b", "a"]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
npm test -- src/__tests__/lib/bottlenecks.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/bottlenecks'`.

- [ ] **Step 3: Implement the engine core**

Create `src/lib/bottlenecks.ts`:

```ts
/**
 * Bottleneck engine — age / volume / flow signals per pipeline stage.
 *
 * Reads the Prisma `Deal` mirror only (never the HubSpot API). Stage entry is
 * inferred from existing date-stamp columns; deals whose entry stamps are all
 * null land in an explicit "age unknown" bucket rather than being dropped.
 *
 * Spec: docs/superpowers/specs/2026-07-07-bottleneck-monitor-design.md
 */

import { prisma } from "@/lib/db";
import { isPermitActiveStatus, isICActiveStatus, isPTOPipelineStatus } from "@/lib/pi-statuses";
import { statusBucket } from "@/lib/pe-milestone-bucket";

// ── Row shape (fixture-friendly subset of the Prisma Deal model) ──

export interface BottleneckDealRow {
  hubspotDealId: string;
  dealName: string | null;
  projectNumber: string | null;
  pbLocation: string | null;
  dealOwnerName: string | null;
  hubspotOwnerId: string | null;
  stage: string | null;
  isParticipateEnergy: boolean;
  rawProperties: unknown;
  designStatus: string | null;
  permittingStatus: string | null;
  icStatus: string | null;
  installStatus: string | null;
  finalInspectionStatus: string | null;
  ptoStatus: string | null;
  siteSurveyCompletionDate: Date | null;
  designStartDate: Date | null;
  designCompletionDate: Date | null;
  permitSubmitDate: Date | null;
  permitIssueDate: Date | null;
  icSubmitDate: Date | null;
  icApprovalDate: Date | null;
  rtbDate: Date | null;
  installScheduleDate: Date | null;
  constructionCompleteDate: Date | null;
  inspectionPassDate: Date | null;
  ptoCompletionDate: Date | null;
  ptoStartDate: Date | null;
}

// ── Stage registry ──

export type BottleneckTeam = "design" | "pi" | "ops" | "precon";

export interface StageDefinition {
  key: string;
  label: string;
  team: BottleneckTeam;
  /** Is the deal currently sitting in this stage? */
  isInStage(d: BottleneckDealRow): boolean;
  /** When did it enter? First non-null wins; null → "age unknown". */
  entryDate(d: BottleneckDealRow): Date | null;
  /** When did it leave? (flow signal — null while still in stage) */
  exitDate(d: BottleneckDealRow): Date | null;
}

/**
 * Design / construction / inspection have no named active-status constant
 * (permitting/IC/PTO do — pi-statuses.ts). For them, "in stage" = status
 * present and not obviously terminal. Matches deals-pipeline.ts TERMINAL_KEYWORDS.
 */
const DONE_KEYWORDS = ["complete", "completed", "cancelled", "canceled", "not needed", "closed", "n/a"];
function isOpenStatus(status: string | null): boolean {
  if (!status || !status.trim()) return false;
  const s = status.toLowerCase();
  return !DONE_KEYWORDS.some((k) => s.includes(k));
}

function rawProp(d: BottleneckDealRow, key: string): string | null {
  const raw = d.rawProperties as Record<string, unknown> | null;
  const v = raw && typeof raw === "object" ? raw[key] : null;
  return typeof v === "string" && v.trim() ? v : null;
}

/** HubSpot dates in rawProperties are epoch-ms strings or ISO strings. */
function rawDate(d: BottleneckDealRow, key: string): Date | null {
  const v = rawProp(d, key);
  if (!v) return null;
  const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

const first = (...dates: Array<Date | null>) => dates.find((x) => x != null) ?? null;
const PE_DONE = new Set(["approved", "paid"]);
const peActive = (status: string | null) => status != null && !PE_DONE.has(statusBucket(status));

export const STAGES: StageDefinition[] = [
  {
    key: "design", label: "Design", team: "design",
    isInStage: (d) => isOpenStatus(d.designStatus),
    entryDate: (d) => first(d.designStartDate, d.siteSurveyCompletionDate),
    exitDate: (d) => d.designCompletionDate,
  },
  {
    key: "permitting", label: "Permitting", team: "pi",
    isInStage: (d) => isPermitActiveStatus(d.permittingStatus ?? ""),
    entryDate: (d) => first(d.permitSubmitDate, d.designCompletionDate),
    exitDate: (d) => d.permitIssueDate,
  },
  {
    key: "interconnection", label: "Interconnection", team: "pi",
    isInStage: (d) => isICActiveStatus(d.icStatus ?? ""),
    entryDate: (d) => first(d.icSubmitDate, d.designCompletionDate),
    exitDate: (d) => d.icApprovalDate,
  },
  {
    key: "construction", label: "Construction", team: "ops",
    isInStage: (d) => isOpenStatus(d.installStatus),
    entryDate: (d) => first(d.installScheduleDate, d.rtbDate, d.permitIssueDate),
    exitDate: (d) => d.constructionCompleteDate,
  },
  {
    key: "inspection", label: "Inspection", team: "ops",
    isInStage: (d) => isOpenStatus(d.finalInspectionStatus),
    entryDate: (d) => d.constructionCompleteDate,
    exitDate: (d) => d.inspectionPassDate,
  },
  {
    key: "pto", label: "PTO", team: "ops",
    isInStage: (d) => isPTOPipelineStatus(d.ptoStatus ?? ""),
    entryDate: (d) => first(d.ptoStartDate, d.inspectionPassDate),
    exitDate: (d) => d.ptoCompletionDate,
  },
  {
    key: "pe_m1", label: "PE M1", team: "precon",
    isInStage: (d) => d.isParticipateEnergy && peActive(rawProp(d, "pe_m1_status")),
    entryDate: (d) => d.inspectionPassDate,
    exitDate: (d) => rawDate(d, "pe_m1_remittance_date"),
  },
  {
    key: "pe_m2", label: "PE M2", team: "precon",
    isInStage: (d) => d.isParticipateEnergy && peActive(rawProp(d, "pe_m2_status")),
    entryDate: (d) => d.ptoCompletionDate,
    exitDate: (d) => rawDate(d, "pe_m2_remittance_date"),
  },
];

// ── Thresholds ──

export interface StageThreshold {
  medianDays: number | null;
  p90Days: number | null;
  thresholdDays: number | null; // null → stage never flags (insufficient history)
  source: "derived" | "manual";
}
export type ThresholdConfig = Record<string, StageThreshold>;

// ── Snapshot computation ──

export interface FlaggedDeal {
  hubspotDealId: string;
  dealName: string;
  projectNumber: string | null;
  pbLocation: string | null;
  dealOwnerName: string | null;
  hubspotOwnerId: string | null;
  dwellDays: number;
  thresholdDays: number;
}

export interface StageSnapshot {
  key: string;
  label: string;
  team: BottleneckTeam;
  totalInStage: number;
  unknownAgeCount: number;
  medianDwellDays: number | null; // median of current in-stage dwell
  threshold: StageThreshold;
  flagged: FlaggedDeal[];
  flow: Array<{ weekStart: string; entered: number; exited: number }>;
}

export interface BottleneckSnapshot {
  computedAt: string;
  stages: StageSnapshot[];
}

const DAY_MS = 86_400_000;
const dwellDays = (entry: Date, now: number) => Math.floor((now - entry.getTime()) / DAY_MS);

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** ISO-week Monday (UTC) for flow bucketing. */
function weekStartOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const FLOW_WEEKS = 8;

export function computeStageSnapshots(
  rows: BottleneckDealRow[],
  thresholds: ThresholdConfig,
  nowMs: number
): BottleneckSnapshot {
  const flowCutoff = nowMs - FLOW_WEEKS * 7 * DAY_MS;

  const stages = STAGES.map((stage) => {
    const threshold: StageThreshold =
      thresholds[stage.key] ?? { medianDays: null, p90Days: null, thresholdDays: null, source: "derived" };

    const inStage = rows.filter((d) => stage.isInStage(d));
    const dwells: number[] = [];
    let unknownAgeCount = 0;
    const flagged: FlaggedDeal[] = [];

    for (const d of inStage) {
      const entry = stage.entryDate(d);
      if (!entry) { unknownAgeCount++; continue; }
      const dwell = dwellDays(entry, nowMs);
      dwells.push(dwell);
      if (threshold.thresholdDays != null && dwell > threshold.thresholdDays) {
        flagged.push({
          hubspotDealId: d.hubspotDealId,
          dealName: d.dealName ?? "(unnamed)",
          projectNumber: d.projectNumber,
          pbLocation: d.pbLocation,
          dealOwnerName: d.dealOwnerName,
          hubspotOwnerId: d.hubspotOwnerId,
          dwellDays: dwell,
          thresholdDays: threshold.thresholdDays,
        });
      }
    }
    flagged.sort((a, b) => b.dwellDays - a.dwellDays);

    // Flow: entry/exit stamps over the trailing weeks — computed over ALL rows,
    // not just current in-stage deals (a deal that exited is no longer in stage).
    const flowMap = new Map<string, { entered: number; exited: number }>();
    for (const d of rows) {
      const entry = stage.entryDate(d);
      if (entry && entry.getTime() >= flowCutoff && entry.getTime() <= nowMs) {
        const wk = weekStartOf(entry);
        const b = flowMap.get(wk) ?? { entered: 0, exited: 0 };
        b.entered++; flowMap.set(wk, b);
      }
      const exit = stage.exitDate(d);
      if (exit && exit.getTime() >= flowCutoff && exit.getTime() <= nowMs) {
        const wk = weekStartOf(exit);
        const b = flowMap.get(wk) ?? { entered: 0, exited: 0 };
        b.exited++; flowMap.set(wk, b);
      }
    }
    const flow = [...flowMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, v]) => ({ weekStart, ...v }));

    dwells.sort((a, b) => a - b);
    return {
      key: stage.key,
      label: stage.label,
      team: stage.team,
      totalInStage: inStage.length,
      unknownAgeCount,
      medianDwellDays: median(dwells),
      threshold,
      flagged,
      flow,
    };
  });

  return { computedAt: new Date(nowMs).toISOString(), stages };
}

// ── Threshold derivation ──

const DERIVE_WINDOW_DAYS = 365;

/**
 * Derive median/p90 from completed transitions (both entry and exit stamps,
 * exit within the trailing 12 months). thresholdDays defaults to p90; a
 * "manual" source in `existing` keeps its thresholdDays but refreshes stats.
 * Stages with <10 completed transitions get thresholdDays null (never flag).
 */
export function deriveThresholds(
  rows: BottleneckDealRow[],
  nowMs: number,
  existing?: ThresholdConfig
): ThresholdConfig {
  const cutoff = nowMs - DERIVE_WINDOW_DAYS * DAY_MS;
  const out: ThresholdConfig = {};
  for (const stage of STAGES) {
    const durations: number[] = [];
    for (const d of rows) {
      const entry = stage.entryDate(d);
      const exit = stage.exitDate(d);
      if (!entry || !exit) continue;
      if (exit.getTime() < cutoff || exit.getTime() > nowMs) continue;
      const days = Math.floor((exit.getTime() - entry.getTime()) / DAY_MS);
      if (days >= 0) durations.push(days);
    }
    durations.sort((a, b) => a - b);
    const med = median(durations);
    const p90 = percentile(durations, 90);
    const prev = existing?.[stage.key];
    out[stage.key] = {
      medianDays: med,
      p90Days: p90,
      thresholdDays:
        prev?.source === "manual" ? prev.thresholdDays : durations.length >= 10 ? p90 : null,
      source: prev?.source === "manual" ? "manual" : "derived",
    };
  }
  return out;
}

// ── Persistence (SystemConfig) ──

const THRESHOLDS_KEY = "bottleneck_thresholds";

export async function getThresholdConfig(): Promise<ThresholdConfig | null> {
  if (!prisma) return null;
  const row = await prisma.systemConfig.findUnique({ where: { key: THRESHOLDS_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as ThresholdConfig;
  } catch {
    return null;
  }
}

export async function saveThresholdConfig(config: ThresholdConfig): Promise<void> {
  if (!prisma) return;
  await prisma.systemConfig.upsert({
    where: { key: THRESHOLDS_KEY },
    create: { key: THRESHOLDS_KEY, value: JSON.stringify(config) },
    update: { value: JSON.stringify(config) },
  });
}

// ── Prisma reader ──

/**
 * All PROJECT-pipeline deals (including completed — needed for threshold
 * derivation and flow), excluding hard-deletes. Stage membership itself is
 * decided by the per-stage status predicates, not the deal stage.
 */
export async function loadBottleneckDeals(): Promise<BottleneckDealRow[]> {
  if (!prisma) return [];
  return prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: ["DELETED", "MERGED"] } },
    select: {
      hubspotDealId: true, dealName: true, projectNumber: true, pbLocation: true,
      dealOwnerName: true, hubspotOwnerId: true, stage: true,
      isParticipateEnergy: true, rawProperties: true,
      designStatus: true, permittingStatus: true, icStatus: true,
      installStatus: true, finalInspectionStatus: true, ptoStatus: true,
      siteSurveyCompletionDate: true, designStartDate: true, designCompletionDate: true,
      permitSubmitDate: true, permitIssueDate: true, icSubmitDate: true, icApprovalDate: true,
      rtbDate: true, installScheduleDate: true, constructionCompleteDate: true,
      inspectionPassDate: true, ptoStartDate: true, ptoCompletionDate: true,
    },
  }) as Promise<BottleneckDealRow[]>;
}

/** Snapshot with thresholds: reads config, derives+persists on first run. */
export async function computeBottleneckSnapshot(nowMs = Date.now()): Promise<BottleneckSnapshot> {
  const rows = await loadBottleneckDeals();
  let thresholds = await getThresholdConfig();
  if (!thresholds) {
    thresholds = deriveThresholds(rows, nowMs);
    await saveThresholdConfig(thresholds);
  }
  return computeStageSnapshots(rows, thresholds, nowMs);
}

/** Weekly recompute (Monday cron): refresh derived stats, keep manual overrides. */
export async function refreshThresholds(nowMs = Date.now()): Promise<ThresholdConfig> {
  const rows = await loadBottleneckDeals();
  const existing = (await getThresholdConfig()) ?? undefined;
  const next = deriveThresholds(rows, nowMs, existing);
  await saveThresholdConfig(next);
  return next;
}
```

**Verify while implementing:** confirm the exact `Deal` field name for the HubSpot deal id (`hubspotDealId` expected) and the `pipeline` enum value (`"PROJECT"` expected) against `prisma/schema.prisma:3007-3013` and `src/app/api/projects/flagged/route.ts` (`where: { pipeline: "PROJECT" ... }`). Confirm `isPermitActiveStatus`/`isICActiveStatus`/`isPTOPipelineStatus` signatures in `src/lib/pi-statuses.ts:281-321` (they take `string`, hence the `?? ""`).

- [ ] **Step 4: Run tests, verify pass**

```bash
npm test -- src/__tests__/lib/bottlenecks.test.ts
```
Expected: PASS (all from Step 1).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bottlenecks.ts src/__tests__/lib/bottlenecks.test.ts
git commit -m "feat(bottlenecks): stage registry + dwell/flag engine over the Deal mirror"
```

### Task 3: Threshold derivation + flow tests

**Files:**
- Modify: `src/__tests__/lib/bottlenecks.test.ts` (append)

- [ ] **Step 1: Write failing tests**

Append to the test file:

```ts
describe("deriveThresholds", () => {
  const completed = (n: number, days: number) =>
    Array.from({ length: n }, (_, i) =>
      deal({
        hubspotDealId: `c${days}-${i}`,
        permitSubmitDate: daysAgo(days + 30),
        permitIssueDate: daysAgo(30),
      })
    );

  it("computes median and p90 from completed transitions and defaults threshold to p90", () => {
    // 10 transitions of 10d + 2 of 100d → median 10, p90 = 100
    const rows = [...completed(10, 10), ...completed(2, 100)];
    const t = deriveThresholds(rows, NOW);
    expect(t.permitting.medianDays).toBe(10);
    expect(t.permitting.thresholdDays).toBe(t.permitting.p90Days);
  });

  it("leaves thresholdDays null below 10 completed transitions (never flags)", () => {
    const t = deriveThresholds(completed(3, 12), NOW);
    expect(t.permitting.thresholdDays).toBeNull();
    // and computeStageSnapshots never flags with a null threshold
    const rows = [deal({ permittingStatus: "Submitted to AHJ", permitSubmitDate: daysAgo(500) })];
    const snap = computeStageSnapshots(rows, t, NOW);
    expect(snap.stages.find((s) => s.key === "permitting")!.flagged).toHaveLength(0);
  });

  it("preserves manual overrides while refreshing stats", () => {
    const existing = {
      permitting: { medianDays: 1, p90Days: 2, thresholdDays: 55, source: "manual" as const },
    };
    const t = deriveThresholds(completed(12, 10), NOW, existing);
    expect(t.permitting.thresholdDays).toBe(55);
    expect(t.permitting.source).toBe("manual");
    expect(t.permitting.medianDays).toBe(10); // stats still refresh
  });

  it("ignores transitions older than the 12-month window", () => {
    const old = completed(12, 10).map((d) => ({
      ...d,
      permitSubmitDate: daysAgo(500),
      permitIssueDate: daysAgo(400),
    }));
    const t = deriveThresholds(old, NOW);
    expect(t.permitting.medianDays).toBeNull();
  });
});

describe("flow", () => {
  it("buckets entries and exits by ISO week over all rows", () => {
    const rows = [
      deal({ hubspotDealId: "f1", permitSubmitDate: daysAgo(3) }),
      deal({ hubspotDealId: "f2", permitSubmitDate: daysAgo(10), permitIssueDate: daysAgo(2) }),
    ];
    const snap = computeStageSnapshots(rows, THRESHOLDS, NOW);
    const flow = snap.stages.find((s) => s.key === "permitting")!.flow;
    const totals = flow.reduce((acc, w) => ({ entered: acc.entered + w.entered, exited: acc.exited + w.exited }), { entered: 0, exited: 0 });
    expect(totals).toEqual({ entered: 2, exited: 1 });
  });
});
```

- [ ] **Step 2: Run, fix until green**

```bash
npm test -- src/__tests__/lib/bottlenecks.test.ts
```
Expected: PASS. (These exercise code written in Task 2 — failures indicate real engine bugs; fix the engine, not the tests, unless a test asserts something the spec doesn't require.)

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/lib/bottlenecks.test.ts src/lib/bottlenecks.ts
git commit -m "test(bottlenecks): threshold derivation, manual overrides, flow bucketing"
```

## Chunk 2: Digest + cron + bot integration

### Task 4: Digest builder with change detection and scopes

**Files:**
- Create: `src/lib/bottleneck-digest.ts`
- Test: `src/__tests__/lib/bottleneck-digest.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
jest.mock("@/lib/db", () => ({
  prisma: { systemConfig: { findUnique: jest.fn(), upsert: jest.fn() } },
}));

import { buildDigestMessage, detectChanges, filterSnapshotForScope } from "@/lib/bottleneck-digest";
import type { BottleneckSnapshot, StageSnapshot } from "@/lib/bottlenecks";

function stage(overrides: Partial<StageSnapshot>): StageSnapshot {
  return {
    key: "permitting", label: "Permitting", team: "pi",
    totalInStage: 10, unknownAgeCount: 1, medianDwellDays: 12,
    threshold: { medianDays: 12, p90Days: 30, thresholdDays: 30, source: "derived" },
    flagged: [], flow: [],
    ...overrides,
  };
}
const snap = (stages: StageSnapshot[]): BottleneckSnapshot => ({ computedAt: "2026-07-07T14:00:00.000Z", stages });
const flaggedDeal = (id: string, dwell = 40) => ({
  hubspotDealId: id, dealName: `PROJ-${id} | Test, Casey | 1 Main St`, projectNumber: `PROJ-${id}`,
  pbLocation: "Westminster", dealOwnerName: "Jane Owner", hubspotOwnerId: "42",
  dwellDays: dwell, thresholdDays: 30,
});

describe("detectChanges", () => {
  it("reports new flags, resolved flags, and growth", () => {
    const prev = { permitting: ["1", "2"] };
    const current = snap([stage({ flagged: [flaggedDeal("2"), flaggedDeal("3")] })]);
    const c = detectChanges(prev, current);
    expect(c.newlyFlagged.map((f) => f.hubspotDealId)).toEqual(["3"]);
    expect(c.resolvedIds).toEqual(["1"]);
    expect(c.hasChanges).toBe(true);
  });

  it("reports no changes when flag sets match", () => {
    const prev = { permitting: ["2"] };
    const c = detectChanges(prev, snap([stage({ flagged: [flaggedDeal("2")] })]));
    expect(c.hasChanges).toBe(false);
  });

  it("treats a missing snapshot (first run) as changed", () => {
    const c = detectChanges(null, snap([stage({ flagged: [flaggedDeal("2")] })]));
    expect(c.hasChanges).toBe(true);
  });
});

describe("buildDigestMessage", () => {
  it("renders plain text with per-stage counts, top deals with owners, and the dashboard link", () => {
    const s = snap([stage({ flagged: [flaggedDeal("1", 62), flaggedDeal("2", 45)] })]);
    const msg = buildDigestMessage(s, detectChanges({ permitting: ["2"] }, s), { includeFlow: false });
    expect(msg).toContain("Permitting: 2 flagged / 10 in stage");
    expect(msg).toContain("62d");
    expect(msg).toContain("Jane Owner");
    expect(msg).toContain("/dashboards/bottlenecks");
    expect(msg).toContain("1 new");
    expect(msg).not.toContain("|"); // no markdown tables — Chat renders raw pipes
  });

  it("includes flow lines when includeFlow (Monday) is set", () => {
    const s = snap([stage({ flow: [
      { weekStart: "2026-06-29", entered: 22, exited: 9 },
    ] })]);
    const msg = buildDigestMessage(s, detectChanges(null, s), { includeFlow: true });
    expect(msg).toContain("22 in / 9 out");
  });

  it("returns null when nothing is flagged and nothing changed", () => {
    const s = snap([stage({ flagged: [] })]);
    expect(buildDigestMessage(s, { newlyFlagged: [], resolvedIds: [], hasChanges: false }, { includeFlow: false })).toBeNull();
  });
});

describe("filterSnapshotForScope", () => {
  const s = snap([
    stage({ key: "permitting", team: "pi", flagged: [flaggedDeal("1")] }),
    stage({ key: "construction", label: "Construction", team: "ops", flagged: [flaggedDeal("2")] }),
  ]);
  it("team scope keeps only that team's stages", () => {
    const out = filterSnapshotForScope(s, { kind: "team", team: "pi" });
    expect(out.stages.map((x) => x.key)).toEqual(["permitting"]);
  });
  it("person scope keeps only that owner's flagged deals across stages", () => {
    const out = filterSnapshotForScope(s, { kind: "person", hubspotOwnerId: "42" });
    expect(out.stages.every((x) => x.flagged.every((f) => f.hubspotOwnerId === "42"))).toBe(true);
  });
  it("all scope is identity", () => {
    expect(filterSnapshotForScope(s, { kind: "all" })).toEqual(s);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm test -- src/__tests__/lib/bottleneck-digest.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/bottleneck-digest.ts`**

```ts
/**
 * Bottleneck digest — renders scoped plain-text Chat digests from a
 * BottleneckSnapshot, with change detection against the last-sent snapshot
 * (SystemConfig). Sending goes through the tech-ops bot's owner DM space.
 */

import { prisma } from "@/lib/db";
import {
  computeBottleneckSnapshot,
  refreshThresholds,
  type BottleneckSnapshot,
  type BottleneckTeam,
  type FlaggedDeal,
} from "@/lib/bottlenecks";

const LAST_DIGEST_KEY = "bottleneck_last_digest";
const DASHBOARD_URL = "https://www.pbtechops.com/dashboards/bottlenecks";

// ── Scopes ──

export type DigestScope =
  | { kind: "all" }
  | { kind: "team"; team: BottleneckTeam }
  | { kind: "person"; hubspotOwnerId: string };

export function filterSnapshotForScope(s: BottleneckSnapshot, scope: DigestScope): BottleneckSnapshot {
  if (scope.kind === "all") return s;
  if (scope.kind === "team") return { ...s, stages: s.stages.filter((x) => x.team === scope.team) };
  return {
    ...s,
    stages: s.stages.map((x) => ({
      ...x,
      flagged: x.flagged.filter((f) => f.hubspotOwnerId === scope.hubspotOwnerId),
    })),
  };
}

// ── Change detection ──

/** flagged deal ids per stage key, as stored in SystemConfig after each send */
export type FlagSnapshot = Record<string, string[]>;

export interface DigestChanges {
  newlyFlagged: FlaggedDeal[];
  resolvedIds: string[];
  hasChanges: boolean;
}

export function toFlagSnapshot(s: BottleneckSnapshot): FlagSnapshot {
  return Object.fromEntries(s.stages.map((x) => [x.key, x.flagged.map((f) => f.hubspotDealId)]));
}

export function detectChanges(prev: FlagSnapshot | null, current: BottleneckSnapshot): DigestChanges {
  const newlyFlagged: FlaggedDeal[] = [];
  const resolvedIds: string[] = [];
  for (const stage of current.stages) {
    const before = new Set(prev?.[stage.key] ?? []);
    const now = new Set(stage.flagged.map((f) => f.hubspotDealId));
    for (const f of stage.flagged) if (!before.has(f.hubspotDealId)) newlyFlagged.push(f);
    for (const id of before) if (!now.has(id)) resolvedIds.push(id);
  }
  return {
    newlyFlagged,
    resolvedIds,
    hasChanges: prev == null || newlyFlagged.length > 0 || resolvedIds.length > 0,
  };
}

// ── Rendering (plain text — Google Chat renders markdown tables as raw pipes) ──

/** "PROJ-#### | Last, First | Address" → "PROJ-#### — Last, First" */
function shortName(name: string): string {
  const parts = name.split("|").map((p) => p.trim());
  return parts.slice(0, 2).join(" — ") || name;
}

export function buildDigestMessage(
  snapshot: BottleneckSnapshot,
  changes: DigestChanges,
  opts: { includeFlow: boolean }
): string | null {
  const flaggedTotal = snapshot.stages.reduce((n, s) => n + s.flagged.length, 0);
  if (flaggedTotal === 0 && !changes.hasChanges && !opts.includeFlow) return null;

  const day = new Date(snapshot.computedAt).toLocaleDateString("en-US", {
    timeZone: "America/Denver", weekday: "short", month: "short", day: "numeric",
  });

  const lines: string[] = [`🚧 Bottleneck digest — ${day}`];
  const delta =
    changes.newlyFlagged.length || changes.resolvedIds.length
      ? ` (${changes.newlyFlagged.length} new, ${changes.resolvedIds.length} resolved)`
      : "";
  lines.push(`${flaggedTotal} deal${flaggedTotal === 1 ? "" : "s"} past threshold${delta}`);
  lines.push("");

  for (const s of snapshot.stages) {
    if (s.flagged.length === 0 && !(opts.includeFlow && s.flow.length > 0)) continue;
    const th = s.threshold.thresholdDays != null ? `, threshold ${s.threshold.thresholdDays}d` : "";
    lines.push(`${s.label}: ${s.flagged.length} flagged / ${s.totalInStage} in stage${th}`);
    for (const f of s.flagged.slice(0, 3)) {
      const who = f.dealOwnerName ? ` — ${f.dealOwnerName}` : "";
      const where = f.pbLocation ? ` (${f.pbLocation})` : "";
      lines.push(`• ${shortName(f.dealName)} — ${f.dwellDays}d${who}${where}`);
    }
    if (s.flagged.length > 3) lines.push(`…and ${s.flagged.length - 3} more.`);
    if (opts.includeFlow && s.flow.length > 0) {
      const recent = s.flow.slice(-2);
      const entered = recent.reduce((n, w) => n + w.entered, 0);
      const exited = recent.reduce((n, w) => n + w.exited, 0);
      lines.push(`↳ flow: ${entered} in / ${exited} out (last 2 weeks)`);
    }
    lines.push("");
  }

  lines.push(`Dashboard: ${DASHBOARD_URL}`);
  return lines.join("\n");
}

// ── Last-sent snapshot persistence ──

export async function getLastFlagSnapshot(): Promise<FlagSnapshot | null> {
  if (!prisma) return null;
  const row = await prisma.systemConfig.findUnique({ where: { key: LAST_DIGEST_KEY } });
  if (!row?.value) return null;
  try {
    return (JSON.parse(row.value) as { flags: FlagSnapshot }).flags ?? null;
  } catch {
    return null;
  }
}

export async function saveFlagSnapshot(flags: FlagSnapshot): Promise<void> {
  if (!prisma) return;
  const value = JSON.stringify({ sentAt: new Date().toISOString(), flags });
  await prisma.systemConfig.upsert({
    where: { key: LAST_DIGEST_KEY },
    create: { key: LAST_DIGEST_KEY, value },
    update: { value },
  });
}

// ── Orchestration (called by the cron route) ──

export interface BottleneckDigestResult {
  posted: boolean;
  reason?: string;
  isMonday: boolean;
  message?: string; // preview mode only
}

export async function runBottleneckDigest(opts?: {
  nowMs?: number;
  preview?: boolean;
}): Promise<BottleneckDigestResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const isMonday =
    new Date(nowMs).toLocaleDateString("en-US", { timeZone: "America/Denver", weekday: "short" }) === "Mon";

  // Mondays also refresh derived thresholds (manual overrides preserved).
  if (isMonday && !opts?.preview) await refreshThresholds(nowMs);

  const snapshot = await computeBottleneckSnapshot(nowMs);
  const prev = await getLastFlagSnapshot();
  const changes = detectChanges(prev, snapshot);

  if (!isMonday && !changes.hasChanges) {
    return { posted: false, reason: "no changes since last digest", isMonday };
  }

  const message = buildDigestMessage(snapshot, changes, { includeFlow: isMonday });
  if (!message) return { posted: false, reason: "nothing to report", isMonday };

  if (opts?.preview) return { posted: false, isMonday, message };

  const { getOwnerDmSpace } = await import("@/lib/tech-ops-bot-proactive");
  const space = await getOwnerDmSpace();
  if (!space) return { posted: false, reason: "owner DM space not captured yet", isMonday };

  const { postGoogleChatMessage } = await import("@/lib/google-chat-api");
  await postGoogleChatMessage({ spaceName: space, text: message });
  await saveFlagSnapshot(toFlagSnapshot(snapshot));
  return { posted: true, isMonday };
}
```

- [ ] **Step 4: Run tests, verify pass** — `npm test -- src/__tests__/lib/bottleneck-digest.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bottleneck-digest.ts src/__tests__/lib/bottleneck-digest.test.ts
git commit -m "feat(bottlenecks): scoped digest builder with change detection"
```

### Task 5: Cron route + vercel.json

**Files:**
- Create: `src/app/api/cron/bottleneck-digest/route.ts`
- Modify: `vercel.json` (crons array, ~line 112 region)

- [ ] **Step 1: Create the cron route** (mirror of `tech-ops-bot-digest/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { runBottleneckDigest } from "@/lib/bottleneck-digest";

/**
 * GET /api/cron/bottleneck-digest
 * Weekday-morning bottleneck digest to the owner DM (change-driven; Mondays
 * always send with flow trends + refresh derived thresholds).
 * ?preview=1 renders without posting. Protected by CRON_SECRET.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const preview = request.nextUrl.searchParams.get("preview") === "1";
  try {
    const result = await runBottleneckDigest({ preview });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[bottleneck-digest] failed:", message);
    return NextResponse.json({ posted: false, reason: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Register the cron in `vercel.json`**

Add to the `crons` array (weekdays 14:00 UTC = 8am MDT / 7am MST — DST drift accepted per spec):

```json
{
  "path": "/api/cron/bottleneck-digest",
  "schedule": "0 14 * * 1-5"
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/cron/bottleneck-digest/route.ts vercel.json
git commit -m "feat(bottlenecks): weekday digest cron (change-driven, Monday full send)"
```

### Task 6: Retire the old stuck-deals section

**Files:**
- Modify: `src/lib/tech-ops-bot-proactive.ts`

Per spec §5: the bottleneck digest **replaces** the daily digest's "Stuck deals" section; the two crons stay separate sends. Remove the section rather than rewiring it.

- [ ] **Step 1: Remove stuck-section code**

In `src/lib/tech-ops-bot-proactive.ts`:
1. Delete `STUCK_THRESHOLDS` (lines 35–44) and `buildStuckSection` (lines 122–200).
2. `SectionKey` (line 335): remove `"stuck"` → `export type SectionKey = "milestones" | "schedule" | "escalations";`
3. In `buildSections` (line 346): remove the `case "stuck"` branch.
4. In `SectionOptions` (line 337): remove `stuckStages`.
5. `buildDailyDigestMessage` (line 455): sections become `["milestones", "escalations"]`.
6. `DIGEST_ROUTES` (line 411): remove `"stuck"` from each route's `sections` and delete the `stuckStages` field on the Colorado route. (All routes are `enabled: false` — content-only edit.)
7. Update the file header comment (lines 4–8) to say the stuck-deals section moved to the bottleneck digest (`src/lib/bottleneck-digest.ts`).

- [ ] **Step 2: Check nothing else references the removed symbols**

```bash
rg -n "STUCK_THRESHOLDS|buildStuckSection|stuckStages|\"stuck\"" src/
```
Expected: no hits outside `tech-ops-bot-proactive.ts` history (fix any callers found — e.g. room-digest API routes passing `"stuck"`).

- [ ] **Step 3: Typecheck, run bot tests, commit**

```bash
npx tsc --noEmit
npm test -- tech-ops
git add src/lib/tech-ops-bot-proactive.ts
git commit -m "refactor(bot): retire hardcoded stuck-deals section (superseded by bottleneck digest)"
```

## Chunk 3: API + dashboard + access

### Task 7: Summary API route

**Files:**
- Create: `src/app/api/bottlenecks/summary/route.ts`

Browser auth comes from middleware + the roles allowlist (Task 9) — no in-route token gate needed (matches `/api/projects/flagged` pattern minus the machine-token path).

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { computeBottleneckSnapshot } from "@/lib/bottlenecks";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const snapshot = await computeBottleneckSnapshot();
    return NextResponse.json({ ...snapshot, lastUpdated: snapshot.computedAt });
  } catch (error) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/bottlenecks/summary/route.ts
git commit -m "feat(bottlenecks): summary API for the dashboard"
```

### Task 8: Dashboard page + query keys

**Files:**
- Modify: `src/lib/query-keys.ts` (follow the existing factory shape — add a `bottlenecks` group with `root` and `summary()`)
- Create: `src/app/dashboards/bottlenecks/page.tsx`

- [ ] **Step 1: Add query keys** — match the file's existing pattern, e.g.:

```ts
bottlenecks: {
  root: ["bottlenecks"] as const,
  summary: () => ["bottlenecks", "summary"] as const,
},
```

- [ ] **Step 2: Create the page** (pattern: `src/app/dashboards/my-tickets/page.tsx` — `"use client"`, `DashboardShell`, React Query). Structure:

```tsx
"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DashboardShell from "@/components/DashboardShell";
import { queryKeys } from "@/lib/query-keys";
import type { BottleneckSnapshot, StageSnapshot } from "@/lib/bottlenecks";

type SummaryResponse = BottleneckSnapshot & { lastUpdated: string };

export default function BottlenecksPage() {
  const queryClient = useQueryClient();
  const [team, setTeam] = useState<string>("all");
  const [showUnknown, setShowUnknown] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.bottlenecks.summary(),
    queryFn: async (): Promise<SummaryResponse> => {
      const r = await fetch("/api/bottlenecks/summary");
      if (!r.ok) throw new Error(`failed: ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const stages = (data?.stages ?? []).filter((s) => team === "all" || s.team === team);

  return (
    <DashboardShell title="Bottleneck Monitor" accentColor="red" lastUpdated={data?.lastUpdated}>
      {/* isError / isLoading ladder as in my-tickets, then: */}
      {/* 1. Stage tiles: grid of cards — label, flagged count (red when >0),
             totalInStage, medianDwellDays vs threshold.thresholdDays,
             unknownAgeCount, and "threshold: Nd (derived|manual)" caption. */}
      {/* 2. Stuck-deal table per stage (stages with flagged.length > 0),
             sorted by dwell desc: shortened dealName, projectNumber,
             dealOwnerName, pbLocation, dwellDays, thresholdDays.
             Wrap in overflow-x-auto. */}
      {/* 3. Flow strip per stage: last 8 weeks entered/exited as simple
             inline bars or a compact table — reuse theme tokens, no new deps. */}
      {/* Team filter: simple select over ["all","design","pi","ops","precon"];
             unknown-age toggle reveals an "age unknown" list per stage. */}
    </DashboardShell>
  );
}
```

Implementation notes (follow, don't improvise):
- Theme tokens only (`bg-surface`, `border-t-border`, `text-muted`, `text-foreground`); flagged accents `text-red-*`. No hardcoded hex.
- Table must live inside `overflow-x-auto`.
- Reuse `MetricCard`/`MiniStat` from `@/components/ui/MetricCard` for tiles if a straightforward fit; otherwise simple styled divs are fine — do NOT add chart libraries.
- Deal rows are display-only in v1 (no links needed; HubSpot deal links can be a follow-up).

- [ ] **Step 3: Verify in the browser (preview tools)**

Start the dev server and load `/dashboards/bottlenecks` as an admin. Check: page renders, tiles show counts, no console errors, table scrolls horizontally on a narrow viewport. Fix and re-check as needed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/query-keys.ts src/app/dashboards/bottlenecks/page.tsx
git commit -m "feat(bottlenecks): dashboard page with stage tiles, stuck table, flow"
```

### Task 9: Roles allowlist + suite card

**Files:**
- Modify: `src/lib/roles.ts` — `allowedRoutes` arrays for OPERATIONS_MANAGER (lines 138–273), PROJECT_MANAGER (313–485), OPERATIONS (519–611), TECH_OPS (734–868), SALES_MANAGER (1365–1436)
- Modify: `src/app/suites/operations/page.tsx` — `BASE_LINKS` array

- [ ] **Step 1: Add routes to the five literal-array roles**

Add both entries to each of the five roles above (ADMIN/EXECUTIVE/OWNER are wildcard — no edit):

```ts
"/dashboards/bottlenecks",
"/api/bottlenecks",
```

Do NOT touch `ADMIN_ONLY_ROUTES`.

- [ ] **Step 2: Add the suite card**

In `BASE_LINKS` (section "Construction" is the best fit):

```ts
{
  href: "/dashboards/bottlenecks",
  title: "Bottleneck Monitor",
  description: "Deals stuck past stage thresholds — age, volume, and flow per pipeline stage.",
  tag: "OPS",
  icon: "🚧",
  section: "Construction",
},
```

Every role that sees the Operations suite now has the route (Step 1), so no per-role card filtering (the `PE_PHOTO_BUILDER_ROLES` pattern) is needed.

- [ ] **Step 3: Verify no silent 403**

```bash
rg -n "bottlenecks" src/lib/roles.ts | wc -l   # expect 10 (2 routes × 5 roles)
npx tsc --noEmit
```
Then in the dev server, impersonate (or check `allowedRoutes` logic for) an OPERATIONS-role user and load `/dashboards/bottlenecks` — expect the page, not a 403/redirect.

- [ ] **Step 4: Commit**

```bash
git add src/lib/roles.ts src/app/suites/operations/page.tsx
git commit -m "feat(bottlenecks): operations suite card + role allowlist entries"
```

### Task 10: Final verification

- [ ] **Step 1: Full unfiltered typecheck, lint, full test suite**

```bash
npx tsc --noEmit
npm run lint
npm test
```
Expected: all green. Fix anything that fails before proceeding (project rule: unfiltered tsc has caught cross-file breaks that filtered runs miss).

- [ ] **Step 2: End-to-end digest preview against real data**

With `.env` loaded (dev server or a one-off script), call:

```bash
curl -s "http://localhost:3000/api/cron/bottleneck-digest?preview=1" \
  -H "Authorization: Bearer $CRON_SECRET" | python3 -m json.tool
```
Expected: JSON with a rendered `message` (or `reason: "nothing to report"`). Eyeball the message: real deal names, sane dwell numbers, no `null`/`undefined` strings, dashboard link present. Note: PE stages will show 0 / unknown until a full deal re-sync backfills `rawProperties` — expected, per spec.

- [ ] **Step 3: Commit any fixes, then stop**

Do NOT push or open a PR — hand back to Zach for review (deploys go through GitHub PRs after his sign-off; the PE `rawProperties` backfill re-sync and Vercel cron go live with the merge).
