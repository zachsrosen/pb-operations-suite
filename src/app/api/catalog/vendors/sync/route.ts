import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";
import { prisma } from "@/lib/db";

// Vercel Cron Jobs hit routes with GET, so export both.
export async function GET(req: NextRequest) { return handleSync(req); }
export async function POST(req: NextRequest) { return handleSync(req); }

async function handleSync(req: NextRequest) {
  // Auth: session-based (admin/owner) OR cron secret
  const cronHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && cronHeader === `Bearer ${cronSecret}`;

  if (!isCron) {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;
    if (!["ADMIN", "OWNER"].includes(authResult.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const zohoVendors = await zohoInventory.listVendors();

    const now = new Date();
    const zohoIds = new Set<string>();

    // Upsert all vendors from Zoho
    for (const v of zohoVendors) {
      zohoIds.add(v.contact_id);
      await prisma.vendorLookup.upsert({
        where: { zohoVendorId: v.contact_id },
        update: {
          name: v.contact_name,
          isActive: true,
          lastSyncedAt: now,
        },
        create: {
          zohoVendorId: v.contact_id,
          name: v.contact_name,
          isActive: true,
          lastSyncedAt: now,
        },
      });
    }

    // Soft-delete vendors no longer in Zoho
    const existing = await prisma.vendorLookup.findMany({
      select: { zohoVendorId: true },
    });
    const missing = existing
      .map((e) => e.zohoVendorId)
      .filter((id) => !zohoIds.has(id));

    if (missing.length > 0) {
      await prisma.vendorLookup.updateMany({
        where: { zohoVendorId: { in: missing } },
        data: { isActive: false },
      });
    }

    return NextResponse.json({
      synced: zohoVendors.length,
      deactivated: missing.length,
    });
  } catch (error) {
    console.error("[vendor-sync] Zoho sync failed:", error);
    return NextResponse.json(
      { error: `Zoho sync failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 }
    );
  }
}
