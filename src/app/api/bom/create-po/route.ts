import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity, prisma } from "@/lib/db";
import {
  createPurchaseOrders,
  mergeUnassignedIntoVendor,
  parseZohoPurchaseOrders,
  resolvePoVendorGroups,
  type BomData,
} from "@/lib/bom-po-create";
import { zohoInventory } from "@/lib/zoho-inventory";
import type { ActorContext } from "@/lib/actor-context";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set([
  "ADMIN",
  "OWNER",
  "MANAGER",
  "OPERATIONS",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "DESIGNER",
]);

async function resolveVendorName(vendorId: string, fallbackGroups: Array<{ vendorId: string; vendorName: string }>) {
  const existing = fallbackGroups.find((group) => group.vendorId === vendorId);
  if (existing?.vendorName) return existing.vendorName;

  try {
    const vendors = await zohoInventory.listVendors();
    return vendors.find((vendor) => vendor.contact_id === vendorId)?.contact_name ?? "Assigned Vendor";
  } catch {
    return "Assigned Vendor";
  }
}

export async function POST(request: NextRequest) {
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ALLOWED_ROLES.has(authResult.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json({ error: "Zoho Inventory is not configured" }, { status: 503 });
  }

  let body: { dealId?: string; version?: number; unassignedVendorId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, version, unassignedVendorId } = body;
  if (!dealId || typeof version !== "number") {
    return NextResponse.json({ error: "dealId and version are required" }, { status: 400 });
  }

  const actor: ActorContext = {
    email: authResult.email,
    name: authResult.name,
    ipAddress: authResult.ip,
    userAgent: authResult.userAgent,
    requestPath: "/api/bom/create-po",
    requestMethod: "POST",
  };

  try {
    const snapshot = await prisma.projectBomSnapshot.findFirst({
      where: { dealId: String(dealId), version },
    });
    if (!snapshot) {
      return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
    }

    const bomData = (snapshot.bomData ?? {}) as BomData;
    const existingPos = parseZohoPurchaseOrders(snapshot.zohoPurchaseOrders);
    let grouping = existingPos.length > 0 && Array.isArray(bomData.poVendorGroups) && bomData.poVendorGroups.length > 0
      ? { vendorGroups: bomData.poVendorGroups, unassignedItems: [] }
      : await resolvePoVendorGroups(bomData);

    if (unassignedVendorId) {
      const vendorName = await resolveVendorName(unassignedVendorId, grouping.vendorGroups);
      grouping = mergeUnassignedIntoVendor(grouping, unassignedVendorId, vendorName);
    }

    const result = await createPurchaseOrders({
      snapshotId: snapshot.id,
      bomData,
      vendorGroups: grouping.vendorGroups,
      existingPos,
      dealName: snapshot.dealName,
      version,
      address: bomData.project?.address,
      actor,
    });

    const purchaseOrders = [...result.skippedExisting, ...result.created];

    await logActivity({
      type: "FEATURE_USED",
      description: `Created ${result.created.length} Zoho PO(s) for ${snapshot.dealName} BOM v${version}`,
      userEmail: actor.email,
      userName: actor.name,
      entityType: "bom",
      entityId: String(dealId),
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_create_po",
        dealId: snapshot.dealId,
        dealName: snapshot.dealName,
        version,
        purchaseOrders,
        failed: result.failed,
        unassignedVendorId: unassignedVendorId ?? null,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestPath: actor.requestPath,
      requestMethod: actor.requestMethod,
    }).catch(() => {});

    return NextResponse.json({
      purchaseOrders,
      unassignedItems: grouping.unassignedItems.map((item) => ({
        name: item.name,
        qty: item.quantity,
      })),
      failed: result.failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
