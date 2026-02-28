# QuickBooks Product Seeding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Seed 486 QuickBooks products into the CatalogProduct cache so the comparison dashboard and BOM tool show QB data without API credentials.

**Architecture:** Add QUICKBOOKS/OPENSOLAR to the CatalogProductSource enum, wire both into the existing cache hydration pipeline in the comparison and cache API routes, then build a seed endpoint + CLI script to import the XLS data.

**Tech Stack:** Prisma 7.3, Next.js API routes, Zod validation, xlsx (devDep), Jest

---

### Task 1: Prisma Schema — Expand CatalogProductSource Enum

**Files:**
- Modify: `prisma/schema.prisma:591-595`
- Create: `prisma/migrations/20260227200000_add_quickbooks_opensolar_source/migration.sql`

**Step 1: Update the enum in schema.prisma**

In `prisma/schema.prisma`, change:

```prisma
enum CatalogProductSource {
  HUBSPOT
  ZUPER
  ZOHO
}
```

to:

```prisma
enum CatalogProductSource {
  HUBSPOT
  ZUPER
  ZOHO
  QUICKBOOKS
  OPENSOLAR
}
```

**Step 2: Create the migration**

Run:
```bash
npx prisma migrate dev --name add_quickbooks_opensolar_source
```

Expected: Migration created, Prisma client regenerated. The SQL will be an `ALTER TYPE` adding two enum values.

**Step 3: Verify Prisma client has the new enum values**

Run:
```bash
grep -c "QUICKBOOKS\|OPENSOLAR" src/generated/prisma/enums.ts
```

Expected: 2 matches (one per enum value).

**Step 4: Commit**

Note: `src/generated/prisma` is gitignored — only commit schema + migration.

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add QUICKBOOKS and OPENSOLAR to CatalogProductSource enum"
```

---

### Task 2: Comparison Route — Wire QB/OS into Cache Hydration

**Files:**
- Modify: `src/app/api/products/comparison/route.ts:20-27,1148-1152,1352-1419,1430-1490`

**Step 1: Expand CACHE_SOURCES, CacheSourceName, and CACHE_SOURCE_ENUM**

At line 20, change:

```typescript
const CACHE_SOURCES = ["hubspot", "zuper", "zoho"] as const;
type CacheSourceName = (typeof CACHE_SOURCES)[number];

const CACHE_SOURCE_ENUM: Record<CacheSourceName, CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
};
```

to:

```typescript
const CACHE_SOURCES = ["hubspot", "zuper", "zoho", "quickbooks", "opensolar"] as const;
type CacheSourceName = (typeof CACHE_SOURCES)[number];

const CACHE_SOURCE_ENUM: Record<CacheSourceName, CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
  quickbooks: "QUICKBOOKS",
  opensolar: "OPENSOLAR",
};
```

**Step 2: Fix sourceFromCacheEnum — explicit branches, no default**

At line 1148, change:

```typescript
function sourceFromCacheEnum(source: CatalogProductSource): CacheSourceName {
  if (source === "HUBSPOT") return "hubspot";
  if (source === "ZUPER") return "zuper";
  return "zoho";
}
```

to:

```typescript
function sourceFromCacheEnum(source: CatalogProductSource): CacheSourceName {
  const map: Record<CatalogProductSource, CacheSourceName> = {
    HUBSPOT: "hubspot",
    ZUPER: "zuper",
    ZOHO: "zoho",
    QUICKBOOKS: "quickbooks",
    OPENSOLAR: "opensolar",
  };
  return map[source];
}
```

**Step 3: Add hydrateSourceWithCache for QB and OS, use effective results everywhere**

At line 1360, change:

```typescript
  const [hubspotCache, zuperCache, zohoCache] = await Promise.all([
    hydrateSourceWithCache("hubspot", {
      products: hubspotResult.products,
      configured: hubspotResult.configured,
      error: hubspotResult.error,
    }),
    hydrateSourceWithCache("zuper", {
      products: zuperResult.products,
      configured: zuperResult.configured,
      error: zuperResult.error,
    }),
    hydrateSourceWithCache("zoho", {
      products: zohoResult.products,
      configured: zohoResult.configured,
      error: zohoResult.error,
    }),
  ]);

  const effectiveHubspotResult = {
    ...hubspotResult,
    products: hubspotCache.result.products,
    configured: hubspotCache.result.configured,
    error: hubspotCache.result.error,
  };
  const effectiveZuperResult = {
    ...zuperResult,
    products: zuperCache.result.products,
    configured: zuperCache.result.configured,
    error: zuperCache.result.error,
  };
  const effectiveZohoResult = {
    ...zohoResult,
    products: zohoCache.result.products,
    configured: zohoCache.result.configured,
    error: zohoCache.result.error,
  };

  const sourceResults = {
    hubspot: effectiveHubspotResult,
    zuper: effectiveZuperResult,
    zoho: effectiveZohoResult,
    opensolar: opensolarResult,
    quickbooks: quickbooksResult,
  } as const;
```

to:

```typescript
  const [hubspotCache, zuperCache, zohoCache, quickbooksCache, opensolarCache] = await Promise.all([
    hydrateSourceWithCache("hubspot", {
      products: hubspotResult.products,
      configured: hubspotResult.configured,
      error: hubspotResult.error,
    }),
    hydrateSourceWithCache("zuper", {
      products: zuperResult.products,
      configured: zuperResult.configured,
      error: zuperResult.error,
    }),
    hydrateSourceWithCache("zoho", {
      products: zohoResult.products,
      configured: zohoResult.configured,
      error: zohoResult.error,
    }),
    hydrateSourceWithCache("quickbooks", {
      products: quickbooksResult.products,
      configured: quickbooksResult.configured,
      error: quickbooksResult.error,
    }),
    hydrateSourceWithCache("opensolar", {
      products: opensolarResult.products,
      configured: opensolarResult.configured,
      error: opensolarResult.error,
    }),
  ]);

  const effectiveHubspotResult = {
    ...hubspotResult,
    products: hubspotCache.result.products,
    configured: hubspotCache.result.configured,
    error: hubspotCache.result.error,
  };
  const effectiveZuperResult = {
    ...zuperResult,
    products: zuperCache.result.products,
    configured: zuperCache.result.configured,
    error: zuperCache.result.error,
  };
  const effectiveZohoResult = {
    ...zohoResult,
    products: zohoCache.result.products,
    configured: zohoCache.result.configured,
    error: zohoCache.result.error,
  };
  const effectiveQuickbooksResult = {
    ...quickbooksResult,
    products: quickbooksCache.result.products,
    configured: quickbooksCache.result.configured,
    error: quickbooksCache.result.error,
  };
  const effectiveOpensolarResult = {
    ...opensolarResult,
    products: opensolarCache.result.products,
    configured: opensolarCache.result.configured,
    error: opensolarCache.result.error,
  };

  const sourceResults = {
    hubspot: effectiveHubspotResult,
    zuper: effectiveZuperResult,
    zoho: effectiveZohoResult,
    opensolar: effectiveOpensolarResult,
    quickbooks: effectiveQuickbooksResult,
  } as const;
```

**Step 4: Update allProducts, productsBySource, sourceCounts, and health blocks**

Replace every remaining reference to raw `opensolarResult` and `quickbooksResult` with `effectiveOpensolarResult` and `effectiveQuickbooksResult` respectively in:

- `allProducts` array (line ~1406-1412)
- `productsBySource` record (line ~1414-1419)
- `summary.sourceCounts` (line ~1454-1459)
- `health` record (line ~1478-1487)

Use the same pattern as the existing HubSpot/Zuper/Zoho effective results. Also update `warnings` to include cache warnings for QB and OS:

```typescript
  const warnings = [
    ...ALL_SOURCES
      .map((source) => sourceResults[source].error)
      .filter(Boolean) as string[],
    ...[hubspotCache, zuperCache, zohoCache, quickbooksCache, opensolarCache]
      .map((c) => c.warning)
      .filter(Boolean) as string[],
  ];
```

**Step 5: Run lint to verify**

```bash
npm run lint
```

Expected: No errors related to the comparison route.

**Step 6: Commit**

```bash
git add src/app/api/products/comparison/route.ts
git commit -m "feat: wire QuickBooks and OpenSolar into cache hydration pipeline"
```

---

### Task 3: Cache Route — Add QB/OS Source Mappings

**Files:**
- Modify: `src/app/api/products/cache/route.ts:19-29,52-63,86-115`

**Step 1: Update SOURCE_ENUM and sourceToApiValue**

Change lines 19-29:

```typescript
const SOURCE_ENUM: Record<string, CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
};

function sourceToApiValue(source: CatalogProductSource): "hubspot" | "zuper" | "zoho" {
  if (source === "HUBSPOT") return "hubspot";
  if (source === "ZUPER") return "zuper";
  return "zoho";
}
```

to:

```typescript
const SOURCE_ENUM: Record<string, CatalogProductSource> = {
  hubspot: "HUBSPOT",
  zuper: "ZUPER",
  zoho: "ZOHO",
  quickbooks: "QUICKBOOKS",
  opensolar: "OPENSOLAR",
};

type SourceApiValue = "hubspot" | "zuper" | "zoho" | "quickbooks" | "opensolar";

function sourceToApiValue(source: CatalogProductSource): SourceApiValue {
  const map: Record<CatalogProductSource, SourceApiValue> = {
    HUBSPOT: "hubspot",
    ZUPER: "zuper",
    ZOHO: "zoho",
    QUICKBOOKS: "quickbooks",
    OPENSOLAR: "opensolar",
  };
  return map[source];
}
```

**Step 2: Update default sources list**

Change line 52:

```typescript
  let sources: CatalogProductSource[] = ["HUBSPOT", "ZUPER", "ZOHO"];
```

to:

```typescript
  let sources: CatalogProductSource[] = ["HUBSPOT", "ZUPER", "ZOHO", "QUICKBOOKS", "OPENSOLAR"];
```

**Step 3: Update error message for invalid source**

Change line 61:

```typescript
      return NextResponse.json({ error: "Invalid source. Use hubspot,zuper,zoho" }, { status: 400 });
```

to:

```typescript
      return NextResponse.json({ error: "Invalid source. Use hubspot,zuper,zoho,quickbooks,opensolar" }, { status: 400 });
```

**Step 4: Update summary.bySource**

Change lines 110-115:

```typescript
    summary: {
      count: rows.length,
      bySource: {
        hubspot: counts.hubspot || 0,
        zuper: counts.zuper || 0,
        zoho: counts.zoho || 0,
      },
    },
```

to:

```typescript
    summary: {
      count: rows.length,
      bySource: {
        hubspot: counts.hubspot || 0,
        zuper: counts.zuper || 0,
        zoho: counts.zoho || 0,
        quickbooks: counts.quickbooks || 0,
        opensolar: counts.opensolar || 0,
      },
    },
```

**Step 5: Run lint**

```bash
npm run lint
```

Expected: No errors.

**Step 6: Commit**

```bash
git add src/app/api/products/cache/route.ts
git commit -m "feat: add QuickBooks and OpenSolar to cache route source mappings"
```

---

### Task 4: Seed Route — POST /api/products/seed

**Files:**
- Create: `src/app/api/products/seed/route.ts`

**Step 1: Write the failing test**

Create `src/__tests__/api/products-seed.test.ts`:

```typescript
// src/__tests__/api/products-seed.test.ts

// ── Auth ──────────────────────────────────────────────────────────────────────
const mockRequireApiAuth = jest.fn().mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });
jest.mock("@/lib/api-auth", () => ({
  requireApiAuth: (...args: unknown[]) => mockRequireApiAuth(...args),
}));

// ── DB ───────────────────────────────────────────────────────────────────────
const mockGetUserByEmail = jest.fn().mockResolvedValue({ role: "ADMIN" });
jest.mock("@/lib/db", () => ({
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  prisma: {
    catalogProduct: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

const mockFindMany = jest.fn();
const mockUpsert = jest.fn();

// ── Route under test ──────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import { POST } from "@/app/api/products/seed/route";

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/products/seed", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });
  mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
  mockFindMany.mockResolvedValue([]);
  mockUpsert.mockResolvedValue({ id: "cat_1" });
});

describe("POST /api/products/seed", () => {
  // ── Auth tests ────────────────────────────────────────────────────────────
  it("rejects non-admin/owner roles with 403", async () => {
    mockGetUserByEmail.mockResolvedValue({ role: "VIEWER" });
    const res = await POST(makeRequest({ products: [{ name: "Test" }] }));
    expect(res.status).toBe(403);
  });

  it("allows OWNER role", async () => {
    mockGetUserByEmail.mockResolvedValue({ role: "OWNER" });
    const res = await POST(makeRequest({ products: [{ name: "Test", sku: "T-1" }] }));
    expect(res.status).toBe(200);
  });

  // ── Validation tests ──────────────────────────────────────────────────────
  it("rejects empty products array", async () => {
    const res = await POST(makeRequest({ products: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects products missing name", async () => {
    const res = await POST(makeRequest({ products: [{ sku: "ABC" }] }));
    expect(res.status).toBe(400);
  });

  // ── Counting tests ────────────────────────────────────────────────────────
  it("seeds valid products and returns counts", async () => {
    const res = await POST(
      makeRequest({
        products: [
          { name: "Powerwall 3", sku: "PW3-001", price: 8500, type: "Non-inventory", description: "Tesla battery" },
          { name: "IQ8 Microinverter", sku: "IQ8-MICRO", price: 200, type: "Non-inventory" },
        ],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inserted).toBe(2);
    expect(data.updated).toBe(0);
    expect(data.skipped).toBe(0);
    expect(data.total).toBe(2);
    expect(data.uniqueTotal).toBe(2);
  });

  it("counts updates when products already exist", async () => {
    mockFindMany.mockResolvedValue([
      { source: "QUICKBOOKS", externalId: "PW3-001" },
    ]);

    const res = await POST(
      makeRequest({
        products: [
          { name: "Powerwall 3", sku: "PW3-001", price: 8500 },
          { name: "IQ8 Microinverter", sku: "IQ8-MICRO", price: 200 },
        ],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inserted).toBe(1);
    expect(data.updated).toBe(1);
  });

  // ── Deduplication tests ───────────────────────────────────────────────────
  it("deduplicates by externalId and reports collisions", async () => {
    const res = await POST(
      makeRequest({
        products: [
          { name: "Powerwall 3", sku: "PW3-001", price: 8500 },
          { name: "Powerwall 3 Updated", sku: "PW3-001", price: 9000 },
        ],
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.uniqueTotal).toBe(1);
    expect(data.inserted).toBe(1);
    expect(data.duplicates).toHaveLength(1);
    expect(data.duplicates[0].externalId).toBe("PW3-001");
    expect(data.duplicates[0].occurrences).toBe(2);
    // Last occurrence wins
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  // ── Deterministic ID tests ────────────────────────────────────────────────
  it("generates deterministic externalId when no SKU", async () => {
    await POST(makeRequest({ products: [{ name: "Labor - Install", price: 150, type: "Service" }] }));
    const firstCall = mockUpsert.mock.calls[0][0];

    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({ id: "cat_2" });
    mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
    mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });

    await POST(makeRequest({ products: [{ name: "Labor - Install", price: 150, type: "Service" }] }));
    const secondCall = mockUpsert.mock.calls[0][0];

    expect(firstCall.where.source_externalId.externalId).toBe(secondCall.where.source_externalId.externalId);
  });

  it("generates same externalId regardless of whitespace/case", async () => {
    await POST(makeRequest({ products: [{ name: "  Labor - Install  ", price: 150.0, type: "  Service  " }] }));
    const call1 = mockUpsert.mock.calls[0][0];

    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockUpsert.mockResolvedValue({ id: "cat_2" });
    mockGetUserByEmail.mockResolvedValue({ role: "ADMIN" });
    mockRequireApiAuth.mockResolvedValue({ email: "admin@photonbrothers.com", role: "ADMIN" });

    await POST(makeRequest({ products: [{ name: "labor - install", price: 150, type: "service" }] }));
    const call2 = mockUpsert.mock.calls[0][0];

    expect(call1.where.source_externalId.externalId).toBe(call2.where.source_externalId.externalId);
  });

  it("hardcodes source as QUICKBOOKS regardless of input", async () => {
    await POST(makeRequest({ products: [{ name: "Test Product", sku: "TP-1" }] }));

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source_externalId: { source: "QUICKBOOKS", externalId: "TP-1" } },
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest src/__tests__/api/products-seed.test.ts --no-coverage 2>&1 | head -20
```

Expected: FAIL — cannot find module `@/app/api/products/seed/route`.

**Step 3: Write the seed route implementation**

Create `src/app/api/products/seed/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { createHash } from "crypto";
import { z } from "zod";

// ── Auth: ADMIN or OWNER only (or API_SECRET_TOKEN for machine clients) ──────
const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER"]);

const ProductSchema = z.object({
  name: z.string().min(1, "Product name is required"),
  sku: z.string().optional(),
  type: z.string().optional(),
  price: z.number().optional(),
  description: z.string().optional(),
});

const SeedPayloadSchema = z.object({
  products: z.array(ProductSchema).min(1, "At least one product is required").max(2000),
});

const SOURCE = "QUICKBOOKS" as const;

/**
 * Build a canonical, deterministic externalId for products without a SKU.
 * Inputs are trimmed, lowercased, and numeric prices are normalized (no trailing zeros)
 * so that formatting-only differences never create duplicates.
 */
function buildFallbackExternalId(product: z.infer<typeof ProductSchema>): string {
  const canonical = [
    (product.name || "").trim().toLowerCase(),
    (product.type || "").trim().toLowerCase(),
    product.price != null ? Number(product.price).toString() : "",
    (product.description || "").trim().toLowerCase(),
  ].join("|");

  const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
  return `qb-${hash}`;
}

function resolveExternalId(product: z.infer<typeof ProductSchema>): string {
  const sku = (product.sku || "").trim();
  if (sku) return sku;
  return buildFallbackExternalId(product);
}

function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function normalizeSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  return sku
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    || null;
}

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  // Role gate: only ADMIN/OWNER (API_SECRET_TOKEN gets role=ADMIN from api-auth.ts)
  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SeedPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { products } = parsed.data;
  const BATCH_SIZE = 200;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Deduplicate by externalId within the payload (last occurrence wins).
  // Report collisions so the user can clean up the source data.
  const duplicates: Array<{ name: string; externalId: string; occurrences: number }> = [];
  const deduped = new Map<string, z.infer<typeof ProductSchema>>();
  const idCounts = new Map<string, number>();

  for (const product of products) {
    const externalId = resolveExternalId(product);
    deduped.set(externalId, product); // last wins
    idCounts.set(externalId, (idCounts.get(externalId) || 0) + 1);
  }

  for (const [externalId, count] of idCounts) {
    if (count > 1) {
      const product = deduped.get(externalId)!;
      duplicates.push({ name: product.name, externalId, occurrences: count });
    }
  }

  const uniqueProducts = [...deduped.entries()];

  for (let i = 0; i < uniqueProducts.length; i += BATCH_SIZE) {
    const chunk = uniqueProducts.slice(i, i + BATCH_SIZE);

    // Pre-check which externalIds already exist
    const externalIds = chunk.map(([id]) => id);
    const existing = await prisma.catalogProduct.findMany({
      where: {
        source: SOURCE,
        externalId: { in: externalIds },
      },
      select: { externalId: true },
    });
    const existingSet = new Set(existing.map((e) => e.externalId));

    // Upsert each product
    const upsertPromises = chunk.map(async ([externalId, product]) => {
      try {
        const name = product.name.trim();
        const sku = (product.sku || "").trim() || null;

        await prisma!.catalogProduct.upsert({
          where: {
            source_externalId: { source: SOURCE, externalId },
          },
          update: {
            name,
            sku,
            normalizedName: normalizeName(name),
            normalizedSku: normalizeSku(sku),
            description: (product.description || "").trim() || null,
            price: product.price ?? null,
            status: (product.type || "").trim() || null,
            lastSyncedAt: new Date(),
          },
          create: {
            source: SOURCE,
            externalId,
            name,
            sku,
            normalizedName: normalizeName(name),
            normalizedSku: normalizeSku(sku),
            description: (product.description || "").trim() || null,
            price: product.price ?? null,
            status: (product.type || "").trim() || null,
          },
        });

        if (existingSet.has(externalId)) {
          updated++;
        } else {
          inserted++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Failed to upsert "${product.name}": ${msg}`);
        skipped++;
      }
    });

    await Promise.all(upsertPromises);
  }

  return NextResponse.json({
    source: "quickbooks",
    total: products.length,
    uniqueTotal: uniqueProducts.length,
    inserted,
    updated,
    skipped,
    duplicates: duplicates.length > 0 ? duplicates : undefined,
    errors: errors.length > 0 ? errors : undefined,
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest src/__tests__/api/products-seed.test.ts --no-coverage
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add src/app/api/products/seed/route.ts src/__tests__/api/products-seed.test.ts
git commit -m "feat: add POST /api/products/seed route with Zod validation and batched upserts"
```

---

### Task 5: CLI Script — Parse XLS and Seed

**Files:**
- Create: `scripts/seed-qb-products.ts`

**Step 1: Install xlsx as devDependency**

```bash
npm install --save-dev xlsx
```

**Step 2: Write the CLI script**

Create `scripts/seed-qb-products.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * Parse a QuickBooks product export (.xls/.xlsx) and seed into CatalogProduct cache.
 *
 * Usage:
 *   npx tsx scripts/seed-qb-products.ts path/to/ProductServiceList.xls
 *
 * Requires:
 *   API_SECRET_TOKEN env var (or pass via --token flag)
 *   API base URL defaults to http://localhost:3000 (or pass via --url flag)
 */

import * as XLSX from "xlsx";
import { resolve } from "path";

interface QBProduct {
  name: string;
  sku?: string;
  type?: string;
  price?: number;
  description?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let filePath = "";
  let apiUrl = process.env.API_BASE_URL || "http://localhost:3000";
  let token = process.env.API_SECRET_TOKEN || "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url" && args[i + 1]) {
      apiUrl = args[++i];
    } else if (args[i] === "--token" && args[i + 1]) {
      token = args[++i];
    } else if (!args[i].startsWith("--")) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error("Usage: npx tsx scripts/seed-qb-products.ts <path-to-xls> [--url http://...] [--token ...]");
    process.exit(1);
  }
  if (!token) {
    console.error("Error: API_SECRET_TOKEN env var or --token flag is required");
    process.exit(1);
  }

  return { filePath: resolve(filePath), apiUrl: apiUrl.replace(/\/$/, ""), token };
}

/** Strip $, commas, whitespace from price strings before parsing. */
function parsePrice(raw: unknown): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "number") return Number.isNaN(raw) ? undefined : raw;
  const cleaned = String(raw).replace(/[$,\s]/g, "").trim();
  if (!cleaned) return undefined;
  const num = Number(cleaned);
  return Number.isNaN(num) ? undefined : num;
}

function parseXls(filePath: string): QBProduct[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    console.error("Error: No sheets found in workbook");
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]);
  console.log(`Parsed ${rows.length} rows from sheet "${sheetName}"`);

  const products: QBProduct[] = [];
  let skippedNoName = 0;

  for (const row of rows) {
    // QuickBooks XLS column names (may vary slightly)
    const name = String(
      row["Product/Service"] || row["Product/Service Name"] || row["Name"] || ""
    ).trim();

    if (!name) {
      skippedNoName++;
      continue;
    }

    const sku = String(row["SKU"] || row["Sku"] || "").trim() || undefined;
    const type = String(row["Type"] || "").trim() || undefined;
    const priceRaw = row["Sales Price/Rate"] ?? row["Sales Price"] ?? row["Rate"];
    const price = parsePrice(priceRaw);
    const description = String(
      row["Sales Description"] || row["Description"] || ""
    ).trim() || undefined;

    products.push({
      name,
      sku,
      type,
      price,
      description,
    });
  }

  if (skippedNoName > 0) {
    console.log(`Skipped ${skippedNoName} rows with no product name`);
  }

  return products;
}

async function seedProducts(products: QBProduct[], apiUrl: string, token: string) {
  console.log(`Seeding ${products.length} products to ${apiUrl}/api/products/seed ...`);

  const res = await fetch(`${apiUrl}/api/products/seed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ products }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Seed request failed (${res.status}): ${text}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log("\n=== Seed Results ===");
  console.log(`  Total:      ${result.total}`);
  console.log(`  Unique:     ${result.uniqueTotal}`);
  console.log(`  Inserted:   ${result.inserted}`);
  console.log(`  Updated:    ${result.updated}`);
  console.log(`  Skipped:    ${result.skipped}`);
  if (result.duplicates?.length) {
    console.log(`\n  ⚠ Duplicate externalIds (${result.duplicates.length}):`);
    for (const dup of result.duplicates) {
      console.log(`    - "${dup.name}" (${dup.externalId}) appeared ${dup.occurrences}x`);
    }
  }
  if (result.errors?.length) {
    console.log(`\n  ✗ Errors:`);
    for (const err of result.errors) {
      console.log(`    - ${err}`);
    }
  }
}

async function main() {
  const { filePath, apiUrl, token } = parseArgs();
  console.log(`Reading: ${filePath}`);

  const products = parseXls(filePath);
  console.log(`Found ${products.length} valid products`);

  if (products.length === 0) {
    console.log("Nothing to seed.");
    return;
  }

  // Show a few examples
  console.log("\nSample products:");
  for (const p of products.slice(0, 3)) {
    console.log(`  ${p.name} | SKU: ${p.sku || "(none)"} | $${p.price ?? "?"} | ${p.type || "?"}`);
  }
  console.log("");

  await seedProducts(products, apiUrl, token);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

**Step 3: Verify the script parses the XLS**

```bash
npx tsx scripts/seed-qb-products.ts /Users/zach/Downloads/ProductServiceList__9130357387915916_02_27_2026.xls --token test 2>&1 | head -15
```

Expected: Shows parsed row count and sample products. Will fail on the HTTP POST (server not running with matching token), which is fine — we're verifying the parse step.

**Step 4: Commit**

```bash
git add scripts/seed-qb-products.ts package.json package-lock.json
git commit -m "feat: add CLI script to parse QuickBooks XLS and seed via API"
```

---

### Task 6: Integration Test — Full Build Verification

**Step 1: Run the full test suite**

```bash
npm run test -- --no-coverage
```

Expected: All tests pass, including the new `products-seed.test.ts`. Check exit code is 0.

**Step 2: Run the build**

```bash
npm run build
```

Expected: Build succeeds with exit code 0. The new seed route and updated comparison/cache routes compile without errors.

**Step 3: Run lint**

```bash
npm run lint
```

Expected: No lint errors, exit code 0.

**Step 4: Commit any fixes if needed, then final summary commit**

If all green, no additional commit needed. If fixes were required, commit them.

---

### Task 7: Seed the QuickBooks Products (Manual Step)

After the dev server is running with a valid `API_SECRET_TOKEN`:

```bash
# Start dev server (in another terminal)
npm run dev

# Run the seed script
API_SECRET_TOKEN=<your-token> npx tsx scripts/seed-qb-products.ts \
  /Users/zach/Downloads/ProductServiceList__9130357387915916_02_27_2026.xls
```

Expected output:
```
Reading: /Users/zach/Downloads/ProductServiceList__9130357387915916_02_27_2026.xls
Parsed 486 rows from sheet "Sheet1"
Found ~486 valid products

=== Seed Results ===
  Total:    486
  Inserted: 486
  Updated:  0
  Skipped:  0
```

After seeding, verify on the comparison dashboard that the QuickBooks column now shows products.
