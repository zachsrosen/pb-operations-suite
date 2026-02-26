// src/app/api/bom/zoho-customers/route.ts
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

// In-memory TTL cache — same pattern as zoho-vendors
let customersCache: { customers: { contact_id: string; contact_name: string }[]; expiresAt: number } | null = null;
const CUSTOMERS_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  if (customersCache && Date.now() < customersCache.expiresAt) {
    return NextResponse.json({ customers: customersCache.customers });
  }

  try {
    const customers = await zohoInventory.listCustomers();
    customersCache = { customers, expiresAt: Date.now() + CUSTOMERS_TTL_MS };
    return NextResponse.json({ customers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch customers";
    console.error("[bom/zoho-customers]", message);
    // Return empty customers + error so the UI can surface the real reason
    return NextResponse.json({ customers: [], error: message });
  }
}
