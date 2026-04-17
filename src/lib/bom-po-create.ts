/**
 * BOM → Purchase Order Creation — Shared Logic
 *
 * Splits BOM items by their Zoho Inventory preferred vendor and creates
 * one draft Purchase Order per vendor. Used by:
 *   - GET  /api/bom/po-preview
 *   - POST /api/bom/create-po
 *   - BOM pipeline orchestrator
 */

import { buildBomSearchTerms } from "@/lib/bom-search-terms";
import { logActivity, prisma } from "@/lib/db";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { ActorContext } from "@/lib/actor-context";
import { Prisma } from "@/generated/prisma/client";

export interface BomDataItem {
  category: string;
  brand?: string | null;
  model?: string | null;
  description: string;
  qty: number | string;
}

export interface BomData {
  project?: { address?: string };
  items?: BomDataItem[];
  poVendorGroups?: PoVendorGroup[];
}

export interface PoLineItem {
  bomName: string;
  zohoName: string;
  zohoSku?: string;
  zohoItemId: string;
  quantity: number;
  description: string;
}

export interface PoVendorGroup {
  vendorId: string;
  vendorName: string;
  items: PoLineItem[];
}

export interface UnassignedItem {
  name: string;
  quantity: number;
  description: string;
  zohoItemId?: string;
  zohoName?: string;
  reason: "no_zoho_match" | "no_vendor";
}

export interface PoGroupingResult {
  vendorGroups: PoVendorGroup[];
  unassignedItems: UnassignedItem[];
}

export interface ZohoPurchaseOrderEntry {
  vendorId: string;
  vendorName: string;
  poId: string;
  poNumber: string | null;
  itemCount: number;
}

export interface CreatePosOptions {
  snapshotId: string;
  bomData: BomData;
  vendorGroups: PoVendorGroup[];
  existingPos: ZohoPurchaseOrderEntry[];
  dealName: string;
  version: number;
  address?: string;
  actor: ActorContext;
}

export interface CreatePosResult {
  created: ZohoPurchaseOrderEntry[];
  failed: Array<{ vendorId: string; vendorName: string; error: string }>;
  skippedExisting: ZohoPurchaseOrderEntry[];
}

function toJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function getBomItemName(item: BomDataItem): string {
  return item.model
    ? `${item.brand ? `${item.brand} ` : ""}${item.model}`
    : item.description;
}

export function parseZohoPurchaseOrders(value: unknown): ZohoPurchaseOrderEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.vendorId !== "string") return [];
    if (typeof candidate.vendorName !== "string") return [];
    if (typeof candidate.poId !== "string") return [];
    const poNumber = typeof candidate.poNumber === "string" ? candidate.poNumber : null;
    const itemCount = typeof candidate.itemCount === "number" ? candidate.itemCount : 0;
    return [{
      vendorId: candidate.vendorId,
      vendorName: candidate.vendorName,
      poId: candidate.poId,
      poNumber,
      itemCount,
    }];
  });
}

export function buildReferenceNumber(
  dealName: string,
  version: number,
  vendorName: string,
): string {
  // Preserve any pipeline prefix that sits before PROJ-XXXX (e.g. "D&R | PROJ-5736")
  // so non-project pipelines can be differentiated in Zoho. Falls back to first 20
  // chars of dealName when no PROJ-XXXX is present anywhere.
  const segments = dealName.split("|").map((s) => s.trim());
  const projIdx = segments.findIndex((s) => /^PROJ-\d+/i.test(s));
  let projId: string;
  if (projIdx >= 0) {
    const projToken = segments[projIdx].match(/PROJ-\d+/i)?.[0] ?? segments[projIdx];
    projId = projIdx === 0
      ? projToken
      : `${segments.slice(0, projIdx).join(" | ")} | ${projToken}`;
  } else {
    projId = dealName.slice(0, 20);
  }

  const prefix = `${projId} V${version} — `;
  const maxVendorLength = 50 - prefix.length;

  if (maxVendorLength <= 0) return projId.slice(0, 50);
  if (vendorName.length <= maxVendorLength) return `${prefix}${vendorName}`;
  return `${prefix}${vendorName.slice(0, Math.max(0, maxVendorLength - 1))}…`;
}

export async function resolvePoVendorGroups(bomData: BomData): Promise<PoGroupingResult> {
  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];
  const vendorGroups = new Map<string, PoVendorGroup>();
  const unassignedItems: UnassignedItem[] = [];

  for (const item of bomItems) {
    const quantity = Math.round(Number(item.qty));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const bomName = getBomItemName(item);
    const searchTerms = buildBomSearchTerms({
      brand: item.brand,
      model: item.model,
      description: item.description,
    });

    let match: Awaited<ReturnType<typeof zohoInventory.findItemIdByName>> = null;
    for (const term of searchTerms) {
      match = await zohoInventory.findItemIdByName(term);
      if (match) break;
    }

    if (!match) {
      unassignedItems.push({
        name: bomName,
        quantity,
        description: item.description,
        reason: "no_zoho_match",
      });
      continue;
    }

    if (!match.vendor_id) {
      unassignedItems.push({
        name: bomName,
        quantity,
        description: item.description,
        zohoItemId: match.item_id,
        zohoName: match.zohoName,
        reason: "no_vendor",
      });
      continue;
    }

    const vendorName = match.vendor_name?.trim() || "Unknown Vendor";
    const existing = vendorGroups.get(match.vendor_id) ?? {
      vendorId: match.vendor_id,
      vendorName,
      items: [],
    };
    existing.items.push({
      bomName,
      zohoName: match.zohoName,
      zohoSku: match.zohoSku,
      zohoItemId: match.item_id,
      quantity,
      description: item.description,
    });
    vendorGroups.set(match.vendor_id, existing);
  }

  return {
    vendorGroups: Array.from(vendorGroups.values()),
    unassignedItems,
  };
}

export function mergeUnassignedIntoVendor(
  grouping: PoGroupingResult,
  vendorId: string,
  vendorName: string,
): PoGroupingResult {
  const movable = grouping.unassignedItems.filter((item) => item.zohoItemId);
  const remainingUnassigned = grouping.unassignedItems.filter((item) => !item.zohoItemId);
  if (movable.length === 0) {
    return {
      vendorGroups: grouping.vendorGroups.map((group) => ({
        ...group,
        items: group.items.map((item) => ({ ...item })),
      })),
      unassignedItems: remainingUnassigned.map((item) => ({ ...item })),
    };
  }

  const vendorGroups = grouping.vendorGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item })),
  }));
  const target = vendorGroups.find((group) => group.vendorId === vendorId);
  const mergedItems = movable.flatMap((item) => {
    if (!item.zohoItemId) return [];
    return [{
      bomName: item.name,
      zohoName: item.zohoName ?? item.name,
      zohoItemId: item.zohoItemId,
      quantity: item.quantity,
      description: item.description,
    }];
  });

  if (target) {
    target.items.push(...mergedItems);
  } else {
    vendorGroups.push({
      vendorId,
      vendorName,
      items: mergedItems,
    });
  }

  return {
    vendorGroups,
    unassignedItems: remainingUnassigned.map((item) => ({ ...item })),
  };
}

export async function createPurchaseOrders(options: CreatePosOptions): Promise<CreatePosResult> {
  if (!prisma) throw new Error("Database not configured");

  const { snapshotId, bomData, existingPos, dealName, version, address, actor } = options;
  const persistedGroups = Array.isArray(bomData.poVendorGroups) ? bomData.poVendorGroups : [];
  const vendorGroups = existingPos.length > 0 && persistedGroups.length > 0
    ? persistedGroups
    : options.vendorGroups;

  if (existingPos.length === 0 && persistedGroups.length === 0) {
    await prisma.projectBomSnapshot.update({
      where: { id: snapshotId },
      data: {
        bomData: toJsonValue({
          ...bomData,
          poVendorGroups: vendorGroups,
        }),
      },
    });
  }

  const skippedExisting = [...existingPos];
  const created: ZohoPurchaseOrderEntry[] = [];
  const failed: Array<{ vendorId: string; vendorName: string; error: string }> = [];
  const allPurchaseOrders = [...existingPos];

  for (const group of vendorGroups) {
    if (existingPos.some((po) => po.vendorId === group.vendorId)) continue;

    try {
      const result = await zohoInventory.createPurchaseOrder({
        vendor_id: group.vendorId,
        reference_number: buildReferenceNumber(dealName, version, group.vendorName),
        notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
        status: "draft",
        line_items: group.items.map((item) => ({
          item_id: item.zohoItemId,
          name: item.bomName,
          quantity: item.quantity,
          ...(item.description ? { description: item.description } : {}),
        })),
      });

      const entry: ZohoPurchaseOrderEntry = {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        poId: result.purchaseorder_id,
        poNumber: result.purchaseorder_number ?? null,
        itemCount: group.items.length,
      };
      created.push(entry);
      allPurchaseOrders.push(entry);

      await prisma.projectBomSnapshot.update({
        where: { id: snapshotId },
        data: {
          zohoPurchaseOrders: toJsonValue(allPurchaseOrders),
          bomData: toJsonValue({
            ...bomData,
            poVendorGroups: vendorGroups,
          }),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        error: message,
      });

      await logActivity({
        type: "API_ERROR",
        description: `PO creation failed for vendor ${group.vendorName} on deal ${dealName}`,
        userEmail: actor.email,
        userName: actor.name,
        entityType: "purchase_order",
        entityId: group.vendorId,
        entityName: group.vendorName,
        metadata: {
          event: "bom_create_po_vendor_failed",
          dealName,
          version,
          vendorId: group.vendorId,
          vendorName: group.vendorName,
          error: message,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        requestPath: actor.requestPath ?? "/api/bom/create-po",
        requestMethod: actor.requestMethod ?? "POST",
      }).catch(() => {});
    }
  }

  return {
    created,
    failed,
    skippedExisting,
  };
}
