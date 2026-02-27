// src/app/api/catalog/push-requests/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";
import {
  getHubspotCategoryValue,
  getHubspotPropertiesFromMetadata,
  getSpecTableName,
} from "@/lib/catalog-fields";
import { createOrUpdateHubSpotProduct } from "@/lib/hubspot";

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
  let responsePush = await prisma.$transaction(async (tx) => {
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
      const metadata = push.metadata as Record<string, unknown> | null;
      if (metadata && Object.keys(metadata).length > 0) {
        const specTable = getSpecTableName(push.category);
        if (specTable) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const prismaModel = (tx as any)[specTable];
          if (prismaModel?.upsert) {
            await prismaModel.upsert({
              where: { skuId: sku.id },
              create: { skuId: sku.id, ...metadata },
              update: metadata,
            });
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

      const followUpWrites: Array<Promise<unknown>> = [
        prisma.pendingCatalogPush
          .update({
            where: { id },
            data: { hubspotProductId: hubspotResult.hubspotProductId },
          })
          .then((row) => {
            responsePush = row;
          }),
      ];
      if (responsePush.internalSkuId) {
        followUpWrites.push(
          prisma.equipmentSku.update({
            where: { id: responsePush.internalSkuId },
            data: { hubspotProductId: hubspotResult.hubspotProductId },
          })
        );
      }
      await Promise.all(followUpWrites);

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
  if (push.systems.includes("ZOHO")) {
    console.log("[catalog/approve] ZOHO push not yet implemented for:", push.model);
    outcomes.ZOHO = {
      status: "not_implemented",
      message: "Zoho product push is not implemented yet.",
    };
  }
  if (push.systems.includes("ZUPER")) {
    console.log("[catalog/approve] ZUPER push not yet implemented for:", push.model);
    outcomes.ZUPER = {
      status: "not_implemented",
      message: "Zuper part push is not implemented yet.",
    };
  }

  return NextResponse.json({
    push: responsePush,
    outcomes,
    summary: makeSummary(outcomes),
  });
}
