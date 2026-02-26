// src/app/api/bom/zoho-vendors/route.ts
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

// In-memory TTL cache — `revalidate` is unreliable for authenticated routes.
// Uses stale-while-revalidate: return cached data immediately (even if stale)
// and refresh in the background so callers never wait after first load.
let vendorsCache: { vendors: { contact_id: string; contact_name: string }[]; expiresAt: number } | null = null;
let vendorsRefreshing = false;
const VENDORS_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function refreshVendors() {
  if (vendorsRefreshing) return;
  vendorsRefreshing = true;
  try {
    const vendors = await zohoInventory.listVendors();
    vendorsCache = { vendors, expiresAt: Date.now() + VENDORS_TTL_MS };
  } catch (e) {
    console.error("[bom/zoho-vendors] background refresh failed:", e instanceof Error ? e.message : e);
  } finally {
    vendorsRefreshing = false;
  }
}

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  // Stale-while-revalidate: return whatever we have immediately, refresh in background if stale
  if (vendorsCache) {
    if (Date.now() >= vendorsCache.expiresAt) {
      void refreshVendors(); // kick off background refresh, don't await
    }
    return NextResponse.json({ vendors: vendorsCache.vendors });
  }

  // No cache at all — must wait (first load only)
  try {
    const vendors = await zohoInventory.listVendors();
    vendorsCache = { vendors, expiresAt: Date.now() + VENDORS_TTL_MS };
    return NextResponse.json({ vendors });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch vendors";
    console.error("[bom/zoho-vendors]", message);
    return NextResponse.json({ vendors: [], error: message });
  }
}
