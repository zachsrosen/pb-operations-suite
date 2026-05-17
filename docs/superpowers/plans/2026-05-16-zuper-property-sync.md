# Zuper Property Sync (Write Direction) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push property-level data (system size, install date, equipment summary, AHJ/utility, Shovels data) from HubSpotPropertyCache into Zuper's native Property module so field techs see property context on their mobile app.

**Architecture:** A cron job (every 15 min) detects dirty properties via `updatedAt > zuperPropertySyncedAt`, creates/updates Zuper Property objects with 10 custom fields using the read-merge-write pattern (to avoid clobbering), and links associated jobs. A one-time backfill script handles the existing ~1,998 properties.

**Tech Stack:** Next.js API route (cron), Prisma migration, Zuper REST API (`/api/property`, `/api/jobs`), existing `mergeZuperMetaData()` from `zuper-catalog.ts`.

**Spec:** `docs/superpowers/specs/2026-05-16-zuper-property-sync-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `prisma/schema.prisma` | Add 3 columns to `HubSpotPropertyCache` |
| `prisma/migrations/YYYYMMDD_add_zuper_property_sync/migration.sql` | Additive migration |
| `src/lib/zuper-property-sync.ts` | **NEW** — field mapping, create/update Zuper Property, link jobs, batch sync orchestration |
| `src/__tests__/zuper-property-sync.test.ts` | **NEW** — unit tests for field mapping and merge logic |
| `src/app/api/cron/zuper-property-sync/route.ts` | **NEW** — cron endpoint (auth, feature flag, batch processing, time budget) |
| `scripts/backfill-zuper-properties.ts` | **NEW** — one-time backfill script with --dry-run and --limit flags |
| `src/middleware.ts` | Add route to `PUBLIC_API_ROUTES` |
| `vercel.json` | Add cron schedule + maxDuration |
| `src/lib/zuper.ts` | Add `property` field to job creation payload when available |

---

## Chunk 1: Schema + Core Sync Library

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma` (line ~834, before `lastReconciledAt`)
- Create: `prisma/migrations/20260516200000_add_zuper_property_sync/migration.sql`

- [ ] **Step 1: Add columns to `HubSpotPropertyCache` model in schema.prisma**

Insert before the `lastReconciledAt` line (after `shovelsRetryCount`):

```prisma
  // Zuper Property sync (write direction)
  zuperPropertyUid      String?   @unique
  zuperPropertySyncedAt DateTime?
  zuperSyncFailCount    Int       @default(0)
```

- [ ] **Step 2: Create the migration SQL file**

Create `prisma/migrations/20260516200000_add_zuper_property_sync/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "HubSpotPropertyCache" ADD COLUMN "zuperPropertyUid" TEXT,
ADD COLUMN "zuperPropertySyncedAt" TIMESTAMP(3),
ADD COLUMN "zuperSyncFailCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "HubSpotPropertyCache_zuperPropertyUid_key" ON "HubSpotPropertyCache"("zuperPropertyUid");
```

- [ ] **Step 3: Run `npx prisma generate` to regenerate the client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" success message.

- [ ] **Step 4: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260516200000_add_zuper_property_sync/
git commit -m "chore: add zuperPropertyUid, zuperPropertySyncedAt, zuperSyncFailCount to HubSpotPropertyCache"
```

---

### Task 2: Core Sync Library — Field Mapping + Create/Update Logic

**Files:**
- Create: `src/lib/zuper-property-sync.ts`
- Test: `src/__tests__/zuper-property-sync.test.ts`

- [ ] **Step 1: Write failing tests for `buildPropertyCustomFields`**

Create `src/__tests__/zuper-property-sync.test.ts`:

```typescript
import {
  buildPropertyCustomFields,
  ZUPER_PROPERTY_FIELD_LABELS,
} from "@/lib/zuper-property-sync";

describe("buildPropertyCustomFields", () => {
  it("maps a fully populated property to 10 custom field entries", () => {
    const property = {
      systemSizeKwDc: 8.4,
      hasBattery: true,
      hasEvCharger: false,
      firstInstallDate: new Date("2024-03-15"),
      yearBuilt: 1998,
      squareFootage: 2400,
      stories: 2,
      pbLocation: "DTC",
      ahjName: "El Paso County",
      utilityName: "Colorado Springs Utilities",
    };

    const fields = buildPropertyCustomFields(property);

    expect(fields).toHaveLength(10);
    expect(fields.find((f) => f.label === "System Size (kW)")?.value).toBe("8.4");
    expect(fields.find((f) => f.label === "Has Battery")?.value).toBe("Yes");
    expect(fields.find((f) => f.label === "Has EV Charger")?.value).toBe("No");
    expect(fields.find((f) => f.label === "Install Date")?.value).toBe("2024-03-15");
    expect(fields.find((f) => f.label === "Year Built")?.value).toBe("1998");
    expect(fields.find((f) => f.label === "Square Footage")?.value).toBe("2400");
    expect(fields.find((f) => f.label === "Stories")?.value).toBe("2");
    expect(fields.find((f) => f.label === "PB Location")?.value).toBe("DTC");
    expect(fields.find((f) => f.label === "AHJ")?.value).toBe("El Paso County");
    expect(fields.find((f) => f.label === "Utility")?.value).toBe("Colorado Springs Utilities");
  });

  it("handles null/missing fields with empty strings", () => {
    const property = {
      systemSizeKwDc: null,
      hasBattery: false,
      hasEvCharger: false,
      firstInstallDate: null,
      yearBuilt: null,
      squareFootage: null,
      stories: null,
      pbLocation: null,
      ahjName: null,
      utilityName: null,
    };

    const fields = buildPropertyCustomFields(property);

    expect(fields).toHaveLength(10);
    expect(fields.find((f) => f.label === "System Size (kW)")?.value).toBe("N/A");
    expect(fields.find((f) => f.label === "Has Battery")?.value).toBe("No");
    expect(fields.find((f) => f.label === "Install Date")?.value).toBe("");
    expect(fields.find((f) => f.label === "Year Built")?.value).toBe("");
    expect(fields.find((f) => f.label === "Square Footage")?.value).toBe("");
  });

  it("exports all 10 field labels", () => {
    expect(ZUPER_PROPERTY_FIELD_LABELS).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/zuper-property-sync.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `buildPropertyCustomFields` in `src/lib/zuper-property-sync.ts`**

```typescript
/**
 * src/lib/zuper-property-sync.ts
 *
 * Syncs HubSpotPropertyCache data → Zuper Property module.
 * Creates/updates Zuper Property objects and links jobs.
 */

import { prisma } from "@/lib/db";
import { mergeZuperMetaData, type ZuperMetaDataEntry } from "@/lib/zuper-catalog";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const INTER_OP_DELAY_MS = 200;

export const ZUPER_PROPERTY_FIELD_LABELS = [
  "System Size (kW)",
  "Has Battery",
  "Has EV Charger",
  "Install Date",
  "Year Built",
  "Square Footage",
  "Stories",
  "PB Location",
  "AHJ",
  "Utility",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PropertyFieldSource {
  systemSizeKwDc: number | null;
  hasBattery: boolean;
  hasEvCharger: boolean;
  firstInstallDate: Date | null;
  yearBuilt: number | null;
  squareFootage: number | null;
  stories: number | null;
  pbLocation: string | null;
  ahjName: string | null;
  utilityName: string | null;
}

export interface SyncPropertyResult {
  propertyId: string;
  zuperPropertyUid: string;
  action: "created" | "updated" | "skipped";
  jobsLinked: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the 10 Zuper custom field entries from a HubSpotPropertyCache record.
 * All values are stringified per Zuper's meta_data format.
 */
export function buildPropertyCustomFields(property: PropertyFieldSource): ZuperMetaDataEntry[] {
  const str = (v: unknown): string => (v != null && v !== "" ? String(v) : "");
  const dateStr = (d: Date | null): string => {
    if (!d) return "";
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  };

  return [
    { label: "System Size (kW)", value: property.systemSizeKwDc != null ? String(property.systemSizeKwDc) : "N/A", type: "SINGLE_LINE" },
    { label: "Has Battery", value: property.hasBattery ? "Yes" : "No", type: "SINGLE_LINE" },
    { label: "Has EV Charger", value: property.hasEvCharger ? "Yes" : "No", type: "SINGLE_LINE" },
    { label: "Install Date", value: dateStr(property.firstInstallDate), type: "SINGLE_LINE" },
    { label: "Year Built", value: str(property.yearBuilt), type: "SINGLE_LINE" },
    { label: "Square Footage", value: str(property.squareFootage), type: "SINGLE_LINE" },
    { label: "Stories", value: str(property.stories), type: "SINGLE_LINE" },
    { label: "PB Location", value: str(property.pbLocation), type: "SINGLE_LINE" },
    { label: "AHJ", value: str(property.ahjName), type: "SINGLE_LINE" },
    { label: "Utility", value: str(property.utilityName), type: "SINGLE_LINE" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Zuper API Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function zuperFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = process.env.ZUPER_API_KEY;
  if (!apiKey) throw new Error("ZUPER_API_KEY not set");

  const res = await fetch(`${ZUPER_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Zuper API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 200)}`);
  }

  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Update Zuper Property
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new Zuper Property. Returns the created property UID.
 */
export async function createZuperProperty(
  address: { street: string; city: string; state: string; zip: string },
  customFields: ZuperMetaDataEntry[],
): Promise<string> {
  const propertyName = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;

  const res = await zuperFetch("/property", {
    method: "POST",
    body: JSON.stringify({
      property: {
        property_name: propertyName,
        property_address: {
          street: address.street,
          city: address.city,
          state: address.state,
          zip_code: address.zip,
          country: "US",
        },
        custom_fields: customFields,
      },
    }),
  });

  const data = await res.json();
  // Zuper returns { type: "success", data: { property_uid: "..." } } on create
  const uid = data?.data?.property_uid ?? data?.data?.uid;
  if (!uid) throw new Error(`Zuper create property returned no UID: ${JSON.stringify(data).slice(0, 200)}`);
  return uid;
}

/**
 * Update an existing Zuper Property's custom fields using read-merge-write.
 * This preserves any fields we don't manage (e.g. manually added by techs).
 */
export async function updateZuperProperty(
  zuperPropertyUid: string,
  newFields: ZuperMetaDataEntry[],
): Promise<void> {
  // 1. Read existing fields
  const readRes = await zuperFetch(`/property/${zuperPropertyUid}`);
  const readData = await readRes.json();
  const existingFields = readData?.data?.custom_fields ?? readData?.data?.property?.custom_fields ?? [];

  // 2. Merge (preserves fields we don't own, updates ours)
  const merged = mergeZuperMetaData(existingFields, newFields);

  // 3. Write full array back
  await zuperFetch(`/property/${zuperPropertyUid}`, {
    method: "PUT",
    body: JSON.stringify({
      property: {
        custom_fields: merged,
      },
    }),
  });
}

/**
 * Link a Zuper job to a Zuper Property by setting the property field on the job.
 */
export async function linkJobToProperty(jobUid: string, zuperPropertyUid: string): Promise<void> {
  await zuperFetch("/jobs", {
    method: "PUT",
    body: JSON.stringify({
      job: {
        job_uid: jobUid,
        property: zuperPropertyUid,
      },
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync a single property to Zuper: create or update the Zuper Property,
 * then link any unlinked jobs. Returns the result.
 */
export async function syncPropertyToZuper(propertyCacheId: string): Promise<SyncPropertyResult> {
  const property = await prisma.hubSpotPropertyCache.findUniqueOrThrow({
    where: { id: propertyCacheId },
    include: { dealLinks: true },
  });

  const fields = buildPropertyCustomFields({
    systemSizeKwDc: property.systemSizeKwDc,
    hasBattery: property.hasBattery,
    hasEvCharger: property.hasEvCharger,
    firstInstallDate: property.firstInstallDate,
    yearBuilt: property.yearBuilt,
    squareFootage: property.squareFootage,
    stories: property.stories,
    pbLocation: property.pbLocation,
    ahjName: property.ahjName,
    utilityName: property.utilityName,
  });

  let zuperPropertyUid = property.zuperPropertyUid;
  let action: "created" | "updated" | "skipped";

  if (!zuperPropertyUid) {
    // Create new Zuper Property
    zuperPropertyUid = await createZuperProperty(
      {
        street: property.streetAddress,
        city: property.city,
        state: property.state,
        zip: property.zip,
      },
      fields,
    );
    action = "created";
  } else {
    // Update existing
    await updateZuperProperty(zuperPropertyUid, fields);
    action = "updated";
  }

  // Update cache with UID + sync timestamp + reset fail count
  await prisma.hubSpotPropertyCache.update({
    where: { id: propertyCacheId },
    data: {
      zuperPropertyUid,
      zuperPropertySyncedAt: new Date(),
      zuperSyncFailCount: 0,
    },
  });

  // Link unlinked jobs (cap at 10 per sync to stay within time budget)
  const dealIds = property.dealLinks.map((l) => l.dealId);
  let jobsLinked = 0;

  if (dealIds.length > 0) {
    const zuperJobs = await prisma.zuperJobCache.findMany({
      where: { hubspotDealId: { in: dealIds } },
      select: { jobUid: true, rawData: true },
      take: 10,
    });

    for (const job of zuperJobs) {
      // Check if job already has a property linked
      const raw = job.rawData as Record<string, unknown> | null;
      const existingProp = raw?.property ?? raw?.property_uid;
      if (existingProp) continue;

      try {
        await linkJobToProperty(job.jobUid, zuperPropertyUid);
        jobsLinked++;
        await sleep(INTER_OP_DELAY_MS);
      } catch (err) {
        console.warn(`[zuper-property-sync] Failed to link job ${job.jobUid}:`, err);
      }
    }
  }

  return { propertyId: propertyCacheId, zuperPropertyUid, action, jobsLinked };
}

/**
 * Find properties that need syncing to Zuper.
 * A property is dirty when:
 *   - zuperPropertyUid is null (never synced), OR
 *   - updatedAt > zuperPropertySyncedAt (data changed since last sync)
 * Excludes poison rows (zuperSyncFailCount >= 5).
 */
export async function findDirtyProperties(limit: number) {
  return prisma.hubSpotPropertyCache.findMany({
    where: {
      zuperSyncFailCount: { lt: 5 },
      dealLinks: { some: {} }, // Only properties with deals (i.e., have Zuper jobs)
      OR: [
        { zuperPropertyUid: null },
        {
          zuperPropertySyncedAt: { not: null },
          updatedAt: { gt: prisma.hubSpotPropertyCache.fields.zuperPropertySyncedAt },
        },
        // Never synced but has a UID somehow (edge case from manual intervention)
        { zuperPropertySyncedAt: null, zuperPropertyUid: { not: null } },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
}
```

**Note:** The `findDirtyProperties` Prisma query comparing `updatedAt > zuperPropertySyncedAt` uses a raw comparison. Prisma doesn't support cross-column filters directly, so this will need a `$queryRaw` approach. We'll fix this in the next step.

- [ ] **Step 4: Fix `findDirtyProperties` to use raw SQL for cross-column comparison**

Replace the `findDirtyProperties` function body:

```typescript
export async function findDirtyProperties(limit: number): Promise<Array<{ id: string }>> {
  return prisma.$queryRaw<Array<{ id: string }>>`
    SELECT pc.id
    FROM "HubSpotPropertyCache" pc
    WHERE pc."zuperSyncFailCount" < 5
      AND EXISTS (SELECT 1 FROM "PropertyDealLink" pdl WHERE pdl."propertyId" = pc.id)
      AND (
        pc."zuperPropertyUid" IS NULL
        OR pc."zuperPropertySyncedAt" IS NULL
        OR pc."updatedAt" > pc."zuperPropertySyncedAt"
      )
    ORDER BY pc."updatedAt" ASC
    LIMIT ${limit}
  `;
}
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/__tests__/zuper-property-sync.test.ts --no-coverage`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/zuper-property-sync.ts src/__tests__/zuper-property-sync.test.ts
git commit -m "feat(zuper-property-sync): core sync library with field mapping, create/update, job linking"
```

---

## Chunk 2: Cron Route + Infrastructure Wiring

### Task 3: Cron Route

**Files:**
- Create: `src/app/api/cron/zuper-property-sync/route.ts`

- [ ] **Step 1: Create the cron route**

Create `src/app/api/cron/zuper-property-sync/route.ts`:

```typescript
/**
 * GET /api/cron/zuper-property-sync
 *
 * Picks up HubSpotPropertyCache records that are dirty (updatedAt > zuperPropertySyncedAt
 * or zuperPropertyUid is null) and syncs them to Zuper's Property module.
 * Runs every 15 minutes via Vercel Cron.
 *
 * Auth: CRON_SECRET bearer token.
 * Feature flag: ZUPER_PROPERTY_SYNC_ENABLED must be "true".
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findDirtyProperties, syncPropertyToZuper } from "@/lib/zuper-property-sync";

export const maxDuration = 300;

const BATCH_SIZE = 20;
const TIME_BUDGET_MS = 250_000; // Stop processing 50s before maxDuration

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ZUPER_PROPERTY_SYNC_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  const startTime = Date.now();
  const dirtyProperties = await findDirtyProperties(BATCH_SIZE);

  if (dirtyProperties.length === 0) {
    return NextResponse.json({ status: "idle", message: "no dirty properties" });
  }

  const results = { created: 0, updated: 0, errors: 0, jobsLinked: 0 };
  let processed = 0;
  let timedOut = false;

  for (const { id } of dirtyProperties) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    try {
      const result = await syncPropertyToZuper(id);
      if (result.action === "created") results.created++;
      else if (result.action === "updated") results.updated++;
      results.jobsLinked += result.jobsLinked;
      processed++;
    } catch (err) {
      results.errors++;
      processed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[zuper-property-sync-cron] Error syncing property ${id}:`, msg);

      // Increment fail count on the property
      await prisma.hubSpotPropertyCache.update({
        where: { id },
        data: { zuperSyncFailCount: { increment: 1 } },
      }).catch(() => {}); // Don't let the fail-count update itself fail the loop
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  return NextResponse.json({
    status: "ok",
    processed,
    ...results,
    timedOut,
    elapsed: `${elapsed}s`,
  });
}
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/zuper-property-sync/route.ts
git commit -m "feat(zuper-property-sync): add cron route with time budget and poison-row protection"
```

---

### Task 4: Middleware + vercel.json Wiring

**Files:**
- Modify: `src/middleware.ts` (line ~39, add to PUBLIC_API_ROUTES)
- Modify: `vercel.json` (add cron entry + function maxDuration)

- [ ] **Step 1: Add route to PUBLIC_API_ROUTES in middleware.ts**

Add to the `PUBLIC_API_ROUTES` array (after the `shovels-enrich` line):

```typescript
  "/api/cron/zuper-property-sync", // Zuper Property write sync — CRON_SECRET validated in route
```

- [ ] **Step 2: Add maxDuration to vercel.json functions section**

In the `"functions"` object, add after the `shovels-enrich` entry:

```json
    "src/app/api/cron/zuper-property-sync/route.ts": { "maxDuration": 300 },
```

- [ ] **Step 3: Add cron schedule to vercel.json crons array**

Add to the `"crons"` array:

```json
    {
      "path": "/api/cron/zuper-property-sync",
      "schedule": "*/15 * * * *"
    },
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/middleware.ts vercel.json
git commit -m "chore: wire zuper-property-sync cron route into middleware and vercel.json"
```

---

### Task 5: Job Creation Hook — Auto-Link New Jobs to Properties

**Files:**
- Modify: `src/lib/zuper.ts` (around line 2156, the `createJobFromProject` function)

- [ ] **Step 1: Add property lookup and pass to job payload**

In `createJobFromProject`, after the job object is built but before `zuper.createJob(job)` (around line 2156), add:

```typescript
  // Auto-link to Zuper Property if the deal's property has been synced
  if (process.env.ZUPER_PROPERTY_SYNC_ENABLED === "true") {
    try {
      const propertyLink = await prisma.propertyDealLink.findFirst({
        where: { dealId: String(project.id) },
        select: { property: { select: { zuperPropertyUid: true } } },
      });
      if (propertyLink?.property?.zuperPropertyUid) {
        (job as Record<string, unknown>).property = propertyLink.property.zuperPropertyUid;
      }
    } catch (err) {
      // Non-fatal — job creation proceeds without property link
      console.warn("[createJobFromProject] Failed to resolve Zuper property:", err);
    }
  }
```

Add the prisma import at the top of `zuper.ts` (it does NOT currently import prisma — this is required):

```typescript
import { prisma } from "@/lib/db";
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/zuper.ts
git commit -m "feat(zuper-property-sync): auto-link new jobs to Zuper Property at creation time"
```

---

## Chunk 3: Backfill Script

### Task 6: Backfill Script

**Files:**
- Create: `scripts/backfill-zuper-properties.ts`

- [ ] **Step 1: Create the backfill script**

```typescript
/**
 * scripts/backfill-zuper-properties.ts
 *
 * One-time backfill: creates Zuper Property objects for all HubSpotPropertyCache
 * records that have linked Zuper jobs, sets 10 custom fields, and links existing
 * jobs to the newly created properties.
 *
 * Resumable: checks zuperPropertyUid before creating, so re-running skips
 * already-synced properties.
 *
 * Usage:
 *   npx tsx scripts/backfill-zuper-properties.ts                  # full run
 *   npx tsx scripts/backfill-zuper-properties.ts --dry-run         # log only
 *   npx tsx scripts/backfill-zuper-properties.ts --limit=10        # 10 properties
 *   npx tsx scripts/backfill-zuper-properties.ts --skip-jobs       # skip job linking phase
 */

import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  buildPropertyCustomFields,
  createZuperProperty,
  linkJobToProperty,
  updateZuperProperty,
} from "../src/lib/zuper-property-sync";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_JOBS = process.argv.includes("--skip-jobs");
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? Number(arg.split("=")[1]) : Infinity;
})();
const INTER_OP_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: Create Zuper Properties
// ─────────────────────────────────────────────────────────────────────────────

async function createProperties(): Promise<{ created: number; skipped: number; failed: number }> {
  log("Phase 1: Creating Zuper Properties for HubSpotPropertyCache records with Zuper jobs...");

  // Find all properties with Zuper job links that haven't been synced yet
  const properties = await prisma.$queryRaw<
    Array<{
      id: string;
      streetAddress: string;
      city: string;
      state: string;
      zip: string;
      systemSizeKwDc: number | null;
      hasBattery: boolean;
      hasEvCharger: boolean;
      firstInstallDate: Date | null;
      yearBuilt: number | null;
      squareFootage: number | null;
      stories: number | null;
      pbLocation: string | null;
      ahjName: string | null;
      utilityName: string | null;
      zuperPropertyUid: string | null;
    }>
  >`
    SELECT DISTINCT
      pc.id, pc."streetAddress", pc.city, pc.state, pc.zip,
      pc."systemSizeKwDc", pc."hasBattery", pc."hasEvCharger",
      pc."firstInstallDate", pc."yearBuilt", pc."squareFootage",
      pc.stories, pc."pbLocation", pc."ahjName", pc."utilityName",
      pc."zuperPropertyUid"
    FROM "HubSpotPropertyCache" pc
    JOIN "PropertyDealLink" pdl ON pdl."propertyId" = pc.id
    JOIN "ZuperJobCache" zj ON zj."hubspotDealId" = pdl."dealId"
    ORDER BY pc.id
  `;

  log(`  Found ${properties.length} properties with Zuper jobs.`);

  const toProcess = properties.slice(0, LIMIT);
  const stats = { created: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < toProcess.length; i++) {
    const prop = toProcess[i];

    if (prop.zuperPropertyUid) {
      stats.skipped++;
      continue;
    }

    if (DRY_RUN) {
      log(`  [DRY RUN] Would create: ${prop.streetAddress}, ${prop.city} (${prop.id})`);
      stats.created++;
      continue;
    }

    try {
      const fields = buildPropertyCustomFields(prop);
      const uid = await createZuperProperty(
        { street: prop.streetAddress, city: prop.city, state: prop.state, zip: prop.zip },
        fields,
      );

      await prisma.hubSpotPropertyCache.update({
        where: { id: prop.id },
        data: {
          zuperPropertyUid: uid,
          zuperPropertySyncedAt: new Date(),
          zuperSyncFailCount: 0,
        },
      });

      stats.created++;
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`  ERROR creating property for ${prop.streetAddress}: ${msg.slice(0, 150)}`);
    }

    if ((i + 1) % 50 === 0) {
      log(`  Progress: ${i + 1}/${toProcess.length} (created=${stats.created}, skipped=${stats.skipped}, failed=${stats.failed})`);
    }

    await sleep(INTER_OP_DELAY_MS);
  }

  log(`  Phase 1 complete: ${stats.created} created, ${stats.skipped} skipped, ${stats.failed} failed.`);
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Link Jobs to Properties
// ─────────────────────────────────────────────────────────────────────────────

async function linkJobs(): Promise<{ linked: number; skipped: number; failed: number }> {
  log("Phase 2: Linking Zuper jobs to their properties...");

  // Find all Zuper jobs whose deals are linked to properties that have a zuperPropertyUid
  const jobsToLink = await prisma.$queryRaw<
    Array<{ jobUid: string; zuperPropertyUid: string; rawData: unknown }>
  >`
    SELECT zj."jobUid", pc."zuperPropertyUid", zj."rawData"
    FROM "ZuperJobCache" zj
    JOIN "PropertyDealLink" pdl ON pdl."dealId" = zj."hubspotDealId"
    JOIN "HubSpotPropertyCache" pc ON pc.id = pdl."propertyId"
    WHERE pc."zuperPropertyUid" IS NOT NULL
      AND zj."hubspotDealId" IS NOT NULL
  `;

  log(`  Found ${jobsToLink.length} jobs to check for property linking.`);

  const toProcess = jobsToLink.slice(0, LIMIT === Infinity ? jobsToLink.length : LIMIT);
  const stats = { linked: 0, skipped: 0, failed: 0 };

  for (let i = 0; i < toProcess.length; i++) {
    const job = toProcess[i];

    // Check if job already has a property linked via rawData
    const raw = job.rawData as Record<string, unknown> | null;
    const existingProp = raw?.property ?? raw?.property_uid;
    if (existingProp) {
      stats.skipped++;
      continue;
    }

    if (DRY_RUN) {
      log(`  [DRY RUN] Would link job ${job.jobUid} → property ${job.zuperPropertyUid}`);
      stats.linked++;
      continue;
    }

    try {
      await linkJobToProperty(job.jobUid, job.zuperPropertyUid);
      stats.linked++;
    } catch (err) {
      stats.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`  ERROR linking job ${job.jobUid}: ${msg.slice(0, 150)}`);
    }

    if ((i + 1) % 100 === 0) {
      log(`  Progress: ${i + 1}/${toProcess.length} (linked=${stats.linked}, skipped=${stats.skipped}, failed=${stats.failed})`);
    }

    await sleep(INTER_OP_DELAY_MS);
  }

  log(`  Phase 2 complete: ${stats.linked} linked, ${stats.skipped} skipped, ${stats.failed} failed.`);
  return stats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.ZUPER_PROPERTY_SYNC_ENABLED !== "true") {
    console.error("ZUPER_PROPERTY_SYNC_ENABLED is not 'true' — refusing to run.");
    process.exit(1);
  }

  log(`backfill-zuper-properties.ts starting (dryRun=${DRY_RUN}, limit=${LIMIT === Infinity ? "none" : LIMIT}, skipJobs=${SKIP_JOBS})`);

  const start = Date.now();

  const createStats = await createProperties();

  let linkStats = { linked: 0, skipped: 0, failed: 0 };
  if (!SKIP_JOBS) {
    linkStats = await linkJobs();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  log("=== SUMMARY ===");
  log(`  Elapsed: ${elapsed}s`);
  log(`  Properties: ${createStats.created} created, ${createStats.skipped} already synced, ${createStats.failed} failed`);
  if (!SKIP_JOBS) {
    log(`  Jobs: ${linkStats.linked} linked, ${linkStats.skipped} already linked, ${linkStats.failed} failed`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```

- [ ] **Step 2: Verify script compiles**

Run: `npx tsx --no-cache scripts/backfill-zuper-properties.ts --help 2>&1 | head -5` (should fail with ZUPER_PROPERTY_SYNC_ENABLED check, confirming it loads)
Expected: "ZUPER_PROPERTY_SYNC_ENABLED is not 'true' — refusing to run."

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-zuper-properties.ts
git commit -m "feat(zuper-property-sync): add backfill script with --dry-run and --limit flags"
```

---

## Chunk 4: Verification + Final Wiring

### Task 7: Integration Test — Dry-Run Verification

**Files:** None (uses existing script)

- [ ] **Step 1: Run backfill with --dry-run --limit=5 to verify field mapping**

Run: `ZUPER_PROPERTY_SYNC_ENABLED=true npx tsx scripts/backfill-zuper-properties.ts --dry-run --limit=5`
Expected: 5 properties listed with "[DRY RUN] Would create..." messages, no API errors.

- [ ] **Step 2: Verify build passes**

Run: `npm run build 2>&1 | tail -10`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Run all tests**

Run: `npx jest --no-coverage --passWithNoTests 2>&1 | tail -10`
Expected: All tests pass.

---

### Task 8: Environment Variable Documentation

**Files:**
- Modify: `.env.example` (add ZUPER_PROPERTY_SYNC_ENABLED)

- [ ] **Step 1: Add env var to .env.example**

Add to the Zuper section:

```env
ZUPER_PROPERTY_SYNC_ENABLED=false  # Enable Zuper Property write sync (cron + backfill + job linking)
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add ZUPER_PROPERTY_SYNC_ENABLED to .env.example"
```

---

### Task 9: Apply Migration to Development Database

**Files:** None (database operation)

- [ ] **Step 1: Apply the migration**

Run: `npx prisma migrate deploy`
Expected: "1 migration applied" success.

**IMPORTANT**: This step requires orchestrator-level approval. Subagents CANNOT run migrations. The orchestrator should run this manually or prompt the user for approval.

---

### Task 10: End-to-End Verification

- [ ] **Step 1: Set ZUPER_PROPERTY_SYNC_ENABLED=true in .env**

- [ ] **Step 2: Run backfill with --limit=3 against live Zuper (non-dry-run)**

Run: `npx tsx scripts/backfill-zuper-properties.ts --limit=3`
Expected: 3 Zuper Properties created, jobs linked, no errors.

- [ ] **Step 3: Verify in Zuper web app**

Open Zuper web app (app.zuperpro.com) → Properties section. Confirm the 3 newly created properties appear with correct address and custom fields (System Size, AHJ, Utility, etc.).

- [ ] **Step 4: Verify job linkage**

Open one of the linked jobs in Zuper → check that the Property field shows the linked property name.

- [ ] **Step 5: Test cron manually**

Run: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/zuper-property-sync`
Expected: JSON response with `{ status: "ok", processed: N, created: 0, updated: N }` (properties from step 2 should show as "updated" if cache has changed since initial sync, or "idle" if nothing is dirty).

---

## Deployment Checklist

Before merging to main:

1. [ ] Add `ZUPER_PROPERTY_SYNC_ENABLED=true` to Vercel production env vars
2. [ ] Verify `CRON_SECRET` is set in Vercel (already exists for other crons)
3. [ ] Deploy and confirm cron shows up in Vercel Cron dashboard
4. [ ] Run full backfill: `npx tsx scripts/backfill-zuper-properties.ts`
5. [ ] Spot-check 5-10 properties in Zuper web app for correct data
6. [ ] Confirm mobile app shows property context on field jobs
