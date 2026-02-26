// src/app/api/bom/zoho-customers/route.ts
//
// Zoho Inventory's search_text param is silently ignored — it always returns
// the same first page regardless of query. We work around this by loading ALL
// customer pages in parallel batches and caching the full list in module memory.
//
// Cache lifecycle:
//   - First request: kick off full load in background, return [] + loading:true
//   - While loading: subsequent requests return [] + loading:true
//   - After load: filter by ?search= and return matches; refresh after 60 min
//
// GET /api/bom/zoho-customers?search=Smith  → filtered matches (or [] if still loading)
// GET /api/bom/zoho-customers               → [] (search required)

import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const BATCH_SIZE = 10; // pages fetched in parallel per round

interface CustomerCache {
  customers: { contact_id: string; contact_name: string }[];
  expiresAt: number;
}

let cache: CustomerCache | null = null;
let loadingPromise: Promise<void> | null = null;

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

function ensureLoading() {
  if (loadingPromise) return; // already in progress
  loadingPromise = loadAllCustomers().catch((e) => {
    console.error("[bom/zoho-customers] load failed:", e instanceof Error ? e.message : e);
  }).finally(() => {
    loadingPromise = null; // allow retry on next request if it failed
  });
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

  const search = req.nextUrl.searchParams.get("search")?.trim() ?? "";

  // Refresh stale cache in background
  if (cache && Date.now() >= cache.expiresAt) {
    cache = null;
    loadingPromise = null;
  }

  // Start loading if not already cached/loading
  if (!cache) {
    ensureLoading();
    return NextResponse.json({ customers: [], loading: true });
  }

  if (!search) {
    return NextResponse.json({ customers: [] });
  }

  const q = search.toLowerCase();
  const matches = cache.customers.filter((c) =>
    c.contact_name.toLowerCase().includes(q)
  );

  return NextResponse.json({ customers: matches });
}
