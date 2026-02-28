/**
 * Zoho Customer Cache
 *
 * Shared in-memory cache for Zoho Inventory customers. Used by both:
 *   - GET /api/bom/zoho-customers (HTTP route)
 *   - BOM pipeline orchestrator (automated)
 *
 * Zoho's search_text param is silently ignored — every query returns the same
 * first page regardless of query. We load ALL pages in parallel batches, cache
 * the full list in module memory, and filter server-side.
 *
 * Cache lifecycle:
 *   - First request: waits for full parallel load (~15s), then filters + returns
 *   - Warm instance: returns immediately from cache (filtered)
 *   - Cache expires after 60 min → next request reloads
 *   - Cache version bump forces reload when schema changes
 */

import { zohoInventory } from "@/lib/zoho-inventory";

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const BATCH_SIZE = 10; // pages fetched in parallel per round
const PAGE_RETRY_ATTEMPTS = 3;
const CACHE_VERSION = 4; // bumped: resilient pagination + expanded hubspot_record_id extraction

export interface CachedCustomer {
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

// ---------------------------------------------------------------------------
// HubSpot ID extraction helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeHubspotRecordId(value: unknown): string | null {
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

// ---------------------------------------------------------------------------
// Cache loading
// ---------------------------------------------------------------------------

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
  console.log(`[zoho-customer-cache] cached ${allCustomers.length} customers (${hsCount} with HubSpot ID)`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ensure the customer cache is loaded (cold start or expired). */
export async function ensureCustomerCacheLoaded(): Promise<void> {
  if (cache && Date.now() < cache.expiresAt && cache.version === CACHE_VERSION) {
    return; // cache is warm and valid
  }
  cache = null;
  await loadAllCustomers();
}

/** Find a customer by HubSpot contact ID. Returns null if not found. */
export function findByHubSpotContactId(contactId: string): CachedCustomer | null {
  if (!cache) return null;

  const normalizedId = normalizeHubspotRecordId(contactId);
  if (!normalizedId) return null;

  const matches = cache.customers.filter(
    (c) => c.hubspot_record_id === normalizedId
  );

  if (matches.length === 0) return null;

  if (matches.length > 1) {
    // Deterministic: pick lowest contact_id
    matches.sort((a, b) => a.contact_id.localeCompare(b.contact_id));
    console.warn(
      `[zoho-customer-cache] WARNING: ${matches.length} customers match hubspot_record_id ${contactId}: [${matches.map((c) => c.contact_id).join(", ")}]. Using ${matches[0].contact_id}.`
    );
  }

  return matches[0];
}

/** Search customers by name substring. */
export function searchCustomersByName(query: string): CachedCustomer[] {
  if (!cache) return [];
  const q = query.toLowerCase();
  return cache.customers.filter((c) =>
    c.contact_name.toLowerCase().includes(q)
  );
}

/** Get cache stats for debug endpoint. */
export function getCacheStats() {
  if (!cache) return null;

  const sourceCounts = cache.customers.reduce<Record<CachedCustomer["hubspot_id_source"], number>>(
    (acc, customer) => {
      acc[customer.hubspot_id_source] += 1;
      return acc;
    },
    { direct: 0, custom_field_hash: 0, custom_fields: 0, none: 0 }
  );

  return {
    cacheVersion: CACHE_VERSION,
    totalCustomers: cache.customers.length,
    hubspotIdCustomers: cache.customers.filter((c) => c.hubspot_record_id).length,
    sourceCounts,
    sample: cache.customers
      .filter((c) => c.hubspot_record_id)
      .slice(0, 10)
      .map((c) => ({
        contact_id: c.contact_id,
        contact_name: c.contact_name,
        hubspot_record_id: c.hubspot_record_id,
        source: c.hubspot_id_source,
      })),
  };
}
