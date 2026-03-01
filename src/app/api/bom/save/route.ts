/**
 * BOM Save API
 *
 * POST /api/bom/save
 *   Accepts a structured BOM from the planset-bom skill and upserts
 *   equipment SKUs (all 8 BOM categories) into EquipmentSku.
 *   Returns counts of created/updated items.
 *   Auth required.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma, logActivity } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { syncEquipmentSkus } from "@/lib/bom-snapshot";
import type { BomData } from "@/lib/bom-snapshot";

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 }
    );
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const startedAt = Date.now();

  const logSave = async (
    outcome: "succeeded" | "failed",
    details: Record<string, unknown>,
    responseStatus: number
  ) => {
    await logActivity({
      type: outcome === "failed" ? "API_ERROR" : "INVENTORY_SKU_SYNCED",
      description:
        outcome === "succeeded"
          ? "Saved BOM data to inventory SKUs"
          : "BOM save failed",
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "inventory",
      entityName: "bom_save",
      metadata: {
        event: "bom_save",
        outcome,
        ...details,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/save",
      requestMethod: "POST",
      responseStatus,
      durationMs: Date.now() - startedAt,
    });
  };

  let body: { bom: BomData };
  try {
    body = await request.json();
  } catch {
    await logSave("failed", { reason: "invalid_json_body" }, 400);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { bom } = body;
  if (!bom?.items?.length) {
    await logSave("failed", { reason: "missing_bom_items" }, 400);
    return NextResponse.json(
      { error: "BOM items array is required" },
      { status: 400 }
    );
  }

  try {
    const { created, updated, skipped, pending, shadow } = await syncEquipmentSkus(bom.items);

    await logSave(
      "succeeded",
      {
        created,
        updated,
        skipped,
        pending,
        ...(shadow ? { shadow } : {}),
        customer: bom.project?.customer,
        address: bom.project?.address,
        plansetRev: bom.project?.plansetRev,
      },
      200
    );

    return NextResponse.json({ created, updated, skipped, pending, ...(shadow ? { shadow } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSave("failed", { reason: "sku_sync_failed", error: message }, 500);
    return NextResponse.json({ error: "Failed to save BOM data" }, { status: 500 });
  }
}
