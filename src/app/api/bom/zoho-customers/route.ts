// src/app/api/bom/zoho-customers/route.ts
//
// Zoho Inventory's search_text param is silently ignored — every query returns
// the same first page regardless of query. We work around this by loading ALL
// customer pages in parallel batches, caching the full list in module memory,
// and filtering client-side on the server.
//
// Cache lifecycle:
//   - First request: waits for full parallel load (~15s), then filters + returns
//   - Warm instance: returns immediately from cache (filtered)
//   - Cache expires after 60 min → next request reloads
//
// maxDuration = 60 ensures Vercel doesn't kill the function mid-load.
//
// GET /api/bom/zoho-customers?search=Smith  → filtered matches
// GET /api/bom/zoho-customers               → [] (search required)

import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";
export const maxDuration = 60;

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const BATCH_SIZE = 10; // pages fetched in parallel per round

interface CustomerCache {
  customers: { contact_id: string; contact_name: string }[];
  expiresAt: number;
}

let cache: CustomerCache | null = null;

async function loadAllCustomers(): Promise<void> {
  const allCustomers: { contact_id: string; contact_name: string }[] = [];
  let page = 1;
  let exhausted = false;

  while (!exhausted) {
    const batch = Array.from({ length: BATCH_SIZE }, (_, i) => page + i);
    const results = await Promise.all(
      batch.map((p) =>
        zohoInventory
          .fetchCustomerPage(p)
          .catch(() => ({ contacts: [], hasMore: false }))
      )
    );

    for (const { contacts, hasMore } of results) {
      allCustomers.push(...contacts);
      if (!hasMore) { exhausted = true; break; }
    }

    page += BATCH_SIZE;
    if (page > 200) break; // safety cap
  }

  cache = { customers: allCustomers, expiresAt: Date.now() + CACHE_TTL_MS };
  console.log(`[bom/zoho-customers] cached ${allCustomers.length} customers`);
}

export async function GET(req: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!zohoInventory.isConfigured()) {
    return NextResponse.json(
      { error: "Zoho Inventory is not configured" },
      { status: 503 }
    );
  }

  // Expire stale cache
  if (cache && Date.now() >= cache.expiresAt) {
    cache = null;
  }

  // Wait for full load if cache is cold (first request on a cold instance)
  if (!cache) {
    try {
      await loadAllCustomers();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load customers";
      console.error("[bom/zoho-customers]", message);
      return NextResponse.json({ customers: [], error: message });
    }
  }

  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";
  if (!search) {
    return NextResponse.json({ customers: [] });
  }

  const q = search.toLowerCase();
  const matches = cache!.customers.filter((c) =>
    c.contact_name.toLowerCase().includes(q)
  );

  return NextResponse.json({ customers: matches });
}
