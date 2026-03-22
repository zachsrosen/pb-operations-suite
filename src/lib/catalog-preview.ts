// src/lib/catalog-preview.ts

import { getActiveMappings } from "@/lib/catalog-sync-mappings";
import type { FieldMappingEdge } from "@/lib/catalog-sync-types";

// ── Input type ──

export interface PreviewInput {
  category: string;
  brand: string;
  model: string;
  name?: string | null;
  description?: string | null;
  sku?: string | null;
  vendorName?: string | null;
  vendorPartNumber?: string | null;
  zohoVendorId?: string | null;
  unitLabel?: string | null;
  sellPrice?: number | null;
  unitCost?: number | null;
  specValues?: Record<string, unknown>;
}

// ── Output types ──

export interface PreviewField {
  label: string;
  externalField: string;
  value: unknown;
  missing?: boolean;
  transformed?: boolean;
  pushOnly?: boolean;
}

export type PreviewSystem = "ZOHO" | "HUBSPOT" | "ZUPER";

export interface SystemPreviewCard {
  system: PreviewSystem;
  fields: PreviewField[];
}

// ── Core field lookup ──

/** Map from internalField name to the PreviewInput property that holds the value. */
const CORE_FIELD_MAP: Record<string, keyof PreviewInput> = {
  name: "name",
  brand: "brand",
  model: "model",
  description: "description",
  sku: "sku",
  vendorName: "vendorName",
  vendorPartNumber: "vendorPartNumber",
  zohoVendorId: "zohoVendorId",
  unitLabel: "unitLabel",
  sellPrice: "sellPrice",
  unitCost: "unitCost",
  category: "category",
};

/** Resolve a value for a given mapping edge from the PreviewInput. */
function resolveValue(edge: FieldMappingEdge, input: PreviewInput): unknown {
  const { internalField } = edge;

  // Special case: name falls back to `${brand} ${model}` if not set
  if (internalField === "name") {
    const fallback = `${input.brand} ${input.model}`.trim();
    if (input.name != null && input.name.trim() !== "") return input.name;
    return fallback !== "" ? fallback : null;
  }

  // Core fields
  if (internalField in CORE_FIELD_MAP) {
    const key = CORE_FIELD_MAP[internalField];
    return (input[key] as unknown) ?? null;
  }

  // Category-conditional spec fields — look in specValues
  if (input.specValues && internalField in input.specValues) {
    return input.specValues[internalField] ?? null;
  }

  return null;
}

/** Check whether a resolved value is considered "missing". */
function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim() === "") return true;
  return false;
}

// ── Main function ──

const SYSTEM_ORDER: PreviewSystem[] = ["ZOHO", "HUBSPOT", "ZUPER"];

/**
 * Build per-system preview cards showing what each external system will receive
 * when a product is approved. Pure function — no I/O, no DB access.
 */
export function buildSystemPreview(
  input: PreviewInput,
  selectedSystems: PreviewSystem[],
): SystemPreviewCard[] {
  const activeMappings = getActiveMappings(input.category);

  const cards: SystemPreviewCard[] = [];

  for (const system of SYSTEM_ORDER) {
    if (!selectedSystems.includes(system)) continue;

    const systemLower = system.toLowerCase();

    // Filter edges for this system, excluding pull-only (those are never pushed)
    const edges = activeMappings.filter(
      (edge) => edge.system === systemLower && edge.direction !== "pull-only",
    );

    const fields: PreviewField[] = edges.map((edge) => {
      const value = resolveValue(edge, input);
      const missing = isMissing(value);

      const field: PreviewField = {
        label: edge.internalField,
        externalField: edge.externalField,
        value: missing ? null : value,
      };

      if (missing) field.missing = true;
      if (edge.transform) field.transformed = true;
      if (edge.direction === "push-only") field.pushOnly = true;

      return field;
    });

    cards.push({ system, fields });
  }

  return cards;
}
