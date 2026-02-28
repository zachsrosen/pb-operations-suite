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
//   - Cache version bump forces reload when schema changes
//
// maxDuration = 60 ensures Vercel doesn't kill the function mid-load.
//
// GET /api/bom/zoho-customers?search=Smith              → filtered matches by name
// GET /api/bom/zoho-customers?hubspot_contact_id=12345  → exact match by HubSpot ID
// GET /api/bom/zoho-customers                           → [] (search required)

import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { zohoInventory } from "@/lib/zoho-inventory";

export const runtime = "nodejs";
export const maxDuration = 60;

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const BATCH_SIZE = 10; // pages fetched in parallel per round
const CACHE_VERSION = 2; // bumped: added hubspot_record_id

interface CachedCustomer {
  contact_id: string;
  contact_name: string;
  hubspot_record_id: string | null;
}

interface CustomerCache {
  version: number;
  customers: CachedCustomer[];
  expiresAt: number;
}

let cache: CustomerCache | null = null;

async function loadAllCustomers(): Promise<void> {
  const allCustomers: CachedCustomer[] = [];
  let page = 1;
  let exhausted = false;

  while (!exhausted) {
    const batch = Array.from({ length: BATCH_SIZE }, (_, i) => page + i);
    const results = await Promise.all(
      batch.map((p) =>
        zohoInventory
          .fetchCustomerPage(p)
          .catch(() => ({ contacts: [] as { contact_id: string; contact_name: string }[], hasMore: false }))
      )
    );

    for (const { contacts, hasMore } of results) {
      for (const c of contacts) {
        const raw = c as Record<string, unknown>;
        const hsId = typeof raw.cf_hubspot_record_id === "string"
          ? raw.cf_hubspot_record_id.trim() || null
          : null;
        allCustomers.push({
          contact_id: c.contact_id,
          contact_name: c.contact_name,
          hubspot_record_id: hsId,
        });
      }
      if (!hasMore) { exhausted = true; break; }
    }

    page += BATCH_SIZE;
    if (page > 200) break; // safety cap
  }

  cache = { version: CACHE_VERSION, customers: allCustomers, expiresAt: Date.now() + CACHE_TTL_MS };
  const hsCount = allCustomers.filter((c) => c.hubspot_record_id).length;
  console.log(`[bom/zoho-customers] cached ${allCustomers.length} customers (${hsCount} with HubSpot ID)`);
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

  // Expire stale cache (TTL or schema version mismatch)
  if (cache && (Date.now() >= cache.expiresAt || cache.version !== CACHE_VERSION)) {
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

  // ── HubSpot contact ID lookup (auto-match) ──
  const hubspotContactId = req.nextUrl.searchParams.get("hubspot_contact_id")?.trim() ?? "";
  if (hubspotContactId) {
    const matches = cache!.customers.filter(
      (c) => c.hubspot_record_id && c.hubspot_record_id.trim() === hubspotContactId
    );

    if (matches.length === 0) {
      return NextResponse.json({ customer: null });
    }

    if (matches.length > 1) {
      // Deterministic: pick lowest contact_id
      matches.sort((a, b) => a.contact_id.localeCompare(b.contact_id));
      console.warn(
        `[bom/zoho-customers] WARNING: ${matches.length} customers match hubspot_record_id ${hubspotContactId}: [${matches.map((c) => c.contact_id).join(", ")}]. Using ${matches[0].contact_id}.`
      );
    }

    return NextResponse.json({
      customer: {
        contact_id: matches[0].contact_id,
        contact_name: matches[0].contact_name,
      },
    });
  }

  // ── Name-based search (existing behavior) ──
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
