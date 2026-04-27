// src/lib/catalog-sync-mappings.ts

import type {
  ExternalSystem,
  FieldMappingEdge,
  NormalizeWith,
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
  { system: "zoho", externalField: "name", internalField: "name",
    normalizeWith: "trimmed-string" },
  { system: "zoho", externalField: "sku", internalField: "sku",
    normalizeWith: "trimmed-string" },
  { system: "zoho", externalField: "rate", internalField: "sellPrice",
    normalizeWith: "number" },
  { system: "zoho", externalField: "purchase_rate", internalField: "unitCost",
    normalizeWith: "number" },
  { system: "zoho", externalField: "description", internalField: "description",
    normalizeWith: "trimmed-string" },
  { system: "zoho", externalField: "part_number", internalField: "model",
    normalizeWith: "trimmed-string" },
  { system: "zoho", externalField: "unit", internalField: "unitLabel",
    normalizeWith: "trimmed-string" },
  { system: "zoho", externalField: "vendor_name", internalField: "vendorName",
    normalizeWith: "trimmed-string", companion: "vendor_id" },
  { system: "zoho", externalField: "vendor_id", internalField: "zohoVendorId",
    normalizeWith: "trimmed-string", companion: "vendor_name" },
  { system: "zoho", externalField: "brand", internalField: "brand",
    normalizeWith: "enum-ci" },

  // ── HubSpot (universal) ──
  { system: "hubspot", externalField: "name", internalField: "name",
    normalizeWith: "trimmed-string" },
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
  { system: "hubspot", externalField: "vendor_part_number", internalField: "model",
    normalizeWith: "trimmed-string" },
  { system: "hubspot", externalField: "unit_label", internalField: "unitLabel",
    normalizeWith: "trimmed-string" },
  { system: "hubspot", externalField: "vendor_name", internalField: "vendorName",
    normalizeWith: "trimmed-string" },

  // ── Zuper ──
  { system: "zuper", externalField: "name", internalField: "name",
    normalizeWith: "trimmed-string" },
  { system: "zuper", externalField: "sku", internalField: "sku",
    normalizeWith: "trimmed-string", direction: "pull-only" },  // product_no auto-assigned by Zuper
  { system: "zuper", externalField: "description", internalField: "description",
    normalizeWith: "trimmed-string" },
  { system: "zuper", externalField: "category", internalField: "category",
    normalizeWith: "enum-ci", transform: "zuperCategoryUid" },
  { system: "zuper", externalField: "brand", internalField: "brand",
    normalizeWith: "enum-ci" },
  { system: "zuper", externalField: "price", internalField: "sellPrice",
    normalizeWith: "number" },
  { system: "zuper", externalField: "purchase_price", internalField: "unitCost",
    normalizeWith: "number" },
  { system: "zuper", externalField: "model", internalField: "model",
    normalizeWith: "trimmed-string" },
  { system: "zuper", externalField: "uom", internalField: "unitLabel",
    normalizeWith: "trimmed-string" },
  { system: "zuper", externalField: "vendor_name", internalField: "vendorName",
    normalizeWith: "trimmed-string" },
];

// ── Category-conditional edges ──
// Derived from per-system keys on FieldDef (hubspotProperty, zuperCustomField, zohoCustomField).

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

// ── Complete mapping table ──

let _allEdges: FieldMappingEdge[] | null = null;

/** Reset the cached edge list. Intended for tests that monkey-patch CATEGORY_CONFIGS. */
export function _resetEdgeCache(): void {
  _allEdges = null;
}

export function getAllMappingEdges(): FieldMappingEdge[] {
  if (!_allEdges) {
    _allEdges = [...STATIC_EDGES, ...buildCategoryExternalEdges()];
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

