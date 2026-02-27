// src/app/api/catalog/push-requests/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";
import {
  filterMetadataToSpecFields,
  generateZuperSpecification,
  getHubspotCategoryValue,
  getHubspotPropertiesFromMetadata,
  getSpecTableName,
  getZuperCategoryValue,
} from "@/lib/catalog-fields";
import { createOrUpdateHubSpotProduct } from "@/lib/hubspot";
import { createOrUpdateZohoItem } from "@/lib/zoho-inventory";
import { createOrUpdateZuperPart } from "@/lib/zuper-catalog";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];
const INTERNAL_CATEGORIES = Object.values(EquipmentCategory) as string[];
const VALID_SYSTEMS = ["INTERNAL", "ZOHO", "HUBSPOT", "ZUPER"] as const;

type SystemName = typeof VALID_SYSTEMS[number];
type SystemOutcomeStatus = "success" | "failed" | "skipped" | "not_implemented";

interface SystemOutcome {
  status: SystemOutcomeStatus;
  message?: string;
  externalId?: string | null;
}

function makeSummary(outcomes: Partial<Record<SystemName, SystemOutcome>>) {
  const selected = Object.keys(outcomes).length;
  const counts = Object.values(outcomes).reduce(
    (acc, outcome) => {
      if (outcome.status === "success") acc.success += 1;
      if (outcome.status === "failed") acc.failed += 1;
      if (outcome.status === "skipped") acc.skipped += 1;
      if (outcome.status === "not_implemented") acc.notImplemented += 1;
      return acc;
    },
    { success: 0, failed: 0, skipped: 0, notImplemented: 0 }
  );

  return { selected, ...counts };
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const push = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!push) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (push.status !== "PENDING") {
    return NextResponse.json({ error: `Already ${push.status.toLowerCase()}` }, { status: 409 });
  }

  const selectedSystems = push.systems.filter((system): system is SystemName =>
    (VALID_SYSTEMS as readonly string[]).includes(system)
  );
  const outcomes: Partial<Record<SystemName, SystemOutcome>> = {};
  for (const system of selectedSystems) {
    outcomes[system] = { status: "skipped", message: "Pending processing." };
  }

  // Single transaction: internal catalog writes + status update are atomic.
  // If any step fails, neither the SKU nor the status change persists.
  const approvedPush = await prisma.$transaction(async (tx) => {
    const results: Record<string, string | null> = {
      internalSkuId: null,
      zohoItemId: null,
      hubspotProductId: null,
      zuperItemId: null,
    };

    // INTERNAL catalog
    if (push.systems.includes("INTERNAL") && INTERNAL_CATEGORIES.includes(push.category)) {
      const parsedUnitSpec = push.unitSpec ? parseFloat(push.unitSpec) : null;
      const unitSpecValue = parsedUnitSpec != null && !isNaN(parsedUnitSpec) ? parsedUnitSpec : null;

      const commonFields = {
        description: push.description || null,
        unitSpec: unitSpecValue,
        unitLabel: push.unitLabel || null,
        sku: push.sku || null,
        vendorName: push.vendorName || null,
        vendorPartNumber: push.vendorPartNumber || null,
        unitCost: push.unitCost,
        sellPrice: push.sellPrice,
        hardToProcure: push.hardToProcure,
        length: push.length,
        width: push.width,
        weight: push.weight,
      };

      // 1. Upsert EquipmentSku with all common fields
      const sku = await tx.equipmentSku.upsert({
        where: {
          category_brand_model: {
            category: push.category as EquipmentCategory,
            brand: push.brand,
            model: push.model,
          },
        },
        update: { isActive: true, ...commonFields },
        create: {
          category: push.category as EquipmentCategory,
          brand: push.brand,
          model: push.model,
          ...commonFields,
        },
      });

      // 2. Write category spec table from metadata (if present)
      const rawMetadata = push.metadata as Record<string, unknown> | null;
      if (rawMetadata && Object.keys(rawMetadata).length > 0) {
        const specTable = getSpecTableName(push.category);
        if (specTable) {
          const specData = filterMetadataToSpecFields(push.category, rawMetadata);
          if (Object.keys(specData).length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const prismaModel = (tx as any)[specTable];
            if (prismaModel?.upsert) {
              await prismaModel.upsert({
                where: { skuId: sku.id },
                create: { skuId: sku.id, ...specData },
                update: specData,
              });
            }
          }
        }
      }

      results.internalSkuId = sku.id;
      outcomes.INTERNAL = {
        status: "success",
        externalId: sku.id,
        message: "Saved to internal catalog.",
      };
    } else if (push.systems.includes("INTERNAL")) {
      outcomes.INTERNAL = {
        status: "skipped",
        message: `Category '${push.category}' is not supported by INTERNAL catalog.`,
      };
    }

    // 3. Mark request approved (same transaction — atomic with writes above)
    return tx.pendingCatalogPush.update({
      where: { id },
      data: {
        status: "APPROVED",
        resolvedAt: new Date(),
        ...results,
      },
    });
  });

  let hubspotPersistedPush: typeof approvedPush | null = null;
  if (push.systems.includes("HUBSPOT")) {
    try {
      const metadata =
        push.metadata && typeof push.metadata === "object"
          ? (push.metadata as Record<string, unknown>)
          : null;
      const mappedMetadataProps = getHubspotPropertiesFromMetadata(push.category, metadata);
      const hubspotResult = await createOrUpdateHubSpotProduct({
        brand: push.brand,
        model: push.model,
        description: push.description,
        sku: push.sku || push.model,
        productCategory: getHubspotCategoryValue(push.category) || push.category,
        sellPrice: push.sellPrice,
        unitCost: push.unitCost,
        hardToProcure: push.hardToProcure,
        length: push.length,
        width: push.width,
        additionalProperties: mappedMetadataProps,
      });

      hubspotPersistedPush = await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { hubspotProductId: hubspotResult.hubspotProductId },
        });
        if (approvedPush.internalSkuId) {
          await tx.equipmentSku.update({
            where: { id: approvedPush.internalSkuId },
            data: { hubspotProductId: hubspotResult.hubspotProductId },
          });
        }
        return pendingPush;
      });

      outcomes.HUBSPOT = {
        status: "success",
        externalId: hubspotResult.hubspotProductId,
        message: hubspotResult.created
          ? "Created HubSpot product."
          : "Updated existing HubSpot product.",
      };
    } catch (error) {
      outcomes.HUBSPOT = {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "HubSpot product push failed.",
      };
    }
  }

  let zohoPersistedPush: typeof approvedPush | null = null;
  if (push.systems.includes("ZOHO")) {
    try {
      const zohoResult = await createOrUpdateZohoItem({
        brand: push.brand,
        model: push.model,
        description: push.description,
        sku: push.sku || push.model,
        unitLabel: push.unitLabel,
        vendorName: push.vendorName,
        sellPrice: push.sellPrice,
        unitCost: push.unitCost,
      });

      zohoPersistedPush = await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { zohoItemId: zohoResult.zohoItemId },
        });
        if (approvedPush.internalSkuId) {
          await tx.equipmentSku.update({
            where: { id: approvedPush.internalSkuId },
            data: { zohoItemId: zohoResult.zohoItemId },
          });
        }
        return pendingPush;
      });

      outcomes.ZOHO = {
        status: "success",
        externalId: zohoResult.zohoItemId,
        message: zohoResult.created
          ? "Created Zoho item."
          : "Updated existing Zoho item.",
      };
    } catch (error) {
      outcomes.ZOHO = {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Zoho product push failed.",
      };
    }
  }
  let zuperPersistedPush: typeof approvedPush | null = null;
  if (push.systems.includes("ZUPER")) {
    try {
      const metadata =
        push.metadata && typeof push.metadata === "object"
          ? (push.metadata as Record<string, unknown>)
          : null;
      const specSummary =
        metadata && Object.keys(metadata).length > 0
          ? generateZuperSpecification(push.category, metadata)
          : undefined;

      const zuperResult = await createOrUpdateZuperPart({
        brand: push.brand,
        model: push.model,
        description: push.description,
        sku: push.sku || push.model,
        unitLabel: push.unitLabel,
        vendorName: push.vendorName,
        vendorPartNumber: push.vendorPartNumber,
        sellPrice: push.sellPrice,
        unitCost: push.unitCost,
        category: getZuperCategoryValue(push.category) || push.category,
        specification: specSummary,
      });

      zuperPersistedPush = await prisma.$transaction(async (tx) => {
        const pendingPush = await tx.pendingCatalogPush.update({
          where: { id },
          data: { zuperItemId: zuperResult.zuperItemId },
        });
        if (approvedPush.internalSkuId) {
          await tx.equipmentSku.update({
            where: { id: approvedPush.internalSkuId },
            data: { zuperItemId: zuperResult.zuperItemId },
          });
        }
        return pendingPush;
      });

      outcomes.ZUPER = {
        status: "success",
        externalId: zuperResult.zuperItemId,
        message: zuperResult.created
          ? "Created Zuper item."
          : "Linked existing Zuper item.",
      };
    } catch (error) {
      outcomes.ZUPER = {
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Zuper part push failed.",
      };
    }
  }

  const responsePush = zuperPersistedPush ?? zohoPersistedPush ?? hubspotPersistedPush ?? approvedPush;

  return NextResponse.json({
    push: responsePush,
    outcomes,
    summary: makeSummary(outcomes),
  });
}
