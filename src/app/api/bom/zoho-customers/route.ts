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
const PAGE_RETRY_ATTEMPTS = 3;
const CACHE_VERSION = 4; // bumped: resilient pagination + expanded hubspot_record_id extraction

interface CachedCustomer {
  contact_id: string;
  contact_name: string;
  hubspot_record_id: string | null;
  hubspot_id_source: "direct" | "custom_field_hash" | "custom_fields" | "none";
}

interface CustomerCache {
  version: number;
  customers: CachedCustomer[];
  expiresAt: number;
}

let cache: CustomerCache | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeHubspotRecordId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();
  if (!raw) return null;

  // Normalize common numeric variants: "12345", "12,345", "12345.0"
  const compact = raw.replace(/[,\s]/g, "");
  if (/^\d+(\.0+)?$/.test(compact)) {
    const parsed = Number.parseInt(compact, 10);
    if (Number.isFinite(parsed)) return String(parsed);
  }

  return raw;
}

function extractCandidate(entries: Array<[string, unknown]>): string | null {
  const preferred = entries.filter(([key]) => /record|contact/i.test(key));
  const fallback = entries.filter(([key]) => /hubspot/i.test(key) && !/record|contact/i.test(key));

  for (const [, candidate] of [...preferred, ...fallback]) {
    const normalized = normalizeHubspotRecordId(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function extractHubspotRecordId(contact: Record<string, unknown>): {
  id: string | null;
  source: CachedCustomer["hubspot_id_source"];
} {
  const directCandidates: Array<[string, unknown]> = [
    ["cf_hubspot_record_id", contact.cf_hubspot_record_id],
    ["cf_hubspot_contact_id", contact.cf_hubspot_contact_id],
    ["hubspot_record_id", contact.hubspot_record_id],
    ["hubspot_contact_id", contact.hubspot_contact_id],
    ["cf_hubspot_id", contact.cf_hubspot_id],
    ["hubspot_id", contact.hubspot_id],
  ];

  for (const [, candidate] of directCandidates) {
    const normalized = normalizeHubspotRecordId(candidate);
    if (normalized) return { id: normalized, source: "direct" };
  }

  const looseDirectEntries = Object.entries(contact).filter(([key]) => {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.includes("hubspot")) return false;
    if (normalizedKey === "custom_field_hash" || normalizedKey === "custom_fields") return false;
    return true;
  });
  const looseDirectMatch = extractCandidate(looseDirectEntries);
  if (looseDirectMatch) {
    return { id: looseDirectMatch, source: "direct" };
  }

  // Some Zoho tenants expose custom fields via custom_field_hash.
  const customFieldHash = contact.custom_field_hash;
  if (isRecord(customFieldHash)) {
    const hashEntries = Object.entries(customFieldHash).filter(([key]) =>
      key.toLowerCase().includes("hubspot")
    );
    const extracted = extractCandidate(hashEntries);
    if (extracted) {
      return { id: extracted, source: "custom_field_hash" };
    }
  }

  // Fallback for array-shaped custom field payloads.
  const customFields = contact.custom_fields;
  if (Array.isArray(customFields)) {
    const preferred: Array<[string, unknown]> = [];
    const fallback: Array<[string, unknown]> = [];
    for (const field of customFields) {
      if (!isRecord(field)) continue;
      const fieldName = String(
        field.api_name ??
          field.customfield_id ??
          field.label ??
          field.field_name ??
          field.name ??
          ""
      )
        .trim()
        .toLowerCase();
      if (!fieldName.includes("hubspot")) continue;
      const candidate =
        field.value ??
        field.field_value ??
        field.value_formatted ??
        field.display_value;
      if (fieldName.includes("record") || fieldName.includes("contact")) {
        preferred.push([fieldName, candidate]);
      } else {
        fallback.push([fieldName, candidate]);
      }
    }
    for (const [, candidate] of [...preferred, ...fallback]) {
      const normalized = normalizeHubspotRecordId(candidate);
      if (normalized) return { id: normalized, source: "custom_fields" };
    }
  }

  return { id: null, source: "none" };
}

async function fetchCustomerPageWithRetry(page: number): Promise<{ contacts: { contact_id: string; contact_name: string }[]; hasMore: boolean }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= PAGE_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await zohoInventory.fetchCustomerPage(page);
    } catch (error) {
      lastError = error;
      if (attempt < PAGE_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 200));
      }
    }
  }

  throw new Error(
    `Failed to fetch Zoho customers page ${page} after ${PAGE_RETRY_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : "unknown error"}`
  );
}

async function loadAllCustomers(): Promise<void> {
  const dedupedCustomers = new Map<string, CachedCustomer>();
  let page = 1;
  let exhausted = false;

  while (!exhausted) {
    const batch = Array.from({ length: BATCH_SIZE }, (_, i) => page + i);
    const results = await Promise.all(
      batch.map((p) => fetchCustomerPageWithRetry(p))
    );

    for (const { contacts, hasMore } of results) {
      for (const c of contacts) {
        const raw = c as Record<string, unknown>;
        const extracted = extractHubspotRecordId(raw);
        dedupedCustomers.set(c.contact_id, {
          contact_id: c.contact_id,
          contact_name: c.contact_name,
          hubspot_record_id: extracted.id,
          hubspot_id_source: extracted.source,
        });
      }
      if (!hasMore) { exhausted = true; break; }
    }

    page += BATCH_SIZE;
    if (page > 200) {
      throw new Error("Zoho customers pagination exceeded safety cap (200 pages)");
    }
  }

  const allCustomers = [...dedupedCustomers.values()];
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
    const normalizedHubspotContactId = normalizeHubspotRecordId(hubspotContactId);
    if (!normalizedHubspotContactId) {
      return NextResponse.json({ customer: null });
    }

    const matches = cache!.customers.filter(
      (c) => c.hubspot_record_id === normalizedHubspotContactId
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

  const debug = req.nextUrl.searchParams.get("debug");
  if (debug === "1" || debug === "true") {
    const sourceCounts = cache!.customers.reduce<Record<CachedCustomer["hubspot_id_source"], number>>(
      (acc, customer) => {
        acc[customer.hubspot_id_source] += 1;
        return acc;
      },
      { direct: 0, custom_field_hash: 0, custom_fields: 0, none: 0 }
    );
    const sample = cache!.customers
      .filter((c) => c.hubspot_record_id)
      .slice(0, 10)
      .map((c) => ({
        contact_id: c.contact_id,
        contact_name: c.contact_name,
        hubspot_record_id: c.hubspot_record_id,
        source: c.hubspot_id_source,
      }));

    return NextResponse.json({
      cacheVersion: CACHE_VERSION,
      totalCustomers: cache!.customers.length,
      hubspotIdCustomers: cache!.customers.filter((c) => c.hubspot_record_id).length,
      sourceCounts,
      sample,
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
