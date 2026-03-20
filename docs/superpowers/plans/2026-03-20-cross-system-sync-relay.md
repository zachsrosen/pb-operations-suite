# Cross-System Sync Relay Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the product catalog sync modal to support relaying values between external systems through a server-derived canonical sync plan with auto-cascade, conflict detection, and mixed push/pull/skip per field.

**Architecture:** Three new server-side modules (types, mapping table, plan engine) replace the current split client/server field mapping. A new `POST /sync/plan` endpoint derives a canonical plan from user intents; revised `confirm` and `execute` endpoints use plan-hash-based HMAC approval. The SyncModal is rewritten to manage per-field intents with auto-cascade, conflict detection, and a plan preview step before confirm.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5, Prisma 7.3, React Query v5, Node.js crypto (SHA-256 HMAC)

**Spec:** `docs/superpowers/specs/2026-03-20-cross-system-sync-relay-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/catalog-sync-types.ts` | Shared types: ExternalSystem, FieldIntent, FieldMappingEdge, SyncPlan, SyncOperation, PullConflict, SyncOperationOutcome, FieldValueSnapshot |
| `src/lib/catalog-sync-mappings.ts` | Complete mapping table, normalizer functions, generator registry, transform registry, `getActiveMappings()` helper |
| `src/lib/catalog-sync-plan.ts` | Plan derivation engine: `buildSnapshots()`, `deriveDefaultIntents()`, `derivePlan()`, `computePlanHash()`, `executePlan()` |
| `src/app/api/inventory/products/[id]/sync/plan/route.ts` | `POST /sync/plan` — derive canonical plan from intents |
| `src/__tests__/lib/catalog-sync-mappings.test.ts` | Mapping table validation, normalizer tests |
| `src/__tests__/lib/catalog-sync-plan.test.ts` | Plan derivation, conflict detection, hash, execution tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/catalog-sync.ts` | Export `buildSkuName`, `getSpecData`; keep existing preview/execute for backward compat during migration |
| `src/lib/catalog-sync-confirmation.ts` | Add `buildPlanConfirmation()` and `validatePlanConfirmationToken()` alongside existing functions |
| `src/app/api/inventory/products/[id]/sync/route.ts` | Revised GET (return snapshots + mappings + defaultIntents), revised POST (plan-hash execute) |
| `src/app/api/inventory/products/[id]/sync/confirm/route.ts` | Accept planHash instead of systems+changesHash |
| `src/components/catalog/SyncModal.tsx` | Full rewrite: FieldIntent state, auto-cascade, conflict detection, plan preview step, new API flow |
| `src/__tests__/lib/catalog-sync.test.ts` | Update existing tests for refactored exports |

---

## Chunk 1: Types & Mapping Table

### Task 1: Create shared type definitions

**Files:**
- Create: `src/lib/catalog-sync-types.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/lib/catalog-sync-types.ts

// ── External system identifiers ──

export type ExternalSystem = "zoho" | "hubspot" | "zuper";

export const EXTERNAL_SYSTEMS: ExternalSystem[] = ["zoho", "hubspot", "zuper"];

// ── System precedence for equal-normalized multi-pull winner ──
// When multiple pulls normalize equal but differ in raw formatting,
// the first system in this order wins the raw write value.
export const SYSTEM_PRECEDENCE: ExternalSystem[] = ["zoho", "hubspot", "zuper"];

// ── Field intent (user's per-field decision) ──

export type Direction = "push" | "pull" | "skip";
export type SelectionMode = "manual" | "auto";

export interface FieldIntent {
  direction: Direction;
  mode: SelectionMode;
  /** Only meaningful when direction === "pull". Controls whether the
   *  pulled value writes to the internal product DB record. */
  updateInternalOnPull: boolean;
}

// ── Normalization ──

export type NormalizeWith = "number" | "trimmed-string" | "enum-ci";

// ── Field mapping edge ──

export interface FieldMappingEdge {
  system: ExternalSystem;
  externalField: string;
  /** Internal product field name. Virtual fields prefixed with `_`
   *  (e.g., `_name`, `_specification`) are never persisted. */
  internalField: string;
  normalizeWith: NormalizeWith;
  /** Restricts this edge to bidirectional, push-only, or pull-only.
   *  Default (undefined) = bidirectional. */
  direction?: "push-only" | "pull-only";
  /** Only active when the product's category is in this list. */
  condition?: { category: string[] };
  /** Auto-paired companion field name (e.g., vendor_name ↔ vendor_id). */
  companion?: string;
  /** Composite field generator key (e.g., "skuName", "zuperSpecification").
   *  Only valid on push-only edges with virtual internalField. */
  generator?: string;
  /** Pre-write transform key (e.g., "zuperCategoryUid").
   *  Runs at execution time before the external API call. */
  transform?: string;
}

// ── Field value snapshot (server returns at preview time) ──

export interface FieldValueSnapshot {
  system: ExternalSystem | "internal";
  field: string;
  rawValue: string | number | null;
  normalizedValue: string | number | null;
}

// ── Sync plan (server-derived from intents + snapshots) ──

export type SyncOperation =
  | {
      kind: "pull";
      system: ExternalSystem;
      externalField: string;
      internalField: string;
      value: string | number | null;
      updateInternal: boolean;
      noOp?: boolean;
      source: "manual";
    }
  | {
      kind: "push";
      system: ExternalSystem;
      externalField: string;
      value: string | number | null;
      source: "manual" | "cascade";
    }
  | {
      kind: "create";
      system: ExternalSystem;
      fields: Record<string, string | number | null>;
      source: "manual" | "cascade";
    };

export interface PullConflict {
  internalField: string;
  contenders: Array<{
    system: ExternalSystem;
    externalField: string;
    normalizedValue: string | number | null;
  }>;
}

export interface SyncPlan {
  productId: string;
  basePreviewHash: string;
  planHash: string;
  conflicts: PullConflict[];
  internalPatch: Record<string, string | number | null>;
  operations: SyncOperation[];
  summary: {
    pulls: number;
    internalWrites: number;
    pushes: number;
    creates: number;
  };
}

// ── Execution outcome ──

export interface SyncOperationOutcome {
  kind: "pull" | "push" | "create" | "internal-patch";
  system: ExternalSystem | "internal";
  status: "success" | "skipped" | "failed";
  message: string;
  fieldDetails: Array<{
    externalField: string;
    source: "manual" | "cascade";
  }>;
}

export interface SyncExecuteResponse {
  status: "success" | "partial" | "failed" | "stale" | "conflict";
  planHash: string;
  outcomes: SyncOperationOutcome[];
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/catalog-sync-types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalog-sync-types.ts
git commit -m "feat(sync-relay): add shared type definitions"
```

---

### Task 2: Create mapping table with normalizers, generators, and transforms

**Files:**
- Create: `src/lib/catalog-sync-mappings.ts`
- Read: `src/lib/catalog-fields.ts` (CATEGORY_CONFIGS, getHubspotPropertiesFromMetadata, generateZuperSpecification, getZuperCategoryValue)
- Read: `src/lib/catalog-sync.ts` (buildSkuName, getSpecData — lines 109-111, 98-107)
- Read: `src/lib/zuper-catalog.ts` (resolveZuperCategoryUid — lines 106-123)

- [ ] **Step 1: Write the mapping table module**

```ts
// src/lib/catalog-sync-mappings.ts

import type {
  ExternalSystem,
  FieldMappingEdge,
  NormalizeWith,
  FieldValueSnapshot,
} from "./catalog-sync-types";
import { CATEGORY_CONFIGS } from "./catalog-fields";
import type { FieldDef } from "./catalog-fields";

// ── Normalizer functions ──

export const normalizers: Record<NormalizeWith, (v: unknown) => string | number | null> = {
  number: (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  },
  "trimmed-string": (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  },
  "enum-ci": (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toLowerCase();
    return s === "" ? null : s;
  },
};

/** Normalize a raw value using the specified transform. */
export function normalize(value: unknown, method: NormalizeWith): string | number | null {
  return normalizers[method](value);
}

/** Compare two values after normalization. Returns true if equal. */
export function normalizedEqual(
  a: unknown,
  b: unknown,
  method: NormalizeWith,
): boolean {
  const na = normalize(a, method);
  const nb = normalize(b, method);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  return String(na) === String(nb);
}

// ── Generator registry ──
// Generators produce composite values from internal product state.
// They run during plan derivation (Step 2: re-materialize).

import { buildSkuName, getSpecData } from "./catalog-sync";
import { generateZuperSpecification } from "./catalog-fields";
import type { SkuRecord } from "./catalog-sync";

export type GeneratorFn = (sku: SkuRecord) => string | null;

export const generators: Record<string, GeneratorFn> = {
  skuName: (sku) => {
    const name = buildSkuName(sku);
    return name?.trim() || null;
  },
  zuperSpecification: (sku) => {
    const specData = getSpecData(sku);
    const spec = generateZuperSpecification(sku.category, specData);
    return spec?.trim() || null;
  },
};

// ── Transform registry ──
// Transforms convert an internal value to external format at write time.

import { resolveZuperCategoryUid } from "./zuper-catalog";
import { getZuperCategoryValue } from "./catalog-fields";

export type TransformFn = (value: string | number | null) => Promise<string | number | null>;

export const transforms: Record<string, TransformFn> = {
  zuperCategoryUid: async (value) => {
    if (!value) return null;
    const categoryName = getZuperCategoryValue(String(value));
    if (!categoryName) return String(value);
    return resolveZuperCategoryUid(categoryName);
  },
};

// ── Static mapping edges ──
// Fields that apply universally (all categories).

const STATIC_EDGES: FieldMappingEdge[] = [
  // ── Zoho ──
  { system: "zoho", externalField: "name", internalField: "_name",
    normalizeWith: "trimmed-string", direction: "push-only", generator: "skuName" },
  { system: "zoho", externalField: "sku", internalField: "sku",
    normalizeWith: "trimmed-string" },
  { system: "zoho", externalField: "rate", internalField: "sellPrice",
    normalizeWith: "number" },
  { system: "zoho", externalField: "purchase_rate", internalField: "unitCost",
    normalizeWith: "number" },
  { system: "zoho", externalField: "description", internalField: "description",
    normalizeWith: "trimmed-string" },
  { system: "zoho", externalField: "part_number", internalField: "model",
    normalizeWith: "trimmed-string", direction: "push-only" },
  { system: "zoho", externalField: "unit", internalField: "unitLabel",
    normalizeWith: "trimmed-string", direction: "push-only" },
  { system: "zoho", externalField: "vendor_name", internalField: "vendorName",
    normalizeWith: "trimmed-string", companion: "vendor_id" },
  { system: "zoho", externalField: "vendor_id", internalField: "zohoVendorId",
    normalizeWith: "trimmed-string", companion: "vendor_name" },

  // ── HubSpot (universal) ──
  { system: "hubspot", externalField: "name", internalField: "_name",
    normalizeWith: "trimmed-string", direction: "push-only", generator: "skuName" },
  { system: "hubspot", externalField: "hs_sku", internalField: "sku",
    normalizeWith: "trimmed-string" },
  { system: "hubspot", externalField: "price", internalField: "sellPrice",
    normalizeWith: "number" },
  { system: "hubspot", externalField: "hs_cost_of_goods_sold", internalField: "unitCost",
    normalizeWith: "number" },
  { system: "hubspot", externalField: "description", internalField: "description",
    normalizeWith: "trimmed-string" },
  { system: "hubspot", externalField: "manufacturer", internalField: "brand",
    normalizeWith: "enum-ci" },
  { system: "hubspot", externalField: "product_category", internalField: "category",
    normalizeWith: "enum-ci", direction: "push-only" },

  // ── Zuper ──
  { system: "zuper", externalField: "name", internalField: "_name",
    normalizeWith: "trimmed-string", direction: "push-only", generator: "skuName" },
  { system: "zuper", externalField: "sku", internalField: "sku",
    normalizeWith: "trimmed-string" },
  { system: "zuper", externalField: "description", internalField: "description",
    normalizeWith: "trimmed-string" },
  { system: "zuper", externalField: "category", internalField: "category",
    normalizeWith: "enum-ci", transform: "zuperCategoryUid" },
  { system: "zuper", externalField: "specification", internalField: "_specification",
    normalizeWith: "trimmed-string", direction: "push-only", generator: "zuperSpecification" },
];

// ── Category-conditional edges ──
// Derived from CATEGORY_CONFIGS hubspotProperty definitions.

function buildCategoryHubSpotEdges(): FieldMappingEdge[] {
  const edges: FieldMappingEdge[] = [];
  for (const [category, config] of Object.entries(CATEGORY_CONFIGS)) {
    if (!config.fields) continue;
    for (const field of config.fields as FieldDef[]) {
      if (!field.hubspotProperty) continue;
      edges.push({
        system: "hubspot",
        externalField: field.hubspotProperty,
        internalField: field.key,
        normalizeWith: field.type === "number" ? "number" : "trimmed-string",
        condition: { category: [category] },
      });
    }
  }
  // Merge edges with same system+externalField+internalField but different categories
  // (e.g., if two categories share the same hubspotProperty→key mapping)
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

// ── Complete mapping table ──

let _allEdges: FieldMappingEdge[] | null = null;

export function getAllMappingEdges(): FieldMappingEdge[] {
  if (!_allEdges) {
    _allEdges = [...STATIC_EDGES, ...buildCategoryHubSpotEdges()];
  }
  return _allEdges;
}

/** Filter mapping edges to only those active for a given product category. */
export function getActiveMappings(category: string): FieldMappingEdge[] {
  return getAllMappingEdges().filter((edge) => {
    if (!edge.condition) return true;
    return edge.condition.category.includes(category);
  });
}

/** Get active mappings for a specific system and category. */
export function getSystemMappings(
  system: ExternalSystem,
  category: string,
): FieldMappingEdge[] {
  return getActiveMappings(category).filter((e) => e.system === system);
}

/** Get all pullable mappings for a system (excludes push-only edges). */
export function getPullableMappings(
  system: ExternalSystem,
  category: string,
): FieldMappingEdge[] {
  return getSystemMappings(system, category).filter(
    (e) => e.direction !== "push-only",
  );
}

/** Get all pushable mappings for a system (excludes pull-only edges). */
export function getPushableMappings(
  system: ExternalSystem,
  category: string,
): FieldMappingEdge[] {
  return getSystemMappings(system, category).filter(
    (e) => e.direction !== "pull-only",
  );
}

/** Validate that no two active edges share the same system+externalField.
 *  Returns conflicting pairs or empty array if valid. */
export function validateMappings(category: string): string[] {
  const active = getActiveMappings(category);
  const seen = new Map<string, FieldMappingEdge>();
  const errors: string[] = [];
  for (const edge of active) {
    const key = `${edge.system}:${edge.externalField}`;
    const existing = seen.get(key);
    if (existing) {
      errors.push(
        `Collision: ${key} maps to both "${existing.internalField}" and "${edge.internalField}"`,
      );
    } else {
      seen.set(key, edge);
    }
  }
  return errors;
}

/** Check if an internal field is virtual (prefixed with _). */
export function isVirtualField(internalField: string): boolean {
  return internalField.startsWith("_");
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/catalog-sync-mappings.ts`
Expected: No errors (may need to export `buildSkuName` and `getSpecData` from catalog-sync.ts first — see Task 3)

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalog-sync-mappings.ts
git commit -m "feat(sync-relay): add mapping table with normalizers, generators, transforms"
```

---

### Task 3: Export helpers from catalog-sync.ts

**Files:**
- Modify: `src/lib/catalog-sync.ts:86-111` (add export to `str`, `numStr`, `getSpecData`, `buildSkuName`)

- [ ] **Step 1: Add exports to existing helper functions**

In `src/lib/catalog-sync.ts`, add `export` keyword to:
- `str()` at line ~86
- `numStr()` at line ~92
- `getSpecData()` at line ~98
- `buildSkuName()` at line ~109

These are currently module-private. The mapping table and plan engine need them.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalog-sync.ts
git commit -m "refactor(sync): export helper functions for mapping table"
```

---

### Task 4: Write mapping table tests

**Files:**
- Create: `src/__tests__/lib/catalog-sync-mappings.test.ts`

- [ ] **Step 1: Write tests**

```ts
// src/__tests__/lib/catalog-sync-mappings.test.ts

import {
  normalize,
  normalizedEqual,
  getAllMappingEdges,
  getActiveMappings,
  getSystemMappings,
  getPullableMappings,
  validateMappings,
  isVirtualField,
  generators,
} from "@/lib/catalog-sync-mappings";

describe("normalizers", () => {
  describe("number", () => {
    it("parses float from string", () => {
      expect(normalize("6600.00", "number")).toBe(6600);
    });
    it("returns null for empty string", () => {
      expect(normalize("", "number")).toBeNull();
    });
    it("returns null for NaN", () => {
      expect(normalize("abc", "number")).toBeNull();
    });
    it("returns null for null/undefined", () => {
      expect(normalize(null, "number")).toBeNull();
      expect(normalize(undefined, "number")).toBeNull();
    });
  });

  describe("trimmed-string", () => {
    it("trims whitespace", () => {
      expect(normalize("  hello  ", "trimmed-string")).toBe("hello");
    });
    it("returns null for empty after trim", () => {
      expect(normalize("   ", "trimmed-string")).toBeNull();
    });
  });

  describe("enum-ci", () => {
    it("lowercases and trims", () => {
      expect(normalize("  HYUNDAI  ", "enum-ci")).toBe("hyundai");
    });
  });
});

describe("normalizedEqual", () => {
  it("numbers equal regardless of string formatting", () => {
    expect(normalizedEqual("6600", "6600.00", "number")).toBe(true);
  });
  it("enum-ci ignores case", () => {
    expect(normalizedEqual("Hyundai", "HYUNDAI", "enum-ci")).toBe(true);
  });
  it("trimmed-string is case-sensitive", () => {
    expect(normalizedEqual("Hyundai", "HYUNDAI", "trimmed-string")).toBe(false);
  });
});

describe("mapping table", () => {
  it("returns non-empty edge list", () => {
    const edges = getAllMappingEdges();
    expect(edges.length).toBeGreaterThan(15);
  });

  it("has name as push-only on all three systems", () => {
    const edges = getAllMappingEdges();
    const nameEdges = edges.filter((e) => e.externalField === "name");
    expect(nameEdges).toHaveLength(3);
    for (const e of nameEdges) {
      expect(e.direction).toBe("push-only");
      expect(e.generator).toBe("skuName");
      expect(e.internalField).toBe("_name");
    }
  });

  it("has specification as push-only on zuper", () => {
    const edges = getAllMappingEdges();
    const specEdge = edges.find(
      (e) => e.system === "zuper" && e.externalField === "specification",
    );
    expect(specEdge).toBeDefined();
    expect(specEdge!.direction).toBe("push-only");
    expect(specEdge!.generator).toBe("zuperSpecification");
  });

  it("has companion fields for zoho vendor", () => {
    const edges = getAllMappingEdges();
    const vendorName = edges.find(
      (e) => e.system === "zoho" && e.externalField === "vendor_name",
    );
    const vendorId = edges.find(
      (e) => e.system === "zoho" && e.externalField === "vendor_id",
    );
    expect(vendorName!.companion).toBe("vendor_id");
    expect(vendorId!.companion).toBe("vendor_name");
  });
});

describe("getActiveMappings", () => {
  it("includes MODULE-conditional dc_size for MODULE products", () => {
    const mappings = getActiveMappings("MODULE");
    const dcSize = mappings.find(
      (e) => e.system === "hubspot" && e.externalField === "dc_size",
    );
    expect(dcSize).toBeDefined();
    expect(dcSize!.internalField).toBe("wattage");
  });

  it("excludes MODULE-conditional dc_size for INVERTER products", () => {
    const mappings = getActiveMappings("INVERTER");
    const dcSize = mappings.find(
      (e) => e.system === "hubspot" && e.externalField === "dc_size",
    );
    expect(dcSize).toBeUndefined();
  });
});

describe("validateMappings", () => {
  it("reports no collisions for MODULE", () => {
    expect(validateMappings("MODULE")).toEqual([]);
  });

  it("reports no collisions for BATTERY", () => {
    expect(validateMappings("BATTERY")).toEqual([]);
  });

  it("reports no collisions for EV_CHARGER", () => {
    expect(validateMappings("EV_CHARGER")).toEqual([]);
  });
});

describe("isVirtualField", () => {
  it("identifies virtual fields", () => {
    expect(isVirtualField("_name")).toBe(true);
    expect(isVirtualField("_specification")).toBe(true);
    expect(isVirtualField("sellPrice")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=catalog-sync-mappings --verbose`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/lib/catalog-sync-mappings.test.ts
git commit -m "test(sync-relay): add mapping table and normalizer tests"
```

---

## Chunk 2: Plan Derivation Engine

### Task 5: Create the plan derivation module — snapshot building

**Files:**
- Create: `src/lib/catalog-sync-plan.ts`
- Read: `src/lib/catalog-sync.ts` (previewZoho, previewHubSpot, previewZuper, parseXxxCurrentFields — for understanding how to fetch current external state)
- Read: `src/lib/zoho-inventory.ts` (getItemById)
- Read: `src/lib/hubspot.ts` (getHubSpotProductById)
- Read: `src/lib/zuper-catalog.ts` (getZuperPartById)

- [ ] **Step 1: Write snapshot builder and default intents**

```ts
// src/lib/catalog-sync-plan.ts

import { createHash } from "crypto";
import type {
  ExternalSystem,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
  SyncPlan,
  SyncOperation,
  PullConflict,
  SyncOperationOutcome,
  SyncExecuteResponse,
} from "./catalog-sync-types";
import { EXTERNAL_SYSTEMS, SYSTEM_PRECEDENCE } from "./catalog-sync-types";
import {
  getActiveMappings,
  getSystemMappings,
  getPushableMappings,
  normalize,
  normalizedEqual,
  generators,
  transforms,
  isVirtualField,
} from "./catalog-sync-mappings";
import type { SkuRecord } from "./catalog-sync";
import { str, numStr, getSpecData, buildSkuName } from "./catalog-sync";
import { zohoInventory } from "./zoho-inventory";
import { getHubSpotProductById } from "./hubspot";
import { getZuperPartById } from "./zuper-catalog";
import {
  getHubSpotPropertyNames,
  parseZohoCurrentFields,
  parseHubSpotCurrentFields,
  parseZuperCurrentFields,
  executeZohoSync,
  executeHubSpotSync,
  executeZuperSync,
} from "./catalog-sync";
import { prisma } from "./db";

// ── Snapshot building ──

/** Fetch current field values from all external systems + internal state.
 *  Returns flat array of FieldValueSnapshot entries. */
export async function buildSnapshots(
  sku: SkuRecord,
  category: string,
): Promise<FieldValueSnapshot[]> {
  const snapshots: FieldValueSnapshot[] = [];
  const activeMappings = getActiveMappings(category);

  // Internal snapshots — from the SkuRecord itself
  const internalValues = buildInternalSnapshot(sku, activeMappings);
  snapshots.push(...internalValues);

  // External snapshots — fetched in parallel
  const [zohoSnaps, hubspotSnaps, zuperSnaps] = await Promise.all([
    buildExternalSnapshot("zoho", sku, activeMappings),
    buildExternalSnapshot("hubspot", sku, activeMappings),
    buildExternalSnapshot("zuper", sku, activeMappings),
  ]);
  snapshots.push(...zohoSnaps, ...hubspotSnaps, ...zuperSnaps);

  return snapshots;
}

function buildInternalSnapshot(
  sku: SkuRecord,
  mappings: FieldMappingEdge[],
): FieldValueSnapshot[] {
  const snapshots: FieldValueSnapshot[] = [];
  const seen = new Set<string>();

  for (const edge of mappings) {
    if (seen.has(edge.internalField)) continue;
    seen.add(edge.internalField);

    // Virtual fields get their value from generators
    let rawValue: string | number | null;
    if (isVirtualField(edge.internalField) && edge.generator) {
      const gen = generators[edge.generator];
      rawValue = gen ? gen(sku) : null;
    } else {
      rawValue = getSkuFieldValue(sku, edge.internalField);
    }

    snapshots.push({
      system: "internal",
      field: edge.internalField,
      rawValue,
      normalizedValue: normalize(rawValue, edge.normalizeWith),
    });
  }
  return snapshots;
}

async function buildExternalSnapshot(
  system: ExternalSystem,
  sku: SkuRecord,
  mappings: FieldMappingEdge[],
): Promise<FieldValueSnapshot[]> {
  const systemMappings = mappings.filter((e) => e.system === system);
  if (systemMappings.length === 0) return [];

  const externalFields = await fetchExternalFields(system, sku);
  if (!externalFields) return []; // system not linked

  const snapshots: FieldValueSnapshot[] = [];
  for (const edge of systemMappings) {
    const rawValue = externalFields[edge.externalField] ?? null;
    snapshots.push({
      system,
      field: edge.externalField,
      rawValue: rawValue === undefined ? null : rawValue,
      normalizedValue: normalize(rawValue, edge.normalizeWith),
    });
  }
  return snapshots;
}

async function fetchExternalFields(
  system: ExternalSystem,
  sku: SkuRecord,
): Promise<Record<string, string | null> | null> {
  try {
    switch (system) {
      case "zoho": {
        if (!sku.zohoItemId) return null;
        const item = await zohoInventory.getItemById(sku.zohoItemId);
        if (!item) return null;
        return parseZohoCurrentFields(item);
      }
      case "hubspot": {
        if (!sku.hubspotProductId) return null;
        const props = getHubSpotPropertyNames(sku);
        const product = await getHubSpotProductById(sku.hubspotProductId, props);
        if (!product) return null;
        return parseHubSpotCurrentFields(product);
      }
      case "zuper": {
        if (!sku.zuperItemId) return null;
        const part = await getZuperPartById(sku.zuperItemId);
        if (!part) return null;
        return parseZuperCurrentFields(part);
      }
    }
  } catch {
    return null;
  }
}

/** Read a field value from the SkuRecord by field name. */
function getSkuFieldValue(sku: SkuRecord, field: string): string | number | null {
  if (isVirtualField(field)) return null;
  // Check spec data for category-specific fields
  const specData = getSpecData(sku);
  if (specData && field in specData) {
    const v = specData[field];
    if (v === null || v === undefined) return null;
    return typeof v === "number" ? v : String(v);
  }
  // Check core SkuRecord fields
  const v = (sku as Record<string, unknown>)[field];
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : String(v);
}

// ── Default intents ──

/** Derive default field intents from snapshots.
 *  - Fields with a diff: push / manual
 *  - Fields with no diff: skip / auto
 *  - Fields on unlinked systems (create): push / manual for all mapped fields
 */
export function deriveDefaultIntents(
  sku: SkuRecord,
  snapshots: FieldValueSnapshot[],
  category: string,
): Record<ExternalSystem, Record<string, FieldIntent>> {
  const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
    zoho: {},
    hubspot: {},
    zuper: {},
  };

  for (const system of EXTERNAL_SYSTEMS) {
    const isLinked = isSystemLinked(system, sku);
    const systemMappings = getSystemMappings(system, category);

    for (const edge of systemMappings) {
      // Push-only fields don't get user intents — server auto-includes them
      if (edge.direction === "push-only") continue;

      if (!isLinked) {
        // Unlinked system = create: all fields default to push/manual
        intents[system][edge.externalField] = {
          direction: "push",
          mode: "manual",
          updateInternalOnPull: true,
        };
        continue;
      }

      // Check if internal vs external differs
      const internalSnap = snapshots.find(
        (s) => s.system === "internal" && s.field === edge.internalField,
      );
      const externalSnap = snapshots.find(
        (s) => s.system === system && s.field === edge.externalField,
      );

      const hasDiff = !normalizedEqual(
        internalSnap?.rawValue,
        externalSnap?.rawValue,
        edge.normalizeWith,
      );

      intents[system][edge.externalField] = {
        direction: hasDiff ? "push" : "skip",
        mode: hasDiff ? "manual" : "auto",
        updateInternalOnPull: true,
      };
    }
  }

  return intents;
}

function isSystemLinked(system: ExternalSystem, sku: SkuRecord): boolean {
  switch (system) {
    case "zoho": return !!sku.zohoItemId;
    case "hubspot": return !!sku.hubspotProductId;
    case "zuper": return !!sku.zuperItemId;
  }
}

// ── Hash helpers ──

/** Hash raw external snapshots for basePreviewHash (informational). */
export function computeBasePreviewHash(snapshots: FieldValueSnapshot[]): string {
  const external = snapshots
    .filter((s) => s.system !== "internal")
    .sort((a, b) => `${a.system}:${a.field}`.localeCompare(`${b.system}:${b.field}`));
  return createHash("sha256").update(JSON.stringify(external)).digest("hex");
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/catalog-sync-plan.ts`
Expected: No errors (some imports may need `getHubSpotPropertyNames`, `parseXxxCurrentFields` to be exported from catalog-sync.ts — add exports if needed)

- [ ] **Step 3: Export any additional functions from catalog-sync.ts**

In `src/lib/catalog-sync.ts`, ensure these are exported (add `export` if not already present):
- `str()` (line ~86) — already exported by Task 3 if done before this task
- `numStr()` (line ~92) — already exported by Task 3
- `getSpecData()` (line ~98) — already exported by Task 3
- `buildSkuName()` (line ~109) — already exported by Task 3
- `getHubSpotPropertyNames()` (line ~202)
- `parseZohoCurrentFields()` (line ~157)
- `parseHubSpotCurrentFields()` (line ~208)
- `parseZuperCurrentFields()` (line ~237)
- `executeZohoSync()` (line ~462) — verify already exported
- `executeHubSpotSync()` (line ~525) — verify already exported
- `executeZuperSync()` (line ~594) — verify already exported

- [ ] **Step 4: Commit**

```bash
git add src/lib/catalog-sync-plan.ts src/lib/catalog-sync.ts
git commit -m "feat(sync-relay): add snapshot builder and default intents"
```

---

### Task 6: Plan derivation core — intents to canonical plan

**Files:**
- Modify: `src/lib/catalog-sync-plan.ts` (append plan derivation functions)

- [ ] **Step 1: Add plan derivation, conflict detection, plan hash**

Append to `src/lib/catalog-sync-plan.ts`:

```ts
// ── Plan derivation ──

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

/** Derive a canonical sync plan from user intents + fresh snapshots.
 *  This is the core server-side logic called by POST /sync/plan and POST /sync/execute. */
export function derivePlan(
  sku: SkuRecord,
  intents: Record<ExternalSystem, Record<string, FieldIntent>>,
  snapshots: FieldValueSnapshot[],
  category: string,
): SyncPlan {
  const activeMappings = getActiveMappings(category);

  // Step 1: Derive pull operations from intents
  const pulls = derivePullOperations(intents, activeMappings, snapshots);

  // Step 2: Detect conflicts (pass mappings for correct normalizeWith lookup)
  const conflicts = detectConflicts(pulls, activeMappings);

  // Step 3: Compute effective internal state (with relay-only overlays)
  const { internalPatch, effectiveState } = computeEffectiveState(
    sku, pulls, activeMappings,
  );

  // Step 4: Derive push and create operations
  const pushesAndCreates = derivePushOperations(
    sku, intents, activeMappings, snapshots, effectiveState,
  );

  // Step 5: Add generator-backed push-only fields (always server-derived)
  const generatorOps = deriveGeneratorPushes(
    sku, activeMappings, snapshots, effectiveState,
  );

  const allOps: SyncOperation[] = [...pulls, ...pushesAndCreates, ...generatorOps];

  // Step 6: Mark no-op pulls (pass mappings for field-level downstream check)
  markNoOpPulls(allOps, activeMappings);

  // Step 7: Compute hashes
  const basePreviewHash = computeBasePreviewHash(snapshots);
  const planHash = computePlanHash(sku.id, internalPatch, allOps);

  return {
    productId: sku.id,
    basePreviewHash,
    planHash,
    conflicts,
    internalPatch,
    operations: allOps,
    summary: {
      pulls: allOps.filter((o) => o.kind === "pull" && !o.noOp).length,
      internalWrites: Object.keys(internalPatch).length,
      pushes: allOps.filter((o) => o.kind === "push").length,
      creates: allOps.filter((o) => o.kind === "create").length,
    },
  };
}

// ── Pull operations ──

function derivePullOperations(
  intents: Record<ExternalSystem, Record<string, FieldIntent>>,
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
): SyncOperation[] {
  const pulls: SyncOperation[] = [];

  for (const system of EXTERNAL_SYSTEMS) {
    const systemIntents = intents[system] ?? {};
    for (const [externalField, intent] of Object.entries(systemIntents)) {
      if (intent.direction !== "pull") continue;

      const edge = mappings.find(
        (e) => e.system === system && e.externalField === externalField,
      );
      if (!edge || edge.direction === "push-only") continue;

      const snap = snapshots.find(
        (s) => s.system === system && s.field === externalField,
      );

      pulls.push({
        kind: "pull",
        system,
        externalField,
        internalField: edge.internalField,
        value: snap?.rawValue ?? null,
        updateInternal: intent.updateInternalOnPull,
        source: "manual",
      });

      // Auto-expand companion fields
      if (edge.companion) {
        const companionEdge = mappings.find(
          (e) => e.system === system && e.externalField === edge.companion,
        );
        if (companionEdge && !pulls.some(
          (p) => p.kind === "pull" && p.system === system &&
                 p.externalField === edge.companion,
        )) {
          const companionSnap = snapshots.find(
            (s) => s.system === system && s.field === edge.companion,
          );
          pulls.push({
            kind: "pull",
            system,
            externalField: edge.companion!,
            internalField: companionEdge.internalField,
            value: companionSnap?.rawValue ?? null,
            updateInternal: intent.updateInternalOnPull, // inherit from trigger
            source: "manual",
          });
        }
      }
    }
  }

  return pulls;
}

// ── Conflict detection ──

function detectConflicts(
  pulls: SyncOperation[],
  mappings: FieldMappingEdge[],
): PullConflict[] {
  // Group pulls by internalField
  const groups = new Map<string, SyncOperation[]>();
  for (const pull of pulls) {
    if (pull.kind !== "pull") continue;
    const key = pull.internalField;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pull);
  }

  const conflicts: PullConflict[] = [];
  for (const [internalField, fieldPulls] of groups) {
    if (fieldPulls.length < 2) continue;

    // Look up normalizeWith from the mapping edge for this internal field
    const edge = mappings.find((e) => e.internalField === internalField);
    const normalizeWith = edge?.normalizeWith ?? "trimmed-string";
    const uniqueNormalized = new Set(
      fieldPulls.map((p) => String(normalize(p.value, normalizeWith) ?? "")),
    );

    if (uniqueNormalized.size > 1) {
      conflicts.push({
        internalField,
        contenders: fieldPulls.map((p) => ({
          system: p.system as ExternalSystem,
          externalField: p.externalField,
          normalizedValue: normalize(p.value, normalizeWith),
        })),
      });
    }
  }
  return conflicts;
}

// ── Effective state computation ──

function computeEffectiveState(
  sku: SkuRecord,
  pulls: SyncOperation[],
  mappings: FieldMappingEdge[],
): { internalPatch: Record<string, string | number | null>; effectiveState: Record<string, string | number | null> } {
  const internalPatch: Record<string, string | number | null> = {};
  const effectiveState: Record<string, string | number | null> = {};

  // Start with current internal values
  for (const edge of mappings) {
    if (isVirtualField(edge.internalField)) continue;
    const current = getSkuFieldValue(sku, edge.internalField);
    effectiveState[edge.internalField] = current;
  }

  // Apply pulls. For equal-normalized multi-pulls, use system precedence.
  const pullsByInternal = new Map<string, SyncOperation[]>();
  for (const pull of pulls) {
    if (pull.kind !== "pull" || isVirtualField(pull.internalField)) continue;
    if (!pullsByInternal.has(pull.internalField)) pullsByInternal.set(pull.internalField, []);
    pullsByInternal.get(pull.internalField)!.push(pull);
  }

  for (const [internalField, fieldPulls] of pullsByInternal) {
    // Pick winner by system precedence
    const winner = fieldPulls.sort(
      (a, b) =>
        SYSTEM_PRECEDENCE.indexOf(a.system as ExternalSystem) -
        SYSTEM_PRECEDENCE.indexOf(b.system as ExternalSystem),
    )[0];

    effectiveState[internalField] = winner.value;

    // Only add to internalPatch if at least one pull has updateInternal=true
    const anyPersist = fieldPulls.some(
      (p) => p.kind === "pull" && p.updateInternal,
    );
    if (anyPersist) {
      internalPatch[internalField] = winner.value;
    }
  }

  // Overlay relay-only pulls (updateInternal=false) into effectiveState
  // These are already in effectiveState from the loop above.
  // The distinction is: they appear in effectiveState but NOT in internalPatch.

  return { internalPatch, effectiveState };
}

// ── Push/create operation derivation ──

function derivePushOperations(
  sku: SkuRecord,
  intents: Record<ExternalSystem, Record<string, FieldIntent>>,
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
  effectiveState: Record<string, string | number | null>,
): SyncOperation[] {
  const ops: SyncOperation[] = [];

  for (const system of EXTERNAL_SYSTEMS) {
    const isLinked = isSystemLinked(system, sku);
    const systemIntents = intents[system] ?? {};
    const systemMappings = mappings.filter(
      (e) => e.system === system && e.direction !== "push-only",
    );

    if (!isLinked) {
      // Create operation: collect all pushable field values
      const hasAnyPush = Object.values(systemIntents).some(
        (i) => i.direction === "push",
      );
      if (hasAnyPush) {
        const fields: Record<string, string | number | null> = {};
        const pushableMappings = getPushableMappings(system, sku.category);
        for (const edge of pushableMappings) {
          if (edge.direction === "push-only") continue; // generators handled separately
          fields[edge.externalField] = effectiveState[edge.internalField] ?? null;
        }
        ops.push({
          kind: "create",
          system,
          fields,
          source: "manual",
        });
      }
      continue;
    }

    // Push operations for linked systems
    for (const [externalField, intent] of Object.entries(systemIntents)) {
      if (intent.direction !== "push") continue;

      const edge = systemMappings.find((e) => e.externalField === externalField);
      if (!edge) continue;

      const value = effectiveState[edge.internalField] ?? null;
      ops.push({
        kind: "push",
        system,
        externalField,
        value,
        source: intent.mode === "auto" ? "cascade" : "manual",
      });
    }
  }

  return ops;
}

// ── Generator-backed push-only fields ──

function deriveGeneratorPushes(
  sku: SkuRecord,
  mappings: FieldMappingEdge[],
  snapshots: FieldValueSnapshot[],
  effectiveState: Record<string, string | number | null>,
): SyncOperation[] {
  const ops: SyncOperation[] = [];

  // Build a temporary sku-like object with effective state overlaid
  const effectiveSku = buildEffectiveSku(sku, effectiveState);

  for (const edge of mappings) {
    if (!edge.generator || edge.direction !== "push-only") continue;
    if (!isSystemLinked(edge.system, sku)) continue; // handled by create ops

    const gen = generators[edge.generator];
    if (!gen) continue;

    const generatedValue = gen(effectiveSku);
    const externalSnap = snapshots.find(
      (s) => s.system === edge.system && s.field === edge.externalField,
    );

    // Only push if the generated value differs from current external
    if (!normalizedEqual(generatedValue, externalSnap?.rawValue, edge.normalizeWith)) {
      ops.push({
        kind: "push",
        system: edge.system,
        externalField: edge.externalField,
        value: generatedValue,
        source: "cascade",
      });
    }
  }

  return ops;
}

/** Build a SkuRecord-like object with effective state values overlaid.
 *  Used so generators read the post-patch + relay-overlay values. */
function buildEffectiveSku(
  sku: SkuRecord,
  effectiveState: Record<string, string | number | null>,
): SkuRecord {
  const specData = getSpecData(sku) ?? {};
  const mergedSpec = { ...specData };

  // Overlay effective state onto spec data and core fields
  const merged = { ...sku } as Record<string, unknown>;
  for (const [field, value] of Object.entries(effectiveState)) {
    if (field in specData) {
      mergedSpec[field] = value;
    } else {
      merged[field] = value;
    }
  }

  // Re-inject spec data into the appropriate spec relation
  const specTable = getSpecData(sku) ? getSpecTableForSku(sku) : null;
  if (specTable) {
    merged[specTable] = mergedSpec;
  }

  return merged as SkuRecord;
}

function getSpecTableForSku(sku: SkuRecord): string | null {
  if (sku.moduleSpec) return "moduleSpec";
  if (sku.inverterSpec) return "inverterSpec";
  if (sku.batterySpec) return "batterySpec";
  if (sku.evChargerSpec) return "evChargerSpec";
  if (sku.mountingHardwareSpec) return "mountingHardwareSpec";
  if (sku.electricalHardwareSpec) return "electricalHardwareSpec";
  if (sku.relayDeviceSpec) return "relayDeviceSpec";
  return null;
}

// ── No-op marking ──

function markNoOpPulls(
  operations: SyncOperation[],
  mappings: FieldMappingEdge[],
): void {
  for (const op of operations) {
    if (op.kind !== "pull") continue;
    if (op.updateInternal) continue; // persists to DB, not a no-op

    // A relay-only pull is no-op if no downstream push/create on another
    // system touches a field whose mapping shares this pull's internalField.
    const siblingExternalFields = mappings
      .filter(
        (e) =>
          e.internalField === op.internalField &&
          e.system !== op.system &&
          e.direction !== "pull-only",
      )
      .map((e) => `${e.system}:${e.externalField}`);

    const hasDownstream = operations.some(
      (other) =>
        other !== op &&
        (other.kind === "push" || other.kind === "create") &&
        (other.kind === "push"
          ? siblingExternalFields.includes(`${other.system}:${other.externalField}`)
          : siblingExternalFields.some((sf) => sf.startsWith(`${other.system}:`))),
    );

    if (!hasDownstream) {
      op.noOp = true;
    }
  }
}

// ── Plan hash ──

function opSortKey(op: SyncOperation): string {
  const field = op.kind === "create" ? "create" : op.externalField;
  return `${op.kind}:${op.system}:${field}`;
}

function canonicalizeOp(op: SyncOperation): Record<string, unknown> {
  if (op.kind === "pull") {
    return {
      kind: op.kind, system: op.system, externalField: op.externalField,
      internalField: op.internalField, value: op.value,
      updateInternal: op.updateInternal,
    };
  }
  if (op.kind === "push") {
    return {
      kind: op.kind, system: op.system, externalField: op.externalField,
      value: op.value, source: op.source,
    };
  }
  return {
    kind: op.kind, system: op.system,
    fields: sortKeys(op.fields as Record<string, unknown>),
    source: op.source,
  };
}

export function computePlanHash(
  productId: string,
  internalPatch: Record<string, string | number | null>,
  operations: SyncOperation[],
): string {
  const activeOps = operations.filter(
    (op) => !(op.kind === "pull" && op.noOp),
  );
  const canonical = {
    productId,
    internalPatch: sortKeys(internalPatch as Record<string, unknown>),
    operations: activeOps
      .sort((a, b) => opSortKey(a).localeCompare(opSortKey(b)))
      .map(canonicalizeOp),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/catalog-sync-plan.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/catalog-sync-plan.ts
git commit -m "feat(sync-relay): add plan derivation engine with conflict detection and hash"
```

---

### Task 7: Plan execution engine

**Files:**
- Modify: `src/lib/catalog-sync-plan.ts` (append execution functions)
- Read: `src/lib/catalog-sync.ts:462-741` (current execute functions for reference)

- [ ] **Step 1: Add execution engine**

Append to `src/lib/catalog-sync-plan.ts`:

```ts
// ── Plan execution ──

/** Execute a validated sync plan. Called by POST /sync/execute after stale check. */
export async function executePlan(
  sku: SkuRecord,
  plan: SyncPlan,
): Promise<SyncExecuteResponse> {
  const outcomes: SyncOperationOutcome[] = [];

  // Step 1: Apply internal patch (pass sku for spec-table field detection)
  if (Object.keys(plan.internalPatch).length > 0) {
    const patchOutcome = await applyInternalPatch(sku.id, plan.internalPatch, sku);
    outcomes.push(patchOutcome);
    if (patchOutcome.status === "failed") {
      return { status: "failed", planHash: plan.planHash, outcomes };
    }
  }

  // Step 2: Re-materialize outbound writes from effective state
  const effectiveState = await buildPostPatchEffectiveState(sku, plan);

  // Build effective SKU for generators
  const effectiveSku = buildEffectiveSku(sku, effectiveState);

  // Step 3: Execute external writes in parallel (one batch per system)
  const externalOps = plan.operations.filter(
    (op) => op.kind === "push" || op.kind === "create",
  );
  const systemGroups = groupBySystem(externalOps);

  const externalOutcomes = await Promise.all(
    Array.from(systemGroups.entries()).map(([system, ops]) =>
      executeSystemWrites(system, sku, ops, effectiveState, effectiveSku),
    ),
  );
  outcomes.push(...externalOutcomes);

  // Step 4: Link-back after create (update InternalProduct with external IDs)
  // This happens inside executeSystemWrites for create operations.

  // Step 5: Determine overall status
  const externalStatuses = externalOutcomes.map((o) => o.status);
  const anyFailed = externalStatuses.includes("failed");
  const allSuccess = externalStatuses.every(
    (s) => s === "success" || s === "skipped",
  );

  return {
    status: allSuccess ? "success" : anyFailed ? "partial" : "success",
    planHash: plan.planHash,
    outcomes,
  };
}

async function applyInternalPatch(
  productId: string,
  patch: Record<string, string | number | null>,
  sku: SkuRecord,
): Promise<SyncOperationOutcome> {
  try {
    // Split patch into core InternalProduct fields vs spec-table fields.
    // Spec fields (wattage, efficiency, etc.) live on separate relations
    // (ModuleSpec, InverterSpec, etc.), not on InternalProduct directly.
    const coreData: Record<string, unknown> = {};
    const specData: Record<string, unknown> = {};
    const existingSpec = getSpecData(sku) ?? {};

    for (const [field, value] of Object.entries(patch)) {
      if (isVirtualField(field)) continue;
      if (field in existingSpec) {
        specData[field] = value;
      } else {
        coreData[field] = value;
      }
    }

    const totalFields = Object.keys(coreData).length + Object.keys(specData).length;
    if (totalFields === 0) {
      return {
        kind: "internal-patch",
        system: "internal",
        status: "skipped",
        message: "No fields to update",
        fieldDetails: [],
      };
    }

    // Update core InternalProduct fields
    if (Object.keys(coreData).length > 0) {
      await prisma.internalProduct.update({
        where: { id: productId },
        data: coreData,
      });
    }

    // Update spec-table fields via the appropriate relation
    if (Object.keys(specData).length > 0) {
      const specTable = getSpecTableForSku(sku);
      if (specTable) {
        const specModel = specTable as keyof typeof prisma;
        await (prisma[specModel] as { update: Function }).update({
          where: { internalProductId: productId },
          data: specData,
        });
      }
    }

    return {
      kind: "internal-patch",
      system: "internal",
      status: "success",
      message: `Updated ${totalFields} field(s)`,
      fieldDetails: Object.keys(patch)
        .filter((f) => !isVirtualField(f))
        .map((f) => ({
          externalField: f,
          source: "manual" as const,
        })),
    };
  } catch (err) {
    return {
      kind: "internal-patch",
      system: "internal",
      status: "failed",
      message: err instanceof Error ? err.message : "Internal patch failed",
      fieldDetails: [],
    };
  }
}

async function buildPostPatchEffectiveState(
  sku: SkuRecord,
  plan: SyncPlan,
): Promise<Record<string, string | number | null>> {
  // Start from the internal patch (what was just written to DB)
  const state: Record<string, string | number | null> = {};

  // Load current SKU values
  const activeMappings = getActiveMappings(sku.category);
  for (const edge of activeMappings) {
    if (isVirtualField(edge.internalField)) continue;
    state[edge.internalField] = getSkuFieldValue(sku, edge.internalField);
  }

  // Apply the persisted patch
  for (const [field, value] of Object.entries(plan.internalPatch)) {
    state[field] = value;
  }

  // Overlay relay-only pull values (updateInternal=false, not in internalPatch)
  for (const op of plan.operations) {
    if (op.kind === "pull" && !op.updateInternal && !op.noOp) {
      state[op.internalField] = op.value;
    }
  }

  return state;
}

function groupBySystem(
  ops: SyncOperation[],
): Map<ExternalSystem, SyncOperation[]> {
  const groups = new Map<ExternalSystem, SyncOperation[]>();
  for (const op of ops) {
    if (op.kind === "pull") continue;
    if (!groups.has(op.system)) groups.set(op.system, []);
    groups.get(op.system)!.push(op);
  }
  return groups;
}

async function executeSystemWrites(
  system: ExternalSystem,
  sku: SkuRecord,
  ops: SyncOperation[],
  effectiveState: Record<string, string | number | null>,
  effectiveSku: SkuRecord,
): Promise<SyncOperationOutcome> {
  const fieldDetails: SyncOperationOutcome["fieldDetails"] = [];
  for (const op of ops) {
    if (op.kind === "push") {
      fieldDetails.push({ externalField: op.externalField, source: op.source });
    } else if (op.kind === "create") {
      for (const field of Object.keys(op.fields)) {
        fieldDetails.push({ externalField: field, source: op.source });
      }
    }
  }

  try {
    const createOp = ops.find((o) => o.kind === "create");
    if (createOp && createOp.kind === "create") {
      return await executeCreate(system, sku, createOp, effectiveSku, fieldDetails);
    }

    const pushOps = ops.filter((o): o is Extract<SyncOperation, { kind: "push" }> =>
      o.kind === "push",
    );
    if (pushOps.length === 0) {
      return { kind: "push", system, status: "skipped", message: "No changes", fieldDetails };
    }

    return await executePushes(system, sku, pushOps, effectiveState, effectiveSku, fieldDetails);
  } catch (err) {
    return {
      kind: ops.some((o) => o.kind === "create") ? "create" : "push",
      system,
      status: "failed",
      message: err instanceof Error ? err.message : "External write failed",
      fieldDetails,
    };
  }
}

// The actual executeCreate and executePushes functions delegate to the existing
// system-specific logic in catalog-sync.ts (executeZohoSync, executeHubSpotSync,
// executeZuperSync). These are imported at the top of this file (Task 5 Step 1).

async function executeCreate(
  system: ExternalSystem,
  sku: SkuRecord,
  op: Extract<SyncOperation, { kind: "create" }>,
  effectiveSku: SkuRecord,
  fieldDetails: SyncOperationOutcome["fieldDetails"],
): Promise<SyncOperationOutcome> {
  // Build a synthetic SyncPreview for the existing execute functions
  const changes = Object.entries(op.fields).map(([field, value]) => ({
    field,
    currentValue: null,
    proposedValue: value != null ? String(value) : null,
  }));

  const preview = {
    system: system as "zoho" | "hubspot" | "zuper",
    externalId: null,
    linked: false,
    action: "create" as const,
    changes,
    noChanges: false,
  };

  const result = await executeSystemSync(system, effectiveSku, preview);

  return {
    kind: "create",
    system,
    status: result.status === "created" ? "success" : "failed",
    message: result.status === "created"
      ? `Created in ${system}`
      : `Failed to create in ${system}`,
    fieldDetails,
  };
}

async function executePushes(
  system: ExternalSystem,
  sku: SkuRecord,
  ops: Extract<SyncOperation, { kind: "push" }>[],
  effectiveState: Record<string, string | number | null>,
  effectiveSku: SkuRecord,
  fieldDetails: SyncOperationOutcome["fieldDetails"],
): Promise<SyncOperationOutcome> {
  // Build a synthetic SyncPreview with the push fields
  const changes = ops.map((op) => ({
    field: op.externalField,
    currentValue: null, // we don't need current for push
    proposedValue: op.value != null ? String(op.value) : null,
  }));

  const externalId = getExternalId(system, sku);

  const preview = {
    system: system as "zoho" | "hubspot" | "zuper",
    externalId,
    linked: true,
    action: "update" as const,
    changes,
    noChanges: false,
  };

  const result = await executeSystemSync(system, effectiveSku, preview);

  return {
    kind: "push",
    system,
    status: result.status === "updated" ? "success" : result.status === "skipped" ? "skipped" : "failed",
    message: result.status === "updated"
      ? `Pushed ${ops.length} field(s) to ${system}`
      : result.status === "skipped"
        ? "Skipped"
        : `Failed: ${result.status}`,
    fieldDetails,
  };
}

function getExternalId(system: ExternalSystem, sku: SkuRecord): string | null {
  switch (system) {
    case "zoho": return sku.zohoItemId;
    case "hubspot": return sku.hubspotProductId;
    case "zuper": return sku.zuperItemId;
  }
}

async function executeSystemSync(
  system: ExternalSystem,
  sku: SkuRecord,
  preview: { system: string; externalId: string | null; linked: boolean; action: string; changes: Array<{ field: string; currentValue: string | null; proposedValue: string | null }>; noChanges: boolean },
) {
  switch (system) {
    case "zoho": return executeZohoSync(sku, preview as Parameters<typeof executeZohoSync>[1]);
    case "hubspot": return executeHubSpotSync(sku, preview as Parameters<typeof executeHubSpotSync>[1]);
    case "zuper": return executeZuperSync(sku, preview as Parameters<typeof executeZuperSync>[1]);
  }
}
```

- [ ] **Step 2: Verify execute functions are already exported**

Confirm that `executeZohoSync`, `executeHubSpotSync`, and `executeZuperSync` are already exported from `src/lib/catalog-sync.ts` (they should be — check lines ~462, ~525, ~594). No changes needed.

- [ ] **Step 3: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/catalog-sync-plan.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/catalog-sync-plan.ts src/lib/catalog-sync.ts
git commit -m "feat(sync-relay): add plan execution engine with effective state overlay"
```

---

### Task 8: Plan derivation tests

**Files:**
- Create: `src/__tests__/lib/catalog-sync-plan.test.ts`

- [ ] **Step 1: Write plan derivation tests**

```ts
// src/__tests__/lib/catalog-sync-plan.test.ts

import {
  deriveDefaultIntents,
  derivePlan,
  computePlanHash,
  computeBasePreviewHash,
} from "@/lib/catalog-sync-plan";
import type {
  ExternalSystem,
  FieldIntent,
  FieldValueSnapshot,
} from "@/lib/catalog-sync-types";
import type { SkuRecord } from "@/lib/catalog-sync";

// Minimal SkuRecord for testing
const baseSku: SkuRecord = {
  id: "test-product-1",
  category: "MODULE",
  brand: "Silfab",
  model: "SIL-410-BG",
  name: "Silfab SIL-410-BG",
  description: "410W Solar Panel",
  sku: "SIL410BG",
  vendorName: null,
  vendorPartNumber: null,
  unitSpec: null,
  unitLabel: "pcs",
  unitCost: 200,
  sellPrice: 305,
  hardToProcure: false,
  length: null,
  width: null,
  weight: null,
  zohoItemId: "zoho-123",
  zohoVendorId: null,
  hubspotProductId: "hs-456",
  zuperItemId: "zuper-789",
  moduleSpec: { wattage: 410, efficiency: 20.5, cellType: "Mono PERC" },
  inverterSpec: null,
  batterySpec: null,
  evChargerSpec: null,
  mountingHardwareSpec: null,
  electricalHardwareSpec: null,
  relayDeviceSpec: null,
};

describe("deriveDefaultIntents", () => {
  it("defaults to push/manual for fields with diffs", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "280", normalizedValue: 280 },
    ];
    const intents = deriveDefaultIntents(baseSku, snapshots, "MODULE");
    expect(intents.hubspot.price.direction).toBe("push");
    expect(intents.hubspot.price.mode).toBe("manual");
  });

  it("defaults to skip/auto for fields without diffs", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "305", normalizedValue: 305 },
    ];
    const intents = deriveDefaultIntents(baseSku, snapshots, "MODULE");
    expect(intents.hubspot.price.direction).toBe("skip");
    expect(intents.hubspot.price.mode).toBe("auto");
  });
});

describe("derivePlan", () => {
  it("produces push operations from push intents", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "280", normalizedValue: 280 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {},
      hubspot: {
        price: { direction: "push", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    const pushOps = plan.operations.filter((o) => o.kind === "push");
    expect(pushOps.some((o) => o.externalField === "price")).toBe(true);
  });

  it("detects pull conflicts for same internal field with different values", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "zoho", field: "rate", rawValue: "6600", normalizedValue: 6600 },
      { system: "hubspot", field: "price", rawValue: "280", normalizedValue: 280 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].internalField).toBe("sellPrice");
    expect(plan.conflicts[0].contenders).toHaveLength(2);
  });

  it("does not conflict when normalized values are equal", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "zoho", field: "rate", rawValue: "305.00", normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "305", normalizedValue: 305 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    expect(plan.conflicts).toHaveLength(0);
  });

  it("uses zoho precedence for equal-normalized multi-pull raw value", () => {
    const snapshots: FieldValueSnapshot[] = [
      { system: "internal", field: "sellPrice", rawValue: 305, normalizedValue: 305 },
      { system: "zoho", field: "rate", rawValue: "305.00", normalizedValue: 305 },
      { system: "hubspot", field: "price", rawValue: "305", normalizedValue: 305 },
    ];
    const intents: Record<ExternalSystem, Record<string, FieldIntent>> = {
      zoho: {
        rate: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      hubspot: {
        price: { direction: "pull", mode: "manual", updateInternalOnPull: true },
      },
      zuper: {},
    };
    const plan = derivePlan(baseSku, intents, snapshots, "MODULE");
    // Zoho wins by precedence
    expect(plan.internalPatch.sellPrice).toBe("305.00");
  });
});

describe("computePlanHash", () => {
  it("is deterministic for same inputs", () => {
    const patch = { sellPrice: 305 as string | number | null };
    const ops = [
      { kind: "push" as const, system: "hubspot" as ExternalSystem, externalField: "price",
        value: 305 as string | number | null, source: "manual" as const },
    ];
    const h1 = computePlanHash("p1", patch, ops);
    const h2 = computePlanHash("p1", patch, ops);
    expect(h1).toBe(h2);
  });

  it("excludes no-op pulls from hash", () => {
    const patch = {};
    const ops1 = [
      { kind: "pull" as const, system: "zoho" as ExternalSystem, externalField: "rate",
        internalField: "sellPrice", value: 305 as string | number | null,
        updateInternal: false, noOp: true, source: "manual" as const },
    ];
    const ops2: typeof ops1 = [];
    expect(computePlanHash("p1", patch, ops1)).toBe(computePlanHash("p1", patch, ops2));
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern=catalog-sync-plan --verbose`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/lib/catalog-sync-plan.test.ts
git commit -m "test(sync-relay): add plan derivation and conflict detection tests"
```

---

## Chunk 3: API Routes & Confirmation

### Task 9: Add plan-hash confirmation functions

**Files:**
- Modify: `src/lib/catalog-sync-confirmation.ts`

- [ ] **Step 1: Add planHash-based confirmation alongside existing**

Append to `src/lib/catalog-sync-confirmation.ts`:

```ts
// ── Plan-hash-based confirmation (new sync relay flow) ──

interface PlanConfirmationInput {
  internalProductId: string;
  planHash: string;
  issuedAt: number;
}

function toPlanCanonicalPayload(input: PlanConfirmationInput): string {
  return JSON.stringify({
    internalProductId: input.internalProductId,
    planHash: input.planHash,
    issuedAt: Math.trunc(input.issuedAt),
  });
}

export async function createPlanConfirmationToken(
  input: PlanConfirmationInput,
): Promise<string | null> {
  const secret = getSyncConfirmationSecret();
  if (!secret) return null;
  const payload = toPlanCanonicalPayload(input);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function validatePlanConfirmationToken(
  input: PlanConfirmationInput & { token: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = Date.now();
  if (input.issuedAt > now + 60_000) {
    return { ok: false, error: "Token issued in the future" };
  }
  if (now - input.issuedAt > CATALOG_SYNC_CONFIRM_TTL_MS) {
    return { ok: false, error: "Token expired" };
  }
  const expected = await createPlanConfirmationToken(input);
  if (!expected || !secureEquals(input.token, expected)) {
    return { ok: false, error: "Invalid token" };
  }
  return { ok: true };
}

export function buildPlanConfirmation(
  internalProductId: string,
  planHash: string,
  issuedAt?: number,
): Promise<{ token: string; issuedAt: number; expiresAt: number } | null> {
  const now = issuedAt ?? Date.now();
  return createPlanConfirmationToken({
    internalProductId,
    planHash,
    issuedAt: now,
  }).then((token) => {
    if (!token) return null;
    return {
      token,
      issuedAt: now,
      expiresAt: now + CATALOG_SYNC_CONFIRM_TTL_MS,
    };
  });
}
```

- [ ] **Step 2: Add `createHmac` import if not already present**

Ensure `import { createHmac, timingSafeEqual } from "crypto"` is at the top.

- [ ] **Step 3: Verify the file compiles**

Run: `npx tsc --noEmit src/lib/catalog-sync-confirmation.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/catalog-sync-confirmation.ts
git commit -m "feat(sync-relay): add plan-hash confirmation token functions"
```

---

### Task 10: Create POST /sync/plan API route

**Files:**
- Create: `src/app/api/inventory/products/[id]/sync/plan/route.ts`
- Read: `src/app/api/inventory/products/[id]/sync/route.ts` (for auth pattern, SKU_INCLUDE)

- [ ] **Step 1: Write the plan endpoint**

```ts
// src/app/api/inventory/products/[id]/sync/plan/route.ts

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/user";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { prisma } from "@/lib/db";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";
import { buildSnapshots, derivePlan } from "@/lib/catalog-sync-plan";
import type { ExternalSystem, FieldIntent } from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER"]);
const SKU_INCLUDE = {
  moduleSpec: true,
  inverterSpec: true,
  batterySpec: true,
  evChargerSpec: true,
  mountingHardwareSpec: true,
  electricalHardwareSpec: true,
  relayDeviceSpec: true,
};

// Reuse the same authenticate pattern as the existing sync route
async function authenticate() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return { error: authResult };

  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!ALLOWED_ROLES.has(role)) {
    return { error: NextResponse.json({ error: "Admin or owner access required" }, { status: 403 }) };
  }
  return { email: authResult.email };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is disabled" }, { status: 404 });
  }

  const auth = await authenticate();
  if ("error" in auth) return auth.error;

  const { id } = await params;
  const product = await prisma.internalProduct.findUnique({
    where: { id },
    include: SKU_INCLUDE,
  });

  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  let body: { intents: Record<ExternalSystem, Record<string, FieldIntent>> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.intents || typeof body.intents !== "object") {
    return NextResponse.json({ error: "intents is required" }, { status: 400 });
  }

  // Validate intent systems
  for (const sys of Object.keys(body.intents)) {
    if (!EXTERNAL_SYSTEMS.includes(sys as ExternalSystem)) {
      return NextResponse.json({ error: `Invalid system: ${sys}` }, { status: 400 });
    }
  }

  const sku = product as unknown as import("@/lib/catalog-sync").SkuRecord;
  const snapshots = await buildSnapshots(sku, product.category);
  const plan = derivePlan(sku, body.intents, snapshots, product.category);

  return NextResponse.json({ plan });
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/products/[id]/sync/plan/route.ts
git commit -m "feat(sync-relay): add POST /sync/plan API endpoint"
```

---

### Task 11: Revise GET /sync to return snapshots, mappings, defaultIntents

**Files:**
- Modify: `src/app/api/inventory/products/[id]/sync/route.ts` (GET handler, lines ~38-76)

- [ ] **Step 1: Update GET handler**

Replace the GET handler body to also return the new data. Keep the existing response fields for backward compatibility:

```ts
// In the GET handler, after fetching the product:
import { buildSnapshots, deriveDefaultIntents, computeBasePreviewHash } from "@/lib/catalog-sync-plan";
import { getActiveMappings } from "@/lib/catalog-sync-mappings";

// ... existing product fetch ...

const sku = product as unknown as SkuRecord;

// Existing flow (keep for backward compat during migration)
const previews = await previewSyncToLinkedSystems(sku);
const changesHash = computePreviewHash(previews);

// New flow
const snapshots = await buildSnapshots(sku, product.category);
const mappings = getActiveMappings(product.category);
const defaultIntents = deriveDefaultIntents(sku, snapshots, product.category);
const basePreviewHash = computeBasePreviewHash(snapshots);

return NextResponse.json({
  // Legacy fields (remove after SyncModal migration)
  internalProductId: product.id,
  previews,
  changesHash,
  systems: previews.map((p) => p.system),
  // New fields
  snapshots,
  mappings,
  defaultIntents,
  basePreviewHash,
});
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/products/[id]/sync/route.ts
git commit -m "feat(sync-relay): extend GET /sync with snapshots, mappings, defaultIntents"
```

---

### Task 12: Revise POST /sync/confirm for planHash

**Files:**
- Modify: `src/app/api/inventory/products/[id]/sync/confirm/route.ts`

- [ ] **Step 1: Add planHash path alongside existing**

Update the POST handler to accept either the old `{ systems, changesHash }` or new `{ planHash }` body:

```ts
import { buildPlanConfirmation } from "@/lib/catalog-sync-confirmation";

// In the POST handler, after auth check:

const body = await request.json();

// New flow: planHash-based confirmation
if (body.planHash && typeof body.planHash === "string") {
  const confirmation = await buildPlanConfirmation(id, body.planHash);
  if (!confirmation) {
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
  return NextResponse.json(confirmation);
}

// Legacy flow: systems + changesHash (keep during migration)
// ... existing validation and buildSyncConfirmation call ...
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/products/[id]/sync/confirm/route.ts
git commit -m "feat(sync-relay): add planHash confirmation path"
```

---

### Task 13: Revise POST /sync/execute for plan-based execution

**Files:**
- Modify: `src/app/api/inventory/products/[id]/sync/route.ts` (POST handler)

- [ ] **Step 1: Add plan-based execute path**

In the POST handler, detect the new request shape and branch:

```ts
import { buildSnapshots, derivePlan, executePlan } from "@/lib/catalog-sync-plan";
import { validatePlanConfirmationToken } from "@/lib/catalog-sync-confirmation";

// In POST handler, after auth and product fetch:

// Detect new flow: request has planHash + intents
if (body.planHash && body.intents) {
  // Validate plan confirmation token
  const tokenResult = await validatePlanConfirmationToken({
    internalProductId: id,
    planHash: body.planHash,
    issuedAt: body.issuedAt,
    token: body.token,
  });
  if (!tokenResult.ok) {
    return NextResponse.json({ error: tokenResult.error }, { status: 403 });
  }

  // Re-derive plan from fresh state
  const snapshots = await buildSnapshots(sku, product.category);
  const freshPlan = derivePlan(sku, body.intents, snapshots, product.category);

  // Stale check
  if (freshPlan.planHash !== body.planHash) {
    return NextResponse.json(
      { error: "External state changed. Re-preview required.", status: "stale" },
      { status: 409 },
    );
  }

  // Conflict check
  if (freshPlan.conflicts.length > 0) {
    return NextResponse.json(
      { error: "Unresolved conflicts", status: "conflict", conflicts: freshPlan.conflicts },
      { status: 409 },
    );
  }

  // Execute
  const result = await executePlan(sku, freshPlan);
  return NextResponse.json(result);
}

// Legacy flow: token + systems + changesHash (keep during migration)
// ... existing execute logic ...
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/inventory/products/[id]/sync/route.ts
git commit -m "feat(sync-relay): add plan-based execute path with stale detection"
```

---

## Chunk 4: SyncModal Client Rewrite

### Task 14: Create auto-cascade hook

**Files:**
- Create: `src/hooks/useSyncCascade.ts`

- [ ] **Step 1: Write the cascade hook**

```ts
// src/hooks/useSyncCascade.ts

import { useCallback, useRef } from "react";
import type {
  ExternalSystem,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
  NormalizeWith,
} from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";

type IntentsMap = Record<ExternalSystem, Record<string, FieldIntent>>;

interface UseSyncCascadeOptions {
  mappings: FieldMappingEdge[];
  snapshots: FieldValueSnapshot[];
}

/** Manages auto-cascade logic: when a field becomes pull/manual,
 *  sibling fields on other systems auto-set to push or skip. */
export function useSyncCascade({ mappings, snapshots }: UseSyncCascadeOptions) {
  const mappingsRef = useRef(mappings);
  mappingsRef.current = mappings;
  const snapshotsRef = useRef(snapshots);
  snapshotsRef.current = snapshots;

  /** Run cascade logic over the full intent map. Returns a new intents object. */
  const applyCascade = useCallback(
    (intents: IntentsMap): IntentsMap => {
      const result = structuredClone(intents);
      const m = mappingsRef.current;
      const s = snapshotsRef.current;

      // Find all active pulls
      const activePulls: Array<{
        system: ExternalSystem;
        externalField: string;
        internalField: string;
        rawValue: string | number | null;
      }> = [];

      for (const system of EXTERNAL_SYSTEMS) {
        for (const [field, intent] of Object.entries(result[system] ?? {})) {
          if (intent.direction !== "pull") continue;
          const edge = m.find(
            (e) => e.system === system && e.externalField === field,
          );
          if (!edge) continue;
          const snap = s.find(
            (sn) => sn.system === system && sn.field === field,
          );
          activePulls.push({
            system,
            externalField: field,
            internalField: edge.internalField,
            rawValue: snap?.rawValue ?? null,
          });
        }
      }

      // Build effective internal values from pulls
      const effectiveValues = new Map<string, string | number | null>();
      for (const pull of activePulls) {
        effectiveValues.set(pull.internalField, pull.rawValue);
      }

      // For fields still without a pull, use the internal snapshot
      for (const snap of s) {
        if (snap.system === "internal" && !effectiveValues.has(snap.field)) {
          effectiveValues.set(snap.field, snap.rawValue);
        }
      }

      // Cascade: for each auto-mode field on non-pulling systems, set push or skip
      for (const system of EXTERNAL_SYSTEMS) {
        for (const [field, intent] of Object.entries(result[system] ?? {})) {
          if (intent.mode !== "auto") continue;
          const edge = m.find(
            (e) => e.system === system && e.externalField === field,
          );
          if (!edge) continue;

          const effectiveValue = effectiveValues.get(edge.internalField);
          const externalSnap = s.find(
            (sn) => sn.system === system && sn.field === field,
          );

          // Compare effective value with external current
          const effectiveNorm = normalizeForCompare(
            effectiveValue,
            edge.normalizeWith,
          );
          const externalNorm = normalizeForCompare(
            externalSnap?.rawValue,
            edge.normalizeWith,
          );

          const hasDiff = effectiveNorm !== externalNorm;
          result[system][field] = {
            ...intent,
            direction: hasDiff ? "push" : "skip",
          };
        }
      }

      return result;
    },
    [],
  );

  return { applyCascade };
}

function normalizeForCompare(
  value: unknown,
  method: NormalizeWith,
): string {
  if (value === null || value === undefined) return "__null__";
  switch (method) {
    case "number": {
      const n = parseFloat(String(value));
      return Number.isFinite(n) ? String(n) : "__null__";
    }
    case "enum-ci":
      return String(value).trim().toLowerCase();
    default:
      return String(value).trim();
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit src/hooks/useSyncCascade.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSyncCascade.ts
git commit -m "feat(sync-relay): add useSyncCascade hook for auto-cascade logic"
```

---

### Task 15: Rewrite SyncModal — state model and API flow

**Files:**
- Modify: `src/components/catalog/SyncModal.tsx`
- Read: Current `SyncModal.tsx` for modal wrapper, loading spinner, status badge patterns

This is the largest single task. The SyncModal is rewritten to use the new state model and API flow. The key changes:

1. Replace `fieldDirections` with `intents: Record<ExternalSystem, Record<string, FieldIntent>>`
2. Replace `PULL_FIELD_MAP` / `COMPANION_FIELDS` with server-returned `mappings`
3. Add plan preview step between intent setting and confirm
4. Add conflict detection UI
5. Add update-internal toggle
6. Add auto/manual mode badges

- [ ] **Step 1: Rewrite SyncModal**

Replace the entire contents of `src/components/catalog/SyncModal.tsx`. The complete implementation below uses the existing modal patterns from the current file (dialog wrapper, loading spinner, status badges) adapted to the new state model.

```tsx
// src/components/catalog/SyncModal.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  ExternalSystem,
  Direction,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
  SyncPlan,
  SyncOperationOutcome,
} from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";
import { useSyncCascade } from "@/hooks/useSyncCascade";

type IntentsMap = Record<ExternalSystem, Record<string, FieldIntent>>;
type Step = "loading" | "intents" | "plan-preview" | "executing" | "results";

const SYSTEM_LABELS: Record<ExternalSystem, string> = {
  zoho: "Zoho Inventory",
  hubspot: "HubSpot",
  zuper: "Zuper",
};

interface SyncModalProps {
  internalProductId: string;
  productName: string;
  isOpen: boolean;
  onClose: () => void;
  onSyncComplete?: () => void;
}

export default function SyncModal({
  internalProductId,
  productName,
  isOpen,
  onClose,
  onSyncComplete,
}: SyncModalProps) {
  // ── State ──
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<FieldValueSnapshot[]>([]);
  const [mappings, setMappings] = useState<FieldMappingEdge[]>([]);
  const [intents, setIntents] = useState<IntentsMap>({ zoho: {}, hubspot: {}, zuper: {} });
  const [basePreviewHash, setBasePreviewHash] = useState<string>("");
  const [globalUpdateInternal, setGlobalUpdateInternal] = useState(true);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [outcomes, setOutcomes] = useState<SyncOperationOutcome[]>([]);
  const [confirmText, setConfirmText] = useState("");

  const { applyCascade } = useSyncCascade({ mappings, snapshots });

  // ── Load data on open ──
  useEffect(() => {
    if (!isOpen) return;
    setStep("loading");
    setError(null);
    setPlan(null);
    setOutcomes([]);
    setConfirmText("");

    fetch(`/api/inventory/products/${internalProductId}/sync`)
      .then((r) => r.json())
      .then((data) => {
        setSnapshots(data.snapshots);
        setMappings(data.mappings);
        setIntents(data.defaultIntents);
        setBasePreviewHash(data.basePreviewHash);
        setStep("intents");
      })
      .catch((err) => {
        setError(err.message);
        setStep("intents");
      });
  }, [isOpen, internalProductId]);

  // ── Helpers ──

  function getSnapshotValue(system: ExternalSystem | "internal", field: string) {
    return snapshots.find((s) => s.system === system && s.field === field)?.rawValue ?? null;
  }

  function isSystemLinked(system: ExternalSystem): boolean {
    return snapshots.some((s) => s.system === system);
  }

  function getSystemMappings(system: ExternalSystem): FieldMappingEdge[] {
    return mappings.filter(
      (e) => e.system === system && e.direction !== "push-only",
    );
  }

  const hasAnyDiffs = Object.values(intents).some((sysIntents) =>
    Object.values(sysIntents).some((i) => i.direction !== "skip"),
  );

  // ── Direction cycling ──

  const cycleDirection = useCallback(
    (system: ExternalSystem, field: string) => {
      setIntents((prev) => {
        const current = prev[system]?.[field];
        if (!current) return prev;

        const edge = mappings.find(
          (e) => e.system === system && e.externalField === field,
        );
        const canPull = edge && edge.direction !== "push-only";
        const directions: Direction[] = canPull
          ? ["push", "skip", "pull"]
          : ["push", "skip"];

        const idx = directions.indexOf(current.direction);
        const next = directions[(idx + 1) % directions.length];

        const updated = structuredClone(prev);
        updated[system][field] = {
          direction: next,
          mode: "manual",
          updateInternalOnPull: current.updateInternalOnPull,
        };
        return applyCascade(updated);
      });
    },
    [mappings, applyCascade],
  );

  // ── Toggle update-internal per field ──

  function toggleFieldUpdateInternal(system: ExternalSystem, field: string) {
    setIntents((prev) => {
      const updated = structuredClone(prev);
      const intent = updated[system]?.[field];
      if (intent) {
        intent.updateInternalOnPull = !intent.updateInternalOnPull;
      }
      return updated;
    });
  }

  // ── Global update-internal toggle ──

  function handleGlobalUpdateInternalToggle() {
    const newValue = !globalUpdateInternal;
    setGlobalUpdateInternal(newValue);
    setIntents((prev) => {
      const updated = structuredClone(prev);
      for (const system of EXTERNAL_SYSTEMS) {
        for (const intent of Object.values(updated[system] ?? {})) {
          intent.updateInternalOnPull = newValue;
        }
      }
      return updated;
    });
  }

  // ── Reset auto decisions ──

  function resetAutoDecisions() {
    setIntents((prev) => {
      const updated = structuredClone(prev);
      for (const system of EXTERNAL_SYSTEMS) {
        for (const [field, intent] of Object.entries(updated[system] ?? {})) {
          if (intent.mode === "manual") {
            // Reset manual overrides back to auto, let cascade re-derive
            updated[system][field] = { ...intent, mode: "auto" };
          }
        }
      }
      return applyCascade(updated);
    });
  }

  // ── Preview plan ──

  async function handlePreviewPlan() {
    setError(null);
    try {
      const response = await fetch(
        `/api/inventory/products/${internalProductId}/sync/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intents }),
        },
      );
      if (!response.ok) {
        const err = await response.json();
        setError(err.error ?? "Failed to derive plan");
        return;
      }
      const data = await response.json();
      setPlan(data.plan);
      setStep("plan-preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview plan");
    }
  }

  // ── Execute ──
  // Note: execute goes through existing POST /sync route, not a separate /sync/execute

  async function handleExecute() {
    if (!plan) return;
    setStep("executing");
    setError(null);
    try {
      // 1. Get confirmation token
      const confirmRes = await fetch(
        `/api/inventory/products/${internalProductId}/sync/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planHash: plan.planHash }),
        },
      );
      if (!confirmRes.ok) {
        setError("Failed to get confirmation token");
        setStep("plan-preview");
        return;
      }
      const { token, issuedAt } = await confirmRes.json();

      // 2. Execute via POST /sync
      const execRes = await fetch(
        `/api/inventory/products/${internalProductId}/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planHash: plan.planHash, token, issuedAt, intents }),
        },
      );
      const result = await execRes.json();

      if (execRes.status === 409) {
        setError("External state changed since preview. Please re-preview.");
        setStep("intents");
        return;
      }
      if (!execRes.ok) {
        setError(result.error ?? "Sync failed");
        setStep("plan-preview");
        return;
      }

      setOutcomes(result.outcomes);
      setStep("results");
      onSyncComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
      setStep("plan-preview");
    }
  }

  // ── Render ──

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Sync: {productName}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            &times;
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Loading */}
        {step === "loading" && (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          </div>
        )}

        {/* Intent Editor */}
        {step === "intents" && (
          <div className="space-y-6">
            {EXTERNAL_SYSTEMS.map((system) => {
              const sysMappings = getSystemMappings(system);
              const linked = isSystemLinked(system);
              if (sysMappings.length === 0) return null;

              return (
                <div key={system} className="rounded-lg border border-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-medium text-foreground">
                      {SYSTEM_LABELS[system]}
                    </h3>
                    <span className={`text-xs rounded-full px-2 py-0.5 ${
                      linked
                        ? "bg-blue-500/10 text-blue-400"
                        : "bg-green-500/10 text-green-400"
                    }`}>
                      {linked ? "Update" : "Will Create"}
                    </span>
                  </div>

                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="pb-2">Field</th>
                        <th className="pb-2">Direction</th>
                        <th className="pb-2">Internal</th>
                        <th className="pb-2">External</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sysMappings.map((edge) => {
                        const intent = intents[system]?.[edge.externalField];
                        if (!intent) return null;
                        const internalVal = getSnapshotValue("internal", edge.internalField);
                        const externalVal = getSnapshotValue(system, edge.externalField);

                        return (
                          <tr key={edge.externalField} className="border-t border-border/50">
                            <td className="py-2 text-foreground">
                              {edge.externalField}
                              {intent.mode === "auto" && (
                                <span className="ml-1 text-xs text-muted">(auto)</span>
                              )}
                            </td>
                            <td className="py-2">
                              <button
                                onClick={() => cycleDirection(system, edge.externalField)}
                                className={`rounded px-2 py-0.5 text-xs font-mono ${
                                  intent.direction === "push"
                                    ? "bg-green-500/10 text-green-400"
                                    : intent.direction === "pull"
                                      ? "bg-blue-500/10 text-blue-400"
                                      : "bg-surface-2 text-muted"
                                }`}
                              >
                                {intent.direction === "push" ? "→ push" :
                                 intent.direction === "pull" ? "← pull" : "— skip"}
                              </button>
                              {intent.direction === "pull" && (
                                <label className="ml-2 inline-flex items-center gap-1 text-xs text-muted">
                                  <input
                                    type="checkbox"
                                    checked={intent.updateInternalOnPull}
                                    onChange={() => toggleFieldUpdateInternal(system, edge.externalField)}
                                    className="rounded"
                                  />
                                  save
                                </label>
                              )}
                            </td>
                            <td className="py-2 font-mono text-xs text-muted">
                              {internalVal ?? "—"}
                            </td>
                            <td className="py-2 font-mono text-xs text-muted">
                              {externalVal ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}

            {/* Global controls */}
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="flex items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={globalUpdateInternal}
                    onChange={handleGlobalUpdateInternalToggle}
                    className="rounded"
                  />
                  Update internal on pull
                </label>
                <button
                  onClick={resetAutoDecisions}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Reset auto decisions
                </button>
              </div>
              <button
                onClick={handlePreviewPlan}
                disabled={!hasAnyDiffs}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Preview Plan
              </button>
            </div>
          </div>
        )}

        {/* Plan Preview */}
        {step === "plan-preview" && plan && (
          <div className="space-y-4">
            <button
              onClick={() => setStep("intents")}
              className="text-sm text-muted hover:text-foreground"
            >
              &larr; Back to intents
            </button>

            {/* Summary */}
            <div className="grid grid-cols-4 gap-3 text-center text-sm">
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.pulls}</div>
                <div className="text-muted">Pulls</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.internalWrites}</div>
                <div className="text-muted">Internal</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.pushes}</div>
                <div className="text-muted">Pushes</div>
              </div>
              <div className="rounded-lg bg-surface-2 p-3">
                <div className="text-lg font-bold text-foreground">{plan.summary.creates}</div>
                <div className="text-muted">Creates</div>
              </div>
            </div>

            {/* Conflicts */}
            {plan.conflicts.length > 0 && (
              <div className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
                <strong>Pull conflict{plan.conflicts.length > 1 ? "s" : ""}:</strong>
                {plan.conflicts.map((c) => (
                  <div key={c.internalField} className="mt-1">
                    <code>{c.internalField}</code> has conflicting values from{" "}
                    {c.contenders.map((ct) => ct.system).join(", ")}. Resolve by
                    changing one to skip.
                  </div>
                ))}
              </div>
            )}

            {/* Operations list */}
            <div className="space-y-1 text-sm">
              {plan.operations
                .filter((op) => !(op.kind === "pull" && op.noOp))
                .map((op, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded px-2 py-1 text-muted"
                  >
                    <span className={`rounded px-1.5 py-0.5 text-xs font-mono ${
                      op.kind === "pull"
                        ? "bg-blue-500/10 text-blue-400"
                        : op.kind === "push"
                          ? "bg-green-500/10 text-green-400"
                          : "bg-purple-500/10 text-purple-400"
                    }`}>
                      {op.kind}
                    </span>
                    <span>{op.system}</span>
                    <span className="font-mono">
                      {op.kind === "create" ? `(${Object.keys(op.fields).length} fields)` : op.externalField}
                    </span>
                    {op.source === "cascade" && (
                      <span className="text-xs text-yellow-400">(cascaded)</span>
                    )}
                  </div>
                ))}
            </div>

            {/* Confirm + Execute */}
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder='Type "confirm" to execute'
                className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground"
              />
              <button
                onClick={handleExecute}
                disabled={
                  confirmText !== "confirm" || plan.conflicts.length > 0
                }
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Execute Sync
              </button>
            </div>
          </div>
        )}

        {/* Executing */}
        {step === "executing" && (
          <div className="flex min-h-[200px] items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
              <p className="text-sm text-muted">Executing sync plan...</p>
            </div>
          </div>
        )}

        {/* Results */}
        {step === "results" && (
          <div className="space-y-4">
            <h3 className="font-medium text-foreground">Sync Results</h3>
            {outcomes.map((outcome, i) => (
              <div
                key={i}
                className={`rounded-lg border px-4 py-3 text-sm ${
                  outcome.status === "success"
                    ? "border-green-500/30 bg-green-500/5 text-green-400"
                    : outcome.status === "failed"
                      ? "border-red-500/30 bg-red-500/5 text-red-400"
                      : "border-border bg-surface-2 text-muted"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {outcome.system === "internal" ? "Internal Product" : SYSTEM_LABELS[outcome.system as ExternalSystem]}
                  </span>
                  <span className="text-xs uppercase">{outcome.status}</span>
                </div>
                <p className="mt-1 text-xs">{outcome.message}</p>
                {outcome.fieldDetails.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {outcome.fieldDetails.map((fd) => (
                      <span
                        key={fd.externalField}
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          fd.source === "cascade"
                            ? "bg-yellow-500/10 text-yellow-400"
                            : "bg-surface-2 text-muted"
                        }`}
                      >
                        {fd.externalField}
                        {fd.source === "cascade" && " (cascaded)"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="rounded-lg bg-surface-2 px-4 py-2 text-sm text-foreground hover:bg-surface"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the component compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual test in browser**

Open a product with linked external systems, open the sync modal:
1. Verify snapshots and mappings load
2. Verify direction arrows cycle push → skip → pull (pull only on pullable fields)
3. Verify auto-cascade sets downstream systems to push when pulling a field
4. Click "Preview Plan" — verify plan response shows in modal
5. Confirm and execute — verify outcomes display

- [ ] **Step 4: Commit**

```bash
git add src/components/catalog/SyncModal.tsx
git commit -m "feat(sync-relay): rewrite SyncModal with plan-based flow and auto-cascade"
```

---

## Chunk 5: Integration, Cleanup & Verification

### Task 16: Verify legacy client code is removed from SyncModal

**Files:**
- Verify: `src/components/catalog/SyncModal.tsx`

Task 15 replaced the entire SyncModal. This task verifies that none of the following legacy artifacts survived:

- [ ] **Step 1: Grep for legacy code**

Run: `grep -n "PULL_FIELD_MAP\|COMPANION_FIELDS\|computePreviewHashClient\|fieldDirections\|changesHash\|handleConfirmAndSync\|confirmAndSync" src/components/catalog/SyncModal.tsx`
Expected: No matches (all were replaced by Task 15's full rewrite)

If any matches remain, remove them. Also verify that the old client-side pull PATCH logic and multi-phase push/pull orchestration are gone (they should be, since Task 15 replaced the entire file).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit (only if Step 1 found remnants to remove)**

```bash
git add src/components/catalog/SyncModal.tsx
git commit -m "refactor(sync-relay): remove legacy client-side sync code"
```

---

### Task 17: Remove legacy server code paths

**Files:**
- Modify: `src/app/api/inventory/products/[id]/sync/route.ts`
- Modify: `src/app/api/inventory/products/[id]/sync/confirm/route.ts`

- [ ] **Step 1: Verify no other callers use legacy paths**

Run: `grep -rn "changesHash\|\"systems\".*changesHash" src/ --include="*.ts" --include="*.tsx"`
Expected: Only matches in the API route files themselves (no client code references)

- [ ] **Step 2: Remove legacy fields from GET /sync response**

In `src/app/api/inventory/products/[id]/sync/route.ts` GET handler, remove:
- The `previews` field from the JSON response (was: `previews: previews.map(...)`)
- The `changesHash` field from the JSON response
- The `systems` field from the JSON response
- The call to `previewSyncToLinkedSystems()` and `computePreviewHash()` (no longer needed)
- The import of `previewSyncToLinkedSystems` and `computePreviewHash` from `catalog-sync`

Keep only the new fields: `snapshots`, `mappings`, `defaultIntents`, `basePreviewHash`.

- [ ] **Step 3: Remove legacy execute path from POST /sync**

In `src/app/api/inventory/products/[id]/sync/route.ts` POST handler, remove:
- The legacy branch below `if (body.planHash && body.intents)` that handles the old `token + systems + changesHash` execute flow
- The `validateSyncConfirmationToken` import (if no longer used)

The POST handler should now ONLY handle the new plan-based execute path.

- [ ] **Step 4: Remove legacy confirm path from POST /sync/confirm**

In `src/app/api/inventory/products/[id]/sync/confirm/route.ts`, remove:
- The legacy branch that handles `systems + changesHash` body (the `if (!body.planHash)` path)
- The `buildSyncConfirmation` import (if no longer used)

The confirm handler should now ONLY handle the new `planHash` path.

- [ ] **Step 5: Verify build + tests**

Run: `npm run build && npm test`
Expected: Both succeed

- [ ] **Step 6: Commit**

```bash
git add src/app/api/inventory/products/[id]/sync/route.ts src/app/api/inventory/products/[id]/sync/confirm/route.ts
git commit -m "refactor(sync-relay): remove legacy sync API paths"
```

---

### Task 18: Update existing tests

**Files:**
- Modify: `src/__tests__/lib/catalog-sync.test.ts` (if needed)

The changes to `catalog-sync.ts` in earlier tasks were:
- Added `export` to `str`, `numStr`, `getSpecData`, `buildSkuName` (Task 3)
- Added `export` to `getHubSpotPropertyNames`, `parseXxxCurrentFields`, `buildXxxProposedFields` (Task 5 Step 3)
- No function signatures or behavior changed

- [ ] **Step 1: Run existing tests to check for breakage**

Run: `npm test -- --testPathPattern=catalog-sync --verbose`
Expected: All existing tests pass. Adding `export` to functions should not break anything.

- [ ] **Step 2: Fix any failures**

If any test fails, the likely causes are:
- A mock that assumed a function was module-private (now exported) — update the mock
- A snapshot test that captured the module shape — update the snapshot
- An import that now conflicts with the new exported name — rename

- [ ] **Step 3: Commit if changes needed**

```bash
git add src/__tests__/lib/catalog-sync.test.ts
git commit -m "test(sync-relay): update existing tests for refactored exports"
```

---

### Task 19: End-to-end verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Successful build, no type errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No lint errors

- [ ] **Step 4: Manual E2E test**

Test the following scenarios in the browser:

1. **Push only**: Open sync modal for a product with diffs on all 3 systems. Verify all fields default to push. Click "Preview Plan", verify plan shows push operations. Confirm and execute. Verify all 3 systems update.

2. **Pull with cascade**: Pull `sellPrice` from Zoho. Verify HubSpot and Zuper auto-set `price` to push (cascade). Verify the cascaded fields show a "cascaded" badge. Preview plan. Verify internal patch includes sellPrice, pushes include HubSpot price and Zoho-origin value flows through.

3. **Relay without internal update**: Pull `sellPrice` from Zoho with `updateInternalOnPull = false`. Verify the plan shows the pull but internal patch does NOT include sellPrice. Verify HubSpot still gets the Zoho value pushed.

4. **Conflict detection**: Pull `sellPrice` from both Zoho (6600) and HubSpot (305). Verify conflict banner appears. Verify confirm is disabled. Resolve by changing one to skip. Verify conflict clears.

5. **Stale detection**: Open sync modal. Click "Preview Plan" to derive a plan. Type "confirm" but do NOT click Execute yet. In another browser tab, manually update the product's price in Zoho. Go back to the sync modal and click "Execute Sync". Verify: the server returns a 409 stale error, the modal shows "External state changed since preview. Please re-preview.", and the modal resets to the intents step.

6. **Create flow**: Open sync modal for a product not linked to Zuper. Verify Zuper section shows "Will Create" badge. Push all fields. Preview plan — verify a `create` operation appears for Zuper. Confirm and execute. Verify Zuper product is created and `zuperItemId` is linked back (check product detail page).

- [ ] **Step 5: Final commit**

Stage only the files changed in this chunk (avoid accidentally staging unrelated work):

```bash
git add src/components/catalog/SyncModal.tsx src/app/api/inventory/products/[id]/sync/route.ts src/app/api/inventory/products/[id]/sync/confirm/route.ts src/__tests__/lib/catalog-sync.test.ts
git commit -m "feat(sync-relay): cross-system sync relay complete"
```
