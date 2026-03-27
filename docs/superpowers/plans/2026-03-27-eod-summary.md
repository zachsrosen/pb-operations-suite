# EOD Summary Email — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a daily end-of-day email to Zach summarizing Design and P&I team activity: status changes, milestones with attribution, and completed HubSpot tasks.

**Architecture:** Morning snapshot captures all active deals via broad HubSpot queries (no status filter). Evening cron diffs against current state, enriches milestones with property history attribution, queries completed tasks, and sends a single HTML rollup email.

**Tech Stack:** Next.js API route (Vercel cron), Prisma (DealStatusSnapshot model), HubSpot SDK (deals search, property history, owners API, tasks search), React Email patterns (inline-styled HTML), dual-provider email (Google Workspace → Resend fallback)

**Spec:** `docs/superpowers/specs/2026-03-27-eod-summary-design.md`

---

## File Map

```
NEW FILES:
  src/lib/eod-summary/config.ts        — Milestone definitions, broad query builder, reexports
  src/lib/eod-summary/snapshot.ts       — Save/load/diff snapshot, broad HubSpot queries
  src/lib/eod-summary/milestones.ts     — Property history wrapper, userId→name map
  src/lib/eod-summary/tasks.ts          — HubSpot completed-task search
  src/lib/eod-summary/html.ts           — EOD email HTML builder
  src/lib/eod-summary/send.ts           — Orchestration, idempotency, email dispatch
  src/app/api/cron/eod-summary/route.ts — Cron handler (GET, CRON_SECRET auth)
  src/__tests__/lib/eod-snapshot.test.ts — Snapshot diff unit tests
  src/__tests__/lib/eod-milestones.test.ts — Milestone detection unit tests

MODIFIED FILES:
  prisma/schema.prisma                  — Add DealStatusSnapshot model
  src/app/api/cron/daily-focus/route.ts — Call saveEodSnapshot() after emails
  vercel.json                           — Add eod-summary cron, bump daily-focus maxDuration
```

---

## Chunk 1: Database + Snapshot Infrastructure

### Task 1: Add DealStatusSnapshot Prisma model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add model to schema**

Add after the existing `HubSpotProjectCache` model:

```prisma
model DealStatusSnapshot {
  id                    Int      @id @default(autoincrement())
  snapshotDate          DateTime @db.Date
  dealId                String
  dealName              String
  pipeline              String
  dealStage             String
  pbLocation            String?
  ownerId               String
  designStatus          String?
  layoutStatus          String?
  permittingStatus      String?
  interconnectionStatus String?
  ptoStatus             String?
  createdAt             DateTime @default(now())

  @@unique([snapshotDate, dealId, ownerId])
  @@index([snapshotDate])
}
```

- [ ] **Step 2: Generate Prisma client and create migration**

Run: `npx prisma migrate dev --name add-deal-status-snapshot`
Expected: Migration created, client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(eod): add DealStatusSnapshot model for morning/evening diff"
```

---

### Task 2: Build EOD config

**Files:**
- Create: `src/lib/eod-summary/config.ts`

- [ ] **Step 1: Create config with milestone definitions and broad query properties**

```typescript
// src/lib/eod-summary/config.ts
//
// EOD summary configuration. Reuses lead rosters and pipeline constants
// from daily-focus but defines its own broader query approach (no status
// filter) and milestone definitions using raw HubSpot enum values.

import {
  PI_LEADS,
  DESIGN_LEADS,
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
  PIPELINE_SUFFIXES,
  MANAGER_EMAIL,
  type PILead,
  type DesignLead,
} from "@/lib/daily-focus/config";

export {
  PI_LEADS,
  DESIGN_LEADS,
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
  PIPELINE_SUFFIXES,
  MANAGER_EMAIL,
  type PILead,
  type DesignLead,
};

// ── Broad query properties ───────────────────────────────────────────
// Used by both morning snapshot and evening refresh. Returns ALL status
// fields so the diff can detect changes across any department.

export const SNAPSHOT_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "dealstage",
  "pipeline",
  "pb_location",
  "design_status",
  "layout_status",
  "permitting_status",
  "interconnection_status",
  "pto_status",
];

// ── Status properties we monitor for changes ─────────────────────────

export const MONITORED_STATUS_FIELDS = [
  "designStatus",
  "layoutStatus",
  "permittingStatus",
  "interconnectionStatus",
  "ptoStatus",
  "dealStage",
] as const;

// Map from snapshot field name → HubSpot property name
export const FIELD_TO_HS_PROPERTY: Record<string, string> = {
  designStatus: "design_status",
  layoutStatus: "layout_status",
  permittingStatus: "permitting_status",
  interconnectionStatus: "interconnection_status",
  ptoStatus: "pto_status",
  dealStage: "dealstage",
};

// Map from HubSpot property → department label for email grouping
export const PROPERTY_TO_DEPARTMENT: Record<string, string> = {
  design_status: "Design",
  layout_status: "Design",
  permitting_status: "Permitting",
  interconnection_status: "Interconnection",
  pto_status: "PTO",
};

// ── Milestone definitions ────────────────────────────────────────────
// Raw HubSpot enum values. Display labels come from deals-types.ts
// STATUS_DISPLAY_LABELS at render time.

export interface MilestoneDef {
  statusProperty: string;       // HubSpot property name
  rawValue: string;             // exact HubSpot enum string
  displayLabel: string;         // human-readable for email
  department: string;           // grouping label
}

export const MILESTONES: MilestoneDef[] = [
  { statusProperty: "design_status", rawValue: "Complete", displayLabel: "Design Complete", department: "Design" },
  { statusProperty: "layout_status", rawValue: "Sent to Customer", displayLabel: "Sent For Approval", department: "Design" },
  { statusProperty: "permitting_status", rawValue: "Submitted to AHJ", displayLabel: "Submitted to AHJ", department: "Permitting" },
  { statusProperty: "permitting_status", rawValue: "Complete", displayLabel: "Permit Issued", department: "Permitting" },
  { statusProperty: "interconnection_status", rawValue: "Application Approved", displayLabel: "IC Approved", department: "Interconnection" },
  { statusProperty: "interconnection_status", rawValue: "Submitted To Utility", displayLabel: "Submitted to Utility", department: "Interconnection" },
  { statusProperty: "pto_status", rawValue: "PTO", displayLabel: "PTO Granted", department: "PTO" },
  { statusProperty: "pto_status", rawValue: "Inspection Submitted to Utility", displayLabel: "PTO Submitted to Utility", department: "PTO" },
];

// Quick lookup: property → Set of raw milestone values
export const MILESTONE_VALUES: Map<string, Set<string>> = new Map();
for (const m of MILESTONES) {
  if (!MILESTONE_VALUES.has(m.statusProperty)) {
    MILESTONE_VALUES.set(m.statusProperty, new Set());
  }
  MILESTONE_VALUES.get(m.statusProperty)!.add(m.rawValue);
}

```

- [ ] **Step 2: Commit**

```bash
git add src/lib/eod-summary/config.ts
git commit -m "feat(eod): add config with milestone defs and broad query properties"
```

---

### Task 3: Build snapshot save/load/diff

**Files:**
- Create: `src/lib/eod-summary/snapshot.ts`
- Create: `src/__tests__/lib/eod-snapshot.test.ts`

- [ ] **Step 1: Write failing tests for diff logic**

```typescript
// src/__tests__/lib/eod-snapshot.test.ts
import { diffSnapshots, type SnapshotDeal, type DiffResult } from "@/lib/eod-summary/snapshot";

describe("diffSnapshots", () => {
  const baseDeal: SnapshotDeal = {
    dealId: "100",
    dealName: "Turner Solar",
    pipeline: "6900017",
    dealStage: "20461937",
    pbLocation: "Westminster",
    designStatus: "In Progress",
    layoutStatus: null,
    permittingStatus: null,
    interconnectionStatus: null,
    ptoStatus: null,
  };

  it("detects a status change", () => {
    const morning = new Map([["100", baseDeal]]);
    const evening = new Map([["100", { ...baseDeal, permittingStatus: "Submitted to AHJ" }]]);

    const result = diffSnapshots(morning, evening);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      dealId: "100",
      field: "permittingStatus",
      from: null,
      to: "Submitted to AHJ",
    });
  });

  it("detects multiple changes on the same deal", () => {
    const morning = new Map([["100", { ...baseDeal, designStatus: "In Progress" }]]);
    const evening = new Map([["100", { ...baseDeal, designStatus: "Complete", layoutStatus: "Sent to Customer" }]]);

    const result = diffSnapshots(morning, evening);
    expect(result.changes).toHaveLength(2);
  });

  it("identifies new deals", () => {
    const morning = new Map<string, SnapshotDeal>();
    const evening = new Map([["200", { ...baseDeal, dealId: "200" }]]);

    const result = diffSnapshots(morning, evening);
    expect(result.newDeals).toHaveLength(1);
    expect(result.newDeals[0].dealId).toBe("200");
  });

  it("identifies resolved deals", () => {
    const morning = new Map([["100", baseDeal]]);
    const evening = new Map<string, SnapshotDeal>();

    const result = diffSnapshots(morning, evening, { failedOwnerIds: new Set() });
    expect(result.resolvedDeals).toHaveLength(1);
  });

  it("excludes resolved deals when their owner query failed", () => {
    const morning = new Map([["100", baseDeal]]);
    const evening = new Map<string, SnapshotDeal>();

    // Owner "78035785" had a failed query — deal should NOT appear as resolved
    const result = diffSnapshots(morning, evening, {
      failedOwnerIds: new Set(["78035785"]),
      dealOwnerMap: new Map([["100", new Set(["78035785"])]]),
    });
    expect(result.resolvedDeals).toHaveLength(0);
  });

  it("excludes resolved deal when one of multiple owners had a failed query", () => {
    const morning = new Map([["100", baseDeal]]);
    const evening = new Map<string, SnapshotDeal>();

    // Deal had two owners in morning. One owner's query failed — deal is ambiguous.
    const result = diffSnapshots(morning, evening, {
      failedOwnerIds: new Set(["78035785"]),
      dealOwnerMap: new Map([["100", new Set(["78035785", "216565308"])]]),
    });
    expect(result.resolvedDeals).toHaveLength(0);
  });

  it("ignores deals with no changes", () => {
    const morning = new Map([["100", baseDeal]]);
    const evening = new Map([["100", baseDeal]]);

    const result = diffSnapshots(morning, evening);
    expect(result.changes).toHaveLength(0);
    expect(result.newDeals).toHaveLength(0);
    expect(result.resolvedDeals).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/eod-snapshot.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement snapshot.ts**

```typescript
// src/lib/eod-summary/snapshot.ts
//
// Broad HubSpot queries for morning snapshot, DB save/load, and diff logic.

import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { prisma } from "@/lib/db";
import {
  PI_LEADS,
  DESIGN_LEADS,
  EXCLUDED_STAGES,
  INCLUDED_PIPELINES,
  SNAPSHOT_PROPERTIES,
  MONITORED_STATUS_FIELDS,
  FIELD_TO_HS_PROPERTY,
} from "./config";

// ── Types ──────────────────────────────────────────────────────────────

export interface SnapshotDeal {
  dealId: string;
  dealName: string;
  pipeline: string;
  dealStage: string;
  pbLocation: string | null;
  designStatus: string | null;
  layoutStatus: string | null;
  permittingStatus: string | null;
  interconnectionStatus: string | null;
  ptoStatus: string | null;
}

export interface StatusChange {
  dealId: string;
  dealName: string;
  pipeline: string;
  dealStage: string;
  pbLocation: string | null;
  field: typeof MONITORED_STATUS_FIELDS[number];
  hsProperty: string;
  from: string | null;
  to: string | null;
}

export interface DiffResult {
  changes: StatusChange[];
  newDeals: SnapshotDeal[];
  resolvedDeals: SnapshotDeal[];
}

interface DiffOptions {
  failedOwnerIds?: Set<string>;
  /** Map from dealId → Set of ownerIds that had this deal in the morning snapshot */
  dealOwnerMap?: Map<string, Set<string>>;
}

// ── Diff logic (pure, testable) ────────────────────────────────────────

export function diffSnapshots(
  morning: Map<string, SnapshotDeal>,
  evening: Map<string, SnapshotDeal>,
  options?: DiffOptions,
): DiffResult {
  const changes: StatusChange[] = [];
  const newDeals: SnapshotDeal[] = [];
  const resolvedDeals: SnapshotDeal[] = [];
  const failedOwnerIds = options?.failedOwnerIds ?? new Set<string>();
  const dealOwnerMap = options?.dealOwnerMap ?? new Map<string, Set<string>>();

  // Detect changes and new deals
  for (const [dealId, eveningDeal] of evening) {
    const morningDeal = morning.get(dealId);
    if (!morningDeal) {
      newDeals.push(eveningDeal);
      continue;
    }

    for (const field of MONITORED_STATUS_FIELDS) {
      const from = morningDeal[field] ?? null;
      const to = eveningDeal[field] ?? null;
      if (from !== to) {
        changes.push({
          dealId,
          dealName: eveningDeal.dealName,
          pipeline: eveningDeal.pipeline,
          dealStage: eveningDeal.dealStage,
          pbLocation: eveningDeal.pbLocation,
          field,
          hsProperty: FIELD_TO_HS_PROPERTY[field] ?? field,
          from,
          to,
        });
      }
    }
  }

  // Detect resolved deals (in morning, not in evening)
  for (const [dealId, morningDeal] of morning) {
    if (evening.has(dealId)) continue;

    // False-positive guard: if ANY owner of this deal had a failed query, skip
    const owners = dealOwnerMap.get(dealId);
    if (owners && [...owners].some((oid) => failedOwnerIds.has(oid))) {
      continue;
    }

    resolvedDeals.push(morningDeal);
  }

  return { changes, newDeals, resolvedDeals };
}

// ── Broad HubSpot query ────────────────────────────────────────────────

interface BroadQueryResult {
  deals: Map<string, SnapshotDeal>;
  /** Map from dealId → Set of ownerIds */
  dealOwners: Map<string, Set<string>>;
  failedOwnerIds: Set<string>;
}

async function queryBroadForLead(
  roleProperty: string,
  ownerId: string,
): Promise<{ deals: SnapshotDeal[]; error?: string }> {
  try {
    const deals: SnapshotDeal[] = [];
    let after: string | undefined;

    do {
      const response = await searchWithRetry({
        filterGroups: [{
          filters: [
            { propertyName: roleProperty, operator: FilterOperatorEnum.Eq, value: ownerId },
            { propertyName: "dealstage", operator: FilterOperatorEnum.NotIn, values: EXCLUDED_STAGES },
            { propertyName: "pipeline", operator: FilterOperatorEnum.In, values: INCLUDED_PIPELINES },
          ],
        }],
        properties: SNAPSHOT_PROPERTIES,
        limit: 200,
        ...(after ? { after } : {}),
      } as unknown as Parameters<typeof searchWithRetry>[0]);

      for (const deal of response.results ?? []) {
        const p = deal.properties;
        deals.push({
          dealId: p.hs_object_id ?? deal.id,
          dealName: p.dealname ?? "",
          pipeline: p.pipeline ?? "",
          dealStage: p.dealstage ?? "",
          pbLocation: p.pb_location ?? null,
          designStatus: p.design_status ?? null,
          layoutStatus: p.layout_status ?? null,
          permittingStatus: p.permitting_status ?? null,
          interconnectionStatus: p.interconnection_status ?? null,
          ptoStatus: p.pto_status ?? null,
        });
      }

      after = response.paging?.next?.after;
    } while (after);

    return { deals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[eod] Broad query failed: ${roleProperty}=${ownerId}: ${msg}`);
    return { deals: [], error: msg };
  }
}

export async function queryAllBroad(): Promise<BroadQueryResult> {
  const dealsMap = new Map<string, SnapshotDeal>();
  const dealOwners = new Map<string, Set<string>>();
  const failedOwnerIds = new Set<string>();

  // PI leads — one query per role (role strings are already HubSpot property names)
  for (const lead of PI_LEADS) {
    for (const role of lead.roles) {
      const result = await queryBroadForLead(role, lead.hubspotOwnerId);
      if (result.error) {
        failedOwnerIds.add(lead.hubspotOwnerId);
        continue;
      }
      for (const deal of result.deals) {
        dealsMap.set(deal.dealId, deal);
        if (!dealOwners.has(deal.dealId)) dealOwners.set(deal.dealId, new Set());
        dealOwners.get(deal.dealId)!.add(lead.hubspotOwnerId);
      }
    }
  }

  // Design leads — one query each
  for (const lead of DESIGN_LEADS) {
    const result = await queryBroadForLead("design", lead.hubspotOwnerId);
    if (result.error) {
      failedOwnerIds.add(lead.hubspotOwnerId);
      continue;
    }
    for (const deal of result.deals) {
      dealsMap.set(deal.dealId, deal);
      if (!dealOwners.has(deal.dealId)) dealOwners.set(deal.dealId, new Set());
      dealOwners.get(deal.dealId)!.add(lead.hubspotOwnerId);
    }
  }

  return { deals: dealsMap, dealOwners, failedOwnerIds };
}

// ── DB save/load ────────────────────────────────────────────────────────

function getTodayDenver(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
}

export async function saveSnapshot(
  broadResult: BroadQueryResult,
): Promise<{ saved: number; errors: string[] }> {
  const dateStr = getTodayDenver();
  const snapshotDate = new Date(dateStr + "T00:00:00Z");
  let saved = 0;
  const errors: string[] = [];

  for (const [dealId, deal] of broadResult.deals) {
    const owners = broadResult.dealOwners.get(dealId) ?? new Set<string>();
    for (const ownerId of owners) {
      try {
        await prisma.dealStatusSnapshot.upsert({
          where: {
            snapshotDate_dealId_ownerId: { snapshotDate, dealId, ownerId },
          },
          create: {
            snapshotDate,
            dealId,
            dealName: deal.dealName,
            pipeline: deal.pipeline,
            dealStage: deal.dealStage,
            pbLocation: deal.pbLocation,
            ownerId,
            designStatus: deal.designStatus,
            layoutStatus: deal.layoutStatus,
            permittingStatus: deal.permittingStatus,
            interconnectionStatus: deal.interconnectionStatus,
            ptoStatus: deal.ptoStatus,
          },
          update: {
            dealName: deal.dealName,
            pipeline: deal.pipeline,
            dealStage: deal.dealStage,
            pbLocation: deal.pbLocation,
            designStatus: deal.designStatus,
            layoutStatus: deal.layoutStatus,
            permittingStatus: deal.permittingStatus,
            interconnectionStatus: deal.interconnectionStatus,
            ptoStatus: deal.ptoStatus,
          },
        });
        saved++;
      } catch (err) {
        errors.push(`${dealId}/${ownerId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return { saved, errors };
}

export async function loadSnapshot(): Promise<{
  deals: Map<string, SnapshotDeal>;
  dealOwnerMap: Map<string, Set<string>>;
} | null> {
  const dateStr = getTodayDenver();
  const snapshotDate = new Date(dateStr + "T00:00:00Z");

  const rows = await prisma.dealStatusSnapshot.findMany({
    where: { snapshotDate },
  });

  if (rows.length === 0) return null;

  const deals = new Map<string, SnapshotDeal>();
  const dealOwnerMap = new Map<string, Set<string>>();

  for (const row of rows) {
    // Deduplicate: last write wins on status fields (all identical for same deal)
    deals.set(row.dealId, {
      dealId: row.dealId,
      dealName: row.dealName,
      pipeline: row.pipeline,
      dealStage: row.dealStage,
      pbLocation: row.pbLocation,
      designStatus: row.designStatus,
      layoutStatus: row.layoutStatus,
      permittingStatus: row.permittingStatus,
      interconnectionStatus: row.interconnectionStatus,
      ptoStatus: row.ptoStatus,
    });

    if (!dealOwnerMap.has(row.dealId)) dealOwnerMap.set(row.dealId, new Set());
    dealOwnerMap.get(row.dealId)!.add(row.ownerId);
  }

  return { deals, dealOwnerMap };
}

// ── Cleanup ────────────────────────────────────────────────────────────

export async function cleanupOldSnapshots(retentionDays = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const result = await prisma.dealStatusSnapshot.deleteMany({
    where: { snapshotDate: { lt: cutoff } },
  });
  return result.count;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/__tests__/lib/eod-snapshot.test.ts --no-coverage`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eod-summary/snapshot.ts src/__tests__/lib/eod-snapshot.test.ts
git commit -m "feat(eod): snapshot save/load/diff with broad HubSpot queries"
```

---

### Task 4: Hook snapshot into daily-focus cron

**Files:**
- Modify: `src/app/api/cron/daily-focus/route.ts`

- [ ] **Step 1: Add snapshot call after email sends**

At the end of the `GET` handler, after both `runPIDailyFocus` and `runDesignDailyFocus` complete, add a try/catch block that runs the snapshot. The snapshot MUST NOT block or fail the daily focus emails.

Add import at top:
```typescript
import { queryAllBroad, saveSnapshot } from "@/lib/eod-summary/snapshot";
```

Add after the existing email-send logic (before the final `return NextResponse.json(...)` line):

```typescript
  // ── EOD Snapshot (best-effort, does not block daily focus emails) ──
  // Skip on dry-run — snapshot writes are production DB mutations.
  let snapshotResult = { saved: 0, errors: [] as string[] };
  if (!dryRun) {
    try {
      const broadResult = await queryAllBroad();
      snapshotResult = await saveSnapshot(broadResult);
      console.log(`[daily-focus] EOD snapshot saved: ${snapshotResult.saved} rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[daily-focus] EOD snapshot failed (non-blocking): ${msg}`);
      snapshotResult.errors.push(msg);
    }
  }
```

Add `snapshot` to the JSON response body:
```typescript
  snapshot: { saved: snapshotResult.saved, errors: snapshotResult.errors },
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/daily-focus/route.ts
git commit -m "feat(eod): save morning snapshot after daily focus emails"
```

---

## Chunk 2: EOD Core Logic

### Task 5: Build milestones module

**Files:**
- Create: `src/lib/eod-summary/milestones.ts`
- Create: `src/__tests__/lib/eod-milestones.test.ts`

- [ ] **Step 1: Write failing tests for milestone detection**

```typescript
// src/__tests__/lib/eod-milestones.test.ts
import { detectMilestones, type StatusChange } from "@/lib/eod-summary/milestones";

describe("detectMilestones", () => {
  const baseChange: StatusChange = {
    dealId: "100",
    dealName: "Turner Solar",
    pipeline: "6900017",
    dealStage: "20461937",
    pbLocation: "Westminster",
    field: "permittingStatus",
    hsProperty: "permitting_status",
    from: "Ready For Permitting",
    to: "Submitted to AHJ",
  };

  it("identifies a known milestone", () => {
    const result = detectMilestones([baseChange]);
    expect(result).toHaveLength(1);
    expect(result[0].displayLabel).toBe("Submitted to AHJ");
    expect(result[0].department).toBe("Permitting");
  });

  it("skips non-milestone changes", () => {
    const change: StatusChange = {
      ...baseChange,
      to: "Waiting On Information",
    };
    const result = detectMilestones([change]);
    expect(result).toHaveLength(0);
  });

  it("handles null 'to' value", () => {
    const change: StatusChange = { ...baseChange, to: null };
    const result = detectMilestones([change]);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/eod-milestones.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement milestones.ts**

```typescript
// src/lib/eod-summary/milestones.ts
//
// Milestone detection and property history enrichment for EOD email.

import { hubspotClient } from "@/lib/hubspot";
import * as Sentry from "@sentry/nextjs";
import { MILESTONES, MILESTONE_VALUES, type MilestoneDef } from "./config";
import type { StatusChange } from "./snapshot";

export type { StatusChange } from "./snapshot";

// ── Types ──────────────────────────────────────────────────────────────

export interface MilestoneHit {
  change: StatusChange;
  displayLabel: string;
  department: string;
  /** Who made the change (from property history). null if unavailable. */
  changedBy: string | null;
  /** When the change happened (Denver-localized display string). null if unavailable. */
  changedAt: string | null;
  /** Raw ISO timestamp for sorting. null if unavailable. */
  changedAtIso: string | null;
}

// ── userId → name map via Owners API ───────────────────────────────────

let cachedUserMap: Map<string, string> | null = null;

export async function buildUserIdMap(): Promise<Map<string, string>> {
  if (cachedUserMap) return cachedUserMap;

  const map = new Map<string, string>();
  try {
    const response = await hubspotClient.crm.owners.ownersApi.getPage(
      undefined, undefined, 500, false
    );
    for (const owner of response.results ?? []) {
      const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email || "Unknown";
      // Map both owner ID and userId for flexibility
      if (owner.id) map.set(owner.id, name);
      if (owner.userId) map.set(String(owner.userId), name);
    }
  } catch (err) {
    console.error(`[eod] Owners API failed: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
  }

  cachedUserMap = map;
  return map;
}

/** Clear cached map (for testing or between runs) */
export function clearUserIdMapCache(): void {
  cachedUserMap = null;
}

// ── Property history ───────────────────────────────────────────────────

const MAX_HISTORY_CALLS = 20;

async function getPropertyHistory(
  dealId: string,
  properties: string[],
): Promise<Record<string, Array<{ value: string; timestamp: string; sourceType: string; sourceId: string }>> | null> {
  try {
    const deal = await hubspotClient.crm.deals.basicApi.getById(
      dealId,
      properties,
      properties,  // propertiesWithHistory
      undefined,
      false,
    );
    return (deal as unknown as { propertiesWithHistory?: Record<string, Array<{ value: string; timestamp: string; sourceType: string; sourceId: string }>> }).propertiesWithHistory ?? null;
  } catch (err) {
    console.error(`[eod] Property history failed for deal ${dealId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── Milestone detection ────────────────────────────────────────────────

export function detectMilestones(changes: StatusChange[]): MilestoneHit[] {
  const hits: MilestoneHit[] = [];

  for (const change of changes) {
    if (!change.to) continue;
    const milestoneSet = MILESTONE_VALUES.get(change.hsProperty);
    if (!milestoneSet?.has(change.to)) continue;

    const def = MILESTONES.find(
      (m) => m.statusProperty === change.hsProperty && m.rawValue === change.to
    );
    if (!def) continue;

    hits.push({
      change,
      displayLabel: def.displayLabel,
      department: def.department,
      changedBy: null,
      changedAt: null,
      changedAtIso: null,
    });
  }

  return hits;
}

// ── Enrich milestones with who/when from property history ──────────────

export async function enrichMilestones(
  hits: MilestoneHit[],
): Promise<MilestoneHit[]> {
  if (hits.length === 0) return hits;

  const userMap = await buildUserIdMap();
  const todayDenver = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  let historyCalls = 0;

  for (const hit of hits) {
    if (historyCalls >= MAX_HISTORY_CALLS) break;

    const history = await getPropertyHistory(
      hit.change.dealId,
      [hit.change.hsProperty],
    );
    historyCalls++;

    if (!history) continue;

    const entries = history[hit.change.hsProperty];
    if (!entries) continue;

    // Find the entry matching the milestone value, from today, made by a human
    const match = entries.find((e) => {
      if (e.value !== hit.change.to) return false;
      const entryDate = new Date(e.timestamp).toLocaleDateString("en-CA", { timeZone: "America/Denver" });
      if (entryDate !== todayDenver) return false;
      return e.sourceType === "CRM_UI" || e.sourceType === "INTEGRATION";
    });

    if (match) {
      hit.changedBy = userMap.get(match.sourceId) ?? "Team member";
      hit.changedAtIso = match.timestamp;
      hit.changedAt = new Date(match.timestamp).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Denver",
      });
    }
  }

  return hits;
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/__tests__/lib/eod-milestones.test.ts --no-coverage`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eod-summary/milestones.ts src/__tests__/lib/eod-milestones.test.ts
git commit -m "feat(eod): milestone detection with property history enrichment"
```

---

### Task 6: Build tasks module

**Files:**
- Create: `src/lib/eod-summary/tasks.ts`

- [ ] **Step 1: Implement HubSpot task query**

```typescript
// src/lib/eod-summary/tasks.ts
//
// Query HubSpot for tasks completed today by tracked leads.

import { hubspotClient } from "@/lib/hubspot";
import { PI_LEADS, DESIGN_LEADS } from "./config";

// ── Types ──────────────────────────────────────────────────────────────

export interface CompletedTask {
  taskId: string;
  subject: string;
  ownerId: string;
  ownerName: string;
  completedAt: string | null;
  associatedDealId: string | null;
  associatedDealName: string | null;
}

// ── Owner lookup ───────────────────────────────────────────────────────

const ALL_LEADS = [...PI_LEADS, ...DESIGN_LEADS];
const OWNER_NAME_MAP = new Map(ALL_LEADS.map((l) => [l.hubspotOwnerId, l.name]));
const ALL_OWNER_IDS = [...new Set(ALL_LEADS.map((l) => l.hubspotOwnerId))];

// ── Task query ─────────────────────────────────────────────────────────

export async function queryCompletedTasks(): Promise<{
  tasks: CompletedTask[];
  error?: string;
}> {
  try {
    // Calculate today 6 AM Denver in UTC
    const now = new Date();
    const todayStr = now.toLocaleDateString("en-CA", { timeZone: "America/Denver" });
    // 6 AM Denver → approximate as start-of-business
    const startOfDay = new Date(`${todayStr}T06:00:00-06:00`);

    // Prefer hs_task_completion_date (semantically correct for "completed today").
    // Fall back to hs_lastmodifieddate only if the first query returns 0 results
    // (indicating the field may be unpopulated in this HubSpot instance).
    const dateFilter = startOfDay.getTime().toString();
    let dateProperty = "hs_task_completion_date";

    let response = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
      filterGroups: [{
        filters: [
          { propertyName: "hs_task_status", operator: "EQ" as never, value: "COMPLETED" },
          { propertyName: dateProperty, operator: "GTE" as never, value: dateFilter },
          { propertyName: "hubspot_owner_id", operator: "IN" as never, values: ALL_OWNER_IDS },
        ],
      }],
      properties: [
        "hs_task_subject",
        "hubspot_owner_id",
        "hs_task_completion_date",
        "hs_lastmodifieddate",
      ],
      limit: 200,
    } as never);

    // Fallback: if hs_task_completion_date returned nothing, retry with hs_lastmodifieddate
    if (((response as { total?: number }).total ?? 0) === 0) {
      dateProperty = "hs_lastmodifieddate";
      response = await hubspotClient.crm.objects.tasks.searchApi.doSearch({
        filterGroups: [{
          filters: [
            { propertyName: "hs_task_status", operator: "EQ" as never, value: "COMPLETED" },
            { propertyName: dateProperty, operator: "GTE" as never, value: dateFilter },
            { propertyName: "hubspot_owner_id", operator: "IN" as never, values: ALL_OWNER_IDS },
          ],
        }],
        properties: [
          "hs_task_subject",
          "hubspot_owner_id",
          "hs_task_completion_date",
          "hs_lastmodifieddate",
        ],
        limit: 200,
      } as never);
    }

    const tasks: CompletedTask[] = [];
    const MAX_ASSOCIATION_LOOKUPS = 50;
    let associationLookups = 0;

    for (const task of (response as { results?: Array<{ id: string; properties: Record<string, string> }> }).results ?? []) {
      const ownerId = task.properties.hubspot_owner_id ?? "";
      const completedTask: CompletedTask = {
        taskId: task.id,
        subject: task.properties.hs_task_subject ?? "(no subject)",
        ownerId,
        ownerName: OWNER_NAME_MAP.get(ownerId) ?? "Unknown",
        completedAt: task.properties.hs_task_completion_date ?? task.properties.hs_lastmodifieddate ?? null,
        associatedDealId: null,
        associatedDealName: null,
      };

      // Resolve deal association
      if (associationLookups < MAX_ASSOCIATION_LOOKUPS) {
        try {
          const assoc = await hubspotClient.crm.objects.tasks.associationsApi.getAll(
            task.id, "deals"
          );
          const dealAssoc = (assoc.results ?? [])[0];
          if (dealAssoc) {
            completedTask.associatedDealId = dealAssoc.id ?? (dealAssoc as unknown as { toObjectId: string }).toObjectId;
          }
          associationLookups++;
        } catch {
          // Best-effort — skip association
        }
      }

      tasks.push(completedTask);
    }

    // Batch-resolve deal names for tasks that have deal associations
    const dealIds = tasks
      .map((t) => t.associatedDealId)
      .filter((id): id is string => id != null);

    if (dealIds.length > 0) {
      try {
        const batchResponse = await hubspotClient.crm.deals.batchApi.read({
          inputs: dealIds.map((id) => ({ id })),
          properties: ["dealname"],
          propertiesWithHistory: [],
        });
        const nameMap = new Map(
          (batchResponse.results ?? []).map((d) => [d.id, d.properties.dealname ?? ""])
        );
        for (const task of tasks) {
          if (task.associatedDealId) {
            task.associatedDealName = nameMap.get(task.associatedDealId) ?? null;
          }
        }
      } catch {
        // Best-effort — deal names stay null
      }
    }

    return { tasks };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[eod] Task query failed: ${msg}`);
    return { tasks: [], error: msg };
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/eod-summary/tasks.ts
git commit -m "feat(eod): HubSpot completed-task search for tracked leads"
```

---

### Task 7: Build orchestration and idempotency

**Files:**
- Create: `src/lib/eod-summary/send.ts`

- [ ] **Step 1: Implement send orchestrator**

```typescript
// src/lib/eod-summary/send.ts
//
// EOD summary orchestration: load snapshot, query evening state, diff,
// enrich milestones, query tasks, build email, send.

import { sendEmailMessage } from "@/lib/email";
import { prisma } from "@/lib/db";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { MANAGER_EMAIL, PI_LEADS, DESIGN_LEADS } from "./config";
import {
  queryAllBroad,
  loadSnapshot,
  diffSnapshots,
  cleanupOldSnapshots,
} from "./snapshot";
import { detectMilestones, enrichMilestones, clearUserIdMapCache } from "./milestones";
import { queryCompletedTasks } from "./tasks";
import { buildEodEmail } from "./html";

// ── Types ──────────────────────────────────────────────────────────────

export interface EodSummaryResult {
  emailSent: boolean;
  changeCount: number;
  milestoneCount: number;
  taskCount: number;
  newDealCount: number;
  resolvedDealCount: number;
  errors: string[];
  skippedReason?: string;
}

// ── Idempotency ────────────────────────────────────────────────────────

function getTodayKey(): string {
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Denver" });
  return `eod-summary:${date}`;
}

async function checkAndClaimKey(dryRun: boolean): Promise<{ alreadySent: boolean }> {
  if (dryRun) return { alreadySent: false };
  if (!prisma) return { alreadySent: false };

  const key = getTodayKey();
  const scope = "eod-summary";

  try {
    await prisma.idempotencyKey.create({
      data: { key, scope, status: "processing", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    return { alreadySent: false };
  } catch {
    try {
      const reclaimed = await prisma.idempotencyKey.updateMany({
        where: { key, scope, status: "failed" },
        data: { status: "processing" },
      });
      return { alreadySent: reclaimed.count === 0 };
    } catch {
      return { alreadySent: false };
    }
  }
}

async function markKeyStatus(status: "completed" | "failed"): Promise<void> {
  if (!prisma) return;
  try {
    await prisma.idempotencyKey.update({
      where: { key_scope: { key: getTodayKey(), scope: "eod-summary" } },
      data: { status },
    });
  } catch {
    // Best-effort
  }
}

// ── Main orchestrator ──────────────────────────────────────────────────

export async function runEodSummary(options: { dryRun: boolean }): Promise<EodSummaryResult> {
  const { alreadySent } = await checkAndClaimKey(options.dryRun);
  if (alreadySent) {
    return {
      emailSent: false, changeCount: 0, milestoneCount: 0, taskCount: 0,
      newDealCount: 0, resolvedDealCount: 0, errors: [],
      skippedReason: "already sent today",
    };
  }

  clearUserIdMapCache();
  const errors: string[] = [];

  // Step 1: Load morning snapshot
  const morningData = await loadSnapshot();

  // Step 2: Query evening state (broad queries)
  const eveningResult = await queryAllBroad();

  // Step 3: Diff
  let diff;
  if (morningData) {
    diff = diffSnapshots(morningData.deals, eveningResult.deals, {
      failedOwnerIds: eveningResult.failedOwnerIds,
      dealOwnerMap: morningData.dealOwnerMap,
    });
  } else {
    errors.push("No morning baseline — diff unavailable");
    diff = { changes: [], newDeals: [], resolvedDeals: [] };
  }

  // Step 4: Detect and enrich milestones
  let milestones = detectMilestones(diff.changes);
  try {
    milestones = await enrichMilestones(milestones);
  } catch (err) {
    errors.push(`Milestone enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Step 5: Query completed tasks
  const taskResult = await queryCompletedTasks();
  if (taskResult.error) errors.push(`Task query: ${taskResult.error}`);

  // Step 6: Build stage map for display names
  const stageMap = await buildStageDisplayMap();

  // Step 7: Compute "still in scope" count
  const morningDealCount = morningData ? morningData.deals.size : 0;
  const stillInScopeCount = morningData
    ? [...morningData.deals.keys()].filter((id) => eveningResult.deals.has(id)).length
    : 0;

  // Step 8: Build lead → owner mapping for grouping changes by lead
  const ownerNameMap = new Map<string, string>();
  for (const lead of [...PI_LEADS, ...DESIGN_LEADS]) {
    ownerNameMap.set(lead.hubspotOwnerId, lead.name);
  }

  // Step 9: Build and send email
  const html = buildEodEmail({
    changes: diff.changes,
    milestones,
    tasks: taskResult.tasks,
    newDeals: diff.newDeals,
    resolvedDeals: diff.resolvedDeals,
    stageMap,
    morningDealCount,
    stillInScopeCount,
    errors,
    dryRun: options.dryRun,
    dealOwners: eveningResult.dealOwners,
    ownerNameMap,
  });

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    timeZone: "America/Denver",
  });
  const subjectPrefix = options.dryRun ? "[DRY RUN] " : "";
  const subject = `${subjectPrefix}EOD Summary — Design / P&I — ${dateStr}`;

  const emailResult = await sendEmailMessage({
    to: MANAGER_EMAIL,
    subject,
    html,
    text: `EOD Summary — ${diff.changes.length} changes, ${milestones.length} milestones, ${taskResult.tasks.length} tasks.`,
  });

  if (!emailResult.success) {
    errors.push(`Email send: ${emailResult.error}`);
  }

  // Step 10: Cleanup old snapshots (best-effort)
  try {
    await cleanupOldSnapshots();
  } catch {
    // Non-critical
  }

  // Mark idempotency
  if (!options.dryRun) {
    await markKeyStatus(emailResult.success ? "completed" : "failed");
  }

  return {
    emailSent: emailResult.success,
    changeCount: diff.changes.length,
    milestoneCount: milestones.length,
    taskCount: taskResult.tasks.length,
    newDealCount: diff.newDeals.length,
    resolvedDealCount: diff.resolvedDeals.length,
    errors,
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: Will fail (html.ts not yet created). That's expected — we build it next.

- [ ] **Step 3: Commit**

```bash
git add src/lib/eod-summary/send.ts
git commit -m "feat(eod): orchestration with idempotency, snapshot diff, and task query"
```

---

## Chunk 3: Email Builder + Cron Route

### Task 8: Build HTML email builder

**Files:**
- Create: `src/lib/eod-summary/html.ts`

- [ ] **Step 1: Implement email builder**

This is the largest file. Follow the existing `daily-focus/html.ts` patterns: inline styles only, `escapeHtml()` utility, `renderEmailWrapper()` for consistent branding, `getHubSpotDealUrl()` for deal links.

```typescript
// src/lib/eod-summary/html.ts
//
// HTML email builder for the EOD summary. Follows daily-focus/html.ts
// patterns: inline styles, escapeHtml, renderEmailWrapper, deal links.

import { getHubSpotDealUrl } from "@/lib/external-links";
import { getStatusDisplayName } from "@/lib/daily-focus/format";
import { PIPELINE_SUFFIXES, PROPERTY_TO_DEPARTMENT, FIELD_TO_HS_PROPERTY } from "./config";
import type { StatusChange, SnapshotDeal } from "./snapshot";
import type { MilestoneHit } from "./milestones";
import type { CompletedTask } from "./tasks";

// ── Helpers ────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pipelineSuffix(pipelineId: string): string {
  return PIPELINE_SUFFIXES[pipelineId] ?? "";
}

function dealLink(dealId: string, dealName: string): string {
  const url = getHubSpotDealUrl(dealId);
  return `<a href="${url}" style="color:#3b82f6;text-decoration:none;">${esc(dealName)}</a>`;
}

function stageDisplay(stageId: string, pipelineId: string, stageMap: Record<string, string>): string {
  const name = stageMap[stageId] ?? stageId;
  // stageMap already includes pipeline suffix from buildStageDisplayMap
  return esc(name);
}

// ── Section styles ─────────────────────────────────────────────────────

const SECTION_HEADER = `font-size:13px;font-weight:600;color:#f97316;border-bottom:1px solid #27272a;padding-bottom:4px;margin:20px 0 8px 0;text-transform:uppercase;letter-spacing:0.5px;`;
const MILESTONE_BORDER = `border-left:3px solid #22c55e;padding-left:12px;margin:8px 0;`;
const CHANGE_ITEM = `margin:6px 0;font-size:13px;line-height:1.4;`;
const MUTED = `color:#a1a1aa;font-size:11px;`;
const BADGE = `display:inline-block;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:500;`;

// ── Build email ────────────────────────────────────────────────────────

export interface EodEmailData {
  changes: StatusChange[];
  milestones: MilestoneHit[];
  tasks: CompletedTask[];
  newDeals: SnapshotDeal[];
  resolvedDeals: SnapshotDeal[];
  stageMap: Record<string, string>;
  morningDealCount: number;
  stillInScopeCount: number;
  errors: string[];
  dryRun: boolean;
  dealOwners: Map<string, Set<string>>;
  ownerNameMap: Map<string, string>;
}

export function buildEodEmail(data: EodEmailData): string {
  const parts: string[] = [];

  // Dry-run banner
  if (data.dryRun) {
    parts.push(`<div style="background:#fef3c7;border:2px solid #f59e0b;border-radius:4px;padding:8px 12px;margin-bottom:12px;font-size:12px;"><strong>DRY RUN</strong> — This is a preview</div>`);
  }

  // Headline stats
  const allQuiet = data.changes.length === 0 && data.milestones.length === 0 && data.tasks.length === 0
    && data.newDeals.length === 0 && data.resolvedDeals.length === 0;

  if (allQuiet) {
    parts.push(`<p style="font-size:14px;color:#a1a1aa;">All quiet — no status changes, milestones, or task completions today.</p>`);
  } else {
    const stats = [
      data.changes.length > 0 ? `${data.changes.length} status change${data.changes.length !== 1 ? "s" : ""}` : null,
      data.milestones.length > 0 ? `${data.milestones.length} milestone${data.milestones.length !== 1 ? "s" : ""}` : null,
      data.tasks.length > 0 ? `${data.tasks.length} task${data.tasks.length !== 1 ? "s" : ""} completed` : null,
    ].filter(Boolean);
    parts.push(`<p style="font-size:14px;color:#d4d4d8;">${stats.join(" · ")}</p>`);
  }

  // Milestones
  if (data.milestones.length > 0) {
    parts.push(`<div style="${SECTION_HEADER}">Milestones</div>`);
    // Sort by raw ISO timestamp desc (most recent first), nulls last
    const sorted = [...data.milestones].sort((a, b) => {
      if (!a.changedAtIso && !b.changedAtIso) return 0;
      if (!a.changedAtIso) return 1;
      if (!b.changedAtIso) return -1;
      return b.changedAtIso.localeCompare(a.changedAtIso);
    });
    for (const m of sorted) {
      const loc = m.change.pbLocation ? ` | ${esc(m.change.pbLocation)}` : "";
      const suffix = pipelineSuffix(m.change.pipeline);
      const attribution = [m.changedBy, m.changedAt].filter(Boolean).join(" · ");
      parts.push(`<div style="${MILESTONE_BORDER}">
        <div style="${CHANGE_ITEM}">★ ${dealLink(m.change.dealId, m.change.dealName)}${esc(loc)}${esc(suffix)}</div>
        <div style="${MUTED}">${esc(m.displayLabel)} (was: ${esc(getStatusDisplayName(m.change.from ?? "—", m.change.hsProperty))})</div>
        ${attribution ? `<div style="${MUTED}">${esc(attribution)}</div>` : ""}
      </div>`);
    }
  }

  // Status changes by department
  if (data.changes.length > 0) {
    // Group: department → ownerId → changes
    const byDept = new Map<string, Map<string, StatusChange[]>>();
    for (const change of data.changes) {
      const dept = PROPERTY_TO_DEPARTMENT[change.hsProperty] ?? "Other";
      if (!byDept.has(dept)) byDept.set(dept, new Map());
      const deptMap = byDept.get(dept)!;

      // Find the owner for this deal from evening query
      const owners = data.dealOwners.get(change.dealId);
      const ownerId = owners ? [...owners][0] : "unknown";
      if (!deptMap.has(ownerId)) deptMap.set(ownerId, []);
      deptMap.get(ownerId)!.push(change);
    }

    for (const [dept, ownerChanges] of byDept) {
      parts.push(`<div style="${SECTION_HEADER}">${esc(dept)}</div>`);
      for (const [ownerId, changes] of ownerChanges) {
        const ownerName = data.ownerNameMap.get(ownerId) ?? "Unknown";
        parts.push(`<div style="font-size:12px;font-weight:600;color:#e4e4e7;margin:10px 0 4px 0;">${esc(ownerName)}</div>`);
        for (const c of changes.sort((a, b) => a.dealName.localeCompare(b.dealName))) {
          const loc = c.pbLocation ? ` | ${esc(c.pbLocation)}` : "";
          const suffix = pipelineSuffix(c.pipeline);
          const fromDisplay = getStatusDisplayName(c.from ?? "—", c.hsProperty);
          const toDisplay = getStatusDisplayName(c.to ?? "—", c.hsProperty);
          parts.push(`<div style="${CHANGE_ITEM}">
            • ${dealLink(c.dealId, c.dealName)}${esc(loc)}${esc(suffix)}<br>
            <span style="${MUTED}">${esc(c.hsProperty)}: ${esc(fromDisplay)} → ${esc(toDisplay)}</span>
          </div>`);
        }
      }
    }
  }

  // New deals entering scope
  if (data.newDeals.length > 0) {
    parts.push(`<div style="${SECTION_HEADER}">New Deals In Scope</div>`);
    for (const d of data.newDeals.sort((a, b) => a.dealName.localeCompare(b.dealName))) {
      const loc = d.pbLocation ? ` | ${esc(d.pbLocation)}` : "";
      const stage = data.stageMap[d.dealStage] ?? d.dealStage;
      parts.push(`<div style="${CHANGE_ITEM}">+ ${dealLink(d.dealId, d.dealName)}${esc(loc)} — entered ${esc(stage)}</div>`);
    }
  }

  // Deals resolved
  if (data.resolvedDeals.length > 0) {
    parts.push(`<div style="${SECTION_HEADER}">Deals Resolved</div>`);
    for (const d of data.resolvedDeals.sort((a, b) => a.dealName.localeCompare(b.dealName))) {
      const loc = d.pbLocation ? ` | ${esc(d.pbLocation)}` : "";
      parts.push(`<div style="${CHANGE_ITEM}">✓ ${dealLink(d.dealId, d.dealName)}${esc(loc)}</div>`);
    }
  }

  // Tasks completed
  if (data.tasks.length > 0) {
    parts.push(`<div style="${SECTION_HEADER}">Tasks Completed</div>`);
    // Group by owner
    const byOwner = new Map<string, CompletedTask[]>();
    for (const t of data.tasks) {
      if (!byOwner.has(t.ownerId)) byOwner.set(t.ownerId, []);
      byOwner.get(t.ownerId)!.push(t);
    }
    for (const [ownerId, tasks] of byOwner) {
      const name = data.ownerNameMap.get(ownerId) ?? tasks[0]?.ownerName ?? "Unknown";
      parts.push(`<div style="font-size:12px;font-weight:600;color:#e4e4e7;margin:10px 0 4px 0;">${esc(name)} — ${tasks.length} task${tasks.length !== 1 ? "s" : ""}</div>`);
      for (const t of tasks) {
        const dealRef = t.associatedDealId && t.associatedDealName
          ? ` (${dealLink(t.associatedDealId, t.associatedDealName)})`
          : "";
        parts.push(`<div style="${CHANGE_ITEM}">✓ ${esc(t.subject)}${dealRef}</div>`);
      }
    }
  }

  // Still pending
  if (data.morningDealCount > 0) {
    parts.push(`<div style="margin-top:20px;padding-top:12px;border-top:1px solid #27272a;">
      <span style="${MUTED}">Morning focus had ${data.morningDealCount} deals across the team · ${data.stillInScopeCount} still in scope</span>
    </div>`);
  }

  // Errors
  if (data.errors.length > 0) {
    parts.push(`<div style="background:#1c1917;border:1px solid #7f1d1d;border-radius:4px;padding:8px 12px;margin-top:16px;font-size:11px;color:#fca5a5;">
      <strong>Warnings:</strong>
      <ul style="margin:4px 0 0;padding-left:16px;">${data.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
    </div>`);
  }

  // Timestamp footer
  const timeStr = new Date().toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
    timeZone: "America/Denver",
  });
  parts.push(`<div style="margin-top:16px;${MUTED}">Generated at ${esc(timeStr)} · Powered by PB Operations Suite</div>`);

  // Wrap in email shell (matches daily-focus wrapper but with EOD-specific footer)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:24px 16px;">
  <div style="text-align:center;margin-bottom:20px;">
    <span style="font-size:18px;font-weight:700;background:linear-gradient(to right,#f97316,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">PB Operations</span>
    <span style="font-size:12px;color:#71717a;margin-left:8px;">EOD Summary</span>
  </div>
  <div style="background:#12121a;border-radius:8px;padding:20px;color:#e4e4e7;font-size:13px;line-height:1.5;">
    ${parts.join("\n")}
  </div>
</div>
</body></html>`;
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors (send.ts + html.ts now both resolve).

- [ ] **Step 3: Commit**

```bash
git add src/lib/eod-summary/html.ts
git commit -m "feat(eod): HTML email builder for EOD summary"
```

---

### Task 9: Build cron route

**Files:**
- Create: `src/app/api/cron/eod-summary/route.ts`

- [ ] **Step 1: Implement route handler**

```typescript
// src/app/api/cron/eod-summary/route.ts
//
// Vercel cron: weekdays at 23:00 UTC (5 PM MDT / 4 PM MST)
// Sends EOD summary email to manager with day's activity diff.

import { NextRequest, NextResponse } from "next/server";
import { runEodSummary } from "@/lib/eod-summary/send";
import { sendCronHealthAlert } from "@/lib/audit/alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  try {
    const result = await runEodSummary({ dryRun });

    return NextResponse.json({
      dryRun,
      emailSent: result.emailSent,
      changeCount: result.changeCount,
      milestoneCount: result.milestoneCount,
      taskCount: result.taskCount,
      newDealCount: result.newDealCount,
      resolvedDealCount: result.resolvedDealCount,
      skippedReason: result.skippedReason ?? null,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[eod-summary] Cron failed: ${msg}`);

    try {
      await sendCronHealthAlert("eod-summary", msg);
    } catch {
      // Best-effort
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/eod-summary/route.ts
git commit -m "feat(eod): cron route handler for EOD summary"
```

---

### Task 10: Vercel config + dry-run test

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add cron schedule and function config**

Add to the `crons` array:
```json
{
  "path": "/api/cron/eod-summary",
  "schedule": "0 23 * * 1-5"
}
```

Add to the `functions` object:
```json
"src/app/api/cron/eod-summary/route.ts": {
  "maxDuration": 300
}
```

Bump the daily-focus maxDuration from 180 to 300:
```json
"src/app/api/cron/daily-focus/route.ts": {
  "maxDuration": 300
}
```

- [ ] **Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(eod): add cron schedule and bump maxDuration for snapshot writes"
```

- [ ] **Step 4: Test dry-run locally**

Run the local dev server and hit the endpoint:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/eod-summary?dryRun=true"
```

Expected: JSON response with `emailSent: true` (or `false` if no morning snapshot exists yet — that's fine for first run). Check Zach's inbox for the email.

**If no morning snapshot exists:** First trigger the daily-focus cron to create one:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" "http://localhost:3000/api/cron/daily-focus?dryRun=true"
```
Wait for it to complete, then re-run the EOD summary.

- [ ] **Step 5: Verify email received and content looks correct**

Check inbox for `[DRY RUN] EOD Summary — Design / P&I — {date}`. Verify:
- Headline stats row is present
- Status changes show before → after
- Milestones (if any) show deal name, what changed, who/when
- Tasks (if any) are grouped by lead
- Deal links point to correct HubSpot URLs
- Pipeline suffixes (D&R, Service, Roofing) appear where expected
- "Morning focus had X deals" footer is present (or "No morning baseline" warning)

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "feat(eod): dry-run verified — EOD summary email working"
```
