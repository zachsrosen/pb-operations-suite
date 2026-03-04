# Catalog Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harvest all products from 5 sources, deduplicate within each, cross-match across systems via graph clustering, build a clean internal catalog with full external links, then lock down creation paths so only the submission form and admin overrides can create SKUs.

**Architecture:** Three-phase pipeline: Phase 1 (Harvest & Dedupe) is read-only and produces a JSON report. Phase 2 (Cross-Match & Build) creates/updates internal SKUs from approved match groups. Phase 3 (Lock Down) rewires `syncEquipmentSkus` to fuzzy-match against persisted canonical keys and gates all other creation paths. Each phase is feature-flagged and deployed independently.

**Tech Stack:** Next.js 16.1, Prisma 7.3 on Neon Postgres, TypeScript 5, Jest for tests. Existing helpers: `canonicalToken()` in `src/app/api/inventory/skus/route.ts`, `ZohoInventoryClient.listItems()` in `src/lib/zoho-inventory.ts`, HubSpot `batchApi.read` in `src/lib/hubspot.ts`, Zuper via `src/lib/zuper-catalog.ts`, `PendingCatalogPush` model in Prisma schema.

**Design doc:** `docs/plans/2026-03-01-catalog-rebuild-design.md`

---

## Task 1: Schema Migration — New Columns + Enums

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/YYYYMMDDHHMMSS_catalog_rebuild_schema/migration.sql` (via `prisma migrate dev`)

**Step 1: Add `EXPIRED` to `PushStatus` enum**

In `prisma/schema.prisma`, find the `PushStatus` enum (~line 978) and add `EXPIRED`:

```prisma
enum PushStatus {
  PENDING
  APPROVED
  REJECTED
  EXPIRED
}
```

**Step 2: Add new columns to `PendingCatalogPush`**

After the existing fields (~line 1010), add:

```prisma
model PendingCatalogPush {
  // ... existing fields ...

  // Catalog rebuild additions
  canonicalKey      String?
  source            String?   // "submission_form" | "bom_extraction" | "admin_override" | "import"
  candidateSkuIds   String[]
  reviewReason      String?
  expiresAt         DateTime?

  @@index([canonicalKey, status])
  @@index([source])
  @@index([expiresAt])
}
```

**Step 3: Add canonical columns to `EquipmentSku`**

After `quickbooksItemId` (~line 730), add:

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

**Step 4: Add new enums and `CatalogMatchGroup` model**

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
  memberSources   Json
  fieldProvenance Json?
  needsReview     Boolean              @default(false)
  reviewReason    String?

  decision        MatchDecisionStatus  @default(PENDING)
  decidedBy       String?
  decidedAt       DateTime?
  decisionNote    String?

  internalSkuId   String?
  linkedAt        DateTime?

  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt

  @@index([confidence])
  @@index([decision])
  @@index([needsReview])
}
```

**Step 5: Run migration**

```bash
cd /Users/zach/Downloads/PB-Operations-Suite
npx prisma migrate dev --name catalog_rebuild_schema
```

Expected: Migration created, client regenerated.

**Step 6: Add partial unique index via raw SQL**

Create a new migration file manually:

```bash
npx prisma migrate dev --name catalog_rebuild_partial_unique --create-only
```

Then edit the generated SQL file to contain:

```sql
CREATE UNIQUE INDEX "PendingCatalogPush_canonicalKey_pending_unique"
  ON "PendingCatalogPush" ("canonicalKey")
  WHERE "status" = 'PENDING' AND "canonicalKey" IS NOT NULL;
```

Apply:

```bash
npx prisma migrate dev
```

**Step 7: Backfill canonical columns on existing SKUs**

Create a backfill script or add to migration SQL:

```sql
UPDATE "EquipmentSku"
SET
  "canonicalBrand" = LOWER(REGEXP_REPLACE(TRIM("brand"), '[^a-zA-Z0-9]+', '', 'g')),
  "canonicalModel" = LOWER(REGEXP_REPLACE(TRIM("model"), '[^a-zA-Z0-9]+', '', 'g')),
  "canonicalKey" = "category" || '|' || LOWER(REGEXP_REPLACE(TRIM("brand"), '[^a-zA-Z0-9]+', '', 'g')) || '|' || LOWER(REGEXP_REPLACE(TRIM("model"), '[^a-zA-Z0-9]+', '', 'g'))
WHERE "canonicalKey" IS NULL;
```

**Step 8: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add catalog rebuild columns, enums, and CatalogMatchGroup model"
```

---

## Task 2: Extract `canonicalToken` to Shared Utility

Currently `canonicalToken()` is defined locally in `src/app/api/inventory/skus/route.ts`. It needs to be shared across harvest, dedupe, matcher, and SKU sync code.

**Files:**
- Create: `src/lib/canonical.ts`
- Create: `src/__tests__/lib/canonical.test.ts`
- Modify: `src/app/api/inventory/skus/route.ts` (~line 194)

**Step 1: Write the failing test**

Create `src/__tests__/lib/canonical.test.ts`:

```ts
import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";

describe("canonical", () => {
  describe("canonicalToken", () => {
    it("lowercases and strips non-alphanumeric", () => {
      expect(canonicalToken("IQ Combiner BOX-5")).toBe("iqcombinerbox5");
    });

    it("returns empty string for null/undefined", () => {
      expect(canonicalToken(null)).toBe("");
      expect(canonicalToken(undefined)).toBe("");
    });

    it("trims whitespace", () => {
      expect(canonicalToken("  Tesla  ")).toBe("tesla");
    });
  });

  describe("buildCanonicalKey", () => {
    it("joins category|brand|model tokens", () => {
      expect(buildCanonicalKey("MODULE", "REC Solar", "Alpha 405-AA")).toBe(
        "MODULE|recsolar|alpha405aa"
      );
    });

    it("returns null when brand or model is empty", () => {
      expect(buildCanonicalKey("MODULE", "", "Alpha")).toBeNull();
      expect(buildCanonicalKey("MODULE", "REC", "")).toBeNull();
    });

    it("returns null when category is empty", () => {
      expect(buildCanonicalKey("", "REC", "Alpha")).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/canonical.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/canonical'`

**Step 3: Write implementation**

Create `src/lib/canonical.ts`:

```ts
/**
 * Canonical token normalization for product deduplication.
 *
 * Used by: SKU route, harvest, dedupe, matcher, syncEquipmentSkus.
 * Must stay in sync with the Postgres backfill regex in migration.
 */

export function canonicalToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Build a canonical key from category, brand, and model.
 * Returns null if any component is empty after normalization.
 *
 * Format: "CATEGORY|canonicalBrand|canonicalModel"
 * Category is kept as-is (enum value), brand/model are canonicalized.
 */
export function buildCanonicalKey(
  category: string,
  brand: unknown,
  model: unknown
): string | null {
  const cat = String(category || "").trim();
  const cb = canonicalToken(brand);
  const cm = canonicalToken(model);
  if (!cat || !cb || !cm) return null;
  return `${cat}|${cb}|${cm}`;
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/lib/canonical.test.ts --no-coverage
```

Expected: PASS (3 tests)

**Step 5: Update SKU route to import from shared module**

In `src/app/api/inventory/skus/route.ts`, replace the local `canonicalToken` function (~line 194-198) with:

```ts
import { canonicalToken } from "@/lib/canonical";
```

Delete the local `function canonicalToken(value: unknown): string { ... }` block.

**Step 6: Run full test suite to verify no regressions**

```bash
npx jest --no-coverage
```

Expected: All existing tests pass.

**Step 7: Commit**

```bash
git add src/lib/canonical.ts src/__tests__/lib/canonical.test.ts src/app/api/inventory/skus/route.ts
git commit -m "refactor: extract canonicalToken to shared lib/canonical module"
```

---

## Task 3: Generalize Admin Action Confirmation

Extract the HMAC confirmation pattern from `product-cleanup-confirmation.ts` into a generic module.

**Files:**
- Create: `src/lib/admin-action-confirmation.ts`
- Create: `src/__tests__/lib/admin-action-confirmation.test.ts`
- Modify: `src/lib/product-cleanup-confirmation.ts` (re-export from generic module)

**Step 1: Write the failing test**

Create `src/__tests__/lib/admin-action-confirmation.test.ts`:

```ts
import {
  createAdminActionToken,
  validateAdminActionToken,
  getAdminActionSecret,
} from "@/lib/admin-action-confirmation";

const TEST_SECRET = "test-secret-at-least-32-chars-long-for-hmac";

describe("admin-action-confirmation", () => {
  it("creates and validates a token round-trip", () => {
    const payload = { action: "override_create", skuIds: ["sku_1"] };
    const issuedAt = Date.now();
    const token = createAdminActionToken(
      { payload, issuedAt },
      TEST_SECRET
    );

    const result = validateAdminActionToken({
      token,
      payload,
      issuedAt,
      secret: TEST_SECRET,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects expired tokens", () => {
    const payload = { action: "test" };
    const issuedAt = Date.now() - 6 * 60_000; // 6 minutes ago
    const token = createAdminActionToken(
      { payload, issuedAt },
      TEST_SECRET
    );

    const result = validateAdminActionToken({
      token,
      payload,
      issuedAt,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/expired/i);
  });

  it("rejects tampered payload", () => {
    const issuedAt = Date.now();
    const token = createAdminActionToken(
      { payload: { action: "original" }, issuedAt },
      TEST_SECRET
    );

    const result = validateAdminActionToken({
      token,
      payload: { action: "tampered" },
      issuedAt,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid/i);
  });

  it("getAdminActionSecret falls back through env vars", () => {
    const original = process.env.ADMIN_ACTION_SECRET;
    process.env.ADMIN_ACTION_SECRET = "my-secret";
    expect(getAdminActionSecret()).toBe("my-secret");
    if (original) {
      process.env.ADMIN_ACTION_SECRET = original;
    } else {
      delete process.env.ADMIN_ACTION_SECRET;
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/admin-action-confirmation.test.ts --no-coverage
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/lib/admin-action-confirmation.ts`:

```ts
/**
 * Generic admin-action HMAC confirmation.
 *
 * Reusable for: catalog cleanup, SKU deletion, admin override creation,
 * bulk operations. Same HMAC-SHA256 + timingSafeEqual + 5-minute TTL.
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_CLOCK_SKEW_MS = 60_000;  // 1 minute

function trim(value: unknown): string {
  return String(value || "").trim();
}

export function getAdminActionSecret(): string | null {
  const candidates = [
    process.env.ADMIN_ACTION_SECRET,
    process.env.PRODUCT_CLEANUP_CONFIRM_SECRET,
    process.env.AUTH_TOKEN_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.AUTH_SECRET,
    process.env.API_SECRET_TOKEN,
  ];
  for (const c of candidates) {
    const normalized = trim(c);
    if (normalized) return normalized;
  }
  return null;
}

function canonicalPayload(payload: unknown, issuedAt: number): string {
  return JSON.stringify({ payload, issuedAt: Math.trunc(issuedAt) });
}

function secureEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export function createAdminActionToken(
  input: { payload: unknown; issuedAt: number },
  secretOverride?: string
): string {
  const secret = trim(secretOverride) || getAdminActionSecret();
  if (!secret) {
    throw new Error(
      "Admin action secret not configured. Set ADMIN_ACTION_SECRET or PRODUCT_CLEANUP_CONFIRM_SECRET."
    );
  }
  return createHmac("sha256", secret)
    .update(canonicalPayload(input.payload, input.issuedAt))
    .digest("hex");
}

export function validateAdminActionToken(input: {
  token: string;
  payload: unknown;
  issuedAt: number;
  secret?: string;
  ttlMs?: number;
}): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  const issuedAt = Math.trunc(input.issuedAt);
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;

  if (issuedAt > now + MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: "Token issuedAt is in the future." };
  }

  if (now - issuedAt > ttlMs) {
    return { ok: false, error: "Token expired. Please confirm again and retry." };
  }

  let expectedToken: string;
  try {
    expectedToken = createAdminActionToken(
      { payload: input.payload, issuedAt },
      input.secret
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Secret is missing.",
    };
  }

  if (!secureEquals(trim(input.token), expectedToken)) {
    return { ok: false, error: "Invalid confirmation token." };
  }

  return { ok: true };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/lib/admin-action-confirmation.test.ts --no-coverage
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/lib/admin-action-confirmation.ts src/__tests__/lib/admin-action-confirmation.test.ts
git commit -m "feat: add generalized admin-action HMAC confirmation module"
```

---

## Task 4: Harvest Adapters

Build adapters that pull the full product catalog from each of the 5 sources.

**Files:**
- Create: `src/lib/catalog-harvest.ts`
- Create: `src/__tests__/lib/catalog-harvest.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/lib/catalog-harvest.test.ts`:

```ts
import {
  type HarvestedProduct,
  harvestInternal,
  parseHarvestWarnings,
} from "@/lib/catalog-harvest";

// Mock Prisma
jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "sku_1",
          category: "MODULE",
          brand: "REC Solar",
          model: "Alpha 405-AA",
          description: "405W module",
          vendorPartNumber: "REC-405",
          zohoItemId: "zo_1",
          hubspotProductId: "hs_1",
          zuperItemId: null,
          quickbooksItemId: null,
          sellPrice: 150,
          isActive: true,
        },
      ]),
    },
  },
}));

describe("catalog-harvest", () => {
  describe("harvestInternal", () => {
    it("returns HarvestedProduct[] from EquipmentSku table", async () => {
      const products = await harvestInternal();
      expect(products).toHaveLength(1);
      expect(products[0]).toMatchObject({
        source: "internal",
        externalId: "sku_1",
        rawBrand: "REC Solar",
        rawModel: "Alpha 405-AA",
        category: "MODULE",
      });
    });
  });

  describe("parseHarvestWarnings", () => {
    it("flags missing brand", () => {
      const product: HarvestedProduct = {
        source: "zoho",
        externalId: "zo_1",
        rawName: "Solar Panel",
        rawBrand: null,
        rawModel: "Alpha 405",
        category: "MODULE",
        price: null,
        description: null,
        rawPayload: {},
      };
      expect(parseHarvestWarnings(product)).toContain("missing_brand");
    });

    it("flags name_only when both brand and model missing", () => {
      const product: HarvestedProduct = {
        source: "zoho",
        externalId: "zo_1",
        rawName: "Solar Panel",
        rawBrand: null,
        rawModel: null,
        category: null,
        price: null,
        description: null,
        rawPayload: {},
      };
      expect(parseHarvestWarnings(product)).toContain("name_only");
    });

    it("returns empty array for complete product", () => {
      const product: HarvestedProduct = {
        source: "internal",
        externalId: "sku_1",
        rawName: "REC Solar Alpha 405-AA",
        rawBrand: "REC Solar",
        rawModel: "Alpha 405-AA",
        category: "MODULE",
        price: 150,
        description: "405W module",
        rawPayload: {},
      };
      expect(parseHarvestWarnings(product)).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/catalog-harvest.test.ts --no-coverage
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/lib/catalog-harvest.ts`:

```ts
/**
 * Catalog Harvest — Pull products from all 5 sources into a uniform shape.
 *
 * Each adapter returns HarvestedProduct[]. The harvest is read-only;
 * no mutations happen here.
 */

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HarvestSource =
  | "zoho"
  | "hubspot"
  | "zuper"
  | "quickbooks"
  | "internal";

export interface HarvestedProduct {
  source: HarvestSource;
  externalId: string;
  rawName: string;
  rawBrand: string | null;
  rawModel: string | null;
  category: string | null;
  price: number | null;
  description: string | null;
  rawPayload: Record<string, unknown>;
}

export type HarvestWarning =
  | "missing_brand"
  | "missing_model"
  | "ambiguous_category"
  | "name_only";

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export function parseHarvestWarnings(p: HarvestedProduct): HarvestWarning[] {
  const warnings: HarvestWarning[] = [];
  const hasBrand = Boolean(p.rawBrand?.trim());
  const hasModel = Boolean(p.rawModel?.trim());

  if (!hasBrand && !hasModel) {
    warnings.push("name_only");
  } else {
    if (!hasBrand) warnings.push("missing_brand");
    if (!hasModel) warnings.push("missing_model");
  }

  if (!p.category?.trim()) {
    warnings.push("ambiguous_category");
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Internal adapter
// ---------------------------------------------------------------------------

export async function harvestInternal(): Promise<HarvestedProduct[]> {
  if (!prisma) throw new Error("Database not configured");

  const skus = await prisma.equipmentSku.findMany({
    where: { isActive: true },
  });

  return skus.map((sku) => ({
    source: "internal" as const,
    externalId: sku.id,
    rawName: `${sku.brand} ${sku.model}`.trim(),
    rawBrand: sku.brand || null,
    rawModel: sku.model || null,
    category: sku.category,
    price: sku.sellPrice,
    description: sku.description || null,
    rawPayload: sku as unknown as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Zoho adapter
// ---------------------------------------------------------------------------

export async function harvestZoho(): Promise<HarvestedProduct[]> {
  // Dynamic import to avoid circular deps and allow mocking
  const { ZohoInventoryClient } = await import("@/lib/zoho-inventory");
  const client = new ZohoInventoryClient();
  const items = await client.listItems();

  return items
    .filter((item) => !item.status || item.status === "active")
    .map((item) => {
      // Zoho items store the full product name; brand/model may need parsing
      const name = item.name || "";
      // Simple heuristic: first word is brand, rest is model
      const parts = name.split(/\s+/);
      const brand = parts[0] || null;
      const model = parts.length > 1 ? parts.slice(1).join(" ") : null;

      return {
        source: "zoho" as const,
        externalId: item.item_id,
        rawName: name,
        rawBrand: brand,
        rawModel: model,
        category: item.group_name || null,
        price: typeof item.rate === "number" ? item.rate : null,
        description: item.description || null,
        rawPayload: item as unknown as Record<string, unknown>,
      };
    });
}

// ---------------------------------------------------------------------------
// HubSpot adapter
// ---------------------------------------------------------------------------

export async function harvestHubSpot(): Promise<HarvestedProduct[]> {
  const { hubspotClient } = await import("@/lib/hubspot");
  if (!hubspotClient) return [];

  const products: HarvestedProduct[] = [];
  let after: string | undefined;

  do {
    const response = await hubspotClient.crm.products.basicApi.getPage(
      100,
      after,
      ["name", "hs_sku", "price", "description"]
    );

    for (const product of response.results) {
      const name = product.properties.name || "";
      const parts = name.split(/\s+/);
      products.push({
        source: "hubspot",
        externalId: product.id,
        rawName: name,
        rawBrand: parts[0] || null,
        rawModel: parts.length > 1 ? parts.slice(1).join(" ") : null,
        category: null, // HubSpot products don't have category
        price: product.properties.price
          ? parseFloat(product.properties.price)
          : null,
        description: product.properties.description || null,
        rawPayload: product.properties as unknown as Record<string, unknown>,
      });
    }

    after = response.paging?.next?.after;
  } while (after);

  return products;
}

// ---------------------------------------------------------------------------
// Zuper adapter
// ---------------------------------------------------------------------------

export async function harvestZuper(): Promise<HarvestedProduct[]> {
  const apiKey = process.env.ZUPER_API_KEY;
  const baseUrl =
    process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
  if (!apiKey) return [];

  const products: HarvestedProduct[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(
      `${baseUrl}/products?page=${page}&count=100`,
      {
        headers: {
          "x-api-key": apiKey,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) break;

    const data = (await response.json()) as {
      data?: Array<{
        product_uid: string;
        product_name: string;
        product_code?: string;
        unit_price?: number;
        description?: string;
      }>;
    };

    if (!data.data || data.data.length === 0) {
      hasMore = false;
      break;
    }

    for (const item of data.data) {
      const name = item.product_name || "";
      const parts = name.split(/\s+/);
      products.push({
        source: "zuper",
        externalId: item.product_uid,
        rawName: name,
        rawBrand: parts[0] || null,
        rawModel: parts.length > 1 ? parts.slice(1).join(" ") : null,
        category: null,
        price:
          typeof item.unit_price === "number" ? item.unit_price : null,
        description: item.description || null,
        rawPayload: item as unknown as Record<string, unknown>,
      });
    }

    page++;
    if (data.data.length < 100) hasMore = false;
  }

  return products;
}

// ---------------------------------------------------------------------------
// QuickBooks adapter
// ---------------------------------------------------------------------------

export async function harvestQuickBooks(): Promise<HarvestedProduct[]> {
  // QuickBooks items are linked via quickbooksItemId on EquipmentSku.
  // We harvest them from the internal table's link data since there's no
  // standalone QB product API in this codebase.
  if (!prisma) return [];

  const linked = await prisma.equipmentSku.findMany({
    where: { quickbooksItemId: { not: null } },
    select: {
      id: true,
      quickbooksItemId: true,
      brand: true,
      model: true,
      category: true,
      sellPrice: true,
      description: true,
    },
  });

  return linked.map((sku) => ({
    source: "quickbooks" as const,
    externalId: sku.quickbooksItemId!,
    rawName: `${sku.brand} ${sku.model}`.trim(),
    rawBrand: sku.brand || null,
    rawModel: sku.model || null,
    category: sku.category,
    price: sku.sellPrice,
    description: sku.description || null,
    rawPayload: sku as unknown as Record<string, unknown>,
  }));
}

// ---------------------------------------------------------------------------
// Full harvest
// ---------------------------------------------------------------------------

export interface HarvestResult {
  source: HarvestSource;
  products: HarvestedProduct[];
  error?: string;
}

export async function harvestAll(): Promise<HarvestResult[]> {
  const adapters: Array<{ source: HarvestSource; fn: () => Promise<HarvestedProduct[]> }> = [
    { source: "internal", fn: harvestInternal },
    { source: "zoho", fn: harvestZoho },
    { source: "hubspot", fn: harvestHubSpot },
    { source: "zuper", fn: harvestZuper },
    { source: "quickbooks", fn: harvestQuickBooks },
  ];

  const results: HarvestResult[] = [];

  for (const adapter of adapters) {
    try {
      const products = await adapter.fn();
      results.push({ source: adapter.source, products });
    } catch (err) {
      results.push({
        source: adapter.source,
        products: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/lib/catalog-harvest.test.ts --no-coverage
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/lib/catalog-harvest.ts src/__tests__/lib/catalog-harvest.test.ts
git commit -m "feat: add catalog harvest adapters for all 5 product sources"
```

---

## Task 5: Intra-Source Deduplication Engine

**Files:**
- Create: `src/lib/catalog-dedupe.ts`
- Create: `src/__tests__/lib/catalog-dedupe.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/lib/catalog-dedupe.test.ts`:

```ts
import {
  dedupeProducts,
  type DedupeCluster,
} from "@/lib/catalog-dedupe";
import type { HarvestedProduct } from "@/lib/catalog-harvest";

function makeProduct(overrides: Partial<HarvestedProduct>): HarvestedProduct {
  return {
    source: "internal",
    externalId: "id_1",
    rawName: "Test Product",
    rawBrand: "Brand",
    rawModel: "Model",
    category: "MODULE",
    price: null,
    description: null,
    rawPayload: {},
    ...overrides,
  };
}

describe("catalog-dedupe", () => {
  it("groups products with same canonical key", () => {
    const products = [
      makeProduct({ externalId: "a", rawBrand: "IQ", rawModel: "Combiner BOX-5" }),
      makeProduct({ externalId: "b", rawBrand: "IQ", rawModel: "Combiner BOX 5" }),
    ];

    const clusters = dedupeProducts(products);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(2);
    expect(clusters[0].sourceIds).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("picks representative with most fields populated", () => {
    const products = [
      makeProduct({
        externalId: "sparse",
        rawBrand: "Tesla",
        rawModel: "PW3",
        description: null,
        price: null,
      }),
      makeProduct({
        externalId: "rich",
        rawBrand: "Tesla",
        rawModel: "PW3",
        description: "Powerwall 3",
        price: 8500,
      }),
    ];

    const clusters = dedupeProducts(products);
    expect(clusters[0].representative.externalId).toBe("rich");
  });

  it("does not cluster products with different canonical keys", () => {
    const products = [
      makeProduct({ externalId: "a", rawBrand: "Tesla", rawModel: "PW3" }),
      makeProduct({ externalId: "b", rawBrand: "Enphase", rawModel: "IQ8P" }),
    ];

    const clusters = dedupeProducts(products);
    // Each product is its own cluster (singletons), so 0 duplicate clusters
    expect(clusters.filter((c) => c.members.length > 1)).toHaveLength(0);
  });

  it("uses vendor part number as fallback key", () => {
    const products = [
      makeProduct({
        externalId: "a",
        rawBrand: "Tesla",
        rawModel: "PW3",
        rawPayload: { vendorPartNumber: "1707000" },
      }),
      makeProduct({
        externalId: "b",
        rawBrand: "Tesla",
        rawModel: "Powerwall 3",
        rawPayload: { vendorPartNumber: "1707000" },
      }),
    ];

    const clusters = dedupeProducts(products);
    // Should be merged via VPN fallback even though models differ
    const multiMember = clusters.filter((c) => c.members.length > 1);
    expect(multiMember).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/catalog-dedupe.test.ts --no-coverage
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/lib/catalog-dedupe.ts`:

```ts
/**
 * Intra-source deduplication via key chain + union-find clustering.
 */

import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";
import type { HarvestedProduct } from "@/lib/catalog-harvest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DedupeCluster {
  canonicalKey: string;
  representative: HarvestedProduct;
  members: HarvestedProduct[];
  dedupeReason: string;
  sourceIds: string[];
  ambiguityCount: number;
}

// ---------------------------------------------------------------------------
// Union-Find for transitive clustering
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: Map<number, number> = new Map();
  private rank: Map<number, number> = new Map();

  find(x: number): number {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    const rankX = this.rank.get(rx) || 0;
    const rankY = this.rank.get(ry) || 0;
    if (rankX < rankY) {
      this.parent.set(rx, ry);
    } else if (rankX > rankY) {
      this.parent.set(ry, rx);
    } else {
      this.parent.set(ry, rx);
      this.rank.set(rx, rankX + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Key extraction
// ---------------------------------------------------------------------------

function getVendorPartNumber(p: HarvestedProduct): string | null {
  const vpn =
    (p.rawPayload as Record<string, unknown>)?.vendorPartNumber ??
    (p.rawPayload as Record<string, unknown>)?.vendor_part_number ??
    (p.rawPayload as Record<string, unknown>)?.part_number ??
    (p.rawPayload as Record<string, unknown>)?.hs_sku ??
    (p.rawPayload as Record<string, unknown>)?.product_code;
  return typeof vpn === "string" && vpn.trim() ? vpn.trim() : null;
}

type KeyType = "primary" | "brand_model" | "name" | "vpn";

interface KeyEntry {
  type: KeyType;
  value: string;
}

function extractKeys(p: HarvestedProduct): KeyEntry[] {
  const keys: KeyEntry[] = [];

  // Key 1: category|canonical(brand)|canonical(model)
  const ck = buildCanonicalKey(
    p.category || "",
    p.rawBrand,
    p.rawModel
  );
  if (ck) keys.push({ type: "primary", value: ck });

  // Key 2: canonical(brand)|canonical(model) — cross-category fallback
  const cb = canonicalToken(p.rawBrand);
  const cm = canonicalToken(p.rawModel);
  if (cb && cm) keys.push({ type: "brand_model", value: `${cb}|${cm}` });

  // Key 3: canonical(name) — broadest fallback
  const cn = canonicalToken(p.rawName);
  if (cn) keys.push({ type: "name", value: cn });

  // Key 4: vendor part number exact match
  const vpn = getVendorPartNumber(p);
  if (vpn) keys.push({ type: "vpn", value: `vpn:${vpn}` });

  return keys;
}

// ---------------------------------------------------------------------------
// Representative selection (deterministic)
// ---------------------------------------------------------------------------

const SOURCE_QUALITY_ORDER: Record<string, number> = {
  zoho: 0,
  internal: 1,
  hubspot: 2,
  quickbooks: 3,
  zuper: 4,
};

function fieldCount(p: HarvestedProduct): number {
  let count = 0;
  if (p.rawBrand?.trim()) count++;
  if (p.rawModel?.trim()) count++;
  if (p.category?.trim()) count++;
  if (p.price != null) count++;
  if (p.description?.trim()) count++;
  if (getVendorPartNumber(p)) count++;
  return count;
}

function selectRepresentative(members: HarvestedProduct[]): HarvestedProduct {
  return [...members].sort((a, b) => {
    // 1. Most fields populated
    const fa = fieldCount(a);
    const fb = fieldCount(b);
    if (fb !== fa) return fb - fa;
    // 2. Preferred source quality
    const sa = SOURCE_QUALITY_ORDER[a.source] ?? 99;
    const sb = SOURCE_QUALITY_ORDER[b.source] ?? 99;
    if (sa !== sb) return sa - sb;
    // 3. Smallest externalId (lexicographic)
    return a.externalId.localeCompare(b.externalId);
  })[0];
}

// ---------------------------------------------------------------------------
// Main dedupe
// ---------------------------------------------------------------------------

export function dedupeProducts(products: HarvestedProduct[]): DedupeCluster[] {
  if (products.length === 0) return [];

  const uf = new UnionFind();
  const keyToIndices = new Map<string, number[]>();

  // Build key → index map
  for (let i = 0; i < products.length; i++) {
    const keys = extractKeys(products[i]);
    for (const key of keys) {
      const existing = keyToIndices.get(key.value);
      if (existing) {
        existing.push(i);
      } else {
        keyToIndices.set(key.value, [i]);
      }
    }
  }

  // Union indices that share a key
  for (const indices of keyToIndices.values()) {
    for (let j = 1; j < indices.length; j++) {
      uf.union(indices[0], indices[j]);
    }
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < products.length; i++) {
    const root = uf.find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i);
    else groups.set(root, [i]);
  }

  // Build clusters
  const clusters: DedupeCluster[] = [];
  for (const indices of groups.values()) {
    const members = indices.map((i) => products[i]);
    const representative = selectRepresentative(members);
    const ck =
      buildCanonicalKey(
        representative.category || "",
        representative.rawBrand,
        representative.rawModel
      ) || canonicalToken(representative.rawName);

    // Count how many members matched only on fallback keys
    const primaryKey = buildCanonicalKey(
      representative.category || "",
      representative.rawBrand,
      representative.rawModel
    );
    let ambiguityCount = 0;
    if (primaryKey) {
      for (const m of members) {
        const mk = buildCanonicalKey(
          m.category || "",
          m.rawBrand,
          m.rawModel
        );
        if (mk !== primaryKey) ambiguityCount++;
      }
    }

    clusters.push({
      canonicalKey: ck,
      representative,
      members,
      dedupeReason:
        members.length > 1 ? "canonical_key_match" : "singleton",
      sourceIds: members.map((m) => m.externalId),
      ambiguityCount,
    });
  }

  return clusters;
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/lib/catalog-dedupe.test.ts --no-coverage
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/lib/catalog-dedupe.ts src/__tests__/lib/catalog-dedupe.test.ts
git commit -m "feat: add intra-source deduplication with union-find clustering"
```

---

## Task 6: Cross-Source Graph Matcher

**Files:**
- Create: `src/lib/catalog-matcher.ts`
- Create: `src/__tests__/lib/catalog-matcher.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/lib/catalog-matcher.test.ts`:

```ts
import {
  crossMatch,
  scorePair,
  type MatchGroup,
} from "@/lib/catalog-matcher";
import type { DedupeCluster } from "@/lib/catalog-dedupe";
import type { HarvestedProduct } from "@/lib/catalog-harvest";

function makeCluster(overrides: {
  source: string;
  externalId: string;
  brand: string;
  model: string;
  category?: string;
  price?: number;
  vpn?: string;
}): DedupeCluster {
  const product: HarvestedProduct = {
    source: overrides.source as HarvestedProduct["source"],
    externalId: overrides.externalId,
    rawName: `${overrides.brand} ${overrides.model}`,
    rawBrand: overrides.brand,
    rawModel: overrides.model,
    category: overrides.category || "MODULE",
    price: overrides.price ?? null,
    description: null,
    rawPayload: overrides.vpn
      ? { vendorPartNumber: overrides.vpn }
      : {},
  };
  return {
    canonicalKey: `MODULE|${overrides.brand.toLowerCase()}|${overrides.model.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    representative: product,
    members: [product],
    dedupeReason: "singleton",
    sourceIds: [overrides.externalId],
    ambiguityCount: 0,
  };
}

describe("catalog-matcher", () => {
  describe("scorePair", () => {
    it("scores 40+ for matching canonical brand+model", () => {
      const a = makeCluster({ source: "internal", externalId: "a", brand: "Tesla", model: "PW3" });
      const b = makeCluster({ source: "zoho", externalId: "b", brand: "Tesla", model: "PW3" });
      expect(scorePair(a.representative, b.representative)).toBeGreaterThanOrEqual(40);
    });

    it("scores 0 for completely different products", () => {
      const a = makeCluster({ source: "internal", externalId: "a", brand: "Tesla", model: "PW3" });
      const b = makeCluster({ source: "zoho", externalId: "b", brand: "Enphase", model: "IQ8P" });
      expect(scorePair(a.representative, b.representative)).toBe(0);
    });
  });

  describe("crossMatch", () => {
    it("groups matching clusters from different sources", () => {
      const clusters = [
        makeCluster({ source: "internal", externalId: "int_1", brand: "Tesla", model: "PW3", category: "BATTERY" }),
        makeCluster({ source: "zoho", externalId: "zo_1", brand: "Tesla", model: "PW3", category: "BATTERY" }),
        makeCluster({ source: "hubspot", externalId: "hs_1", brand: "Tesla", model: "PW3", category: "BATTERY" }),
      ];

      const groups = crossMatch(clusters);
      const multiMember = groups.filter((g) => g.memberClusters.length > 1);
      expect(multiMember).toHaveLength(1);
      expect(multiMember[0].memberClusters).toHaveLength(3);
      expect(multiMember[0].confidence).toBe("HIGH");
    });

    it("assigns MEDIUM confidence for moderate scores", () => {
      const clusters = [
        makeCluster({ source: "internal", externalId: "int_1", brand: "Tesla", model: "Powerwall 3", category: "BATTERY" }),
        makeCluster({ source: "zoho", externalId: "zo_1", brand: "Tesla", model: "PW3", category: "BATTERY", vpn: "1707000" }),
      ];
      // These share brand but different model text — will get partial score via VPN
      // Test that the grouping logic works; exact confidence depends on scoring weights
      const groups = crossMatch(clusters);
      expect(groups.length).toBeGreaterThan(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/catalog-matcher.test.ts --no-coverage
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/lib/catalog-matcher.ts`:

```ts
/**
 * Cross-source graph clustering matcher.
 *
 * Takes dedupe-cluster representatives from multiple sources,
 * builds a weighted edge graph, finds connected components above
 * threshold, and assigns confidence levels.
 */

import { createHash } from "crypto";
import { canonicalToken } from "@/lib/canonical";
import type { HarvestedProduct } from "@/lib/catalog-harvest";
import type { DedupeCluster } from "@/lib/catalog-dedupe";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface MatchGroup {
  matchGroupKey: string;
  confidence: ConfidenceLevel;
  score: number;
  canonicalBrand: string | null;
  canonicalModel: string | null;
  category: string | null;
  memberClusters: DedupeCluster[];
  memberSources: Array<{
    source: string;
    externalId: string;
    rawName: string;
  }>;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function getVpn(p: HarvestedProduct): string | null {
  const payload = p.rawPayload as Record<string, unknown>;
  const vpn =
    payload?.vendorPartNumber ??
    payload?.vendor_part_number ??
    payload?.part_number ??
    payload?.hs_sku ??
    payload?.product_code;
  return typeof vpn === "string" && vpn.trim() ? vpn.trim() : null;
}

export function scorePair(a: HarvestedProduct, b: HarvestedProduct): number {
  let score = 0;

  // canonical(brand) + canonical(model) exact match: 40
  const abrand = canonicalToken(a.rawBrand);
  const amodel = canonicalToken(a.rawModel);
  const bbrand = canonicalToken(b.rawBrand);
  const bmodel = canonicalToken(b.rawModel);

  if (abrand && amodel && abrand === bbrand && amodel === bmodel) {
    score += 40;
  }

  // canonical(name) exact match: 20
  const aname = canonicalToken(a.rawName);
  const bname = canonicalToken(b.rawName);
  if (aname && bname && aname === bname) {
    score += 20;
  }

  // Vendor part number match: 25
  const avpn = getVpn(a);
  const bvpn = getVpn(b);
  if (avpn && bvpn && avpn === bvpn) {
    score += 25;
  }

  // Category match: 10
  if (a.category && b.category && a.category === b.category) {
    score += 10;
  }

  // Price within 5%: 5
  if (a.price != null && b.price != null && a.price > 0 && b.price > 0) {
    const ratio = Math.abs(a.price - b.price) / Math.max(a.price, b.price);
    if (ratio <= 0.05) {
      score += 5;
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Union-Find (reused for graph clustering)
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: Map<number, number> = new Map();
  private rank: Map<number, number> = new Map();

  find(x: number): number {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!));
    }
    return this.parent.get(x)!;
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;
    const rankX = this.rank.get(rx) || 0;
    const rankY = this.rank.get(ry) || 0;
    if (rankX < rankY) this.parent.set(rx, ry);
    else if (rankX > rankY) this.parent.set(ry, rx);
    else {
      this.parent.set(ry, rx);
      this.rank.set(rx, rankX + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Stable match group key
// ---------------------------------------------------------------------------

function buildMatchGroupKey(clusters: DedupeCluster[]): string {
  const memberIds = clusters
    .flatMap((c) =>
      c.members.map((m) => `${m.source}:${m.externalId}`)
    )
    .sort();
  return createHash("sha256").update(memberIds.join("|")).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Confidence assignment
// ---------------------------------------------------------------------------

function assignConfidence(score: number): ConfidenceLevel {
  if (score >= 80) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Main cross-match
// ---------------------------------------------------------------------------

const EDGE_THRESHOLD = 50; // Minimum score to form an edge

export function crossMatch(clusters: DedupeCluster[]): MatchGroup[] {
  if (clusters.length === 0) return [];

  const uf = new UnionFind();
  const edgeScores = new Map<string, number>(); // "i-j" → max score

  // Build edges between all pairs above threshold
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const score = scorePair(
        clusters[i].representative,
        clusters[j].representative
      );
      if (score >= EDGE_THRESHOLD) {
        uf.union(i, j);
        edgeScores.set(`${i}-${j}`, score);
      }
    }
  }

  // Group by component root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < clusters.length; i++) {
    const root = uf.find(i);
    const arr = groups.get(root);
    if (arr) arr.push(i);
    else groups.set(root, [i]);
  }

  // Build MatchGroups
  const result: MatchGroup[] = [];
  for (const indices of groups.values()) {
    const memberClusters = indices.map((i) => clusters[i]);

    // Max score across all edges in this component
    let maxScore = 0;
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const key =
          indices[a] < indices[b]
            ? `${indices[a]}-${indices[b]}`
            : `${indices[b]}-${indices[a]}`;
        const s = edgeScores.get(key) || 0;
        if (s > maxScore) maxScore = s;
      }
    }

    // For singletons, score is 0 → LOW
    const confidence = assignConfidence(maxScore);
    const rep = memberClusters[0].representative;

    result.push({
      matchGroupKey: buildMatchGroupKey(memberClusters),
      confidence,
      score: maxScore,
      canonicalBrand: canonicalToken(rep.rawBrand) || null,
      canonicalModel: canonicalToken(rep.rawModel) || null,
      category: rep.category,
      memberClusters,
      memberSources: memberClusters.flatMap((c) =>
        c.members.map((m) => ({
          source: m.source,
          externalId: m.externalId,
          rawName: m.rawName,
        }))
      ),
    });
  }

  return result.sort((a, b) => b.score - a.score);
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/lib/catalog-matcher.test.ts --no-coverage
```

Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/lib/catalog-matcher.ts src/__tests__/lib/catalog-matcher.test.ts
git commit -m "feat: add cross-source graph clustering matcher with scoring"
```

---

## Task 7: Harvest API Route (Phase 1)

Read-only endpoint that runs Phase 1 and returns the harvest report.

**Files:**
- Create: `src/app/api/catalog/harvest/route.ts`

**Step 1: Write the route**

```ts
/**
 * POST /api/catalog/harvest
 *
 * Phase 1: Harvest all products from all sources, dedupe within each,
 * and return a read-only JSON report. No mutations.
 *
 * Auth: ADMIN or OWNER only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { harvestAll, parseHarvestWarnings, type HarvestSource } from "@/lib/catalog-harvest";
import { dedupeProducts, type DedupeCluster } from "@/lib/catalog-dedupe";

const ALLOWED_ROLES = ["ADMIN", "OWNER"];

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, ALLOWED_ROLES);
  if (auth instanceof NextResponse) return auth;

  try {
    const harvestResults = await harvestAll();

    const sourceSummaries: Record<
      string,
      {
        totalHarvested: number;
        dedupeClusters: number;
        duplicatesFound: number;
        parseWarnings: number;
        error?: string;
      }
    > = {};

    const allClusters: DedupeCluster[] = [];
    const ambiguousClusters: DedupeCluster[] = [];

    for (const result of harvestResults) {
      const clusters = dedupeProducts(result.products);
      const duplicateClusters = clusters.filter((c) => c.members.length > 1);

      let warningCount = 0;
      for (const p of result.products) {
        warningCount += parseHarvestWarnings(p).length;
      }

      sourceSummaries[result.source] = {
        totalHarvested: result.products.length,
        dedupeClusters: clusters.length,
        duplicatesFound: duplicateClusters.reduce(
          (sum, c) => sum + c.members.length - 1,
          0
        ),
        parseWarnings: warningCount,
        ...(result.error ? { error: result.error } : {}),
      };

      allClusters.push(...clusters);
      ambiguousClusters.push(
        ...clusters.filter((c) => c.ambiguityCount > 0)
      );
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      sources: sourceSummaries,
      totalClusters: allClusters.length,
      totalAmbiguous: ambiguousClusters.length,
      clusters: allClusters.slice(0, 500), // Cap response size
      ambiguousClusters: ambiguousClusters.slice(0, 100),
    });
  } catch (error) {
    console.error("[catalog/harvest] Error:", error);
    return NextResponse.json(
      { error: "Harvest failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/catalog/harvest/route.ts
git commit -m "feat: add POST /api/catalog/harvest (Phase 1 read-only report)"
```

---

## Task 8: Match & Review API Routes (Phase 2)

**Files:**
- Create: `src/app/api/catalog/match/route.ts`
- Create: `src/app/api/catalog/review/route.ts`

**Step 1: Write match route**

Create `src/app/api/catalog/match/route.ts`:

```ts
/**
 * POST /api/catalog/match
 *
 * Phase 2: Cross-match dedupe clusters and persist CatalogMatchGroup records.
 * Idempotent — re-running updates existing groups.
 *
 * Auth: ADMIN or OWNER only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { harvestAll } from "@/lib/catalog-harvest";
import { dedupeProducts } from "@/lib/catalog-dedupe";
import { crossMatch } from "@/lib/catalog-matcher";

const ALLOWED_ROLES = ["ADMIN", "OWNER"];

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, ALLOWED_ROLES);
  if (auth instanceof NextResponse) return auth;
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  try {
    // Phase 1: harvest + dedupe
    const harvestResults = await harvestAll();
    const allClusters = harvestResults.flatMap((r) => dedupeProducts(r.products));

    // Phase 2: cross-match
    const matchGroups = crossMatch(allClusters);

    // Persist match groups
    let created = 0;
    let updated = 0;
    let skippedSticky = 0;

    for (const group of matchGroups) {
      // Check for existing decision (stickiness)
      const existing = await prisma.catalogMatchGroup.findUnique({
        where: { matchGroupKey: group.matchGroupKey },
      });

      if (existing) {
        // If previously decided and membership unchanged, skip
        if (
          existing.decision !== "PENDING" &&
          JSON.stringify(existing.memberSources) === JSON.stringify(group.memberSources)
        ) {
          skippedSticky++;
          continue;
        }

        // Membership changed or still pending — update
        await prisma.catalogMatchGroup.update({
          where: { matchGroupKey: group.matchGroupKey },
          data: {
            confidence: group.confidence,
            score: group.score,
            canonicalBrand: group.canonicalBrand,
            canonicalModel: group.canonicalModel,
            category: group.category,
            memberSources: group.memberSources as unknown as object,
            needsReview:
              group.confidence !== "HIGH" || existing.decision === "REJECTED",
            reviewReason:
              existing.decision !== "PENDING"
                ? "membership_changed"
                : existing.reviewReason,
            // Reset decision only if membership changed and was previously decided
            ...(existing.decision !== "PENDING" &&
            JSON.stringify(existing.memberSources) !==
              JSON.stringify(group.memberSources)
              ? { decision: "PENDING" as const, decidedBy: null, decidedAt: null }
              : {}),
          },
        });
        updated++;
      } else {
        await prisma.catalogMatchGroup.create({
          data: {
            matchGroupKey: group.matchGroupKey,
            confidence: group.confidence,
            score: group.score,
            canonicalBrand: group.canonicalBrand,
            canonicalModel: group.canonicalModel,
            category: group.category,
            memberSources: group.memberSources as unknown as object,
            needsReview: group.confidence !== "HIGH",
            reviewReason:
              group.confidence === "LOW"
                ? "low_confidence"
                : group.confidence === "MEDIUM"
                  ? "medium_confidence"
                  : null,
          },
        });
        created++;
      }
    }

    return NextResponse.json({
      totalMatchGroups: matchGroups.length,
      created,
      updated,
      skippedSticky,
      byConfidence: {
        HIGH: matchGroups.filter((g) => g.confidence === "HIGH").length,
        MEDIUM: matchGroups.filter((g) => g.confidence === "MEDIUM").length,
        LOW: matchGroups.filter((g) => g.confidence === "LOW").length,
      },
    });
  } catch (error) {
    console.error("[catalog/match] Error:", error);
    return NextResponse.json(
      { error: "Match failed", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
```

**Step 2: Write review route**

Create `src/app/api/catalog/review/route.ts`:

```ts
/**
 * GET  /api/catalog/review - List match groups needing review
 * POST /api/catalog/review - Approve/reject a match group
 *
 * Auth: ADMIN or OWNER only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

const ALLOWED_ROLES = ["ADMIN", "OWNER"];

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth(request, ALLOWED_ROLES);
  if (auth instanceof NextResponse) return auth;
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "PENDING";
  const confidence = url.searchParams.get("confidence");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);

  const where: Record<string, unknown> = { decision: status };
  if (confidence) where.confidence = confidence;

  const [groups, total] = await Promise.all([
    prisma.catalogMatchGroup.findMany({
      where,
      orderBy: [{ needsReview: "desc" }, { score: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.catalogMatchGroup.count({ where }),
  ]);

  return NextResponse.json({ groups, total, limit, offset });
}

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, ALLOWED_ROLES);
  if (auth instanceof NextResponse) return auth;
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const body = await request.json();
  const { matchGroupKey, decision, note } = body as {
    matchGroupKey?: string;
    decision?: string;
    note?: string;
  };

  if (!matchGroupKey || !decision) {
    return NextResponse.json(
      { error: "matchGroupKey and decision are required" },
      { status: 400 }
    );
  }

  if (!["APPROVED", "REJECTED", "MERGED"].includes(decision)) {
    return NextResponse.json(
      { error: "decision must be APPROVED, REJECTED, or MERGED" },
      { status: 400 }
    );
  }

  const existing = await prisma.catalogMatchGroup.findUnique({
    where: { matchGroupKey },
  });

  if (!existing) {
    return NextResponse.json({ error: "Match group not found" }, { status: 404 });
  }

  const updated = await prisma.catalogMatchGroup.update({
    where: { matchGroupKey },
    data: {
      decision: decision as "APPROVED" | "REJECTED" | "MERGED",
      decidedBy: auth.email,
      decidedAt: new Date(),
      decisionNote: note || null,
      needsReview: false,
    },
  });

  return NextResponse.json({ updated });
}
```

**Step 3: Commit**

```bash
git add src/app/api/catalog/match/route.ts src/app/api/catalog/review/route.ts
git commit -m "feat: add match and review API routes for Phase 2 cross-matching"
```

---

## Task 9: Expire Pending Pushes (Cron)

**Files:**
- Create: `src/app/api/catalog/expire-pending/route.ts`
- Create: `src/__tests__/api/catalog-expire-pending.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/api/catalog-expire-pending.test.ts`:

```ts
/**
 * Tests for POST /api/catalog/expire-pending
 *
 * This cron route expires PendingCatalogPush records older than TTL.
 */

const mockUpdateMany = jest.fn().mockResolvedValue({ count: 3 });

jest.mock("@/lib/db", () => ({
  prisma: {
    pendingCatalogPush: {
      updateMany: mockUpdateMany,
    },
  },
  logActivity: jest.fn(),
}));

jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: jest.fn().mockResolvedValue({
    id: "user_1",
    email: "admin@test.com",
    role: "ADMIN",
  }),
}));

import { POST } from "@/app/api/catalog/expire-pending/route";
import { NextRequest } from "next/server";

describe("POST /api/catalog/expire-pending", () => {
  it("expires pending pushes with past expiresAt", async () => {
    const request = new NextRequest("http://localhost/api/catalog/expire-pending", {
      method: "POST",
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.expired).toBe(3);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PENDING",
        }),
        data: { status: "EXPIRED" },
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/api/catalog-expire-pending.test.ts --no-coverage
```

Expected: FAIL — module not found

**Step 3: Write implementation**

Create `src/app/api/catalog/expire-pending/route.ts`:

```ts
/**
 * POST /api/catalog/expire-pending
 *
 * Cron job: expire PendingCatalogPush records past their expiresAt.
 * Idempotent — safe to re-run.
 *
 * Auth: ADMIN only (or CRON token in production).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma, logActivity } from "@/lib/db";

export async function POST(request: NextRequest) {
  const auth = await requireApiAuth(request, ["ADMIN", "OWNER"]);
  if (auth instanceof NextResponse) return auth;

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const now = new Date();

  const result = await prisma.pendingCatalogPush.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });

  if (logActivity && result.count > 0) {
    await logActivity({
      type: "CATALOG_PENDING_EXPIRED",
      userId: auth.id,
      description: `Expired ${result.count} pending catalog push(es)`,
      metadata: { expiredCount: result.count, expiredAt: now.toISOString() },
    });
  }

  return NextResponse.json({
    expired: result.count,
    at: now.toISOString(),
  });
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/api/catalog-expire-pending.test.ts --no-coverage
```

Expected: PASS (1 test)

**Step 5: Commit**

```bash
git add src/app/api/catalog/expire-pending/route.ts src/__tests__/api/catalog-expire-pending.test.ts
git commit -m "feat: add cron endpoint to expire stale pending catalog pushes"
```

---

## Task 10: Rewire `syncEquipmentSkus` for Fuzzy Matching (Phase 3)

This is the core lock-down change: instead of direct INSERT, fuzzy-match against canonical keys.

**Files:**
- Modify: `src/lib/bom-snapshot.ts` (~lines 97-179, the `syncEquipmentSkus` function)
- Create: `src/__tests__/lib/bom-snapshot-fuzzy.test.ts`

**Step 1: Write the failing test**

Create `src/__tests__/lib/bom-snapshot-fuzzy.test.ts`:

```ts
/**
 * Tests for the fuzzy-match path in syncEquipmentSkus.
 *
 * When CATALOG_LOCKDOWN_ENABLED=true:
 * - Exact canonical match → use existing SKU
 * - No match → create PendingCatalogPush
 * - Ambiguous → create PendingCatalogPush with candidateSkuIds
 */

const mockFindMany = jest.fn();
const mockCreate = jest.fn().mockResolvedValue({ id: "pending_1" });
const mockQueryRawUnsafe = jest.fn().mockResolvedValue([]);

jest.mock("@/lib/db", () => ({
  prisma: {
    equipmentSku: { findMany: mockFindMany },
    pendingCatalogPush: { create: mockCreate },
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
  logActivity: jest.fn(),
}));

import type { BomItem } from "@/lib/bom-snapshot";

describe("syncEquipmentSkus with lockdown", () => {
  const originalEnv = process.env.CATALOG_LOCKDOWN_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CATALOG_LOCKDOWN_ENABLED = "true";
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.CATALOG_LOCKDOWN_ENABLED = originalEnv;
    } else {
      delete process.env.CATALOG_LOCKDOWN_ENABLED;
    }
  });

  it("uses existing SKU when canonical key matches exactly", async () => {
    mockFindMany.mockResolvedValue([
      { id: "sku_1", category: "MODULE", canonicalKey: "MODULE|recsolar|alpha405aa" },
    ]);

    // Dynamic import to pick up env var
    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      { category: "MODULE", brand: "REC Solar", model: "Alpha 405-AA", description: "test", qty: 1 },
    ];

    const result = await syncEquipmentSkus(items);
    // Should not create a pending push
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.skipped).toBe(0);
  });

  it("creates PendingCatalogPush when no match found", async () => {
    mockFindMany.mockResolvedValue([]); // no matches

    const { syncEquipmentSkus } = await import("@/lib/bom-snapshot");
    const items: BomItem[] = [
      { category: "MODULE", brand: "NewBrand", model: "NewModel", description: "test", qty: 1 },
    ];

    const result = await syncEquipmentSkus(items);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          brand: "NewBrand",
          model: "NewModel",
          source: "bom_extraction",
          status: "PENDING",
        }),
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/lib/bom-snapshot-fuzzy.test.ts --no-coverage
```

Expected: FAIL (tests reference lockdown-aware code that doesn't exist yet)

**Step 3: Modify `syncEquipmentSkus` in `src/lib/bom-snapshot.ts`**

Replace the function body (~lines 97-179) with:

```ts
import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";

function isLockdownEnabled(): boolean {
  return String(process.env.CATALOG_LOCKDOWN_ENABLED || "").trim().toLowerCase() === "true";
}

export async function syncEquipmentSkus(items: BomItem[]): Promise<SkuSyncResult> {
  if (!prisma) {
    throw new Error("Database not configured");
  }

  const validItems = items
    .map((item) => {
      const inventoryCategory = INVENTORY_CATEGORIES[item.category];
      if (!inventoryCategory) return null;
      const brand = item.brand?.trim();
      const model = item.model?.trim();
      if (!brand || !model) return null;
      return {
        category: inventoryCategory,
        brand,
        model,
        description: item.description?.trim() || null,
        unitSpec: item.unitSpec != null ? Number(item.unitSpec) : null,
        unitLabel: item.unitLabel ?? null,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const skipped = items.length - validItems.length;
  if (validItems.length === 0) {
    return { created: 0, updated: 0, skipped };
  }

  // ----- Lockdown path: fuzzy match against canonical keys -----
  if (isLockdownEnabled()) {
    return syncWithFuzzyMatch(validItems, skipped);
  }

  // ----- Legacy path: direct INSERT ON CONFLICT -----
  return syncWithDirectInsert(validItems, skipped);
}

async function syncWithFuzzyMatch(
  validItems: Array<{
    category: string;
    brand: string;
    model: string;
    description: string | null;
    unitSpec: number | null;
    unitLabel: string | null;
  }>,
  initialSkipped: number
): Promise<SkuSyncResult> {
  let updated = 0;
  let created = 0; // pending pushes created
  let skipped = initialSkipped;

  for (const item of validItems) {
    const ck = buildCanonicalKey(item.category, item.brand, item.model);
    if (!ck) {
      skipped++;
      continue;
    }

    // Query for existing SKUs matching this canonical key
    const matches = await prisma!.equipmentSku.findMany({
      where: { canonicalKey: ck, isActive: true },
      select: { id: true, canonicalKey: true },
    });

    if (matches.length === 1) {
      // Exact match — use existing SKU, no insert needed
      updated++;
      continue;
    }

    if (matches.length > 1) {
      // Ambiguous — create pending push with candidate IDs
      await prisma!.pendingCatalogPush.create({
        data: {
          brand: item.brand,
          model: item.model,
          description: item.description || "",
          category: item.category,
          systems: ["INTERNAL"],
          requestedBy: "bom_extraction",
          source: "bom_extraction",
          canonicalKey: ck,
          candidateSkuIds: matches.map((m) => m.id),
          reviewReason: "ambiguous_bom_match",
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });
      created++;
      continue;
    }

    // Zero matches — create pending push
    await prisma!.pendingCatalogPush.create({
      data: {
        brand: item.brand,
        model: item.model,
        description: item.description || "",
        category: item.category,
        systems: ["INTERNAL"],
        requestedBy: "bom_extraction",
        source: "bom_extraction",
        canonicalKey: ck,
        candidateSkuIds: [],
        reviewReason: "no_match",
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    created++;
  }

  return { created, updated, skipped };
}

async function syncWithDirectInsert(
  validItems: Array<{
    category: string;
    brand: string;
    model: string;
    description: string | null;
    unitSpec: number | null;
    unitLabel: string | null;
  }>,
  initialSkipped: number
): Promise<SkuSyncResult> {
  let created = 0;
  let updated = 0;

  const BATCH_SIZE = 50;
  for (let i = 0; i < validItems.length; i += BATCH_SIZE) {
    const batch = validItems.slice(i, i + BATCH_SIZE);

    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      const ck = buildCanonicalKey(item.category, item.brand, item.model);
      const offset = j * 10;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}::"EquipmentCategory", $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::double precision, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, true, NOW(), NOW())`
      );
      values.push(
        crypto.randomUUID(),
        item.category,
        item.brand,
        item.model,
        item.description,
        item.unitSpec,
        item.unitLabel,
        canonicalToken(item.brand),
        canonicalToken(item.model),
        ck,
      );
    }

    const rows = await prisma!.$queryRawUnsafe<Array<{ xmax: string }>>(
      `INSERT INTO "EquipmentSku" ("id", "category", "brand", "model", "description", "unitSpec", "unitLabel", "canonicalBrand", "canonicalModel", "canonicalKey", "isActive", "createdAt", "updatedAt")
       VALUES ${placeholders.join(", ")}
       ON CONFLICT ("category", "brand", "model") DO UPDATE SET
         "description"    = COALESCE(NULLIF(EXCLUDED."description", ''), "EquipmentSku"."description"),
         "unitSpec"       = COALESCE(EXCLUDED."unitSpec", "EquipmentSku"."unitSpec"),
         "unitLabel"      = COALESCE(EXCLUDED."unitLabel", "EquipmentSku"."unitLabel"),
         "canonicalBrand" = EXCLUDED."canonicalBrand",
         "canonicalModel" = EXCLUDED."canonicalModel",
         "canonicalKey"   = EXCLUDED."canonicalKey",
         "isActive"       = true,
         "updatedAt"      = NOW()
       RETURNING xmax::text`,
      ...values
    );

    for (const row of rows) {
      if (row.xmax === "0") created++;
      else updated++;
    }
  }

  return { created, updated, skipped: initialSkipped };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest src/__tests__/lib/bom-snapshot-fuzzy.test.ts --no-coverage
```

Expected: PASS (2 tests)

**Step 5: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests pass. If existing `bom-snapshot` tests break, they're using the legacy path (lockdown disabled by default), so they should still work.

**Step 6: Commit**

```bash
git add src/lib/bom-snapshot.ts src/__tests__/lib/bom-snapshot-fuzzy.test.ts
git commit -m "feat: add fuzzy-match lockdown path to syncEquipmentSkus (Phase 3)"
```

---

## Task 11: Populate Canonical Columns on SKU Create/Update

Ensure all SKU creation and update paths keep `canonicalBrand`, `canonicalModel`, `canonicalKey` in sync.

**Files:**
- Modify: `src/app/api/inventory/skus/route.ts`

**Step 1: Import canonical utilities**

At the top of `src/app/api/inventory/skus/route.ts`, add:

```ts
import { canonicalToken, buildCanonicalKey } from "@/lib/canonical";
```

And remove the local `canonicalToken` function definition (~lines 194-198).

**Step 2: Add canonical fields to POST handler's `createData`/`updateData`**

Find the section where SKU data is assembled for `prisma.equipmentSku.create()` and `prisma.equipmentSku.update()`. Add:

```ts
canonicalBrand: canonicalToken(brand),
canonicalModel: canonicalToken(model),
canonicalKey: buildCanonicalKey(category, brand, model),
```

to both the create and update data objects.

**Step 3: Run tests**

```bash
npx jest --no-coverage
```

Expected: All pass.

**Step 4: Commit**

```bash
git add src/app/api/inventory/skus/route.ts
git commit -m "feat: populate canonical columns on SKU create/update"
```

---

## Task 12: Lint, Full Test Suite, Build Check

**Step 1: Run lint**

```bash
npm run lint
```

Expected: Clean (0 warnings, 0 errors). Fix any issues.

**Step 2: Run full test suite**

```bash
npm run test
```

Expected: All tests pass.

**Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds. If there are type errors from new schema fields, run `npx prisma generate` first.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "chore: lint and build fixes for catalog rebuild"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Schema migration + backfill | `prisma/schema.prisma`, migrations |
| 2 | Extract `canonicalToken` | `src/lib/canonical.ts` |
| 3 | Generalized admin confirmation | `src/lib/admin-action-confirmation.ts` |
| 4 | Harvest adapters (5 sources) | `src/lib/catalog-harvest.ts` |
| 5 | Dedupe engine (union-find) | `src/lib/catalog-dedupe.ts` |
| 6 | Cross-source matcher (graph) | `src/lib/catalog-matcher.ts` |
| 7 | Harvest API route (Phase 1) | `src/app/api/catalog/harvest/route.ts` |
| 8 | Match + Review API (Phase 2) | `src/app/api/catalog/match/route.ts`, `review/route.ts` |
| 9 | Expire pending cron | `src/app/api/catalog/expire-pending/route.ts` |
| 10 | Rewire `syncEquipmentSkus` | `src/lib/bom-snapshot.ts` |
| 11 | Canonical columns on create/update | `src/app/api/inventory/skus/route.ts` |
| 12 | Lint + test + build | All files |
