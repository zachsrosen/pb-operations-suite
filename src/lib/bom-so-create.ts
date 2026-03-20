/**
 * BOM → Sales Order Creation — Shared Logic
 *
 * Creates a draft Zoho Sales Order from a saved BOM snapshot. Used by both:
 *   - POST /api/bom/create-so (HTTP route)
 *   - BOM pipeline orchestrator (automated)
 *
 * Handles: snapshot lookup, idempotency guard, sequential item matching,
 * SO post-processing (feature-gated), Zoho SO creation, and snapshot update.
 *
 * Callers provide an ActorContext for audit logging — routes build it from
 * requireApiAuth(), the pipeline uses PIPELINE_ACTOR.
 */

import { zohoInventory } from "@/lib/zoho-inventory";
import { logActivity, prisma } from "@/lib/db";
import { postProcessSoItems, type SoLineItem, type BomProject, type BomItem } from "@/lib/bom-so-post-process";
import { buildBomSearchTerms } from "@/lib/bom-search-terms";
import { ZOHO_WAREHOUSE_IDS } from "@/lib/constants";
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import type { ActorContext } from "@/lib/actor-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSoResult {
  salesorder_id: string;
  salesorder_number: string | null;
  unmatchedCount: number;
  unmatchedItems: string[];
  matchedItems: Array<{ bomName: string; zohoName: string }>;
  alreadyExisted?: boolean;
  /** Post-processor corrections (when enabled) */
  corrections?: unknown[];
  rulesVersion?: string;
  jobContext?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Create a draft Zoho Sales Order from a BOM snapshot.
 *
 * Steps:
 *  1. Load snapshot for deal + version
 *  2. Idempotency check — return existing SO if already created
 *  3. Match each BOM item to a Zoho Inventory item (sequential)
 *  4. Run SO post-processor (if ENABLE_SO_POST_PROCESS=true)
 *  5. Create draft SO in Zoho
 *  6. Store zohoSoId on the snapshot record
 *
 * @throws Error on missing snapshot, Zoho API errors, or DB errors.
 */
export async function createSalesOrder(params: {
  dealId: string;
  version: number;
  customerId: string;
  actor: ActorContext;
  debug?: boolean;
  pbLocation?: string | null;
}): Promise<CreateSoResult> {
  const { dealId, version, customerId, actor, debug, pbLocation } = params;
  const startedAt = Date.now();

  if (!prisma) {
    throw new Error("Database not configured");
  }

  if (!zohoInventory.isConfigured()) {
    throw new Error("Zoho Inventory is not configured");
  }

  const logSo = async (
    outcome: "succeeded" | "failed" | "reused",
    details: Record<string, unknown>,
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "FEATURE_USED",
      description:
        outcome === "succeeded"
          ? `Created Zoho SO for deal ${dealId} BOM v${version}`
          : outcome === "reused"
            ? `Reused existing Zoho SO for deal ${dealId} v${version}`
            : `BOM create-so failed for deal ${dealId}`,
      userEmail: actor.email,
      userName: actor.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: "create_so",
      metadata: {
        event: "bom_create_so",
        outcome,
        dealId,
        version,
        ...details,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestPath: actor.requestPath ?? "/api/bom/create-so",
      requestMethod: actor.requestMethod ?? "POST",
      responseStatus: outcome === "failed" ? 500 : 200,
      durationMs: Date.now() - startedAt,
    });
  };

  // 1. Load the BOM snapshot
  const snapshot = await prisma.projectBomSnapshot.findFirst({
    where: { dealId: String(dealId), version },
  });
  if (!snapshot) {
    await logSo("failed", { reason: "snapshot_not_found" });
    throw new Error(`BOM snapshot not found for deal ${dealId} v${version}`);
  }

  // 2. Idempotency guard — return existing SO if already created
  if (snapshot.zohoSoId) {
    await logSo("reused", {
      dealName: snapshot.dealName,
      salesorder_id: snapshot.zohoSoId,
    });
    return {
      salesorder_id: snapshot.zohoSoId,
      salesorder_number: null,
      unmatchedCount: 0,
      unmatchedItems: [],
      matchedItems: [],
      alreadyExisted: true,
    };
  }

  // 3. Build line items — look up zohoItemId per BOM item
  const bomData = snapshot.bomData as {
    project?: BomProject & { address?: string };
    items?: BomItem[];
  };

  const bomItems = Array.isArray(bomData?.items) ? bomData.items : [];

  const enablePostProcess = process.env.ENABLE_SO_POST_PROCESS === "true";
  const wantDebug = enablePostProcess && (debug ?? false);

  // Process SEQUENTIALLY — findItemIdByName uses a shared in-memory item
  // cache, and firing 30+ simultaneous requests hits Zoho's concurrent limit.
  let unmatchedCount = 0;
  const unmatchedItems: string[] = [];
  const matchedItems: Array<{ bomName: string; zohoName: string }> = [];
  const resolvedItems: (SoLineItem | null)[] = [];

  for (const item of bomItems) {
    const name =
      item.model
        ? `${item.brand ? item.brand + " " : ""}${item.model}`
        : item.description;

    const searchTerms = buildBomSearchTerms({
      brand: item.brand,
      model: item.model,
      description: item.description,
    });
    let match: { item_id: string; zohoName: string; zohoSku?: string } | null = null;
    for (const term of searchTerms) {
      match = await zohoInventory.findItemIdByName(term);
      if (match) break;
    }

    if (!match) {
      unmatchedCount++;
      unmatchedItems.push(name);
      resolvedItems.push(null);
      continue;
    }

    const parsedQty = Math.round(Number(item.qty));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      resolvedItems.push(null);
      continue;
    }
    matchedItems.push({ bomName: name, zohoName: match.zohoName });
    resolvedItems.push({
      item_id: match.item_id,
      name,
      quantity: parsedQty,
      description: item.description,
      sku: match.zohoSku,
      bomCategory: item.category,
    });
  }

  let lineItems = resolvedItems.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );

  // 3b. Fetch feedback IDs for audit trail (best-effort, deal-scoped first)
  let feedbackIds: string[] = [];
  try {
    if (prisma) {
      const dealEntries = dealId
        ? await prisma.bomToolFeedback.findMany({
            where: { dealId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true },
          })
        : [];
      if (dealEntries.length > 0) {
        feedbackIds = dealEntries.map(e => e.id);
      } else {
        const globalEntries = await prisma.bomToolFeedback.findMany({
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true },
        });
        feedbackIds = globalEntries.map(e => e.id);
      }
    }
  } catch {
    // Best-effort — don't block SO creation
  }

  // 3c. Post-process line items (when enabled)
  let postProcessExtras: Record<string, unknown> = {};
  if (enablePostProcess) {
    const originalLineItems = wantDebug ? lineItems.map((i) => ({ ...i })) : undefined;
    const ppResult = await postProcessSoItems(
      lineItems,
      bomData,
      (query) => zohoInventory.findItemIdByName(query),
      { feedbackIds },
    );
    lineItems = ppResult.lineItems;
    postProcessExtras = {
      corrections: ppResult.corrections,
      rulesVersion: ppResult.rulesVersion,
      jobContext: ppResult.jobContext,
      feedbackIds: ppResult.feedbackIds,
      ...(wantDebug ? { originalLineItems, correctedLineItems: ppResult.lineItems } : {}),
    };
  }

  // 4. Create SO in Zoho
  const address = bomData?.project?.address ?? "";
  const projMatch = snapshot.dealName.match(/PROJ-(\d+)/);
  const soNumber = projMatch ? `SO-${projMatch[1]}` : `SO-${dealId}`;

  // Resolve warehouse from PB location (fetch from HubSpot if not provided)
  let resolvedLocation = pbLocation;
  if (!resolvedLocation) {
    try {
      const dealResp = await searchWithRetry({
        filterGroups: [{ filters: [{ propertyName: "hs_object_id", operator: FilterOperatorEnum.Eq, value: dealId }] }],
        properties: ["pb_location"],
        limit: 1,
      });
      resolvedLocation = dealResp.results?.[0]?.properties?.pb_location?.trim() || null;
    } catch {
      // Best-effort — don't block SO creation
    }
  }
  const warehouseId = resolvedLocation
    ? ZOHO_WAREHOUSE_IDS[resolvedLocation] ?? ZOHO_WAREHOUSE_IDS[resolvedLocation.toLowerCase()]
    : undefined;
  if (resolvedLocation && !warehouseId) {
    console.warn(`[BOM-SO] Unknown pb_location "${resolvedLocation}" — no warehouse mapped for deal ${dealId}`);
  }

  let soResult: { salesorder_id: string; salesorder_number: string };
  try {
    soResult = await zohoInventory.createSalesOrder({
      customer_id: customerId,
      salesorder_number: soNumber,
      reference_number: snapshot.dealName
        .split("|").slice(0, 2).join("|").trim()
        .slice(0, 50),
      notes: `Generated from PB Ops BOM v${version}${address ? ` — ${address}` : ""}`,
      status: "draft",
      line_items: lineItems.map(({ item_id, name, quantity, description }) => ({
        ...(item_id ? { item_id } : {}),
        name,
        quantity,
        ...(description ? { description } : {}),
        ...(warehouseId ? { warehouse_id: warehouseId } : {}),
      })),
      custom_fields: [
        { label: "HubSpot Deal Record ID", value: dealId },
      ],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Zoho API error";

    // ── Recovery: SO already exists in Zoho (previous run crashed before saving ID) ──
    if (message.includes("already exists")) {
      console.warn(`[bom-so-create] SO ${soNumber} already exists in Zoho — recovering`);
      try {
        const existing = await zohoInventory.getSalesOrder(soNumber);
        if (existing?.salesorder_id) {
          // Best-effort: merge the deal-link custom field onto the recovered SO,
          // preserving any other custom fields already present.
          try {
            const existingFields: Array<{ label: string; value: string }> =
              (existing as unknown as Record<string, unknown>).custom_fields as Array<{ label: string; value: string }> ?? [];
            const alreadySet = existingFields.some(
              (f) => f.label === "HubSpot Deal Record ID" && f.value === dealId,
            );
            if (!alreadySet) {
              const merged = [
                ...existingFields.filter((f) => f.label !== "HubSpot Deal Record ID"),
                { label: "HubSpot Deal Record ID", value: dealId },
              ];
              await zohoInventory.updateSalesOrder(existing.salesorder_id, {
                custom_fields: merged,
              });
            }
          } catch (patchErr) {
            console.warn("[bom-so-create] Could not patch custom fields on recovered SO:", patchErr);
          }
          // Patch the snapshot so future runs hit the idempotency guard
          await prisma.projectBomSnapshot.update({
            where: { id: snapshot.id },
            data: { zohoSoId: existing.salesorder_id },
          });
          await logSo("reused", {
            dealName: snapshot.dealName,
            salesorder_id: existing.salesorder_id,
            salesorder_number: existing.salesorder_number,
            recovered: true,
          });
          return {
            salesorder_id: existing.salesorder_id,
            salesorder_number: existing.salesorder_number,
            unmatchedCount,
            unmatchedItems,
            matchedItems,
            alreadyExisted: true,
            ...postProcessExtras,
          };
        }
      } catch (recoveryErr) {
        console.error("[bom-so-create] Recovery lookup failed:", recoveryErr);
      }
    }

    console.error("[bom-so-create] Zoho error:", message);
    await logSo("failed", {
      reason: "zoho_api_error",
      dealName: snapshot.dealName,
      error: message,
    });
    throw new Error(`Zoho API error: ${message}`);
  }

  // 5. Store zohoSoId on snapshot
  await prisma.projectBomSnapshot.update({
    where: { id: snapshot.id },
    data: { zohoSoId: soResult.salesorder_id },
  });

  await logSo("succeeded", {
    dealName: snapshot.dealName,
    salesorder_id: soResult.salesorder_id,
    salesorder_number: soResult.salesorder_number,
    unmatchedCount,
  });

  return {
    salesorder_id: soResult.salesorder_id,
    salesorder_number: soResult.salesorder_number,
    unmatchedCount,
    unmatchedItems,
    matchedItems,
    ...postProcessExtras,
  };
}
