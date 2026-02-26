// src/app/api/bom/zoho-customers/route.ts
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

// In-memory TTL cache — same stale-while-revalidate pattern as zoho-vendors.
// Returns cached data immediately even if stale, refreshes in background.
let customersCache: { customers: { contact_id: string; contact_name: string }[]; expiresAt: number } | null = null;
let customersRefreshing = false;
const CUSTOMERS_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function refreshCustomers() {
  if (customersRefreshing) return;
  customersRefreshing = true;
  try {
    const customers = await zohoInventory.listCustomers();
    customersCache = { customers, expiresAt: Date.now() + CUSTOMERS_TTL_MS };
  } catch (e) {
    console.error("[bom/zoho-customers] background refresh failed:", e instanceof Error ? e.message : e);
  } finally {
    customersRefreshing = false;
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
  if (customersCache) {
    if (Date.now() >= customersCache.expiresAt) {
      void refreshCustomers(); // kick off background refresh, don't await
    }
    return NextResponse.json({ customers: customersCache.customers });
  }

  // No cache at all — must wait (first load only)
  try {
    const customers = await zohoInventory.listCustomers();
    customersCache = { customers, expiresAt: Date.now() + CUSTOMERS_TTL_MS };
    return NextResponse.json({ customers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch customers";
    console.error("[bom/zoho-customers]", message);
    return NextResponse.json({ customers: [], error: message });
  }
}
