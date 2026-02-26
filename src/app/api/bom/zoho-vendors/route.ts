// src/app/api/bom/zoho-vendors/route.ts
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

// In-memory TTL cache — `revalidate` is unreliable for authenticated routes
// because Next.js would need to key on auth token, which it doesn't do.
let vendorsCache: { vendors: { contact_id: string; contact_name: string }[]; expiresAt: number } | null = null;
const VENDORS_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  if (vendorsCache && Date.now() < vendorsCache.expiresAt) {
    return NextResponse.json({ vendors: vendorsCache.vendors });
  }

  try {
    const vendors = await zohoInventory.listVendors();
    vendorsCache = { vendors, expiresAt: Date.now() + VENDORS_TTL_MS };
    return NextResponse.json({ vendors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch vendors";
    console.error("[bom/zoho-vendors]", message);
    // Return empty vendors + error so the UI can surface the real reason
    return NextResponse.json({ vendors: [], error: message });
  }
}
