# Catalog Sync Quality Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Migrations are **orchestrator-only** — never delegate `prisma migrate deploy` or `db execute` to a subagent.

**Goal:** Close the observability, data-integrity, and field-coverage gaps in the product catalog → HubSpot/Zuper/Zoho sync pipeline so that (a) every sync produces an auditable record, (b) no entry path silently creates orphan external records, and (c) more of the spec data we collect actually reaches the systems that consume it.

**Architecture:** Reuse the existing `ActivityLog` system (no new sync-log table) by adding catalog-specific `ActivityType` enum values; extract the cross-link writer from `executeCatalogPushApproval` into a shared `catalog-cross-link.ts` module called from both the wizard/approval path AND `executePlan` in catalog-sync-plan; replace the null-guard `updateMany` link-back with a transactional re-fetch + assert; add graceful-fallback wrappers around HubSpot manufacturer enum errors; extend `FieldDef` with optional `zuperCustomField` and `zohoCustomField` keys so the spec→external mapping registry already in `catalog-sync-mappings.ts` picks them up automatically when populated.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5, Prisma 7.3 / Neon Postgres, Jest, existing HubSpot/Zoho/Zuper clients

**Discovery artifact:** [`docs/product-sync-map.html`](../../product-sync-map.html) — visual field map and gap inventory that drove this plan

**External mapping decisions:** [`docs/superpowers/specs/2026-04-24-catalog-sync-external-mappings.md`](../specs/2026-04-24-catalog-sync-external-mappings.md) — proposed Zoho category mappings (cross-referenced against live data), Zuper custom field schema (15 fields), and the corrected HubSpot manufacturer-enum policy. Read this BEFORE executing Milestone 3.

**Source files at a glance:**
- `src/lib/catalog-fields.ts` — field schema, source of truth for spec→external mappings
- `src/lib/catalog-sync.ts` — Sync Modal preview/execute (per-system)
- `src/lib/catalog-sync-mappings.ts` — mapping edge registry
- `src/lib/catalog-sync-plan.ts` — plan derivation + executePlan
- `src/lib/catalog-push-approve.ts` — wizard/BOM approval engine
- `src/lib/zoho-inventory.ts`, `src/lib/zuper-catalog.ts`, `src/lib/hubspot.ts` — external clients
- `src/lib/zoho-taxonomy.ts` — group_name confirmation registry
- `prisma/schema.prisma` — `InternalProduct`, `PendingCatalogPush`, `ActivityType`, spec tables

---

## Context

A health-check audit of the product creation/sync system surfaced 12 quality gaps. Severity ranges from "silently creating orphan records in production" (Sync Modal cross-link writes) to "missing nice-to-have spec data in HubSpot" (efficiency, cell type, etc.). This plan organizes the fixes into four ship-able milestones, ordered by dependency:

1. **Observability first** — once we can see what sync did, every subsequent fix can be verified immediately. Without this, we'd be shipping fixes blind.
2. **Data integrity next** — the orphan-creation and silent-failure bugs erode trust in the data and create cleanup work later.
3. **Coverage expansion** — additive, low-risk, but volume-heavy. Depends on Zach confirming Zoho group names and (optionally) defining new Zuper custom fields.
4. **Optional follow-ups** — features that didn't exist or didn't need to exist. Sized so each can be deferred without blocking the others.

**Each milestone is independently shippable.** Hard checkpoints between milestones — get one to prod, watch for a day, then start the next.

---

## Architecture Decisions

### D1. Reuse `ActivityLog`, do not introduce `CatalogSyncLog`
The existing `ActivityLog` table already stores per-action audit rows with `entityType`/`entityId`/`metadata`/risk fields and is queried by the admin activity-log UI and audit-digest cron. A new `CatalogSyncLog` table would (a) duplicate the schema, (b) need its own UI, (c) miss the existing audit-session and anomaly-detection wiring. We'll add 4 new `ActivityType` enum values and write through `logActivity()`. **Tradeoff:** ActivityLog rows are wider than a dedicated sync log would need to be, and the row-count cost is non-trivial (one row per sync × 3 systems). Acceptable — we already log every login and dashboard view.

### D2. Cross-link writer is shared infrastructure, not duplicated
Today the cross-link IDs (`cf_internal_product_id`, `internal_product_id`, etc.) are written exclusively by `executeCatalogPushApproval` in catalog-push-approve.ts. The Sync Modal's `executePlan` does NOT call this code, so a "create new in HubSpot" via the modal results in an orphaned HubSpot product with no `internal_product_id` property. We'll extract a `writeCrossLinkIds()` helper to `src/lib/catalog-cross-link.ts` and call it from both paths after any external create succeeds. **Tradeoff:** Adds one indirection layer. Worth it — orphan creation is the highest-leverage data-integrity bug in the system.

### D3. Race-safe link-back via row-locked re-fetch, not `updateMany WHERE col IS NULL`
Today, when `executeZohoSync` creates a Zoho item, it writes the new ID back via `prisma.internalProduct.updateMany({ where: { id, zohoItemId: null }, data: { zohoItemId } })`. If two admins sync the same product simultaneously, the second wins in Zoho but loses the link-back, orphaning the second-created Zoho item with only a console warning. We'll wrap the create + link-back in a `$transaction` that locks the InternalProduct row, re-fetches, and refuses to create if the column is non-null (instead of refusing to link AFTER creating). **Tradeoff:** Adds a small latency cost (the row lock) and complicates the create flow. Worth it — silent orphan creation in production is exactly the kind of bug nobody catches until quarterly cleanup.

### D4. HubSpot `manufacturer` enum: phased rollout to block-and-prompt (REVISED 2026-04-24, twice)
**Zach's policy: brand SHOULD be in HubSpot. No silent strip.** Live audit (`scripts/_pull-hubspot-manufacturer-enum.ts`) found that 37 of 45 internal brands are missing from HubSpot's enum today (Generic, IronRidge, Square D, Siemens, Eaton, GE, Pegasus, etc.). Hard-enforcing immediately would block most submissions. So:

- **Phase A** (ships in M2 T2.4): land the typed `HubSpotManufacturerEnumError` and block path, gated behind `HUBSPOT_MANUFACTURER_ENFORCEMENT` env flag. Default OFF: existing fallback (drop manufacturer, retry, succeed) preserved, but ActivityLog now records the rejection.
- **Phase B** (manual / Zach): backfill HubSpot enum with legitimate missing brands per `scripts/hubspot-manufacturer-enum.json`. Clean up dupes (Multiple/MULTIPLE, Cutler-Hammer/Cutler Hammer - Eaton, Unirac/UNIRAC) and test data in InternalProduct.brand.
- **Phase C** (Vercel env flip): set `HUBSPOT_MANUFACTURER_ENFORCEMENT=true` in prod. New unknown brands hard-block.

**Tradeoff:** Adds a feature flag, defers the "real" enforcement until after data hygiene. Worth it — turning enforcement on cold would block ~37 known brand strings in production. Implementation details in companion mapping spec § 3.

### D5. Spec field external mappings live in `catalog-fields.ts`, not a parallel registry
The `FieldDef` interface already declares `hubspotProperty?`, `zuperCustomField?`, `zohoCustomField?` keys (`src/lib/catalog-fields.ts:13-15`) but only `hubspotProperty` is wired in `catalog-sync-mappings.ts`. We'll extend `buildCategoryHubSpotEdges()` to also emit category-conditional Zuper and Zoho edges from those keys. **Tradeoff:** Pushes more weight onto the field-definition file. Already by design — that file is the single source of truth.

### D6. Zoho mapping is bigger than originally scoped — switch from `group_name` to `category_name`/`category_id` (REVISED 2026-04-24)
**Original assumption (flip 12 unresolved entries to confirmed in `zoho-taxonomy.ts`) was wrong.** A live pull of the prod Zoho org via `scripts/_pull-zoho-item-groups.ts` showed:
- `group_name` is essentially unused (2 of 1717 items). Our existing "confirmed" mappings (MODULE→Module, INVERTER→Inverter) write to a field nobody sees in the Zoho UI.
- `category_name` is the real field — 21 distinct values across 1351 items, surfaced in Zoho admin.
The fix is structural: rename the registry entries (`groupName` → `categoryName`/`categoryId`), swap `group_name: ...` → `category_id: ...` (or `category_name: ...`) in the Zoho create/update payload, and populate the proposed mappings in [`docs/superpowers/specs/2026-04-24-catalog-sync-external-mappings.md`](../specs/2026-04-24-catalog-sync-external-mappings.md). **Tradeoff:** ~2x the original M3 Task 3.1 effort. Worth it — the original task would have changed nothing user-visible.

### D7. Wizard auth stays open, but adds risk-scoring
Today anyone authed can submit through the wizard (auto-approves and creates external records). Sync Modal restricts to ADMIN/EXECUTIVE. Tightening the wizard auth would block sales reps from submitting product requests, which is the actual intended workflow. Instead: keep wizard auth open, but flag the new ActivityLog row with `riskLevel: MEDIUM` when a non-admin triggers external system creation, and surface those rows in the existing anomaly digest. **Tradeoff:** Doesn't actually prevent the asymmetry. Acceptable — the pre-existing workflow assumes any authed user can request a product, and we have audit/notification infrastructure for after-the-fact review.

### D8. No new env vars; no new external API integrations
Everything in this plan reuses existing API tokens (HubSpot, Zoho refresh, Zuper x-api-key). No Vercel env sync needed. Migrations are additive only (new enum values + 1 column added on `InternalProduct` for sync watermark — see Milestone 2). **Tradeoff:** None.

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `prisma/schema.prisma` | Schema | Add 4 `ActivityType` enum values; add `lastSyncedAt`, `lastSyncedBy` columns on `InternalProduct` |
| `prisma/migrations/<timestamp>_catalog_sync_observability/migration.sql` | Migration | Additive: enum values + nullable columns |
| `src/lib/catalog-activity-log.ts` | **New** | `logCatalogSync()`, `logCatalogProductCreated()`, `logCatalogSyncFailed()` helpers wrapping `logActivity` with consistent shape |
| `src/lib/catalog-cross-link.ts` | **New** | Extracted `writeCrossLinkIds()` from catalog-push-approve.ts; called by wizard AND sync modal paths |
| `src/lib/catalog-fields.ts` | Field schema | Add `zuperCustomField`/`zohoCustomField` to category fields where applicable |
| `src/lib/catalog-sync-mappings.ts` | Mapping registry | Extend `buildCategoryHubSpotEdges()` → `buildCategoryExternalEdges()` to emit Zuper + Zoho edges from FieldDef |
| `src/lib/catalog-sync.ts` | Per-system executors | Race-safe link-back; catch HubSpot 400 manufacturer enum errors |
| `src/lib/catalog-sync-plan.ts` | Plan executor | Call `writeCrossLinkIds()` and `logCatalogSync()` after `executePlan` |
| `src/lib/catalog-push-approve.ts` | Wizard/BOM engine | Replace inline cross-link block with `writeCrossLinkIds()` call; wrap with `logCatalogSync()` |
| `src/lib/zoho-taxonomy.ts` | Group name registry | Flip confirmed entries (data-only, depends on D6) |
| `src/lib/hubspot.ts` | HubSpot client | `createOrUpdateHubSpotProduct` retry path catches 400 on manufacturer specifically |
| `src/lib/zuper-catalog.ts` | Zuper client | Accept dimensions in `createOrUpdateZuperPart` (no-op if customer fields not configured) |
| `src/__tests__/lib/catalog-activity-log.test.ts` | **New** | Unit test the helpers |
| `src/__tests__/lib/catalog-cross-link.test.ts` | **New** | Unit test cross-link writer |
| `src/__tests__/lib/catalog-sync-mappings.test.ts` | Tests | Add cases for new Zuper/Zoho category-conditional edges |
| `src/__tests__/lib/catalog-sync.test.ts` | **New** (or extend existing) | Race-safe link-back; manufacturer fallback |
| `src/__tests__/api/catalog-push-approve.test.ts` | Tests | Add assertions for ActivityLog rows |
| `src/components/catalog/SyncModal.tsx` | UI | Add cross-link warning text when creating new external record (informational) |
| `src/app/dashboards/admin/activity/page.tsx` (if exists) or new section | UI | Filter by catalog activity types |

---

## Decisions Needed from Zach

These are gating items — flag if Zach hasn't responded by the time you reach the relevant task. **Don't block earlier milestones on them.**

1. **Zoho group names (Milestone 3, Task 3.1).** For each of these 12 categories, what is the exact group name in Zoho Inventory admin?
   - BATTERY, BATTERY_EXPANSION, EV_CHARGER, RACKING, MONITORING, GATEWAY, OPTIMIZER, ELECTRICAL_BOS, RAPID_SHUTDOWN, TESLA_SYSTEM_COMPONENTS, D_AND_R, SERVICE
   - Zach: pull the Zoho admin → Items → Item Groups list and paste verbatim. "We don't track this in Zoho" is a valid answer for some (SERVICE, PROJECT_MILESTONES, ADDER_SERVICES likely).

2. **Zuper custom field availability (Milestone 3, Task 3.4).** Does the Zuper org have admin-level access to define custom fields on the Product object? If yes, which spec fields are most valuable to surface in Zuper for technicians (likely: efficiency, chemistry, cellType, mountType, gaugeSize)? If admin access is gated, this task becomes "skip" rather than "do."

3. **HubSpot manufacturer enum policy (D4).** Acceptable to silently strip unknown brands from the HubSpot push and continue, or should we block submission with a "brand not in HubSpot — request enum addition" message? Default is silent strip.

4. **Stock auto-seed (Milestone 4, Task 4.3).** When a new product enters the catalog, should we auto-create `InventoryStock` rows at qty=0 for every PB location, or leave stock-row creation as an explicit ops action? Default is "leave as-is."

5. **Wizard auth (D7).** Confirm we want to keep the wizard open to all authed users with audit-flagging instead of restricting to ADMIN/EXEC. If you want it restricted, the change is one role-allowlist edit — say so before Milestone 2.

---

## Out of Scope (Explicit YAGNI)

These came up during discovery and are intentionally NOT in this plan. Don't expand scope to include them — they each need their own thinking:

- **QuickBooks product sync** — `qbo_product_id` field hooks exist on HubSpot Products and `UpsertHubSpotProductInput`, but no QBO client exists. Significant new integration. Track in `docs/superpowers/followups/` as a separate spec.
- **OpenSolar product mapping** — `PendingCatalogPush.openSolarId` exists for the sales-request flow, no sync. Track separately.
- **CatalogProduct cleanup** — the read-only mirror table has its own dedup engine (`product-cleanup-engine.ts`); leave it alone.
- **Bulk sync UI improvements** — the `/api/inventory/products/sync-bulk` and `/sync-hubspot-bulk` endpoints work; their UI affordances are a separate UX project.
- **Renaming `EquipmentSku` table to `internal_product`** — already tracked in plans `2026-03-16-internal-product-rename-phase1.md` through phase 4. Don't touch.
- **HubSpot brand enum auto-creation** — would need new HubSpot Properties API write scopes and is brittle. Falling back to vendor_name (D4) is the chosen path.
- **Webhook/SSE invalidation for the catalog table** — the catalog dashboard already polls; real-time updates here aren't load-bearing.

---

## Testing Strategy

- **Unit tests for new modules** (`catalog-activity-log.ts`, `catalog-cross-link.ts`): mock the prisma client and external clients, assert on shape and call counts.
- **Integration-style tests for the executors** (`executeCatalogPushApproval`, `executePlan`): use the patterns already in `src/__tests__/api/catalog-push-approve.test.ts`. Mock the external API clients but use a real prisma test DB transaction.
- **Migration smoke**: after `prisma migrate dev`, run `npm run lint` and the catalog sync tests; the new enum values must show up in the generated client at `src/generated/prisma/enums.ts`.
- **Race-condition test**: simulate concurrent `executeZohoSync` calls in a Jest test using two un-awaited promises with a small delay; assert that only one external record gets linked and the other returns a `conflict` outcome rather than an orphan.
- **Manual smoke after each milestone**: open `/dashboards/submit-product`, submit a real test product (e.g., a fake module), verify all 4 systems get the record AND the cross-link IDs AND the ActivityLog row.

**No e2e harness exists for this code path** — call that out and rely on manual smoke + unit/integration coverage.

---

## Rollout Sequencing (Critical)

Per the user's documented preferences (`feedback_migration_ordering.md`, `feedback_prisma_migration_before_code.md`):

1. **Additive migration first.** Apply the schema migration (new enum values + columns on `InternalProduct`) on prod via `npm run db:migrate` BEFORE merging the code that reads/writes them. The migration is purely additive, so it's safe to ship alone.
2. **Code merges via GitHub PR** (`feedback_deploys_via_github.md`). One PR per task or per closely-related task group. Don't `vercel --prod`.
3. **Per-milestone production soak.** After each milestone ships to prod, watch the new ActivityLog entries for ~24 hours. If they're being written and outcomes look right, move to the next milestone. If they're noisy or missing, fix before continuing.

---

## Chunk 1: Milestone 1 — Observability foundation

**Why first:** Every subsequent fix should be verifiable from the ActivityLog. Without this in place, fixes get shipped blind.

**Goal:** Every product creation, every sync attempt, every sync failure produces one structured `ActivityLog` row with enough metadata to answer: *who synced what when, which systems received writes, what was the outcome per system, and what fields were pushed.*

### Task 1.1: Add `ActivityType` enum values + InternalProduct sync watermark

**Files:**
- Modify: `prisma/schema.prisma` (ActivityType enum at line ~116, InternalProduct model at line 1215)
- Create: `prisma/migrations/<timestamp>_catalog_sync_observability/migration.sql`

- [ ] **Step 1: Add 4 enum values to `ActivityType`**

In `prisma/schema.prisma`, add these to the enum block (line ~116). Place them grouped logically — under the existing `// Inventory` section which already has `INVENTORY_SKU_SYNCED`:

```prisma
  // Inventory
  INVENTORY_RECEIVED
  INVENTORY_ADJUSTED
  INVENTORY_ALLOCATED
  INVENTORY_TRANSFERRED
  INVENTORY_SKU_SYNCED
  CATALOG_PRODUCT_CREATED
  CATALOG_PRODUCT_UPDATED
  CATALOG_SYNC_EXECUTED
  CATALOG_SYNC_FAILED
```

- [ ] **Step 2: Add sync watermark columns to `InternalProduct`**

In the `InternalProduct` model (line 1215+), add after the existing external-ID fields (line 1236):

```prisma
  // Catalog sync observability — populated by logCatalogSync after each sync
  lastSyncedAt   DateTime?
  lastSyncedBy   String? // user email
```

And add an index for "stale products" queries:

```prisma
  @@index([lastSyncedAt])
```

- [ ] **Step 3: Generate the migration locally**

Run:
```bash
npx prisma migrate dev --name catalog_sync_observability --create-only
```

Inspect the generated SQL — it should be:
```sql
-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'CATALOG_PRODUCT_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'CATALOG_PRODUCT_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'CATALOG_SYNC_EXECUTED';
ALTER TYPE "ActivityType" ADD VALUE 'CATALOG_SYNC_FAILED';

-- AlterTable
ALTER TABLE "EquipmentSku" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);
ALTER TABLE "EquipmentSku" ADD COLUMN "lastSyncedBy" TEXT;

-- CreateIndex
CREATE INDEX "EquipmentSku_lastSyncedAt_idx" ON "EquipmentSku"("lastSyncedAt");
```

If extra `ALTER TABLE` statements appear (unrelated changes), abort and figure out why before committing.

- [ ] **Step 4: Verify generated client**

Run:
```bash
npx prisma generate
grep -E "CATALOG_(PRODUCT|SYNC)" src/generated/prisma/enums.ts
```

Expected: 4 lines matching the new enum values.

- [ ] **Step 5: Apply migration to local DB**

```bash
npx prisma migrate dev
```

Verify the columns exist:
```bash
npx prisma db execute --stdin <<< "SELECT column_name FROM information_schema.columns WHERE table_name='EquipmentSku' AND column_name LIKE 'lastSync%';"
```

- [ ] **Step 6: Commit migration + schema**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(catalog): add sync observability enums and watermark columns

- 4 new ActivityType values for catalog audit trail
- lastSyncedAt/lastSyncedBy on InternalProduct
- Index on lastSyncedAt for stale-product queries"
```

- [ ] **Step 7: ORCHESTRATOR ONLY — confirm production migration plan with user**

Do not run `prisma migrate deploy` against production yet. Per `feedback_subagents_no_migrations.md`: this is orchestrator-only and needs explicit user approval at the moment of execution. After commits land on the PR, surface the migration to user with: *"Ready to apply additive migration `<timestamp>_catalog_sync_observability` to prod. Safe to run before code merges. Approve?"*

---

### Task 1.2: Create `catalog-activity-log.ts` helper module

**Files:**
- Create: `src/lib/catalog-activity-log.ts`
- Create: `src/__tests__/lib/catalog-activity-log.test.ts`

- [ ] **Step 1: Write the failing test for `logCatalogSync` shape**

`src/__tests__/lib/catalog-activity-log.test.ts`:

```typescript
import { logCatalogSync, logCatalogProductCreated } from "@/lib/catalog-activity-log";
import * as db from "@/lib/db";

jest.mock("@/lib/db", () => ({
  logActivity: jest.fn().mockResolvedValue({ id: "act_1" }),
}));

describe("logCatalogSync", () => {
  beforeEach(() => jest.clearAllMocks());

  test("writes one ActivityLog row per sync with structured outcomes metadata", async () => {
    await logCatalogSync({
      internalProductId: "prod_1",
      productName: "Silfab 400W",
      userEmail: "zach@photonbrothers.com",
      source: "wizard",
      outcomes: {
        INTERNAL: { status: "success", externalId: "prod_1" },
        HUBSPOT: { status: "success", externalId: "12345" },
        ZOHO: { status: "failed", message: "API 503" },
        ZUPER: { status: "skipped", message: "Not selected" },
      },
      durationMs: 4521,
    });

    expect(db.logActivity).toHaveBeenCalledTimes(1);
    const call = (db.logActivity as jest.Mock).mock.calls[0][0];
    expect(call.type).toBe("CATALOG_SYNC_EXECUTED");
    expect(call.entityType).toBe("internal_product");
    expect(call.entityId).toBe("prod_1");
    expect(call.entityName).toBe("Silfab 400W");
    expect(call.userEmail).toBe("zach@photonbrothers.com");
    expect(call.metadata).toMatchObject({
      source: "wizard",
      outcomes: expect.any(Object),
      systemsAttempted: ["INTERNAL", "HUBSPOT", "ZOHO", "ZUPER"],
      successCount: 2,
      failedCount: 1,
      skippedCount: 1,
    });
    expect(call.durationMs).toBe(4521);
  });

  test("uses CATALOG_SYNC_FAILED type and HIGH risk when any system failed", async () => {
    await logCatalogSync({
      internalProductId: "prod_2",
      productName: "Test",
      userEmail: "x@y.com",
      source: "modal",
      outcomes: {
        HUBSPOT: { status: "failed", message: "boom" },
      },
    });
    const call = (db.logActivity as jest.Mock).mock.calls[0][0];
    expect(call.type).toBe("CATALOG_SYNC_FAILED");
    expect(call.riskLevel).toBe("HIGH");
  });
});

describe("logCatalogProductCreated", () => {
  beforeEach(() => jest.clearAllMocks());

  test("writes CATALOG_PRODUCT_CREATED row with category in metadata", async () => {
    await logCatalogProductCreated({
      internalProductId: "prod_3",
      category: "MODULE",
      brand: "Silfab",
      model: "SIL-400-NU",
      userEmail: "z@p.com",
      source: "wizard",
    });
    const call = (db.logActivity as jest.Mock).mock.calls[0][0];
    expect(call.type).toBe("CATALOG_PRODUCT_CREATED");
    expect(call.entityName).toBe("Silfab SIL-400-NU");
    expect(call.metadata).toMatchObject({ category: "MODULE", source: "wizard" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test -- catalog-activity-log.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/catalog-activity-log'".

- [ ] **Step 3: Write the helper module**

`src/lib/catalog-activity-log.ts`:

```typescript
/**
 * Catalog Activity Log
 *
 * Thin wrappers around logActivity for catalog/product sync events.
 * Centralizes the metadata shape so dashboards and digests can rely on it.
 */
import { logActivity } from "@/lib/db";

export type CatalogSyncSource = "wizard" | "bom_pipeline" | "modal" | "bulk" | "approval_retry";

export type SystemName = "INTERNAL" | "HUBSPOT" | "ZOHO" | "ZUPER";

export interface SystemOutcome {
  status: "success" | "failed" | "skipped" | "not_implemented";
  externalId?: string | null;
  message?: string;
}

export interface LogCatalogSyncInput {
  internalProductId: string;
  productName: string;
  userEmail: string;
  userName?: string;
  source: CatalogSyncSource;
  outcomes: Partial<Record<SystemName, SystemOutcome>>;
  durationMs?: number;
  /** Optional: HubSpot deal that triggered this sync, if any */
  dealId?: string;
}

function summarize(outcomes: Partial<Record<SystemName, SystemOutcome>>) {
  const systemsAttempted = Object.keys(outcomes) as SystemName[];
  let successCount = 0, failedCount = 0, skippedCount = 0;
  for (const o of Object.values(outcomes)) {
    if (!o) continue;
    if (o.status === "success") successCount++;
    else if (o.status === "failed") failedCount++;
    else skippedCount++;
  }
  return { systemsAttempted, successCount, failedCount, skippedCount };
}

export async function logCatalogSync(input: LogCatalogSyncInput) {
  const summary = summarize(input.outcomes);
  const hasFailure = summary.failedCount > 0;
  return logActivity({
    type: hasFailure ? "CATALOG_SYNC_FAILED" : "CATALOG_SYNC_EXECUTED",
    description: hasFailure
      ? `Catalog sync had ${summary.failedCount} failure(s) for ${input.productName}`
      : `Catalog sync executed for ${input.productName}`,
    userEmail: input.userEmail,
    userName: input.userName,
    entityType: "internal_product",
    entityId: input.internalProductId,
    entityName: input.productName,
    metadata: {
      source: input.source,
      outcomes: input.outcomes,
      ...summary,
      ...(input.dealId ? { dealId: input.dealId } : {}),
    },
    durationMs: input.durationMs,
    riskLevel: hasFailure ? "HIGH" : "LOW",
  });
}

export interface LogCatalogProductCreatedInput {
  internalProductId: string;
  category: string;
  brand: string;
  model: string;
  userEmail: string;
  userName?: string;
  source: CatalogSyncSource;
}

export async function logCatalogProductCreated(input: LogCatalogProductCreatedInput) {
  const productName = `${input.brand} ${input.model}`.trim();
  return logActivity({
    type: "CATALOG_PRODUCT_CREATED",
    description: `New catalog product: ${productName} (${input.category})`,
    userEmail: input.userEmail,
    userName: input.userName,
    entityType: "internal_product",
    entityId: input.internalProductId,
    entityName: productName,
    metadata: {
      category: input.category,
      source: input.source,
    },
    riskLevel: "LOW",
  });
}

export interface LogCatalogProductUpdatedInput {
  internalProductId: string;
  productName: string;
  userEmail: string;
  changedFields: string[];
}

export async function logCatalogProductUpdated(input: LogCatalogProductUpdatedInput) {
  return logActivity({
    type: "CATALOG_PRODUCT_UPDATED",
    description: `Updated catalog product ${input.productName}: ${input.changedFields.join(", ")}`,
    userEmail: input.userEmail,
    entityType: "internal_product",
    entityId: input.internalProductId,
    entityName: input.productName,
    metadata: { changedFields: input.changedFields },
    riskLevel: "LOW",
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test -- catalog-activity-log.test.ts
```

Expected: PASS, both describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-activity-log.ts src/__tests__/lib/catalog-activity-log.test.ts
git commit -m "feat(catalog): add catalog-activity-log helpers

Centralizes ActivityLog write shape for product creation, sync
execution, and sync failure events. Used by both wizard/approval
path and Sync Modal."
```

---

### Task 1.3: Wire `logCatalogSync` into `executeCatalogPushApproval`

**Files:**
- Modify: `src/lib/catalog-push-approve.ts:586-624` (around the `responsePush` finalize block)
- Modify: `src/__tests__/api/catalog-push-approve.test.ts` (add ActivityLog assertion)

- [ ] **Step 1: Add ActivityLog assertion to existing test**

In `src/__tests__/api/catalog-push-approve.test.ts`, find the happy-path test (a successful approval) and add an assertion that `logActivity` was called with `CATALOG_SYNC_EXECUTED`. Pattern (adapt to existing mock setup):

```typescript
import * as activityLog from "@/lib/catalog-activity-log";
jest.mock("@/lib/catalog-activity-log");

// ...inside the existing happy-path test...
expect(activityLog.logCatalogSync).toHaveBeenCalledWith(
  expect.objectContaining({
    internalProductId: expect.any(String),
    source: "wizard",
    outcomes: expect.objectContaining({
      INTERNAL: expect.objectContaining({ status: "success" }),
    }),
  }),
);
```

Run the test — expect FAIL ("logCatalogSync was not called").

- [ ] **Step 2: Add the call inside `executeCatalogPushApproval`**

In `src/lib/catalog-push-approve.ts`, at the top:

```typescript
import { logCatalogSync, type CatalogSyncSource } from "@/lib/catalog-activity-log";
```

Modify the function signature to accept a `source` parameter (default `"wizard"` to preserve current callers):

```typescript
export async function executeCatalogPushApproval(
  id: string,
  options: { source?: CatalogSyncSource; userEmail?: string } = {},
): Promise<ApprovalResult> {
  const startedAt = Date.now();
  // ...existing code...
```

After the final `responsePush` update (around line 595, just before the `if (finalizeApproved)` block), add:

```typescript
  // Audit trail — one row per approval execution
  if (basePush.internalSkuId) {
    await logCatalogSync({
      internalProductId: basePush.internalSkuId,
      productName: `${push.brand} ${push.model}`.trim(),
      userEmail: options.userEmail || push.requestedBy,
      source: options.source || "wizard",
      outcomes,
      durationMs: Date.now() - startedAt,
      ...(push.dealId ? { dealId: push.dealId } : {}),
    });

    // Bump InternalProduct watermark
    await prisma.internalProduct.update({
      where: { id: basePush.internalSkuId },
      data: {
        lastSyncedAt: new Date(),
        lastSyncedBy: options.userEmail || push.requestedBy,
      },
    }).catch((err) => {
      console.warn("[catalog] watermark update failed:", err);
    });
  }
```

- [ ] **Step 3: Pass `source` from the wizard caller**

In `src/app/api/catalog/push-requests/route.ts:137`:

```typescript
const approval = await executeCatalogPushApproval(push.id, {
  source: "wizard",
  userEmail: authResult.email,
}).catch(...);
```

In `src/app/api/catalog/push-requests/[id]/approve/route.ts:24`:

```typescript
const result = await executeCatalogPushApproval(id, {
  source: "approval_retry",
  userEmail: authResult.email,
});
```

For the BOM-pipeline-driven path: search for any other `executeCatalogPushApproval(` callers (`grep -rn 'executeCatalogPushApproval' src/`). For BOM-pipeline-triggered approvals, pass `source: "bom_pipeline"`.

- [ ] **Step 4: Run all catalog-push-approve tests**

```bash
npm run test -- catalog-push-approve
```

Expected: all PASS, including the new ActivityLog assertion.

- [ ] **Step 5: Add `logCatalogProductCreated` for the first-time INTERNAL upsert**

In `executeCatalogPushApproval`, inside the INTERNAL block (around line 210-247), distinguish the "create" case from the "update" case. The current code uses `tx.internalProduct.upsert` which doesn't tell us which happened. Refactor:

```typescript
const existed = await tx.internalProduct.findUnique({
  where: {
    category_brand_model: {
      category: push.category as EquipmentCategory,
      brand: push.brand,
      model: push.model,
    },
  },
  select: { id: true },
});

const sku = await tx.internalProduct.upsert({
  // ...existing args...
});

// ...spec table upsert as before...

internalSkuId = sku.id;
outcomes.INTERNAL = {
  status: "success",
  externalId: sku.id,
  message: existed ? "Updated existing internal catalog entry." : "Created internal catalog entry.",
};
// Stash a flag for post-transaction logging
(basePush as Record<string, unknown>)._wasCreated = !existed;
```

Then after the transaction (alongside the new `logCatalogSync` call from Step 2):

```typescript
if (basePush.internalSkuId && (basePush as Record<string, unknown>)._wasCreated) {
  await logCatalogProductCreated({
    internalProductId: basePush.internalSkuId,
    category: push.category,
    brand: push.brand,
    model: push.model,
    userEmail: options.userEmail || push.requestedBy,
    source: options.source || "wizard",
  });
}
```

(Yes, the `_wasCreated` smuggling is ugly — feel free to thread it through the return value of the transaction more cleanly. Goal: distinguish create from update.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-push-approve.ts src/app/api/catalog/push-requests/ src/__tests__/api/catalog-push-approve.test.ts
git commit -m "feat(catalog): log every approval execution to ActivityLog

executeCatalogPushApproval now writes one CATALOG_SYNC_EXECUTED
(or CATALOG_SYNC_FAILED) row per run, plus CATALOG_PRODUCT_CREATED
on first-time internal upsert. Updates lastSyncedAt watermark.
Source parameter distinguishes wizard vs BOM vs approval-retry."
```

---

### Task 1.4: Wire `logCatalogSync` into `executePlan` (Sync Modal path)

**Files:**
- Modify: `src/lib/catalog-sync-plan.ts` (the `executePlan` function)
- Modify: `src/app/api/inventory/products/[id]/sync/route.ts:162` (capture user email)

- [ ] **Step 1: Locate `executePlan` and trace its callers**

```bash
grep -n "executePlan\b" src/lib/catalog-sync-plan.ts src/app/api/inventory/products/
```

Confirm signature and the route caller at `src/app/api/inventory/products/[id]/sync/route.ts:162`.

- [ ] **Step 2: Add user email parameter to `executePlan`**

The route already has `auth.email` available (set at line 36). Thread it through:

`src/lib/catalog-sync-plan.ts`:
```typescript
export async function executePlan(
  sku: SkuRecord,
  plan: SyncPlan,
  options: { userEmail: string } = { userEmail: "system" },
): Promise<SyncExecuteResponse> {
  const startedAt = Date.now();
  // ...existing executePlan body...

  // After the response is constructed, before return:
  await logCatalogSync({
    internalProductId: sku.id,
    productName: `${sku.brand} ${sku.model}`.trim(),
    userEmail: options.userEmail,
    source: "modal",
    outcomes: convertOutcomesToSystemShape(response.outcomes),
    durationMs: Date.now() - startedAt,
  });

  await prisma.internalProduct.update({
    where: { id: sku.id },
    data: { lastSyncedAt: new Date(), lastSyncedBy: options.userEmail },
  }).catch((err) => console.warn("[catalog] watermark update failed:", err));

  return response;
}
```

The `convertOutcomesToSystemShape` helper translates from `SyncOperationOutcome[]` (the Sync Modal's per-operation shape) to the `Partial<Record<SystemName, SystemOutcome>>` shape `logCatalogSync` expects. Add it inline:

```typescript
function convertOutcomesToSystemShape(
  outcomes: SyncOperationOutcome[],
): Partial<Record<SystemName, SystemOutcome>> {
  const result: Partial<Record<SystemName, SystemOutcome>> = {};
  for (const o of outcomes) {
    if (o.system === "internal") continue;
    const sys = o.system.toUpperCase() as SystemName;
    // First non-success wins for status; otherwise last seen
    const existing = result[sys];
    if (!existing || (existing.status === "success" && o.status !== "success")) {
      result[sys] = {
        status: o.status === "success" ? "success" : o.status === "skipped" ? "skipped" : "failed",
        message: o.message,
      };
    }
  }
  return result;
}
```

- [ ] **Step 3: Pass `userEmail` from the route**

`src/app/api/inventory/products/[id]/sync/route.ts:162`:

```typescript
const result = await executePlan(sku, freshPlan, { userEmail: auth.email });
```

(`auth.email` is already in scope from `await authenticate()` at line 93.)

- [ ] **Step 4: Add a unit test for `executePlan` ActivityLog wiring**

Extend `src/__tests__/lib/catalog-sync-plan.test.ts` (create if missing):

```typescript
import { executePlan } from "@/lib/catalog-sync-plan";
import * as activityLog from "@/lib/catalog-activity-log";

jest.mock("@/lib/catalog-activity-log");
// Mock the prisma client + external clients per existing test patterns

test("executePlan writes a CATALOG_SYNC_EXECUTED ActivityLog row", async () => {
  // ...arrange a minimal plan with one push to HubSpot...
  await executePlan(skuFixture, planFixture, { userEmail: "test@p.com" });
  expect(activityLog.logCatalogSync).toHaveBeenCalledWith(
    expect.objectContaining({
      internalProductId: skuFixture.id,
      source: "modal",
      userEmail: "test@p.com",
    }),
  );
});
```

- [ ] **Step 5: Run tests**

```bash
npm run test -- catalog-sync-plan
npm run test -- catalog-activity-log
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-sync-plan.ts src/app/api/inventory/products/ src/__tests__/lib/catalog-sync-plan.test.ts
git commit -m "feat(catalog): log Sync Modal executions to ActivityLog

executePlan now writes one CATALOG_SYNC_EXECUTED row per run with
per-system outcomes, and updates the InternalProduct watermark."
```

---

### Task 1.5: Surface catalog activity in the admin activity log UI

**Files:**
- Investigate: `src/app/dashboards/admin/activity/` (likely path; adjust if different)
- Modify: that page's filter dropdown to include the new types

- [ ] **Step 1: Find the existing activity log UI**

```bash
grep -rn "ActivityType\|activityLog\b" src/app/dashboards/admin/ src/app/dashboards/executive/ | head -20
find src/app -path '*activity*' -name '*.tsx' | head
```

- [ ] **Step 2: If a category/type filter exists, add CATALOG_* group**

Add a "Catalog & Sync" filter group containing the 4 new types. Reuse whatever existing filter pattern (likely a `MultiSelectFilter` component per CLAUDE.md conventions).

- [ ] **Step 3: If no activity log UI exists yet**

Skip this task — the data is queryable directly via Prisma. Note in `docs/superpowers/followups/` that a catalog-sync activity report should be added to admin dashboards.

- [ ] **Step 4: Commit (if changes made)**

```bash
git add src/app/dashboards/admin/
git commit -m "feat(admin): surface catalog sync activity in activity log filter"
```

---

### Milestone 1 — Ship Checkpoint

- [ ] All Milestone 1 tasks complete and tests passing
- [ ] PR opened: `feat(catalog): observability foundation`
- [ ] User approves migration → orchestrator runs `npm run db:migrate` against prod
- [ ] PR merged → Vercel deploy succeeds
- [ ] Manual smoke: submit a test product via wizard, observe one CATALOG_SYNC_EXECUTED row in ActivityLog with `outcomes` populated
- [ ] Manual smoke: open Sync Modal on existing product, sync something, observe one CATALOG_SYNC_EXECUTED row from `source: "modal"`
- [ ] **Soak for 24h**, then proceed to Milestone 2.

---

## Chunk 2: Milestone 2 — Data integrity fixes

**Why second:** Once we can see what sync did (Milestone 1), these fixes have an immediate verification surface. Without M1 you'd be guessing.

**Goal:** Stop creating orphan external records via the Sync Modal; eliminate the silent race condition; stop letting unknown brand strings kill the entire HubSpot push.

### Task 2.1: Extract `writeCrossLinkIds` to `catalog-cross-link.ts`

**Files:**
- Create: `src/lib/catalog-cross-link.ts`
- Create: `src/__tests__/lib/catalog-cross-link.test.ts`
- Modify: `src/lib/catalog-push-approve.ts:459-581` (replace inline cross-link block with helper call)

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/catalog-cross-link.test.ts`:

```typescript
import { writeCrossLinkIds } from "@/lib/catalog-cross-link";
import * as zoho from "@/lib/zoho-inventory";
import * as zuper from "@/lib/zuper-catalog";

jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: { updateItem: jest.fn().mockResolvedValue({ status: "updated" }) },
}));
jest.mock("@/lib/zuper-catalog", () => ({
  buildZuperProductCustomFields: jest.requireActual("@/lib/zuper-catalog").buildZuperProductCustomFields,
  updateZuperPart: jest.fn().mockResolvedValue({ status: "updated" }),
}));
global.fetch = jest.fn(() => Promise.resolve({ ok: true } as Response));
process.env.HUBSPOT_ACCESS_TOKEN = "test_token";

describe("writeCrossLinkIds", () => {
  beforeEach(() => jest.clearAllMocks());

  test("writes cf_* fields to Zoho when other systems present", async () => {
    await writeCrossLinkIds({
      zohoItemId: "z_1",
      zuperItemId: "zu_1",
      hubspotProductId: "hs_1",
      internalProductId: "p_1",
    });
    expect(zoho.zohoInventory.updateItem).toHaveBeenCalledWith("z_1", {
      custom_fields: expect.arrayContaining([
        expect.objectContaining({ api_name: "cf_zuper_product_id", value: "zu_1" }),
        expect.objectContaining({ api_name: "cf_hubspot_product_id", value: "hs_1" }),
        expect.objectContaining({ api_name: "cf_internal_product_id", value: "p_1" }),
      ]),
    });
  });

  test("writes properties to HubSpot Product when other systems present", async () => {
    await writeCrossLinkIds({
      zohoItemId: "z_1", zuperItemId: "zu_1",
      hubspotProductId: "hs_1", internalProductId: "p_1",
    });
    const fetchCall = (global.fetch as jest.Mock).mock.calls.find((c) =>
      c[0].includes("/products/hs_1"),
    );
    expect(fetchCall).toBeDefined();
    const body = JSON.parse(fetchCall[1].body);
    expect(body.properties).toMatchObject({
      zuper_item_id: "zu_1",
      zoho_item_id: "z_1",
      internal_product_id: "p_1",
    });
  });

  test("no-ops when only one system has an ID", async () => {
    const result = await writeCrossLinkIds({
      hubspotProductId: "hs_1",
      // zoho/zuper/internal all missing
    });
    expect(result.warnings).toEqual([]);
    expect(zoho.zohoInventory.updateItem).not.toHaveBeenCalled();
    expect(zuper.updateZuperPart).not.toHaveBeenCalled();
  });

  test("returns warnings when individual system updates fail without throwing", async () => {
    (zoho.zohoInventory.updateItem as jest.Mock).mockResolvedValueOnce({
      status: "failed", message: "503",
    });
    const result = await writeCrossLinkIds({
      zohoItemId: "z_1", hubspotProductId: "hs_1", internalProductId: "p_1",
    });
    expect(result.warnings.some((w) => w.includes("Zoho"))).toBe(true);
  });
});
```

Run, expect FAIL with "Cannot find module".

- [ ] **Step 2: Implement the helper**

`src/lib/catalog-cross-link.ts`:

```typescript
/**
 * Catalog Cross-Link Writer
 *
 * After a product is created or updated in any combination of HubSpot / Zoho / Zuper,
 * write each system's ID into the others' custom-fields/properties so any record can
 * navigate to its siblings.
 *
 * Used by:
 *   - executeCatalogPushApproval (wizard / BOM approval path)
 *   - executePlan (Sync Modal path) — added in Milestone 2 Task 2.2
 *
 * All writes are best-effort: a failure on one system surfaces in the warnings array
 * but does not throw or block the other writes.
 */
import { zohoInventory } from "@/lib/zoho-inventory";
import { updateZuperPart, buildZuperProductCustomFields } from "@/lib/zuper-catalog";

export interface CrossLinkInput {
  internalProductId?: string | null;
  hubspotProductId?: string | null;
  zohoItemId?: string | null;
  zuperItemId?: string | null;
}

export interface CrossLinkResult {
  attempted: Array<"zoho" | "zuper" | "hubspot">;
  warnings: string[];
}

export async function writeCrossLinkIds(input: CrossLinkInput): Promise<CrossLinkResult> {
  const result: CrossLinkResult = { attempted: [], warnings: [] };
  const { internalProductId, hubspotProductId, zohoItemId, zuperItemId } = input;

  const otherIdsForZoho = !!(zuperItemId || hubspotProductId || internalProductId);
  const otherIdsForZuper = !!(hubspotProductId || zohoItemId || internalProductId);
  const otherIdsForHubSpot = !!(zuperItemId || zohoItemId || internalProductId);

  // Zoho cross-link
  if (zohoItemId && otherIdsForZoho) {
    result.attempted.push("zoho");
    try {
      const customFields: Array<{ api_name: string; value: string }> = [];
      if (zuperItemId) customFields.push({ api_name: "cf_zuper_product_id", value: zuperItemId });
      if (hubspotProductId) customFields.push({ api_name: "cf_hubspot_product_id", value: hubspotProductId });
      if (internalProductId) customFields.push({ api_name: "cf_internal_product_id", value: internalProductId });
      const out = await zohoInventory.updateItem(zohoItemId, { custom_fields: customFields });
      if (out.status !== "updated") {
        result.warnings.push(`Zoho cross-link returned ${out.status}: ${out.message || "unknown"}`);
      }
    } catch (err) {
      result.warnings.push(`Zoho cross-link threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Zuper cross-link
  if (zuperItemId && otherIdsForZuper) {
    result.attempted.push("zuper");
    try {
      const customFields = buildZuperProductCustomFields({
        hubspotProductId,
        zohoItemId,
        internalProductId,
      });
      if (customFields) {
        const out = await updateZuperPart(zuperItemId, { custom_fields: customFields });
        if (out.status !== "updated") {
          result.warnings.push(`Zuper cross-link returned ${out.status}: ${out.message || "unknown"}`);
        }
      }
    } catch (err) {
      result.warnings.push(`Zuper cross-link threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // HubSpot cross-link
  if (hubspotProductId && otherIdsForHubSpot) {
    result.attempted.push("hubspot");
    try {
      const props: Record<string, string> = {};
      if (zuperItemId) props.zuper_item_id = zuperItemId;
      if (zohoItemId) props.zoho_item_id = zohoItemId;
      if (internalProductId) props.internal_product_id = internalProductId;
      const token = process.env.HUBSPOT_ACCESS_TOKEN;
      if (token && Object.keys(props).length > 0) {
        const res = await fetch(`https://api.hubapi.com/crm/v3/objects/products/${hubspotProductId}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ properties: props }),
        });
        if (!res.ok) {
          result.warnings.push(`HubSpot cross-link PATCH returned ${res.status}`);
        }
      }
    } catch (err) {
      result.warnings.push(`HubSpot cross-link threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
```

Run the test:
```bash
npm run test -- catalog-cross-link
```

Expected: PASS.

- [ ] **Step 3: Replace inline cross-link block in catalog-push-approve.ts**

In `src/lib/catalog-push-approve.ts`, lines 459-581 currently contain three inline cross-link blocks (Zoho, Zuper, HubSpot). Replace them with a single call:

```typescript
// Cross-link: write each system's ID into the others' custom-fields/properties.
const zohoId = outcomes.ZOHO?.externalId || basePush.zohoItemId;
const zuperId = outcomes.ZUPER?.externalId || basePush.zuperItemId;
const hsId = outcomes.HUBSPOT?.externalId || basePush.hubspotProductId;
const internalSkuId = basePush.internalSkuId;

const crossLink = await writeCrossLinkIds({
  zohoItemId: zohoId,
  zuperItemId: zuperId,
  hubspotProductId: hsId,
  internalProductId: internalSkuId,
});

// Append cross-link warnings to the originating system's outcome message
for (const warning of crossLink.warnings) {
  const sys = warning.startsWith("Zoho") ? outcomes.ZOHO
    : warning.startsWith("Zuper") ? outcomes.ZUPER
    : warning.startsWith("HubSpot") ? outcomes.HUBSPOT
    : null;
  if (sys?.message) sys.message += ` (Warning: ${warning})`;
}
```

Add the import at the top:
```typescript
import { writeCrossLinkIds } from "@/lib/catalog-cross-link";
```

Delete the now-redundant inline blocks (the three `try { ... } catch { ... }` blocks at lines 464-581 in catalog-push-approve.ts that today do the cross-link writes — leave the photo upload block alone).

- [ ] **Step 4: Run all approval tests**

```bash
npm run test -- catalog-push-approve catalog-cross-link
```

Expected: PASS. Existing tests should still pass because behavior is preserved.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-cross-link.ts src/lib/catalog-push-approve.ts src/__tests__/lib/catalog-cross-link.test.ts
git commit -m "refactor(catalog): extract cross-link writer to shared helper

Pulls the Zoho/Zuper/HubSpot custom-field cross-link logic out of
executeCatalogPushApproval into catalog-cross-link.ts. Behavior
preserved (best-effort, warnings appended to outcome messages).
Sets up Milestone 2 Task 2.2 to call from executePlan."
```

---

### Task 2.2: Call `writeCrossLinkIds` from `executePlan` (Sync Modal)

This is the actual fix for the orphan-creation bug.

**Files:**
- Modify: `src/lib/catalog-sync-plan.ts` — `executePlan` function

- [ ] **Step 1: Write a failing test for the orphan scenario**

Extend `src/__tests__/lib/catalog-sync-plan.test.ts`:

```typescript
import { executePlan } from "@/lib/catalog-sync-plan";
import * as crossLink from "@/lib/catalog-cross-link";

jest.mock("@/lib/catalog-cross-link");

test("executePlan writes cross-link IDs after creating a new external record", async () => {
  // Arrange: a plan that creates a new HubSpot product, given an InternalProduct
  // that already has Zoho + Zuper IDs.
  const skuFixture = {
    id: "p_1",
    brand: "TestBrand",
    model: "TestModel",
    zohoItemId: "z_1",
    zuperItemId: "zu_1",
    hubspotProductId: null,
    // ...other required SkuRecord fields...
  } as unknown as SkuRecord;

  const planFixture = {
    productId: "p_1",
    operations: [
      { kind: "create", system: "hubspot", fields: { name: "TestBrand TestModel" }, source: "manual" },
    ],
    // ...
  } as SyncPlan;

  // Mock the HubSpot create to return a new ID (mock catalog-sync.ts createOrUpdateHubSpotProduct path)

  await executePlan(skuFixture, planFixture, { userEmail: "z@p.com" });

  expect(crossLink.writeCrossLinkIds).toHaveBeenCalledWith(
    expect.objectContaining({
      hubspotProductId: expect.any(String),
      zohoItemId: "z_1",
      zuperItemId: "zu_1",
      internalProductId: "p_1",
    }),
  );
});
```

Run, expect FAIL.

- [ ] **Step 2: Wire `writeCrossLinkIds` into `executePlan`**

In `src/lib/catalog-sync-plan.ts`, after the `Promise.allSettled` of operations completes and after the InternalProduct row has been refreshed with new external IDs:

```typescript
import { writeCrossLinkIds } from "@/lib/catalog-cross-link";

// ...inside executePlan, after operations execute and IDs are written back...

// Re-fetch InternalProduct to pick up any IDs written by create operations.
const updated = await prisma.internalProduct.findUnique({
  where: { id: sku.id },
  select: {
    hubspotProductId: true, zohoItemId: true, zuperItemId: true,
  },
});

const crossLink = await writeCrossLinkIds({
  internalProductId: sku.id,
  hubspotProductId: updated?.hubspotProductId,
  zohoItemId: updated?.zohoItemId,
  zuperItemId: updated?.zuperItemId,
});

// Append warnings to the response so the modal results UI surfaces them.
if (crossLink.warnings.length > 0) {
  response.outcomes.push({
    kind: "internal-patch",
    system: "internal",
    status: "skipped",  // not failed — informational
    message: `Cross-link warnings: ${crossLink.warnings.join("; ")}`,
    fieldDetails: [],
  });
}
```

- [ ] **Step 3: Run the test**

```bash
npm run test -- catalog-sync-plan
```

Expected: PASS.

- [ ] **Step 4: Add UI hint to the SyncModal results view**

In `src/components/catalog/SyncModal.tsx:935-986` (the "results" step), if any outcome has a `Cross-link warnings:` message, render it with a yellow (informational) tag rather than red (failed). The existing render logic already differentiates by `outcome.status`; this should already work since we set `status: "skipped"` above. If `skipped` doesn't render with the right visual weight, add a special case.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-sync-plan.ts src/components/catalog/SyncModal.tsx src/__tests__/lib/catalog-sync-plan.test.ts
git commit -m "fix(catalog): write cross-link IDs from Sync Modal too

Sync Modal previously created external records without populating
the cf_internal_product_id / internal_product_id / etc. linking
fields, leaving orphans visible only via console warnings. Now
calls the shared writeCrossLinkIds helper after each execute,
surfacing any per-system failures in the results view."
```

---

### Task 2.3: Race-safe link-back via transactional re-fetch

The current `updateMany WHERE … AND xxxItemId IS NULL` pattern (catalog-sync.ts:502, 579, 646) silently no-ops if a concurrent caller wrote first. We want either-or semantics: either we get the lock and create, or we abort the create entirely.

**Files:**
- Modify: `src/lib/catalog-sync.ts` — `executeZohoSync`, `executeHubSpotSync`, `executeZuperSync`

- [ ] **Step 1: Write the failing test**

`src/__tests__/lib/catalog-sync-race.test.ts` (new file):

```typescript
import { executeZohoSync } from "@/lib/catalog-sync";
import { prisma } from "@/lib/db";

// This test simulates two concurrent sync attempts on the same product where neither
// has an external ID yet. Only one should successfully create + link; the other
// should detect the race and abort with status "skipped".

describe("executeZohoSync race-safety", () => {
  test("two concurrent creates on the same SKU result in only one external record", async () => {
    // Arrange: insert a test InternalProduct with zohoItemId = null
    // ...

    // Mock createOrUpdateZohoItem to delay 100ms before returning a new ID
    // ...

    // Act: fire both syncs simultaneously
    const [a, b] = await Promise.allSettled([
      executeZohoSync(sku, previewWithCreate),
      executeZohoSync(sku, previewWithCreate),
    ]);

    // Assert: exactly one created, one skipped/failed-with-conflict
    const statuses = [a, b].map((r) => r.status === "fulfilled" ? r.value.status : "rejected");
    const created = statuses.filter((s) => s === "created").length;
    const skipped = statuses.filter((s) => s === "skipped").length;
    expect(created).toBe(1);
    expect(skipped).toBe(1);
  });
});
```

This test requires a real test DB connection (or a heavily mocked one). If your test setup doesn't support a real DB, write the test against the helper extracted in Step 2 instead, mocking only the Prisma transaction.

Run, expect FAIL.

- [ ] **Step 2: Extract the create-and-link pattern into a helper**

`src/lib/catalog-sync.ts`, add at the top:

```typescript
/**
 * Race-safe create-and-link for a new external record.
 *
 * Wraps:
 *   1. Lock the InternalProduct row (SELECT ... FOR UPDATE)
 *   2. Re-fetch and check that the target external ID is still null
 *   3. If null: call the create function, write the new ID back inside the same txn
 *   4. If non-null: abort (return null) so the caller doesn't double-create
 */
async function createAndLinkExternal<T extends { externalId: string }>(opts: {
  internalProductId: string;
  externalIdField: "zohoItemId" | "hubspotProductId" | "zuperItemId";
  doCreate: () => Promise<T>;
}): Promise<{ skipped: true; reason: string } | { skipped: false; result: T }> {
  return prisma.$transaction(async (tx) => {
    // Postgres row lock
    const locked = await tx.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, "${tx.$queryRawUnsafe ? opts.externalIdField : opts.externalIdField}" AS ext_id
      FROM "EquipmentSku" WHERE id = ${opts.internalProductId} FOR UPDATE
    `;
    // ... actually, Prisma raw queries are awkward — use a normal findUnique with a fence column instead.
    // Simpler: re-fetch via Prisma, then UPDATE WHERE col IS NULL inside the same txn,
    // but check the affected count and treat 0 as a conflict.
    const before = await tx.internalProduct.findUnique({
      where: { id: opts.internalProductId },
      select: { [opts.externalIdField]: true },
    });
    if (before && before[opts.externalIdField]) {
      return { skipped: true, reason: `Another sync linked ${opts.externalIdField} first` };
    }

    const created = await opts.doCreate();

    const updated = await tx.internalProduct.updateMany({
      where: { id: opts.internalProductId, [opts.externalIdField]: null },
      data: { [opts.externalIdField]: created.externalId },
    });

    if (updated.count === 0) {
      // Lost the race AFTER creating in the external system. Log, return skipped.
      console.error(`[Sync] Race: created ${opts.externalIdField} ${created.externalId} but lost link-back. Orphan in external system.`);
      return { skipped: true, reason: "Lost link-back race after external create — orphan exists" };
    }

    return { skipped: false, result: created };
  });
}
```

Refactor `executeZohoSync`, `executeHubSpotSync`, `executeZuperSync` to use it for the `preview.action === "create"` branch.

- [ ] **Step 3: Run all sync tests**

```bash
npm run test -- catalog-sync
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/catalog-sync.ts src/__tests__/lib/catalog-sync-race.test.ts
git commit -m "fix(catalog): race-safe external-record create + link-back

Replaces null-guard updateMany with a transactional re-fetch + lock.
If a concurrent sync linked the external ID first, we now abort
the second create entirely instead of creating then orphaning.
The narrow window where we create externally then lose link-back
(network races mid-transaction) is logged with an explicit
'orphan in external system' error so it can be cleaned up."
```

**Note on residual risk:** there's still a window where the external API call succeeds but the transaction commit fails (e.g., DB connection drops). In that case the external record is created but unlinked. This is fundamental to dual-write systems — the proper fix is an outbox pattern (Saga / two-phase). Out of scope here; document in `docs/superpowers/followups/` if it bites in practice.

---

### Task 2.4: HubSpot manufacturer enum block-and-prompt (REVISED 2026-04-24)

> **Implementation per** [companion spec § 3](../specs/2026-04-24-catalog-sync-external-mappings.md). Behavior reversed from original draft: brand failures BLOCK the HubSpot push instead of silently dropping. No vendor_name fallback.

**Files:**
- Modify: `src/lib/hubspot.ts:2484-2588` (createOrUpdateHubSpotProduct — raise `HubSpotManufacturerEnumError` instead of dropping properties)
- Modify: `src/lib/catalog-push-approve.ts` HUBSPOT block — catch the typed error and produce actionable failure message
- Modify: `src/lib/catalog-sync-plan.ts` executePlan — same error handling
- Modify: `src/__tests__/lib/hubspot.test.ts` — test asserts `HubSpotManufacturerEnumError` is thrown, NOT silent retry

- [ ] **Step 1: Find existing hubspot tests**

```bash
ls src/__tests__/lib/ | grep hubspot
ls src/__tests__/api/ | grep hubspot
```

- [ ] **Step 2: Write a failing test for the unknown-brand fallback**

Add a test that mocks the HubSpot API to return 400 with `Property "manufacturer" is invalid` on the first call (with manufacturer included), and 200 on the second call (without):

```typescript
test("createOrUpdateHubSpotProduct retries without manufacturer when enum value is rejected", async () => {
  let callCount = 0;
  global.fetch = jest.fn(async (url, init) => {
    callCount++;
    if (callCount === 1) {
      return {
        ok: false, status: 400,
        json: async () => ({
          message: "Property values were not valid",
          errors: [{ message: 'Property "manufacturer" was not one of the allowed options', name: "manufacturer" }],
        }),
      } as unknown as Response;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ id: "12345" }),
    } as unknown as Response;
  });

  const result = await createOrUpdateHubSpotProduct({
    brand: "ObscureBrand",
    model: "X100",
  });

  expect(result.hubspotProductId).toBe("12345");
  expect(result.warnings?.[0]).toMatch(/manufacturer/i);
  expect(callCount).toBe(2);
  // Second call body should NOT contain manufacturer
  const secondCallBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
  expect(secondCallBody.properties.manufacturer).toBeUndefined();
});
```

- [ ] **Step 3: Implement the fallback**

In `src/lib/hubspot.ts:2568-2587` (the existing `try { ... } catch { drop optionalProperties }` block), narrow the retry to specifically detect the manufacturer-enum error and only drop `manufacturer` (not all optional properties):

```typescript
function isManufacturerEnumRejection(message: string): boolean {
  return /manufacturer.*(?:was not|is not).+(allowed|enum|valid options)/i.test(message)
    || /Property "manufacturer" was not one of/i.test(message);
}

try {
  return await upsertHubSpotProductRecord(token, existingId, withOptional);
} catch (error) {
  const message = getErrorMessage(error);

  // Narrow retry: just manufacturer
  if (hasOptional && isManufacturerEnumRejection(message)) {
    console.warn(`[HubSpot] Brand "${brand}" not in manufacturer enum. Retrying without manufacturer property.`);
    const withoutMfg = { ...withOptional };
    delete withoutMfg.manufacturer;
    // Optionally: stash brand in vendor_name as fallback if not already set
    if (brand && !withoutMfg.vendor_name) {
      withoutMfg.vendor_name = brand;
    }
    const result = await upsertHubSpotProductRecord(token, existingId, withoutMfg);
    return {
      ...result,
      warnings: [`Brand "${brand}" is not in the HubSpot manufacturer enum — written to vendor_name as fallback.`],
    };
  }

  // Existing wide retry (drop all optional) for other 400s
  if (!hasOptional || !message.includes("(400)")) {
    throw error;
  }

  // ...existing wide-retry block...
}
```

- [ ] **Step 4: Run the test**

```bash
npm run test -- hubspot
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubspot.ts src/__tests__/lib/hubspot.test.ts
git commit -m "fix(hubspot): graceful fallback when brand isn't in manufacturer enum

createOrUpdateHubSpotProduct now detects HubSpot 400 errors that
specifically reject manufacturer, retries without it (writing the
brand into vendor_name as a fallback if vendor_name is empty),
and surfaces a warning. Previously the entire HubSpot push would
fail and the brand would be lost from HubSpot entirely."
```

---

### Milestone 2 — Ship Checkpoint

- [ ] All Milestone 2 tasks complete and tests passing
- [ ] PR opened: `fix(catalog): data integrity — cross-links, race-safety, manufacturer fallback`
- [ ] PR merged → Vercel deploy succeeds
- [ ] Manual smoke: in Sync Modal, create a brand-new external record (e.g., create a Zoho item for a product that already exists in HubSpot/Zuper). Verify the new Zoho item gets `cf_hubspot_product_id` and `cf_internal_product_id` populated.
- [ ] Manual smoke: submit a wizard product with an obscure brand HubSpot doesn't recognize. Verify the HubSpot push succeeds (with a warning) and the brand lands in `vendor_name`.
- [ ] Query ActivityLog: `SELECT * FROM "ActivityLog" WHERE type IN ('CATALOG_SYNC_EXECUTED', 'CATALOG_SYNC_FAILED') ORDER BY "createdAt" DESC LIMIT 20;` — confirm cross-link warnings are surfacing in the metadata.
- [ ] **Soak for 24h**, then proceed to Milestone 3.

---

## Chunk 3: Milestone 3 — Coverage expansion

**Why third:** Additive, low-risk. Bottlenecked on Zach data (Zoho group names, Zuper custom field availability).

**Goal:** Get more of the spec data we collect into HubSpot, Zoho, and Zuper. Specifically: (a) confirm Zoho group names so non-MODULE/INVERTER products land in their proper Zoho group, (b) wire spec field → HubSpot property mappings for all categories where HubSpot already has a property defined, (c) add `zuperCustomField` and `zohoCustomField` support to FieldDef so future additions don't need code changes.

### Task 3.1: Switch Zoho writes from `group_name` to `category_id` + populate mappings (REVISED 2026-04-24)

> **Implementation per** [companion spec § 1](../specs/2026-04-24-catalog-sync-external-mappings.md). The original "flip 12 entries to confirmed" task was based on a wrong assumption — `group_name` is essentially unused in our prod Zoho org. The real field is `category_name`/`category_id`.

**Files:**
- Modify: `src/lib/zoho-taxonomy.ts` — rename `groupName` → `categoryName` + add `categoryId`; rebuild registry per spec table
- Modify: `src/lib/zoho-inventory.ts:850-907` — swap `group_name: groupName` for `category_id: categoryId` (or `category_name` fallback if no ID) in BOTH the create and update paths
- Modify: `src/__tests__/lib/zoho-taxonomy.test.ts` — assert new shape and confirmed mappings
- Optional follow-up (separate PR): backfill script to update existing Zoho items with correct category_id

**Prerequisites:**
1. Zach confirms the MEDIUM-confidence rows in the companion spec mapping table (esp. BATTERY/EV_CHARGER assignments)
2. Fix `scripts/_pull-zoho-item-groups.ts` to surface category IDs (script's `/categories` parser uses `name` not `category_name` — already noted in companion spec § 1 "Pending: pull category IDs"). Re-run script. Use those IDs in `zoho-taxonomy.ts`.

- [ ] **Step 1: Read Zach's group-name answers (from where he posted them — likely in Slack DM, email, or directly in this plan)**

If not yet provided, surface the question to Zach: *"Need the Zoho Inventory item-group names for: BATTERY, BATTERY_EXPANSION, EV_CHARGER, RACKING, MONITORING, GATEWAY, OPTIMIZER, ELECTRICAL_BOS, RAPID_SHUTDOWN, TESLA_SYSTEM_COMPONENTS, D_AND_R, SERVICE. Categories that don't exist in Zoho can be left as 'unresolved'."*

Block this task until you have the answers; do NOT guess.

- [ ] **Step 2: Edit `ZOHO_CATEGORY_MAP`**

For each category Zach confirmed, change the entry from `status: "unresolved"` (or `"likely"`) to:

```typescript
BATTERY: {
  groupName: "Battery", // ← Zach's actual value
  status: "confirmed",
},
```

For categories Zach said don't exist in Zoho:

```typescript
PROJECT_MILESTONES: {
  groupName: undefined,
  status: "confirmed",   // confirmed there's NO Zoho group, suppress warnings
  note: "Confirmed by Zach 2026-04-XX — no corresponding Zoho group, intentional",
},
```

(Add a `confirmed_no_group` status if you want explicit semantics; otherwise the `confirmed` + `groupName: undefined` combination suppresses the warning since `getZohoGroupName` only returns when status is `confirmed`.)

- [ ] **Step 3: Update `getZohoGroupName` to suppress warnings for confirmed-no-group**

In `src/lib/zoho-taxonomy.ts:123`, modify:

```typescript
export function getZohoGroupName(category: string): string | undefined {
  const mapping = ZOHO_CATEGORY_MAP[category];
  if (!mapping) {
    console.warn(`[zoho-taxonomy] Unknown category "${category}"...`);
    return undefined;
  }
  if (mapping.status === "confirmed") {
    return mapping.groupName; // may be undefined for confirmed-no-group; that's fine
  }
  console.warn(`[zoho-taxonomy] Category "${category}" has no confirmed Zoho group_name mapping...`);
  return undefined;
}
```

- [ ] **Step 4: Add a test guarding the confirmed list**

`src/__tests__/lib/zoho-taxonomy.test.ts` (create if missing):

```typescript
import { ZOHO_CATEGORY_MAP } from "@/lib/zoho-taxonomy";

test("all 16 EquipmentCategory values have an entry in ZOHO_CATEGORY_MAP", () => {
  const expected = [
    "MODULE", "INVERTER", "BATTERY", "BATTERY_EXPANSION", "EV_CHARGER",
    "RACKING", "ELECTRICAL_BOS", "MONITORING", "RAPID_SHUTDOWN", "OPTIMIZER",
    "GATEWAY", "D_AND_R", "SERVICE", "ADDER_SERVICES",
    "TESLA_SYSTEM_COMPONENTS", "PROJECT_MILESTONES",
  ];
  for (const cat of expected) {
    expect(ZOHO_CATEGORY_MAP[cat]).toBeDefined();
  }
});

test("no category remains 'likely' after Milestone 3 sign-off", () => {
  const stillLikely = Object.entries(ZOHO_CATEGORY_MAP)
    .filter(([, v]) => v.status === "likely");
  expect(stillLikely).toEqual([]);  // every entry should be confirmed or unresolved
});
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/zoho-taxonomy.ts src/__tests__/lib/zoho-taxonomy.test.ts
git commit -m "feat(catalog): confirm Zoho group_name mappings for all categories

Per Zach's review of the Zoho Inventory item-group list, flips
12 categories from unresolved/likely to confirmed. New products
created in those categories will now land in their proper Zoho
group instead of 'no group'."
```

---

### Task 3.2: Wire remaining HubSpot product property mappings

**Files:**
- Modify: `src/lib/catalog-fields.ts` (add `hubspotProperty` keys to existing FieldDef entries)

**Prerequisite:** Identify which HubSpot Product properties already exist for spec data. Run:

```bash
# In a Node REPL or one-off script with HUBSPOT_ACCESS_TOKEN:
curl -H "Authorization: Bearer $HUBSPOT_ACCESS_TOKEN" \
  https://api.hubapi.com/crm/v3/properties/products | jq '.results[] | {name, label, type}'
```

(or save that as a quick `scripts/list-hubspot-product-properties.ts`).

- [ ] **Step 1: Cross-reference HubSpot properties against unmapped spec fields**

For each spec field in `catalog-fields.ts` that doesn't have `hubspotProperty`, check the HubSpot list. Likely candidates that exist in HubSpot but aren't wired here:
- `efficiency` → `module_efficiency` (verify name)
- `cellType` → `cell_type` (verify)
- `chemistry` → `battery_chemistry` (verify)
- `mountType` → ? (probably none)
- `componentType` → ? (probably none)

For each match: add `hubspotProperty: "the_property_name"` to the FieldDef in `catalog-fields.ts`.

For each spec field where no HubSpot property exists: leave as-is, document in followups that a HubSpot property would need to be created.

- [ ] **Step 2: The `buildCategoryHubSpotEdges()` registry picks them up automatically**

No code change needed in `catalog-sync-mappings.ts` — it iterates `CATEGORY_CONFIGS` and emits edges for any field with `hubspotProperty`.

- [ ] **Step 3: Add tests**

`src/__tests__/lib/catalog-sync-mappings.test.ts` — extend with cases verifying the new edges:

```typescript
test("MODULE has efficiency → module_efficiency edge", () => {
  const edges = getSystemMappings("hubspot", "MODULE");
  expect(edges.find((e) => e.internalField === "efficiency"?.externalField === "module_efficiency"))
    .toBeDefined();
});
```

- [ ] **Step 4: Run tests**

```bash
npm run test -- catalog-fields catalog-sync-mappings
```

- [ ] **Step 5: Smoke**

Locally: edit a product via the Sync Modal, verify the new spec fields appear in the diff table for the HubSpot column.

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-fields.ts src/__tests__/lib/
git commit -m "feat(catalog): wire additional spec fields to HubSpot properties

Adds hubspotProperty keys for module efficiency, cell type, battery
chemistry, and any other spec fields that have a corresponding
HubSpot Product property. The mapping registry picks them up
automatically. Categories with no matching HubSpot property remain
internal-only (tracked in followups for future HubSpot property creation)."
```

---

### Task 3.3: Add `zuperCustomField`/`zohoCustomField` plumbing to mappings registry

This is the structural change that makes adding more Zuper/Zoho field mappings a one-line edit in `catalog-fields.ts` instead of a code change.

**Files:**
- Modify: `src/lib/catalog-sync-mappings.ts` — extend `buildCategoryHubSpotEdges` → generic per-system

- [ ] **Step 1: Refactor `buildCategoryHubSpotEdges` to handle all three systems**

Replace the existing function (line 140-167) with:

```typescript
const SYSTEM_KEY_MAP: Record<ExternalSystem, keyof FieldDef> = {
  hubspot: "hubspotProperty",
  zuper: "zuperCustomField",
  zoho: "zohoCustomField",
};

function buildCategoryExternalEdges(): FieldMappingEdge[] {
  const edges: FieldMappingEdge[] = [];
  for (const [category, config] of Object.entries(CATEGORY_CONFIGS)) {
    if (!config.fields) continue;
    for (const field of config.fields as FieldDef[]) {
      for (const system of Object.keys(SYSTEM_KEY_MAP) as ExternalSystem[]) {
        const externalKey = SYSTEM_KEY_MAP[system];
        const externalField = field[externalKey];
        if (typeof externalField !== "string") continue;
        edges.push({
          system,
          externalField,
          internalField: field.key,
          normalizeWith: field.type === "number" ? "number" : "trimmed-string",
          condition: { category: [category] },
        });
      }
    }
  }
  // Merge edges with same system+externalField+internalField but different categories
  const merged = new Map<string, FieldMappingEdge>();
  for (const edge of edges) {
    const key = `${edge.system}:${edge.externalField}:${edge.internalField}`;
    const existing = merged.get(key);
    if (existing && existing.condition && edge.condition) {
      existing.condition.category.push(...edge.condition.category);
    } else {
      merged.set(key, { ...edge });
    }
  }
  return Array.from(merged.values());
}
```

Update the only caller (`getAllMappingEdges()` at line 173):

```typescript
export function getAllMappingEdges(): FieldMappingEdge[] {
  if (!_allEdges) {
    _allEdges = [...STATIC_EDGES, ...buildCategoryExternalEdges()];
  }
  return _allEdges;
}
```

- [ ] **Step 2: Verify nothing breaks (no Zuper/Zoho custom fields are populated yet)**

Run:
```bash
npm run test -- catalog-sync-mappings
```

All existing tests must pass — the function should produce the same edges as before (since no `zuperCustomField` or `zohoCustomField` keys are populated yet).

- [ ] **Step 3: Add a test verifying the new plumbing works**

```typescript
test("buildCategoryExternalEdges emits Zuper edges when zuperCustomField is set", () => {
  // Temporarily monkey-patch a category config to test the edge generation
  const original = CATEGORY_CONFIGS.MODULE.fields;
  CATEGORY_CONFIGS.MODULE.fields = [
    ...original,
    { key: "testField", label: "Test", type: "text", zuperCustomField: "test_zuper" },
  ];
  // Reset cache
  (getAllMappingEdges as { _reset?: () => void })._reset?.();

  const edges = getSystemMappings("zuper", "MODULE");
  expect(edges.find((e) => e.externalField === "test_zuper")).toBeDefined();

  // Restore
  CATEGORY_CONFIGS.MODULE.fields = original;
});
```

(Implementing a `_reset` for the cached edges may be needed; alternatively, refactor to not cache during tests.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/catalog-sync-mappings.ts src/__tests__/lib/catalog-sync-mappings.test.ts
git commit -m "refactor(catalog): generalize category-conditional mapping edges

buildCategoryHubSpotEdges renamed to buildCategoryExternalEdges,
now also emits Zuper and Zoho category-conditional edges from the
zuperCustomField / zohoCustomField keys on FieldDef. No mappings
are populated for those systems yet; this is the plumbing for
Task 3.4 and any future spec field additions."
```

---

### Task 3.4: Define and wire Zuper custom fields (REVISED 2026-04-24 — Zach confirmed YES)

> **Implementation per** [companion spec § 2](../specs/2026-04-24-catalog-sync-external-mappings.md). 15 proposed Zuper custom fields across MODULE/INVERTER/BATTERY/EV_CHARGER/RACKING. Skipped fields documented in the companion spec's "Skipped" subsection — easy to promote later.

**Sequencing (gated):**

1. Zach reviews the proposed schema in companion spec § 2 and approves field keys/labels/types.
2. Zach (or a script — see open question 2.3 in spec) defines the 15 fields in Zuper admin. Custom fields must exist in Zuper BEFORE the code changes ship — otherwise the sync writes get rejected.
3. Code changes:
   - `src/lib/catalog-fields.ts` — add `zuperCustomField: "pb_module_wattage"` etc. per the spec table
   - `src/lib/zuper-catalog.ts:754-839` — extend `createOrUpdateZuperPart` to accept `customFields?: Record<string, unknown>` and nest as `custom_fields` in payload
   - `src/lib/catalog-push-approve.ts:411-423` — build customFields dict from metadata filtered through `getCategoryFields(category)` looking for entries with `zuperCustomField` set, pass to `createOrUpdateZuperPart`
   - `src/lib/catalog-sync.ts` `executeZuperSync` update path — route `custom_fields` updates through Zuper's nested payload structure
4. Optional one-time backfill script per companion spec § 2 open Q 2.2.

This is a meaningful chunk — likely its own PR. Scope it carefully and ship after the rest of M3.

---

### Task 3.5: Wire dimensions to Zuper

**Files:**
- Modify: `src/lib/zuper-catalog.ts:125-145` (`UpsertZuperPartInput`), `:754-839` (`createOrUpdateZuperPart`)

This is small. Zuper's Product object accepts `length`, `width`, `weight` (verify via Zuper docs or by inspecting an existing product's payload).

- [ ] **Step 1: Extend `UpsertZuperPartInput`**

```typescript
export interface UpsertZuperPartInput {
  // ...existing fields...
  length?: number | null;
  width?: number | null;
  weight?: number | null;
}
```

- [ ] **Step 2: Add to `optionalPayload` in `createOrUpdateZuperPart`**

In `src/lib/zuper-catalog.ts:784`:

```typescript
const optionalPayload: JsonRecord = {
  ...corePayload,
  // ...existing fields...
  ...(isFiniteNumber(input.length) ? { length: input.length } : {}),
  ...(isFiniteNumber(input.width) ? { width: input.width } : {}),
  ...(isFiniteNumber(input.weight) ? { weight: input.weight } : {}),
};
```

- [ ] **Step 3: Pass dimensions from callers**

In `src/lib/catalog-push-approve.ts:411-423` (Zuper block), add:
```typescript
length: push.length,
width: push.width,
weight: push.weight,
```

- [ ] **Step 4: Test + commit**

```bash
npm run test -- zuper
git add src/lib/zuper-catalog.ts src/lib/catalog-push-approve.ts
git commit -m "feat(zuper): pass dimensions on product create

length/width/weight now flow through to Zuper's Product object
optional payload. Drops out of the optional retry if Zuper's
schema doesn't accept them — same pattern as existing fields."
```

---

### Milestone 3 — Ship Checkpoint

- [ ] All Milestone 3 tasks complete and tests passing
- [ ] PR opened: `feat(catalog): expand spec field coverage in HubSpot/Zoho/Zuper`
- [ ] PR merged → Vercel deploy succeeds
- [ ] Manual smoke: create a new MODULE via wizard, verify the new HubSpot properties (efficiency, cellType, etc.) populate
- [ ] Manual smoke: create a new BATTERY via wizard, verify it lands in the correct Zoho group
- [ ] **Soak for 24h**, then proceed to Milestone 4.

---

## Chunk 4: Milestone 4 — Optional follow-ups

These are independent. Pick whichever ones matter; defer the rest. Each is sized to be a single PR.

### Task 4.1: HubSpot product photo upload

Today the wizard photo only goes to Zoho. HubSpot's Files API can attach images to records, but Products don't have a first-class image field — you'd attach via Note or use the `image_url` property if it exists.

- [ ] Investigate: does the HubSpot Products object have an `image_url` or `hs_image_url` property?
- [ ] If yes: upload the blob to HubSpot Files API, get the URL, set `image_url` on the Product. ~half-day.
- [ ] If no: attach as a note instead, or skip and document.

Defer if photos aren't critical for HubSpot users.

### Task 4.2: Zuper product photo upload

Zuper's Product API likely supports image upload via a separate endpoint (like Zoho's). Investigate and replicate the Zoho pattern in `src/lib/zuper-catalog.ts`. ~half-day.

### Task 4.3: Auto-seed `InventoryStock` rows on product creation

**Decision needed (Zach Open Q #4).** If yes:

- [ ] In `executeCatalogPushApproval` after the INTERNAL block succeeds, insert one `InventoryStock` row per PB location with `quantityOnHand: 0`. Locations come from the existing `pb-locations.ts` constants (or whichever location source is canonical).
- [ ] Add `INVENTORY_STOCK_INITIALIZED` ActivityType if helpful, or just log under the existing `CATALOG_PRODUCT_CREATED`.

### Task 4.4: Anomaly digest entry for non-admin wizard submissions

Per D7. The existing audit anomaly digest (`src/lib/compliance-*.ts`, `/api/cron/`) already runs nightly. Add a query that selects `CATALOG_PRODUCT_CREATED` ActivityLog rows where `userEmail` doesn't belong to an ADMIN/EXECUTIVE/PROJECT_MANAGER user, and include them in the digest as informational. ~2-3 hours.

### Milestone 4 — Ship Checkpoint

Each task ships independently as its own PR. No bundled checkpoint.

---

## Chunk 5: Open Questions and Closing Notes

### Open Questions — ALL RESOLVED 2026-04-24

See the [companion spec § 4 decisions log](../specs/2026-04-24-catalog-sync-external-mappings.md#4-decisions-log-all-resolved-2026-04-24) for the full table. Summary:

- Zoho mapping: create new "Battery" + "EV Charger" categories in Zoho admin; pin writes by `category_id`
- Zuper: 15-field schema approved, mobile-visible, backfill existing products
- HubSpot: phased manufacturer-enforcement rollout; re-brand 106 Generic products; keep Eaton/Cutler-Hammer separate; standardize Unirac casing; merge Multiple; delete 3 test products
- Stock auto-seed: no (keep manual)
- Wizard auth: keep open with audit flag

**The plan is unblocked for implementation.** All Phase A code work (M1+M2+M3 plumbing) can proceed independently. Phase B (HubSpot enum backfill, Generic re-branding, dedup, Zoho category creation, Zuper field admin work) is operational work that runs in parallel.

### Coverage of the original 12 gaps

| # | Gap from health-check | Addressed by |
|---|---|---|
| 1 | Sync Modal cross-link writes missing | Tasks 2.1, 2.2 |
| 2 | No catalog ActivityLog entries | Tasks 1.2, 1.3, 1.4 |
| 3 | Zoho group_name unconfirmed for 12 categories | Task 3.1 (needs Zach data) |
| 4 | ~30 spec fields not mapped externally | Tasks 3.2, 3.3, 3.4 (partial, more incremental work after) |
| 5 | No CatalogSyncLog table | Decision D1 — reuse ActivityLog (M1) |
| 6 | Photo upload Zoho-only | Tasks 4.1, 4.2 (optional) |
| 7 | Dimensions don't reach Zuper | Task 3.5 |
| 8 | HubSpot manufacturer enum dead-end | Task 2.4 |
| 9 | Race on guarded link-back | Task 2.3 |
| 10 | Wizard auth vs Sync Modal auth asymmetry | Decision D7 + Task 4.4 (audit-flag, don't restrict) |
| 11 | Stock not auto-created | Task 4.3 (optional, decision needed) |
| 12 | QBO/OpenSolar slots unwired | Out of scope — separate specs |

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Migration applied without code → enum values referenced by older deploys cause Prisma errors | Low | Low (additive only — old code doesn't reference new values) | Sequencing: migration first, code second is correct per `feedback_migration_ordering.md` |
| Race fix's transactional re-fetch creates new deadlock surface | Low | Medium | Test with concurrent simulation in Task 2.3 Step 1; if real DB bites, fall back to advisory locks |
| Zuper custom fields cause `optionalPayload` create to 4xx | Medium | Low | The existing core/optional retry pattern in `createOrUpdateZuperPart` already handles this — drops to core payload + warning |
| HubSpot manufacturer fallback writes brand into vendor_name and clobbers a real vendor | Medium | Low | Only fall back when vendor_name is empty (`!withoutMfg.vendor_name` check) |
| ActivityLog row-count growth from 4 new types overwhelms storage | Low | Low | Existing audit retention cron (`/api/cron/audit-retention`) handles cleanup |
| Zoho group_name change for existing items causes confusion | Medium | Low | The change only affects newly-created items; existing items keep their current group. Document this in the PR. |

### What this plan does NOT do

- Doesn't backfill ActivityLog for past sync runs — only forward.
- Doesn't expose a "sync history" UI on individual product pages — admin activity log filter is the surface.
- Doesn't add a sync retry queue or background job — keeps the synchronous request-response shape.
- Doesn't refactor the wizard or Sync Modal UX — purely backend/data-integrity work.
- Doesn't change the BOM pipeline's catalog matching logic.

### Suggested PR sequencing

1. PR 1 (M1.1): schema migration only — small, additive, ships solo. Apply migration to prod **before** merging the next PR.
2. PR 2 (M1.2-1.5): observability wiring — depends on the new enum values existing in prod.
3. PR 3 (M2.1, M2.2): cross-link extraction + Sync Modal wiring — single logical change.
4. PR 4 (M2.3): race-safe link-back — independent.
5. PR 5 (M2.4): manufacturer fallback — independent.
6. PR 6 (M3.1): Zoho group_name confirmation — data only.
7. PR 7 (M3.2-3.5): mapping registry expansion + dimensions — bundled.
8. PRs 8+: M4 tasks individually as desired.

Total scope ~8 PRs across ~2-3 weeks of focused work, but Milestones 1 and 2 (the highest-value 5 PRs) are ~1 week of work and capture the real damage prevention.

---

## Execution Notes for the Implementing Agent

- This is a multi-PR, multi-day plan. **Use the `superpowers:subagent-driven-development` skill** — fresh subagent per task, reviewer after each chunk. Don't try to bang out the whole thing in one session.
- Per `feedback_subagents_no_migrations.md`: subagents may write migration files but **may not run** `prisma migrate deploy`. Orchestrator-only with explicit user approval.
- Per `feedback_api_route_role_allowlist.md`: this plan adds NO new API routes (only modifies existing ones). No role allowlist edits needed.
- Per `feedback_no_slack.md`: notification channels for any new alerts are SMS/email/HubSpot tasks, not Slack. The new ActivityLog rows feed the existing audit digest email — no new outbound channel needed.
- Per `feedback_self_review_dont_kick_to_user.md`: handle code review yourself via subagents; only escalate to Zach for the documented Open Questions.
- Per `feedback_debug_myself.md`: if anything breaks in prod after a milestone ships, debug via Vercel logs / Sentry / direct DB query — don't ask Zach to paste anything.

When the plan is complete and tests pass, end with: *"Catalog sync hardening Milestones 1-3 complete. ActivityLog populated, cross-links wired, race condition closed, Zoho groups confirmed, additional spec fields synced. M4 tasks deferred per scope. Ready for review and merge sequence."*
