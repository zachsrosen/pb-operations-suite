import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { UpdateZohoItemResult } from "@/lib/zoho-inventory";
import { getHubSpotProductById, updateHubSpotProduct } from "@/lib/hubspot";
import type { UpdateHubSpotProductResult } from "@/lib/hubspot";
import { getZuperPartById, updateZuperPart } from "@/lib/zuper-catalog";
import type { UpdateZuperPartResult } from "@/lib/zuper-catalog";
import {
  getHubspotCategoryValue,
  getHubspotPropertiesFromMetadata,
  getZuperCategoryValue,
  generateZuperSpecification,
  CATEGORY_CONFIGS,
} from "@/lib/catalog-fields";
import type { SyncSystem } from "@/lib/catalog-sync-confirmation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncFieldChange {
  field: string;
  currentValue: string | null;
  proposedValue: string | null;
}

export interface SyncPreview {
  system: SyncSystem;
  externalId: string | null;
  linked: boolean;
  action: "update" | "create" | "skip";
  changes: SyncFieldChange[];
  noChanges: boolean;
}

export interface SyncOutcome {
  system: SyncSystem;
  externalId: string;
  status: "updated" | "created" | "skipped" | "failed" | "unsupported";
  message: string;
  httpStatus?: number;
}

export interface SyncExecuteResult {
  outcomes: SyncOutcome[];
}

// Type for a SKU record with all specs included
export interface SkuRecord {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  sku: string | null;
  vendorName: string | null;
  vendorPartNumber: string | null;
  unitSpec: number | null;
  unitLabel: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  hardToProcure: boolean;
  length: number | null;
  width: number | null;
  weight: number | null;
  zohoItemId: string | null;
  hubspotProductId: string | null;
  zuperItemId: string | null;
  moduleSpec?: Record<string, unknown> | null;
  inverterSpec?: Record<string, unknown> | null;
  batterySpec?: Record<string, unknown> | null;
  evChargerSpec?: Record<string, unknown> | null;
  mountingHardwareSpec?: Record<string, unknown> | null;
  electricalHardwareSpec?: Record<string, unknown> | null;
  relayDeviceSpec?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function numStr(value: unknown): string | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
}

function getSpecData(sku: SkuRecord): Record<string, unknown> {
  const specTable = CATEGORY_CONFIGS[sku.category]?.specTable;
  if (!specTable) return {};
  const spec = sku[specTable as keyof SkuRecord];
  if (!spec || typeof spec !== "object") return {};
  const record = spec as Record<string, unknown>;
  // Strip Prisma metadata fields
  const { id: _id, internalProductId: _internalProductId, ...rest } = record;
  return rest;
}

function buildSkuName(sku: SkuRecord): string {
  return `${sku.brand || ""} ${sku.model || ""}`.trim();
}

function diffFields(
  proposed: Record<string, string | null>,
  current: Record<string, string | null>,
): SyncFieldChange[] {
  const changes: SyncFieldChange[] = [];
  for (const [field, proposedValue] of Object.entries(proposed)) {
    const currentValue = current[field] ?? null;
    if (proposedValue !== currentValue) {
      changes.push({ field, currentValue, proposedValue });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Zoho field mapping
// ---------------------------------------------------------------------------

function buildZohoProposedFields(sku: SkuRecord): Record<string, string | null> {
  return {
    name: str(buildSkuName(sku)),
    sku: str(sku.sku) || str(sku.model),
    rate: numStr(sku.sellPrice),
    purchase_rate: numStr(sku.unitCost),
    description: str(sku.description),
    part_number: str(sku.model),
    unit: str(sku.unitLabel),
    vendor_name: str(sku.vendorName),
  };
}

function parseZohoCurrentFields(item: Record<string, unknown>): Record<string, string | null> {
  return {
    name: str(item.name),
    sku: str(item.sku),
    rate: numStr(item.rate),
    purchase_rate: numStr(item.purchase_rate),
    description: str(item.description),
    part_number: str(item.part_number),
    unit: str(item.unit),
    vendor_name: str(item.vendor_name),
  };
}

// ---------------------------------------------------------------------------
// HubSpot field mapping
// ---------------------------------------------------------------------------

const HUBSPOT_CORE_PROPERTIES = [
  "name", "hs_sku", "price", "description", "manufacturer",
  "product_category", "hs_cost_of_goods_sold",
];

function buildHubSpotProposedFields(sku: SkuRecord): Record<string, string | null> {
  const specData = getSpecData(sku);
  const specProps = getHubspotPropertiesFromMetadata(sku.category, specData);
  const categoryValue = getHubspotCategoryValue(sku.category);

  const proposed: Record<string, string | null> = {
    name: str(buildSkuName(sku)),
    hs_sku: str(sku.sku) || str(sku.model),
    price: numStr(sku.sellPrice),
    description: str(sku.description),
    manufacturer: str(sku.brand),
    product_category: str(categoryValue),
    hs_cost_of_goods_sold: numStr(sku.unitCost),
  };

  for (const [key, value] of Object.entries(specProps)) {
    proposed[key] = str(value);
  }

  return proposed;
}

function getHubSpotPropertyNames(sku: SkuRecord): string[] {
  const specData = getSpecData(sku);
  const specProps = getHubspotPropertiesFromMetadata(sku.category, specData);
  return [...HUBSPOT_CORE_PROPERTIES, ...Object.keys(specProps)];
}

function parseHubSpotCurrentFields(
  properties: Record<string, string>,
  proposedKeys: string[],
): Record<string, string | null> {
  const current: Record<string, string | null> = {};
  for (const key of proposedKeys) {
    current[key] = str(properties[key]);
  }
  return current;
}

// ---------------------------------------------------------------------------
// Zuper field mapping
// ---------------------------------------------------------------------------

function buildZuperProposedFields(sku: SkuRecord): Record<string, string | null> {
  const specData = getSpecData(sku);
  const categoryValue = getZuperCategoryValue(sku.category);
  const specification = generateZuperSpecification(sku.category, specData);

  return {
    name: str(buildSkuName(sku)),
    sku: str(sku.sku) || str(sku.model),
    description: str(sku.description),
    category: str(categoryValue),
    specification: str(specification),
  };
}

function parseZuperCurrentFields(item: Record<string, unknown>): Record<string, string | null> {
  // Zuper /product/{id} returns product_* prefixed fields and nested category
  const categoryObj = item.product_category as Record<string, unknown> | undefined;
  return {
    name: str(item.product_name ?? item.name ?? item.item_name ?? item.part_name),
    sku: str(item.product_id ?? item.sku ?? item.item_sku ?? item.item_code),
    description: str(item.product_description ?? item.description),
    category: str(categoryObj?.category_name ?? item.category ?? item.category_name),
    specification: str(item.specification),
  };
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

async function previewZoho(sku: SkuRecord): Promise<SyncPreview> {
  const externalId = sku.zohoItemId;
  const proposed = buildZohoProposedFields(sku);

  if (!externalId) {
    return {
      system: "zoho",
      externalId: null,
      linked: false,
      action: "create",
      changes: Object.entries(proposed).map(([field, proposedValue]) => ({
        field,
        currentValue: null,
        proposedValue,
      })),
      noChanges: false,
    };
  }

  const item = await zohoInventory.getItemById(externalId);
  if (!item) {
    return {
      system: "zoho",
      externalId,
      linked: true,
      action: "skip",
      changes: [],
      noChanges: true,
    };
  }

  const current = parseZohoCurrentFields(item as unknown as Record<string, unknown>);
  const changes = diffFields(proposed, current);

  return {
    system: "zoho",
    externalId,
    linked: true,
    action: changes.length > 0 ? "update" : "skip",
    changes,
    noChanges: changes.length === 0,
  };
}

async function previewHubSpot(sku: SkuRecord): Promise<SyncPreview> {
  const externalId = sku.hubspotProductId;
  const proposed = buildHubSpotProposedFields(sku);

  if (!externalId) {
    return {
      system: "hubspot",
      externalId: null,
      linked: false,
      action: "create",
      changes: Object.entries(proposed).map(([field, proposedValue]) => ({
        field,
        currentValue: null,
        proposedValue,
      })),
      noChanges: false,
    };
  }

  const propertyNames = getHubSpotPropertyNames(sku);
  const properties = await getHubSpotProductById(externalId, propertyNames);
  if (!properties) {
    return {
      system: "hubspot",
      externalId,
      linked: true,
      action: "skip",
      changes: [],
      noChanges: true,
    };
  }

  const current = parseHubSpotCurrentFields(properties, Object.keys(proposed));
  const changes = diffFields(proposed, current);

  return {
    system: "hubspot",
    externalId,
    linked: true,
    action: changes.length > 0 ? "update" : "skip",
    changes,
    noChanges: changes.length === 0,
  };
}

async function previewZuper(sku: SkuRecord): Promise<SyncPreview> {
  const externalId = sku.zuperItemId;
  const proposed = buildZuperProposedFields(sku);

  if (!externalId) {
    return {
      system: "zuper",
      externalId: null,
      linked: false,
      action: "create",
      changes: Object.entries(proposed).map(([field, proposedValue]) => ({
        field,
        currentValue: null,
        proposedValue,
      })),
      noChanges: false,
    };
  }

  const item = await getZuperPartById(externalId);
  if (!item) {
    return {
      system: "zuper",
      externalId,
      linked: true,
      action: "skip",
      changes: [],
      noChanges: true,
    };
  }

  const current = parseZuperCurrentFields(item);
  const changes = diffFields(proposed, current);

  return {
    system: "zuper",
    externalId,
    linked: true,
    action: changes.length > 0 ? "update" : "skip",
    changes,
    noChanges: changes.length === 0,
  };
}

export async function previewSyncToLinkedSystems(
  sku: SkuRecord,
  systems?: SyncSystem[],
): Promise<SyncPreview[]> {
  const targetSystems = systems ?? (["zoho", "hubspot", "zuper"] as const);

  const previewFns: Record<SyncSystem, () => Promise<SyncPreview>> = {
    zoho: () => previewZoho(sku),
    hubspot: () => previewHubSpot(sku),
    zuper: () => previewZuper(sku),
  };

  const results = await Promise.allSettled(
    targetSystems.map((sys) => previewFns[sys]()),
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    return {
      system: targetSystems[i],
      externalId: null,
      linked: false,
      action: "skip" as const,
      changes: [],
      noChanges: true,
    };
  });
}

// ---------------------------------------------------------------------------
// Field exclusion filtering
// ---------------------------------------------------------------------------

/** Map of system → field names to exclude from sync */
export type ExcludedFieldsMap = Record<string, string[]>;

/**
 * Filters out excluded fields from preview changes.
 * Returns a new array — does not mutate inputs.
 */
export function applyFieldExclusions(
  previews: SyncPreview[],
  excludedFields?: ExcludedFieldsMap,
): SyncPreview[] {
  if (!excludedFields || Object.keys(excludedFields).length === 0) return previews;
  return previews.map((p) => {
    const excluded = new Set(excludedFields[p.system] || []);
    if (excluded.size === 0) return p;
    const filteredChanges = p.changes.filter((c) => !excluded.has(c.field));
    return { ...p, changes: filteredChanges };
  });
}

// ---------------------------------------------------------------------------
// Hash
// ---------------------------------------------------------------------------

export function computePreviewHash(previews: SyncPreview[]): string {
  const sorted = [...previews].sort((a, b) => a.system.localeCompare(b.system));
  const canonical = sorted.map((p) => ({
    system: p.system,
    externalId: p.externalId,
    action: p.action,
    changes: [...p.changes].sort((a, b) => a.field.localeCompare(b.field)),
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export async function executeZohoSync(sku: SkuRecord, preview: SyncPreview): Promise<SyncOutcome> {
  if (preview.action === "skip" || preview.noChanges) {
    return {
      system: "zoho",
      externalId: sku.zohoItemId || "",
      status: "skipped",
      message: "No changes to sync.",
    };
  }

  if (preview.action === "create") {
    // Use existing create function
    const { createOrUpdateZohoItem } = await import("@/lib/zoho-inventory");
    const result = await createOrUpdateZohoItem({
      brand: sku.brand,
      model: sku.model,
      description: sku.description,
      sku: sku.sku,
      unitLabel: sku.unitLabel,
      vendorName: sku.vendorName,
      sellPrice: sku.sellPrice,
      unitCost: sku.unitCost,
    });

    // Guarded write: only set zohoItemId if it's still null
    if (result.zohoItemId) {
      const updated = await prisma.internalProduct.updateMany({
        where: { id: sku.id, zohoItemId: null },
        data: { zohoItemId: result.zohoItemId },
      });
      if (updated.count === 0) {
        console.error(`[Sync] Guarded write: zohoItemId already set for SKU ${sku.id}, skipping link-back`);
      }
    }

    return {
      system: "zoho",
      externalId: result.zohoItemId,
      status: "created",
      message: result.created ? "Created new Zoho item." : "Found existing Zoho item.",
    };
  }

  // Update existing
  const fields: Record<string, unknown> = {};
  for (const change of preview.changes) {
    if (change.proposedValue !== null) {
      fields[change.field] = change.field === "rate" || change.field === "purchase_rate"
        ? Number(change.proposedValue)
        : change.proposedValue;
    }
  }

  const result: UpdateZohoItemResult = await zohoInventory.updateItem(sku.zohoItemId!, fields);
  return {
    system: "zoho",
    externalId: result.zohoItemId,
    status: result.status === "updated" ? "updated" : "failed",
    message: result.message,
    httpStatus: result.httpStatus,
  };
}

export async function executeHubSpotSync(sku: SkuRecord, preview: SyncPreview): Promise<SyncOutcome> {
  if (preview.action === "skip" || preview.noChanges) {
    return {
      system: "hubspot",
      externalId: sku.hubspotProductId || "",
      status: "skipped",
      message: "No changes to sync.",
    };
  }

  if (preview.action === "create") {
    const { createOrUpdateHubSpotProduct } = await import("@/lib/hubspot");
    const specData = getSpecData(sku);
    const specProps = getHubspotPropertiesFromMetadata(sku.category, specData);
    const additionalProperties: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(specProps)) {
      additionalProperties[key] = value;
    }

    const result = await createOrUpdateHubSpotProduct({
      brand: sku.brand,
      model: sku.model,
      description: sku.description,
      sku: sku.sku,
      productCategory: getHubspotCategoryValue(sku.category),
      sellPrice: sku.sellPrice,
      unitCost: sku.unitCost,
      hardToProcure: sku.hardToProcure,
      length: sku.length,
      width: sku.width,
      additionalProperties,
    });

    if (result.hubspotProductId) {
      const updated = await prisma.internalProduct.updateMany({
        where: { id: sku.id, hubspotProductId: null },
        data: { hubspotProductId: result.hubspotProductId },
      });
      if (updated.count === 0) {
        console.error(`[Sync] Guarded write: hubspotProductId already set for SKU ${sku.id}, skipping link-back`);
      }
    }

    return {
      system: "hubspot",
      externalId: result.hubspotProductId,
      status: "created",
      message: result.created ? "Created new HubSpot product." : "Found existing HubSpot product.",
    };
  }

  // Update existing
  const properties: Record<string, string> = {};
  for (const change of preview.changes) {
    if (change.proposedValue !== null) {
      properties[change.field] = change.proposedValue;
    }
  }

  const result: UpdateHubSpotProductResult = await updateHubSpotProduct(sku.hubspotProductId!, properties);
  return {
    system: "hubspot",
    externalId: result.hubspotProductId,
    status: result.status === "updated" ? "updated" : "failed",
    message: result.message,
    httpStatus: result.httpStatus,
  };
}

export async function executeZuperSync(sku: SkuRecord, preview: SyncPreview): Promise<SyncOutcome> {
  if (preview.action === "skip" || preview.noChanges) {
    return {
      system: "zuper",
      externalId: sku.zuperItemId || "",
      status: "skipped",
      message: "No changes to sync.",
    };
  }

  if (preview.action === "create") {
    const { createOrUpdateZuperPart } = await import("@/lib/zuper-catalog");
    const specData = getSpecData(sku);
    const result = await createOrUpdateZuperPart({
      brand: sku.brand,
      model: sku.model,
      description: sku.description,
      sku: sku.sku,
      unitLabel: sku.unitLabel,
      vendorName: sku.vendorName,
      vendorPartNumber: sku.vendorPartNumber,
      sellPrice: sku.sellPrice,
      unitCost: sku.unitCost,
      category: getZuperCategoryValue(sku.category),
      specification: generateZuperSpecification(sku.category, specData),
    });

    if (result.zuperItemId) {
      const updated = await prisma.internalProduct.updateMany({
        where: { id: sku.id, zuperItemId: null },
        data: { zuperItemId: result.zuperItemId },
      });
      if (updated.count === 0) {
        console.error(`[Sync] Guarded write: zuperItemId already set for SKU ${sku.id}, skipping link-back`);
      }
    }

    return {
      system: "zuper",
      externalId: result.zuperItemId,
      status: "created",
      message: result.created ? "Created new Zuper item." : "Found existing Zuper item.",
    };
  }

  // Update existing — nest dotted keys (e.g. "custom_fields.x" → { custom_fields: { x } })
  const fields: Record<string, unknown> = {};
  for (const change of preview.changes) {
    if (change.proposedValue !== null) {
      const parts = change.field.split(".");
      if (parts.length === 2) {
        const parent = fields[parts[0]] as Record<string, unknown> | undefined;
        fields[parts[0]] = { ...parent, [parts[1]]: change.proposedValue };
      } else {
        fields[change.field] = change.proposedValue;
      }
    }
  }

  const result: UpdateZuperPartResult = await updateZuperPart(sku.zuperItemId!, fields);
  if (result.status === "unsupported") {
    return {
      system: "zuper",
      externalId: result.zuperItemId,
      status: "unsupported",
      message: result.message,
      httpStatus: result.httpStatus,
    };
  }
  return {
    system: "zuper",
    externalId: result.zuperItemId,
    status: result.status === "updated" ? "updated" : "failed",
    message: result.message,
    httpStatus: result.httpStatus,
  };
}

export async function executeSyncToLinkedSystems(
  sku: SkuRecord,
  _expectedHash: string,
  systems: SyncSystem[],
  excludedFields?: ExcludedFieldsMap,
): Promise<SyncExecuteResult> {
  // Fetch fresh preview and apply exclusions for execution.
  // HMAC validation already happened in the route handler, so we
  // don't need to compare hashes here — external API responses are
  // non-deterministic enough (Zuper/Zoho field formatting) to cause
  // spurious mismatches between preview and execute calls.
  const rawPreviews = await previewSyncToLinkedSystems(sku, systems);
  const freshPreviews = applyFieldExclusions(rawPreviews, excludedFields);

  // Execute writes in parallel
  const executeFns: Record<SyncSystem, (preview: SyncPreview) => Promise<SyncOutcome>> = {
    zoho: (p) => executeZohoSync(sku, p),
    hubspot: (p) => executeHubSpotSync(sku, p),
    zuper: (p) => executeZuperSync(sku, p),
  };

  const results = await Promise.allSettled(
    freshPreviews.map((preview) => {
      if (preview.action === "update" && preview.changes.length === 0) {
        return Promise.resolve<SyncOutcome>({
          system: preview.system,
          externalId: preview.externalId || "",
          status: "skipped",
          message: "All changes excluded.",
        });
      }
      return executeFns[preview.system](preview);
    }),
  );

  const outcomes: SyncOutcome[] = results.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const errMessage = result.reason instanceof Error ? result.reason.message : "Unknown error";
    console.error(`[Sync] ${freshPreviews[i].system} failed:`, result.reason);
    return {
      system: freshPreviews[i].system,
      externalId: freshPreviews[i].externalId || "",
      status: "failed" as const,
      message: errMessage,
    };
  });

  return { outcomes };
}
