import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma, logActivity } from "@/lib/db";

const WRITE_ROLES = new Set(["ADMIN", "OWNER", "PROJECT_MANAGER"]);

const mergeSchema = z.object({
  sourceSkuId: z.string().trim().min(1),
  targetSkuId: z.string().trim().min(1),
});

const SPEC_TABLES = [
  "moduleSpec",
  "inverterSpec",
  "batterySpec",
  "evChargerSpec",
  "mountingHardwareSpec",
  "electricalHardwareSpec",
  "relayDeviceSpec",
] as const;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function pickMissingTargetValue<T>(targetValue: T, sourceValue: T): T | undefined {
  if (!isBlank(targetValue)) return undefined;
  if (isBlank(sourceValue)) return undefined;
  return sourceValue;
}

function mergeTimestamps(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!WRITE_ROLES.has(authResult.role)) {
    return NextResponse.json(
      { error: "Insufficient permissions. Requires ADMIN, OWNER, or PROJECT_MANAGER role." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const { sourceSkuId, targetSkuId } = parsed.data;
  if (sourceSkuId === targetSkuId) {
    return NextResponse.json({ error: "sourceSkuId and targetSkuId must be different" }, { status: 400 });
  }

  const include = {
    stockLevels: true,
    moduleSpec: true,
    inverterSpec: true,
    batterySpec: true,
    evChargerSpec: true,
    mountingHardwareSpec: true,
    electricalHardwareSpec: true,
    relayDeviceSpec: true,
  } as const;

  const [source, target] = await Promise.all([
    prisma.internalProduct.findUnique({ where: { id: sourceSkuId }, include }),
    prisma.internalProduct.findUnique({ where: { id: targetSkuId }, include }),
  ]);

  if (!source) return NextResponse.json({ error: "Source product not found" }, { status: 404 });
  if (!target) return NextResponse.json({ error: "Target product not found" }, { status: 404 });
  if (source.category !== target.category) {
    return NextResponse.json(
      { error: `Category mismatch. Source is ${source.category}, target is ${target.category}.` },
      { status: 400 }
    );
  }

  const conflicts: string[] = [];
  for (const [label, sourceValue, targetValue] of [
    ["HubSpot", source.hubspotProductId, target.hubspotProductId],
    ["Zuper", source.zuperItemId, target.zuperItemId],
    ["Zoho", source.zohoItemId, target.zohoItemId],
  ] as const) {
    if (!isBlank(sourceValue) && !isBlank(targetValue) && String(sourceValue).trim() !== String(targetValue).trim()) {
      conflicts.push(`${label} link conflict (${targetValue} vs ${sourceValue})`);
    }
  }

  const mergeResult = await prisma.$transaction(async (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any
  ) => {
    const sourceFresh = await tx.internalProduct.findUnique({ where: { id: sourceSkuId }, include });
    const targetFresh = await tx.internalProduct.findUnique({ where: { id: targetSkuId }, include });
    if (!sourceFresh || !targetFresh) {
      throw new Error("Source or target product no longer exists");
    }

    const updateData: Record<string, unknown> = {};
    updateData.description = pickMissingTargetValue(targetFresh.description, sourceFresh.description) ?? targetFresh.description;
    updateData.vendorName = pickMissingTargetValue(targetFresh.vendorName, sourceFresh.vendorName) ?? targetFresh.vendorName;
    updateData.vendorPartNumber =
      pickMissingTargetValue(targetFresh.vendorPartNumber, sourceFresh.vendorPartNumber) ?? targetFresh.vendorPartNumber;
    updateData.unitSpec = pickMissingTargetValue(targetFresh.unitSpec, sourceFresh.unitSpec) ?? targetFresh.unitSpec;
    updateData.unitLabel = pickMissingTargetValue(targetFresh.unitLabel, sourceFresh.unitLabel) ?? targetFresh.unitLabel;
    updateData.unitCost = pickMissingTargetValue(targetFresh.unitCost, sourceFresh.unitCost) ?? targetFresh.unitCost;
    updateData.sellPrice = pickMissingTargetValue(targetFresh.sellPrice, sourceFresh.sellPrice) ?? targetFresh.sellPrice;
    updateData.sku = pickMissingTargetValue(targetFresh.sku, sourceFresh.sku) ?? targetFresh.sku;
    updateData.length = pickMissingTargetValue(targetFresh.length, sourceFresh.length) ?? targetFresh.length;
    updateData.width = pickMissingTargetValue(targetFresh.width, sourceFresh.width) ?? targetFresh.width;
    updateData.weight = pickMissingTargetValue(targetFresh.weight, sourceFresh.weight) ?? targetFresh.weight;
    updateData.hardToProcure = Boolean(targetFresh.hardToProcure || sourceFresh.hardToProcure);
    updateData.hubspotProductId =
      pickMissingTargetValue(targetFresh.hubspotProductId, sourceFresh.hubspotProductId) ?? targetFresh.hubspotProductId;
    updateData.zuperItemId = pickMissingTargetValue(targetFresh.zuperItemId, sourceFresh.zuperItemId) ?? targetFresh.zuperItemId;
    updateData.zohoItemId = pickMissingTargetValue(targetFresh.zohoItemId, sourceFresh.zohoItemId) ?? targetFresh.zohoItemId;

    await tx.internalProduct.update({
      where: { id: targetSkuId },
      data: updateData,
    });

    let mergedStockLocations = 0;
    const sourceStocks = await tx.inventoryStock.findMany({
      where: { internalProductId: sourceSkuId },
      select: {
        id: true,
        location: true,
        quantityOnHand: true,
        minStockLevel: true,
        lastCountedAt: true,
      },
    });

    for (const sourceStock of sourceStocks) {
      const targetStock = await tx.inventoryStock.findUnique({
        where: {
          internalProductId_location: {
            internalProductId: targetSkuId,
            location: sourceStock.location,
          },
        },
      });

      let destinationStockId = "";
      if (targetStock) {
        await tx.inventoryStock.update({
          where: { id: targetStock.id },
          data: {
            quantityOnHand: targetStock.quantityOnHand + sourceStock.quantityOnHand,
            minStockLevel: targetStock.minStockLevel ?? sourceStock.minStockLevel,
            lastCountedAt: mergeTimestamps(targetStock.lastCountedAt, sourceStock.lastCountedAt),
          },
        });
        destinationStockId = targetStock.id;
      } else {
        const createdStock = await tx.inventoryStock.create({
          data: {
            internalProductId: targetSkuId,
            location: sourceStock.location,
            quantityOnHand: sourceStock.quantityOnHand,
            minStockLevel: sourceStock.minStockLevel,
            lastCountedAt: sourceStock.lastCountedAt,
          },
        });
        destinationStockId = createdStock.id;
      }

      await tx.stockTransaction.updateMany({
        where: { stockId: sourceStock.id },
        data: { stockId: destinationStockId },
      });

      await tx.inventoryStock.delete({ where: { id: sourceStock.id } });
      mergedStockLocations += 1;
    }

    let mergedSpecTables = 0;
    for (const table of SPEC_TABLES) {
      const sourceSpec = sourceFresh[table];
      if (!sourceSpec) continue;
      const targetSpec = targetFresh[table];

      if (!targetSpec) {
        await tx[table].update({
          where: { internalProductId: sourceSkuId },
          data: { internalProductId: targetSkuId },
        });
        mergedSpecTables += 1;
        continue;
      }

      const specUpdateData: Record<string, unknown> = {};
      for (const [key, sourceValue] of Object.entries(sourceSpec as Record<string, unknown>)) {
        if (key === "id" || key === "internalProductId") continue;
        const targetValue = (targetSpec as Record<string, unknown>)[key];
        const mergedValue = pickMissingTargetValue(targetValue, sourceValue);
        if (mergedValue !== undefined) specUpdateData[key] = mergedValue;
      }

      if (Object.keys(specUpdateData).length > 0) {
        await tx[table].update({
          where: { internalProductId: targetSkuId },
          data: specUpdateData,
        });
      }

      await tx[table].delete({ where: { internalProductId: sourceSkuId } });
      mergedSpecTables += 1;
    }

    await tx.internalProduct.delete({ where: { id: sourceSkuId } });
    const targetAfter = await tx.internalProduct.findUnique({
      where: { id: targetSkuId },
      select: {
        id: true,
        category: true,
        brand: true,
        model: true,
        sku: true,
        hubspotProductId: true,
        zuperItemId: true,
        zohoItemId: true,
      },
    });

    return {
      mergedStockLocations,
      mergedSpecTables,
      target: targetAfter,
    };
  });

  await logActivity({
    type: "FEATURE_USED",
    description: "Merged duplicate internal products",
    userEmail: authResult.email,
    userName: authResult.name,
    entityType: "product_comparison",
    entityId: targetSkuId,
    entityName: mergeResult.target ? `${mergeResult.target.brand} ${mergeResult.target.model}`.trim() : targetSkuId,
    metadata: {
      feature: "product_comparison",
      action: "merge_internal",
      sourceSkuId,
      targetSkuId,
      conflicts,
      mergedStockLocations: mergeResult.mergedStockLocations,
      mergedSpecTables: mergeResult.mergedSpecTables,
    },
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: request.nextUrl.pathname,
    requestMethod: request.method,
    responseStatus: 200,
  });

  return NextResponse.json({
    ok: true,
    sourceSkuId,
    targetSkuId,
    conflicts,
    mergedStockLocations: mergeResult.mergedStockLocations,
    mergedSpecTables: mergeResult.mergedSpecTables,
    target: mergeResult.target,
  });
}
