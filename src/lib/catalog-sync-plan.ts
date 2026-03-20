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
        return parseZohoCurrentFields(item as unknown as Record<string, unknown>);
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
  const v = (sku as unknown as Record<string, unknown>)[field];
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
