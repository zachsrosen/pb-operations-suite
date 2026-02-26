// src/app/api/bom/zoho-customers/route.ts
//
// Zoho has 9,000+ customers — pre-loading all pages (~105s) exceeds Vercel's
// function timeout. Instead this route does server-side search via Zoho's
// search_text param, returning only matching contacts.
//
// GET /api/bom/zoho-customers?search=Smith  → up to 200 matches
// GET /api/bom/zoho-customers?search=       → returns [] (require a query)

import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  if (!search) {
    return NextResponse.json({ customers: [] });
  }

  try {
    const customers = await zohoInventory.searchCustomers(search);
    return NextResponse.json({ customers });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to search customers";
    console.error("[bom/zoho-customers]", message);
    return NextResponse.json({ customers: [], error: message });
  }
}
