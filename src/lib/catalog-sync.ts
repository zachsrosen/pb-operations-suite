import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { UpdateZohoItemResult } from "@/lib/zoho-inventory";
import { getHubSpotProductById, updateHubSpotProduct } from "@/lib/hubspot";
import type { UpdateHubSpotProductResult } from "@/lib/hubspot";
import { getZuperPartById, updateZuperPart, resolveZuperCategoryUid } from "@/lib/zuper-catalog";
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
  /** True when the fresh preview hash diverged from the approved hash. */
  stale?: boolean;
}

// Type for a SKU record with all specs included
export interface SkuRecord {
  id: string;
  category: string;
  brand: string;
  model: string;
  name: string | null;
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
  zohoVendorId: string | null;
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

export function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

export function numStr(value: unknown): string | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
}

export function getSpecData(sku: SkuRecord): Record<string, unknown> {
  const specTable = CATEGORY_CONFIGS[sku.category]?.specTable;
  if (!specTable) return {};
  const spec = sku[specTable as keyof SkuRecord];
  if (!spec || typeof spec !== "object") return {};
  const record = spec as Record<string, unknown>;
  // Strip Prisma metadata fields
  const { id: _id, internalProductId: _internalProductId, ...rest } = record;
  return rest;
}

export function buildSkuName(sku: SkuRecord): string {
  return `${sku.brand || ""} ${sku.model || ""}`.trim();
}

function diffFields(
  proposed: Record<string, string | null>,
  current: Record<string, string | null>,
  options?: { caseInsensitiveFields?: Set<string> },
): SyncFieldChange[] {
  const ciFields = options?.caseInsensitiveFields;
  const changes: SyncFieldChange[] = [];
  for (const [field, proposedValue] of Object.entries(proposed)) {
    const currentValue = current[field] ?? null;
    // For enum-like fields (e.g. HubSpot manufacturer), treat case-only
    // differences as equal so we don't push a value the API will reject.
    if (
      ciFields?.has(field) &&
      proposedValue != null &&
      currentValue != null &&
      proposedValue.toLowerCase() === currentValue.toLowerCase()
    ) {
      continue;
    }
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
    vendor_id: str(sku.zohoVendorId),
  };
}

export function parseZohoCurrentFields(item: Record<string, unknown>): Record<string, string | null> {
  return {
    name: str(item.name),
    sku: str(item.sku),
    rate: numStr(item.rate),
    purchase_rate: numStr(item.purchase_rate),
    description: str(item.description),
    part_number: str(item.part_number),
    unit: str(item.unit),
    vendor_name: str(item.vendor_name),
    vendor_id: str(item.vendor_id),
    brand: str(item.brand ?? item.manufacturer),
  };
}

// ---------------------------------------------------------------------------
// HubSpot field mapping
// ---------------------------------------------------------------------------

const HUBSPOT_CORE_PROPERTIES = [
  "name", "hs_sku", "price", "description", "manufacturer",
  "product_category", "hs_cost_of_goods_sold",
  "vendor_part_number", "unit_label", "vendor_name",
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

export function getHubSpotPropertyNames(sku: SkuRecord): string[] {
  const specData = getSpecData(sku);
  const specProps = getHubspotPropertiesFromMetadata(sku.category, specData);
  return [...HUBSPOT_CORE_PROPERTIES, ...Object.keys(specProps)];
}

export function parseHubSpotCurrentFields(
  properties: Record<string, string>,
  proposedKeys?: string[],
): Record<string, string | null> {
  const keys = proposedKeys ?? Object.keys(properties);
  const current: Record<string, string | null> = {};
  for (const key of keys) {
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

export function parseZuperCurrentFields(item: Record<string, unknown>): Record<string, string | null> {
  const categoryObj = item.product_category as Record<string, unknown> | undefined;
  return {
    name: str(item.product_name ?? item.name ?? item.item_name ?? item.part_name),
    sku: str(item.product_id ?? item.sku ?? item.item_sku ?? item.item_code),
    description: str(item.product_description ?? item.description),
    category: str(categoryObj?.category_name ?? item.category ?? item.category_name),
    specification: str(item.specification),
    brand: str(item.brand),
    model: str(item.model ?? item.part_number ?? item.vendor_part_number),
    price: numStr(item.price ?? item.unit_price ?? item.rate),
    purchase_price: numStr(item.purchase_price ?? item.cost_price ?? item.cost),
    uom: str(item.uom ?? item.unit),
    vendor_name: str(item.vendor_name ?? item.vendor),
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
  // manufacturer is a HubSpot enumeration — case-only differences aren't
  // real changes and will be rejected by the API with a 400.
  const changes = diffFields(proposed, current, {
    caseInsensitiveFields: new Set(["manufacturer"]),
  });

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
    // Build create payload from planned changes (effective state) over raw sku defaults
    const planned: Record<string, string | null> = {};
    for (const c of preview.changes) {
      planned[c.field] = c.proposedValue;
    }
    const { createOrUpdateZohoItem } = await import("@/lib/zoho-inventory");
    const result = await createOrUpdateZohoItem({
      name: planned["name"] ?? sku.name,
      brand: planned["brand"] ?? sku.brand,
      model: planned["part_number"] ?? sku.model,
      description: planned["description"] ?? sku.description,
      sku: planned["sku"] ?? sku.sku,
      unitLabel: planned["unit"] ?? sku.unitLabel,
      vendorName: planned["vendor_name"] ?? sku.vendorName,
      sellPrice: planned["rate"] != null ? Number(planned["rate"]) : sku.sellPrice,
      unitCost: planned["purchase_rate"] != null ? Number(planned["purchase_rate"]) : sku.unitCost,
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
    // Build create payload from planned changes (effective state) over raw sku defaults
    const planned: Record<string, string | null> = {};
    for (const c of preview.changes) {
      planned[c.field] = c.proposedValue;
    }
    const { createOrUpdateHubSpotProduct } = await import("@/lib/hubspot");
    const specData = getSpecData(sku);
    const specProps = getHubspotPropertiesFromMetadata(sku.category, specData);
    const additionalProperties: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(specProps)) {
      additionalProperties[key] = value;
    }

    const result = await createOrUpdateHubSpotProduct({
      name: planned["name"] ?? sku.name,
      brand: planned["manufacturer"] ?? sku.brand,
      model: planned["vendor_part_number"] ?? sku.model,
      description: planned["description"] ?? sku.description,
      sku: planned["hs_sku"] ?? sku.sku,
      productCategory: getHubspotCategoryValue(sku.category),
      sellPrice: planned["price"] != null ? Number(planned["price"]) : sku.sellPrice,
      unitCost: planned["hs_cost_of_goods_sold"] != null ? Number(planned["hs_cost_of_goods_sold"]) : sku.unitCost,
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
    // Build create payload from planned changes (effective state) over raw sku defaults
    const planned: Record<string, string | null> = {};
    for (const c of preview.changes) {
      planned[c.field] = c.proposedValue;
    }
    const { createOrUpdateZuperPart } = await import("@/lib/zuper-catalog");
    const specData = getSpecData(sku);
    const result = await createOrUpdateZuperPart({
      name: planned["name"] ?? sku.name,
      brand: planned["brand"] ?? sku.brand,
      model: planned["model"] ?? sku.model,
      description: planned["description"] ?? sku.description,
      sku: planned["sku"] ?? sku.sku,
      unitLabel: planned["uom"] ?? sku.unitLabel,
      vendorName: planned["vendor_name"] ?? sku.vendorName,
      vendorPartNumber: sku.vendorPartNumber,
      sellPrice: planned["price"] != null ? Number(planned["price"]) : sku.sellPrice,
      unitCost: planned["purchase_price"] != null ? Number(planned["purchase_price"]) : sku.unitCost,
      category: getZuperCategoryValue(sku.category),
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

  // Update existing — map internal preview field names to Zuper /product API
  // field names, resolve category to UID, and nest dotted keys.
  const ZUPER_FIELD_MAP: Record<string, string> = {
    name: "product_name",
    description: "product_description",
    // category handled separately (needs UID resolution)
    // sku omitted (product_no is auto-assigned by Zuper)
    // specification stays as-is
  };

  const fields: Record<string, unknown> = {};
  for (const change of preview.changes) {
    if (change.proposedValue !== null) {
      const parts = change.field.split(".");
      if (parts.length === 2) {
        const parent = fields[parts[0]] as Record<string, unknown> | undefined;
        fields[parts[0]] = { ...parent, [parts[1]]: change.proposedValue };
      } else if (change.field === "category") {
        fields.product_category = await resolveZuperCategoryUid(
          change.proposedValue,
        );
      } else if (change.field === "sku") {
        // product_no is auto-assigned by Zuper — skip SKU updates
        continue;
      } else {
        const apiField = ZUPER_FIELD_MAP[change.field] ?? change.field;
        fields[apiField] = change.proposedValue;
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
  expectedHash: string,
  systems: SyncSystem[],
  excludedFields?: ExcludedFieldsMap,
): Promise<SyncExecuteResult> {
  // Fetch fresh preview and apply the same exclusions the admin saw.
  const rawPreviews = await previewSyncToLinkedSystems(sku, systems);
  const freshPreviews = applyFieldExclusions(rawPreviews, excludedFields);

  // Verify the approved diff still matches current external state.
  // If external data changed between preview and execute, the hash will
  // diverge and we refuse to push unapproved changes.
  const freshHash = computePreviewHash(freshPreviews);
  if (freshHash !== expectedHash) {
    return { outcomes: [], stale: true };
  }

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
