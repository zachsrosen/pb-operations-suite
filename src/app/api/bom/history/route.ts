/**
 * BOM History API
 *
 * GET  /api/bom/history?dealId=xxx
 *   Returns all snapshots for a deal, newest-first, with full bomData.
 *
 * POST /api/bom/history
 *   Saves a new snapshot for a deal, auto-incrementing version.
 *   Also syncs inventory SKUs via the same logic as /api/bom/save.
 *   Body: { dealId, dealName, bomData, sourceFile?, blobUrl? }
 *   Returns: { id, version, createdAt }
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { EquipmentCategory } from "@/generated/prisma/enums";

const ALLOWED_ROLES = new Set([
  "ADMIN", "OWNER", "MANAGER", "OPERATIONS", "OPERATIONS_MANAGER",
  "PROJECT_MANAGER", "DESIGNER", "PERMITTING",
]);

// Categories that map to the EquipmentSku inventory table
const INVENTORY_CATEGORIES: Record<string, EquipmentCategory> = {
  MODULE: "MODULE",
  INVERTER: "INVERTER",
  BATTERY: "BATTERY",
  EV_CHARGER: "EV_CHARGER",
  RAPID_SHUTDOWN: "RAPID_SHUTDOWN",
  RACKING: "RACKING",
  ELECTRICAL_BOS: "ELECTRICAL_BOS",
  MONITORING: "MONITORING",
};

interface BomItem {
  category: string;
  brand: string | null;
  model: string | null;
  description: string;
  qty: number | string;
  unitSpec?: number | string | null;
  unitLabel?: string | null;
  source?: string;
  flags?: string[];
}

interface BomData {
  project: {
    customer?: string;
    address?: string;
    systemSizeKwdc?: number | string;
    systemSizeKwac?: number | string;
    moduleCount?: number | string;
    plansetRev?: string;
    stampDate?: string;
    utility?: string;
    ahj?: string;
    apn?: string;
  };
  items: BomItem[];
  validation?: {
    moduleCountMatch?: boolean | null;
    batteryCapacityMatch?: boolean | null;
    ocpdMatch?: boolean | null;
    warnings?: string[];
  };
}

/* ---- GET ---- */
export async function GET(req: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dealId = req.nextUrl.searchParams.get("dealId");
  if (!dealId) return NextResponse.json({ error: "dealId is required" }, { status: 400 });

  const snapshots = await prisma.projectBomSnapshot.findMany({
    where: { dealId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      dealId: true,
      dealName: true,
      version: true,
      bomData: true,
      sourceFile: true,
      blobUrl: true,
      savedBy: true,
      createdAt: true,
      zohoPoId: true,
      zohoSoId: true,
    },
  });

  return NextResponse.json({ snapshots });
}

/* ---- POST ---- */
export async function POST(req: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const startedAt = Date.now();
  const { role, email, name, ip, userAgent } = authResult;

  const logSnapshot = async (
    outcome: "succeeded" | "failed",
    details: Record<string, unknown>,
    responseStatus: number
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "INVENTORY_SKU_SYNCED",
      description:
        outcome === "succeeded"
          ? "Saved BOM snapshot"
          : "BOM snapshot save failed",
      userEmail: email,
      userName: name,
      entityType: "project",
      entityName: "bom_history",
      metadata: {
        event: "bom_snapshot_save",
        outcome,
        ...details,
      },
      ipAddress: ip,
      userAgent,
      requestPath: "/api/bom/history",
      requestMethod: "POST",
      responseStatus,
      durationMs: Date.now() - startedAt,
    });
  };

  if (!ALLOWED_ROLES.has(role)) {
    await logSnapshot("failed", { reason: "insufficient_permissions", role }, 403);
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { dealId: string; dealName: string; bomData: BomData; sourceFile?: string; blobUrl?: string };
  try {
    body = await req.json();
  } catch {
    await logSnapshot("failed", { reason: "invalid_json_body" }, 400);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dealId, dealName, bomData, sourceFile, blobUrl } = body;

  if (!dealId || !dealName || !bomData?.items) {
    await logSnapshot(
      "failed",
      { reason: "missing_required_fields", hasDealId: !!dealId, hasDealName: !!dealName, hasItems: !!bomData?.items },
      400
    );
    return NextResponse.json({ error: "dealId, dealName, and bomData are required" }, { status: 400 });
  }

  try {
    // Find the current highest version for this deal
    const latest = await prisma.projectBomSnapshot.findFirst({
      where: { dealId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    // Save snapshot
    const snapshot = await prisma.projectBomSnapshot.create({
      data: {
        dealId,
        dealName,
        version: nextVersion,
        bomData: bomData as object,
        sourceFile: sourceFile ?? null,
        blobUrl: blobUrl ?? null,
        savedBy: email,
      },
    });

    // Sync inventory SKUs (same as /api/bom/save)
    let skuCreated = 0, skuUpdated = 0, skuSkipped = 0;
    for (const item of bomData.items) {
      const inventoryCategory = INVENTORY_CATEGORIES[item.category];
      if (!inventoryCategory) { skuSkipped++; continue; }
      const brand = item.brand?.trim();
      const model = item.model?.trim();
      const description = item.description?.trim();
      if (!brand || !model) { skuSkipped++; continue; }

      const unitSpec = item.unitSpec != null ? Number(item.unitSpec) : null;
      const result = await prisma.equipmentSku.upsert({
        where: { category_brand_model: { category: inventoryCategory, brand, model } },
        update: {
          description: description || undefined,
          unitSpec: unitSpec ?? undefined,
          unitLabel: item.unitLabel ?? undefined,
          isActive: true,
        },
        create: {
          category: inventoryCategory,
          brand,
          model,
          description: description || null,
          unitSpec,
          unitLabel: item.unitLabel ?? null,
        },
      });
      if (result.createdAt.getTime() === result.updatedAt.getTime()) skuCreated++; else skuUpdated++;
    }

    await logSnapshot(
      "succeeded",
      { dealId, dealName, version: nextVersion, sourceFile, skuCreated, skuUpdated, skuSkipped },
      200
    );

    return NextResponse.json({ id: snapshot.id, version: snapshot.version, createdAt: snapshot.createdAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSnapshot(
      "failed",
      { reason: "snapshot_save_failed", dealId, dealName, error: message },
      500
    );
    return NextResponse.json({ error: "Failed to save BOM snapshot" }, { status: 500 });
  }
}
