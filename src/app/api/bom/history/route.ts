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
    },
  });

  return NextResponse.json({ snapshots });
}

/* ---- POST ---- */
export async function POST(req: NextRequest) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role, email, name, ip, userAgent } = authResult;

  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  let body: { dealId: string; dealName: string; bomData: BomData; sourceFile?: string; blobUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dealId, dealName, bomData, sourceFile, blobUrl } = body;

  if (!dealId || !dealName || !bomData?.items) {
    return NextResponse.json({ error: "dealId, dealName, and bomData are required" }, { status: 400 });
  }

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
    if (!brand || !model) { skuSkipped++; continue; }

    const unitSpec = item.unitSpec != null ? Number(item.unitSpec) : null;
    const result = await prisma.equipmentSku.upsert({
      where: { category_brand_model: { category: inventoryCategory, brand, model } },
      update: { unitSpec: unitSpec ?? undefined, unitLabel: item.unitLabel ?? undefined, isActive: true },
      create: { category: inventoryCategory, brand, model, unitSpec, unitLabel: item.unitLabel ?? null },
    });
    if (result.createdAt.getTime() === result.updatedAt.getTime()) skuCreated++; else skuUpdated++;
  }

  await logActivity({
    type: "INVENTORY_SKU_SYNCED",
    description: `BOM v${nextVersion} saved for ${dealName} — ${bomData.items.length} items (SKUs: ${skuCreated} created, ${skuUpdated} updated, ${skuSkipped} skipped)`,
    userEmail: email,
    userName: name,
    entityType: "project",
    entityId: dealId,
    metadata: { dealId, dealName, version: nextVersion, sourceFile, skuCreated, skuUpdated, skuSkipped },
    ipAddress: ip,
    userAgent,
    requestPath: "/api/bom/history",
    requestMethod: "POST",
    responseStatus: 200,
  });

  return NextResponse.json({ id: snapshot.id, version: snapshot.version, createdAt: snapshot.createdAt });
}
