// src/app/api/bom/zoho-customers/route.ts
//
// Thin wrapper around the shared zoho-customer-cache module.
// All cache logic, HubSpot ID extraction, and customer resolution live in
// src/lib/zoho-customer-cache.ts (shared with the BOM pipeline orchestrator).
//
// GET /api/bom/zoho-customers?search=Smith              → filtered matches by name
// GET /api/bom/zoho-customers?hubspot_contact_id=12345  → exact match by HubSpot ID
// GET /api/bom/zoho-customers?debug=1                   → cache stats
// GET /api/bom/zoho-customers                           → [] (search required)

import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";
import {
  ensureCustomerCacheLoaded,
  findByHubSpotContactId,
  searchCustomersByName,
  getCacheStats,
} from "@/lib/zoho-customer-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  // Ensure cache is loaded (cold start or expired)
  try {
    await ensureCustomerCacheLoaded();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load customers";
    console.error("[bom/zoho-customers]", message);
    return NextResponse.json({ customers: [], error: message });
  }

  // ── HubSpot contact ID lookup (auto-match) ──
  const hubspotContactId = req.nextUrl.searchParams.get("hubspot_contact_id")?.trim() ?? "";
  if (hubspotContactId) {
    const match = findByHubSpotContactId(hubspotContactId);
    if (!match) {
      return NextResponse.json({ customer: null });
    }
    return NextResponse.json({
      customer: {
        contact_id: match.contact_id,
        contact_name: match.contact_name,
      },
    });
  }

  // ── Debug endpoint ──
  const debug = req.nextUrl.searchParams.get("debug");
  if (debug === "1" || debug === "true") {
    const stats = getCacheStats();
    if (!stats) {
      return NextResponse.json({ error: "Cache not loaded" }, { status: 503 });
    }
    return NextResponse.json(stats);
  }

  // ── Name-based search (existing behavior) ──
  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  if (!search) {
    return NextResponse.json({ customers: [] });
  }

  const matches = searchCustomersByName(search);
  return NextResponse.json({ customers: matches });
}
