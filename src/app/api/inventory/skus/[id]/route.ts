/**
 * DELETE /api/inventory/skus/[id]
 *
 * Hard-deletes a SKU with audit logging.
 * ADMIN role only. Two-step flow: force=false returns preflight (never deletes),
 * force=true performs deletion with audit trail.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import { tagSentryRequest } from "@/lib/sentry-request";

const SKU_INCLUDE = {
  stockLevels: { select: { location: true, quantityOnHand: true } },
  moduleSpec: true,
  inverterSpec: true,
  batterySpec: true,
  evChargerSpec: true,
  mountingHardwareSpec: true,
  electricalHardwareSpec: true,
  relayDeviceSpec: true,
} as const;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  tagSentryRequest(request);

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Auth — ADMIN only
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (authResult.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Insufficient permissions. Requires ADMIN role." },
      { status: 403 }
    );
  }

  const { id } = await params;
  if (!id || !id.trim()) {
    return NextResponse.json({ error: "SKU id is required" }, { status: 400 });
  }

  // Parse optional body for force flag
  let force = false;
  try {
    const body = await request.json().catch(() => null);
    if (body && typeof body === "object" && "force" in body) {
      force = body.force === true;
    }
  } catch {
    // No body is fine — force defaults to false
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: Find SKU with all relations
      const sku = await tx.equipmentSku.findUnique({
        where: { id },
        include: SKU_INCLUDE,
      });

      if (!sku) {
        return { status: 404, body: { error: "SKU not found" } };
      }

      // Step 2: Collect ALL warnings (sync + pending)
      const syncedSystems: string[] = [];
      if (sku.zohoItemId) syncedSystems.push("ZOHO");
      if (sku.hubspotProductId) syncedSystems.push("HUBSPOT");
      if (sku.zuperItemId) syncedSystems.push("ZUPER");

      const pendingCount = await tx.pendingCatalogPush.count({
        where: {
          internalSkuId: id,
          status: "PENDING",
        },
      });

      // Step 3: If force=false, return preflight response (NEVER deletes)
      if (!force) {
        return {
          status: 200,
          body: {
            preflight: true,
            ...(syncedSystems.length > 0 ? { syncedSystems } : {}),
            ...(pendingCount > 0 ? { pendingCount } : {}),
          },
        };
      }

      // Step 4: Look up user DB id for audit trail
      const dbUser = await tx.user.findUnique({
        where: { email: authResult.email },
        select: { id: true },
      });

      // Step 5: Create audit log
      const auditLog = await tx.catalogAuditLog.create({
        data: {
          action: "SKU_DELETE",
          skuId: id,
          snapshot: JSON.parse(JSON.stringify(sku)),
          deletedByUserId: dbUser?.id ?? "unknown",
          deletedByEmail: authResult.email,
        },
      });

      // Step 6: Null out PendingCatalogPush references
      await tx.pendingCatalogPush.updateMany({
        where: { internalSkuId: id },
        data: { internalSkuId: null },
      });

      // Step 7: Delete SKU (cascade handles specs, stock, transactions)
      await tx.equipmentSku.delete({ where: { id } });

      return {
        status: 200,
        body: { deleted: true, auditLogId: auditLog.id },
      };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    Sentry.captureException(error);
    console.error("SKU delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
