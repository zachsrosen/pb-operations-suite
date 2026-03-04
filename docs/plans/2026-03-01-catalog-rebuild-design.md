# Catalog Rebuild — Design Doc

**Date:** 2026-03-01
**Scope:** Full product catalog deduplication, cross-system linking, and lock-down
**Depends on:** Product cleanup plan (Tasks A-G, merged), product submission form, pending-push workflow

---

## Problem

The product catalog has accumulated duplicates across four external systems (Zoho Inventory, HubSpot, Zuper, QuickBooks) and the internal `EquipmentSku` table. Differences in formatting (dashes vs spaces, capitalization, abbreviations) cause `canonicalToken()` collisions that bypass the DB's exact `(category, brand, model)` unique constraint. No single external system is authoritative. BOM extraction via `syncEquipmentSkus` silently creates new rows on any minor mismatch, and there is no enforcement preventing future drift.

**Goal:** Harvest all products from all sources, deduplicate within each, cross-match across systems, build a clean internal catalog fully linked to all external records, then lock down creation paths so all future products must go through the submission form.

---

## Design Principles

| Principle | Detail |
|-----------|--------|
| No single source of truth | Each external system contributes fields; canonical record is derived, not copied from one system |
| Idempotent end-to-end | Every phase can re-run without side effects; mutations use upsert/merge semantics |
| Confidence-gated | Auto-link only at high confidence (>=80); medium (50-79) and ambiguous go to review queue |
| Provenance preserved | Every link stores `matchMethod`, `matchScore`, `confirmedBy`, `confirmedAt`; field-level provenance tracks which source contributed each value |
| Rollout in order | Phase 1 (harvest) is read-only, Phase 2 (build) creates/updates, Phase 3 (lock-down) only after metrics are healthy |
| Controlled exceptions | Lock-down allows admin overrides with full audit trail |

---

## Phase 1 — Harvest & Dedupe

### 1.1 Harvest

Pull the full product catalog from each source:

| Source | Method | Fields |
|--------|--------|--------|
| Zoho Inventory | `GET /items` (paginated, cached) | `item_id`, `name`, `sku`, `rate`, `purchase_rate`, `group_name`, `description` |
| HubSpot | `searchWithRetry` on Products | `hs_object_id`, `name`, `hs_sku`, `price`, `description` |
| Zuper | Products API | `product_uid`, `product_name`, `product_code`, `unit_price` |
| QuickBooks | Catalog sync | `externalId`, `name`, `sku`, `unitPrice` |
| Internal | Prisma `EquipmentSku.findMany()` | All columns |

Each record is wrapped in a `HarvestedProduct`:

```ts
interface HarvestedProduct {
  source: "zoho" | "hubspot" | "zuper" | "quickbooks" | "internal";
  externalId: string;
  rawName: string;
  rawBrand: string | null;
  rawModel: string | null;
  category: string | null;
  price: number | null;
  description: string | null;
  rawPayload: Record<string, unknown>; // full original record
}
```

### 1.2 Dedupe Within Source

For each source, group by **primary key** then apply **fallback keys** to catch duplicates:

**Key chain (in priority order):**
1. `canonicalToken(category) + "|" + canonicalToken(brand) + "|" + canonicalToken(model)` — primary
2. `canonicalToken(brand) + "|" + canonicalToken(model)` — cross-category fallback
3. `canonicalToken(name)` where `name` is the combined product name — broadest fallback
4. Vendor part number exact match (when both records have one)

**Cluster formation:** Records matching on any key are placed in the same dedupe cluster. Transitive — if A matches B on key 1 and B matches C on key 3, all three cluster together.

**Canonical selection (deterministic tie-breaking):**
1. Most fields populated (non-null count)
2. Preferred source quality order: Zoho > Internal > HubSpot > QuickBooks > Zuper
3. Newest `updatedAt` timestamp
4. Smallest `externalId` (lexicographic)

Winner becomes the cluster representative; losers are flagged as duplicates with `dedupeReason` and `sourceIds[]` lineage.

### 1.3 Parse Quality Signal

Each harvested product gets a `parseWarnings: string[]` array tracking extraction issues:
- `"missing_brand"` — brand could not be parsed from name
- `"missing_model"` — model could not be parsed
- `"ambiguous_category"` — category inferred but uncertain
- `"name_only"` — only raw name available, no structured fields

### 1.4 Harvest Report

Phase 1 output is a **read-only JSON report** (no mutations):

```ts
interface HarvestReport {
  generatedAt: string;
  sources: Record<string, {
    totalHarvested: number;
    dedupeClusters: number;
    duplicatesFound: number;
    parseWarnings: number;
  }>;
  clusters: DedupeCluster[];
  ambiguousClusters: DedupeCluster[]; // matched on fallback keys only
}

interface DedupeCluster {
  canonicalKey: string; // category|canonical(brand)|canonical(model)
  representative: HarvestedProduct;
  members: HarvestedProduct[];
  dedupeReason: string;
  sourceIds: string[]; // all original IDs in cluster
  ambiguityCount: number; // how many fallback-only matches
}
```

Admin reviews this report before proceeding to Phase 2.

---

## Phase 2 — Cross-Match & Build Internal Catalog

### 2.1 Graph Clustering

After intra-source deduplication, cross-source matching uses **graph clustering** (not just pairwise scoring):

1. Each dedupe-cluster representative becomes a node.
2. Edges are added between nodes with match score > 0, weighted by score.
3. **Connected components** at threshold >= 50 form match groups.
4. Within each match group, the canonical representative is selected using the same deterministic tie-breaking as Phase 1.

**Scoring signals:**

| Signal | Weight | Description |
|--------|--------|-------------|
| `canonicalToken(brand) + canonicalToken(model)` exact match | 40 | Core identity |
| `canonicalToken(name)` exact match | 20 | Catches reformatted names |
| Vendor part number exact match | 25 | Strong cross-system signal |
| Category match | 10 | Same equipment type |
| Price within 5% | 5 | Weak corroboration |

### 2.2 Stable Match Group Key

Each match group gets a **stable `matchGroupKey`** derived from sorted, normalized member IDs:

```ts
matchGroupKey = sha256(
  members.map(m => `${m.source}:${m.externalId}`).sort().join("|")
).slice(0, 16);
```

This key is used for upsert identity — **not** display fields like `category+brand+model`, which can change on re-harvest.

### 2.3 Confidence Gates

| Level | Score | Action |
|-------|-------|--------|
| High | >= 80 | Auto-create/update internal SKU, auto-link all members |
| Medium | 50-79 | Create match group record, queue for admin review before linking |
| Low | < 50 | Place in unmatched queue; review-first, do not auto-create |

### 2.4 Manual Decision Stickiness

Admin approvals/rejections are persisted and survive re-runs:

```ts
interface MatchDecision {
  matchGroupKey: string;
  decision: "approved" | "rejected" | "merged"; // merged = two groups combined
  decidedBy: string; // admin email
  decidedAt: DateTime;
  note: string?;
}
```

On re-run:
- If a `matchGroupKey` has a prior `approved` decision → auto-link (skip review)
- If `rejected` → skip (do not re-queue)
- If group membership changed (new members) → re-queue with note `"membership changed since last review"`

### 2.5 Internal SKU Creation/Update

For approved match groups:

1. **Upsert** `EquipmentSku` using `matchGroupKey` lookup (not `category+brand+model`).
2. Set field values from the canonical representative.
3. **Field-level provenance**: Track which source contributed each field:
   ```
   priceSource: "zoho:item_12345"
   nameSource: "internal:sku_abc"
   descriptionSource: "hubspot:prod_789"
   ```
4. Set external link columns (`zohoItemId`, `hubspotProductId`, `zuperItemId`, `quickbooksItemId`) from matched members.
5. **Uniqueness constraint**: Each `(source, externalId)` maps to exactly one internal SKU. If a re-run would re-assign an external record to a different SKU, flag for review instead of silently moving it.

### 2.6 Persisted Normalized Columns

Add durable columns to `EquipmentSku` for indexed matching (no ad-hoc `canonicalToken()` in hot queries):

```prisma
model EquipmentSku {
  // ... existing fields ...
  canonicalBrand  String?
  canonicalModel  String?
  canonicalKey    String?   // "category|canonicalBrand|canonicalModel"

  @@index([canonicalKey])
  @@index([canonicalBrand, canonicalModel])
}
```

Populated by a migration backfill and kept in sync by the SKU create/update paths.

### 2.7 Schema Additions

New models/enums needed:

```prisma
enum MatchConfidence {
  HIGH
  MEDIUM
  LOW
}

enum MatchDecisionStatus {
  PENDING
  APPROVED
  REJECTED
  MERGED
}

model CatalogMatchGroup {
  id              String               @id @default(cuid())
  matchGroupKey   String               @unique
  confidence      MatchConfidence
  canonicalBrand  String?
  canonicalModel  String?
  category        String?
  score           Float
  memberSources   Json                 // [{ source, externalId, rawName }]
  fieldProvenance Json?                // { priceSource, nameSource, ... }
  needsReview     Boolean              @default(false)
  reviewReason    String?

  // Decision tracking
  decision        MatchDecisionStatus  @default(PENDING)
  decidedBy       String?
  decidedAt       DateTime?
  decisionNote    String?

  // Result
  internalSkuId   String?
  linkedAt        DateTime?

  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@index([confidence])
  @@index([decision])
  @@index([needsReview])
}
```

### 2.8 Replace vs Migrate

The existing ~138 internal SKUs are **replaced entirely**:
- Phase 2 builds fresh SKUs from the matched results
- Old SKUs that match are updated in place (preserving IDs where possible for foreign key continuity)
- Old SKUs with no match group are flagged for manual review or deactivation
- `isActive = false` for unmatched old SKUs (not hard-deleted, for audit trail)

---

## Phase 3 — Lock Down & Prevention

### 3.1 BOM Extraction Fuzzy Matching

**Current behavior:** `syncEquipmentSkus` does exact `INSERT ON CONFLICT (category, brand, model)` — any formatting difference creates a new row.

**New behavior:**
1. Normalize incoming `(brand, model)` and query against persisted `canonicalKey` index.
2. **Exactly one match** → use existing SKU ID (no insert).
3. **Zero matches** → create a `PendingCatalogPush` with `source: "bom_extraction"` context (see 3.3).
4. **Multiple matches (ambiguous)** → create a `PendingCatalogPush` with `reviewReason: "ambiguous_bom_match"` and `candidateSkuIds` in metadata. **Do not auto-attach** — ambiguous matches are high-risk false positives.

### 3.2 Submission Form as Default Path

All new products must go through the submission form:
- **Required fields:** `category`, `brand`, `model`
- **External link requirement:** Configurable by category/workflow. Default: at least one external source link required. Categories marked `allowInternalOnly: true` can skip this with an explicit warning banner.
- **Canonical uniqueness check:** On submit, warn if `canonicalKey` matches an existing SKU (offer to link instead of create).
- **Source link uniqueness check:** Reject if the external ID is already linked to another SKU.
- **Provenance:** `createdVia: "submission_form"`, `createdBy: userEmail`.

### 3.3 Extend Existing `PendingCatalogPush`

Reuse the existing `PendingCatalogPush` model (not a new table) with additions:

```prisma
enum PushStatus {
  PENDING
  APPROVED
  REJECTED
  EXPIRED        // new
}

model PendingCatalogPush {
  // ... existing fields ...

  // New fields for catalog rebuild
  canonicalKey      String?   // "category|canonical(brand)|canonical(model)"
  source            String?   // "submission_form" | "bom_extraction" | "admin_override" | "import"
  candidateSkuIds   String[]  // for ambiguous matches: possible SKU IDs to link to
  reviewReason      String?   // "ambiguous_bom_match" | "no_match" | "membership_changed" etc.
  expiresAt         DateTime? // set on creation for bom_extraction source

  @@index([canonicalKey, status])
  @@index([source])
  @@index([expiresAt])
}
```

**Partial unique constraint** on `(canonicalKey)` where `status = PENDING` — prevents duplicate pending requests for the same product. Since Prisma cannot express partial uniques natively, this requires a **raw SQL migration**:

```sql
CREATE UNIQUE INDEX "PendingCatalogPush_canonicalKey_pending_unique"
  ON "PendingCatalogPush" ("canonicalKey")
  WHERE "status" = 'PENDING' AND "canonicalKey" IS NOT NULL;
```

### 3.4 Admin Override Path

For urgent corrections that can't wait for the form:

1. **Endpoint:** `POST /api/inventory/skus` with `override: true` flag.
2. **Access:** `ADMIN` and `OWNER` roles only.
3. **Confirmation:** Generalized HMAC confirmation token (see 3.6).
4. **Provenance:** `createdVia: "admin_override"`, `overrideReason` (required free-text).
5. **Audit:** Override logged to `CatalogAuditLog` with admin email, timestamp, reason, SKU snapshot.
6. **Dashboard badge:** Override-created SKUs show a distinct indicator in catalog UI.

### 3.5 Expiration Job

Pending push requests from BOM extraction auto-expire:

| Setting | Value |
|---------|-------|
| TTL | 90 days from `createdAt` |
| Cadence | Daily scheduled task (Vercel cron or equivalent) |
| Endpoint | `POST /api/catalog/expire-pending` (internal, CRON-authed) |
| Logic | `UPDATE PendingCatalogPush SET status = 'EXPIRED' WHERE status = 'PENDING' AND expiresAt < NOW()` |
| Idempotency | Re-running is safe; already-expired rows are no-ops |
| Audit | Log count of expired items per run |

### 3.6 Generalized Confirmation Helper

The current `product-cleanup-confirmation.ts` is cleanup-specific. Extract to a generic module:

```
src/lib/admin-action-confirmation.ts
```

Supports: catalog cleanup, SKU deletion, admin override creation, bulk operations. Same HMAC-SHA256 + `timingSafeEqual` + 5-minute TTL pattern, parameterized by action type and payload hash.

### 3.7 Lock Down All Creation Paths

Audit and gate every path that can create an `EquipmentSku`:

| Path | Current | After Lock-Down |
|------|---------|-----------------|
| `syncEquipmentSkus` (BOM extraction) | Direct `INSERT ON CONFLICT` | Fuzzy match → existing SKU or `PendingCatalogPush` |
| Submission form | Creates SKU | No change (this is the blessed path) |
| Push approval (`/api/catalog/push/[id]/approve`) | Creates SKU from pending | No change (admin-gated) |
| Admin override (`POST /api/inventory/skus?override=true`) | Creates SKU | Requires HMAC token + `overrideReason` |
| Seed/import scripts | Direct Prisma inserts | Must use submission or override path; scripts gate behind `CATALOG_LOCKDOWN_ENABLED` |
| `POST /api/inventory/skus` (standard) | Creates SKU | Reject unless via submission form or override; check `createdVia` |

### 3.8 Rollout

| Step | Gate | Action |
|------|------|--------|
| 1 | Phase 2 complete, match metrics healthy | Deploy fuzzy-match + lockdown behind `CATALOG_LOCKDOWN_ENABLED=false` |
| 2 | Flag off | BOM extraction runs normally; fuzzy-match in **shadow mode** (logs what it would do, no behavior change) |
| 3 | Shadow metrics reviewed by admin | Enable `CATALOG_LOCKDOWN_ENABLED=true` — fuzzy-match live, unmatched items create pending pushes |
| 4 | 1-2 weeks stable | Remove old direct-insert path from `syncEquipmentSkus` |

### 3.9 Controlled Exceptions

- **Admin override** (3.4): Always available, always audited.
- **Bulk import**: New external system onboarding uses override path with batch reason (e.g., `"Initial Zoho catalog import 2026-Q2"`).
- **Emergency bypass**: `CATALOG_LOCKDOWN_BYPASS=true` env var disables lockdown entirely (incident response). Logged prominently. Must not be left on.

---

## Migration Plan

### Schema Changes (in order)

1. Add `EXPIRED` to `PushStatus` enum
2. Add columns to `PendingCatalogPush`: `canonicalKey`, `source`, `candidateSkuIds`, `reviewReason`, `expiresAt`
3. Add columns to `EquipmentSku`: `canonicalBrand`, `canonicalModel`, `canonicalKey`
4. Create `CatalogMatchGroup` model
5. Add indexes on new columns
6. Raw SQL: partial unique index on `PendingCatalogPush(canonicalKey)` where `status = 'PENDING'`
7. Backfill `canonicalBrand`, `canonicalModel`, `canonicalKey` on all existing `EquipmentSku` rows

### New Files

| File | Purpose |
|------|---------|
| `src/lib/catalog-harvest.ts` | Harvest adapters for all 5 sources |
| `src/lib/catalog-dedupe.ts` | Intra-source deduplication with key chain |
| `src/lib/catalog-matcher.ts` | Cross-source graph clustering + scoring |
| `src/lib/catalog-builder.ts` | SKU creation/update from match groups |
| `src/lib/admin-action-confirmation.ts` | Generalized HMAC confirmation (extracted from cleanup) |
| `src/app/api/catalog/harvest/route.ts` | Trigger Phase 1, return report |
| `src/app/api/catalog/match/route.ts` | Trigger Phase 2, return match results |
| `src/app/api/catalog/review/route.ts` | Admin review queue: approve/reject match groups |
| `src/app/api/catalog/expire-pending/route.ts` | Cron job for pending push expiration |
| `src/app/dashboards/catalog/rebuild/page.tsx` | Admin UI for harvest report + match review |
| `prisma/migrations/XXX_catalog_rebuild/` | Schema migration |
| `prisma/migrations/XXX_catalog_rebuild/backfill.sql` | Canonical key backfill |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/bom-snapshot.ts` | `syncEquipmentSkus` → fuzzy match against `canonicalKey` index |
| `src/app/api/inventory/skus/route.ts` | Gate creation behind submission form / override; populate canonical columns on create/update |
| `src/app/dashboards/catalog/page.tsx` | Show match group badges, override indicators |
| `src/lib/product-cleanup-confirmation.ts` | Extract to `admin-action-confirmation.ts` |
| `prisma/schema.prisma` | New models, enum additions, new columns |

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `CATALOG_LOCKDOWN_ENABLED` | Gates Phase 3 fuzzy-match + creation restrictions | `false` |
| `CATALOG_LOCKDOWN_BYPASS` | Emergency bypass (incident response only) | `false` |
| `CATALOG_PENDING_TTL_DAYS` | Days before pending BOM pushes expire | `90` |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Internal SKU count | Reduced from ~138 to true unique product count |
| Duplicate clusters found | 0 after rebuild (by canonical key) |
| External link coverage | >= 90% of active SKUs linked to >= 1 external system |
| BOM extraction false creates | 0 after lockdown (all unmatched → pending queue) |
| Pending push review backlog | < 20 items at any time |
| Shadow mode mismatches | < 5% of extractions differ from current behavior (validates fuzzy logic) |
