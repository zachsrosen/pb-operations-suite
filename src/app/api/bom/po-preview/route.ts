import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { logActivity, prisma } from "@/lib/db";
import { resolvePoVendorGroups, type BomData } from "@/lib/bom-po-create";
import { zohoInventory } from "@/lib/zoho-inventory";

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

export async function GET(request: NextRequest) {
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

  const dealId = request.nextUrl.searchParams.get("dealId");
  const versionRaw = request.nextUrl.searchParams.get("version");
  const version = versionRaw ? Number(versionRaw) : NaN;
  if (!dealId || !Number.isFinite(version)) {
    return NextResponse.json({ error: "dealId and version are required" }, { status: 400 });
  }

  try {
    const snapshot = await prisma.projectBomSnapshot.findFirst({
      where: { dealId, version },
    });
    if (!snapshot) {
      return NextResponse.json({ error: "BOM snapshot not found" }, { status: 404 });
    }

    const grouping = await resolvePoVendorGroups((snapshot.bomData ?? {}) as BomData);

    await logActivity({
      type: "FEATURE_USED",
      description: `Previewed PO vendor grouping for ${snapshot.dealName} BOM v${version}`,
      userEmail: authResult.email,
      userName: authResult.name,
      entityType: "bom",
      entityId: dealId,
      entityName: snapshot.dealName,
      metadata: {
        event: "bom_po_preview",
        dealId,
        version,
        vendorGroupCount: grouping.vendorGroups.length,
        unassignedCount: grouping.unassignedItems.length,
      },
      ipAddress: authResult.ip,
      userAgent: authResult.userAgent,
      requestPath: "/api/bom/po-preview",
      requestMethod: "GET",
    }).catch(() => {});

    return NextResponse.json(grouping);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
