/**
 * Customer Resolver Module
 *
 * Searches HubSpot contacts + companies, groups by canonical identity
 * (Company ID + normalized address), expands via company associations,
 * and resolves deal/ticket/Zuper job associations for detail view.
 *
 * Spec: docs/superpowers/specs/2026-03-17-customer-history-design.md
 */

import * as Sentry from "@sentry/nextjs";
import { hubspotClient } from "@/lib/hubspot";
import { chunk } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;
const MAX_SEARCH_RESULTS = 25;

/** Company names to treat as empty/generic */
const GENERIC_COMPANY_NAMES = new Set([
  "unknown company",
  "unknown",
  "n/a",
  "na",
  "none",
  "test",
  "test company",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CustomerContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface CustomerSummary {
  groupKey: string;
  displayName: string;
  address: string;
  contactIds: string[];
  companyId: string | null;
  dealCount: number;
  ticketCount: number;
  jobCount: number;
}

export interface CustomerDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: string | null;
  location: string | null;
  closeDate: string | null;
  lastModified: string;
}

export interface CustomerTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string;
  lastModified: string;
}

export interface CustomerJob {
  uid: string;
  title: string;
  category: string | null;
  status: string | null;
  scheduledDate: string | null;
  createdAt: string | null;
}

export interface CustomerDetail extends CustomerSummary {
  contacts: CustomerContact[];
  deals: CustomerDeal[];
  tickets: CustomerTicket[];
  jobs: CustomerJob[];
}

export interface SearchResult {
  results: CustomerSummary[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Address Normalization
// ---------------------------------------------------------------------------

/** Street suffix abbreviation → full form */
const SUFFIX_MAP: Record<string, string> = {
  st: "street",
  ave: "avenue",
  dr: "drive",
  blvd: "boulevard",
  ln: "lane",
  ct: "court",
  rd: "road",
  pl: "place",
  cir: "circle",
  way: "way",
  pkwy: "parkway",
  trl: "trail",
};

/** Directional abbreviation → full form */
const DIRECTIONAL_MAP: Record<string, string> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  ne: "northeast",
  nw: "northwest",
  se: "southeast",
  sw: "southwest",
};

/**
 * Normalize a street address + zip into a canonical grouping key.
 * Returns `"{normalized_street}|{zip5}"` or null if inputs are missing.
 */
export function normalizeAddress(street: string | null | undefined, zip: string | null | undefined): string | null {
  if (!street || !zip) return null;

  const trimmedStreet = street.trim();
  const trimmedZip = zip.trim();
  if (!trimmedStreet || !trimmedZip) return null;

  // Take first 5 digits of zip
  const zip5 = trimmedZip.replace(/[^0-9]/g, "").slice(0, 5);
  if (zip5.length < 5) return null;

  // Lowercase, strip periods, collapse whitespace
  let normalized = trimmedStreet
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Expand directionals and suffixes — only standalone tokens
  normalized = normalized
    .split(" ")
    .map((token) => {
      if (DIRECTIONAL_MAP[token]) return DIRECTIONAL_MAP[token];
      if (SUFFIX_MAP[token]) return SUFFIX_MAP[token];
      return token;
    })
    .join(" ");

  return `${normalized}|${zip5}`;
}

// ---------------------------------------------------------------------------
// Display Name
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable display name for a customer group.
 * 1. Company name (if present and not generic)
 * 2. "{LastName} Residence" from first contact with a last name
 * 3. Formatted address as fallback
 */
export function deriveDisplayName(
  companyName: string | null | undefined,
  contacts: Array<{ lastName: string | null | undefined }>,
  address: string
): string {
  if (companyName && !GENERIC_COMPANY_NAMES.has(companyName.toLowerCase().trim())) {
    return companyName.trim();
  }

  for (const c of contacts) {
    if (c.lastName && c.lastName.trim()) {
      return `${c.lastName.trim()} Residence`;
    }
  }

  return address;
}

// ---------------------------------------------------------------------------
// Retry Wrappers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search contacts with rate-limit retry.
 * Mirrors searchTicketsWithRetry() in hubspot-tickets.ts.
 */
export async function searchContactsWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.contacts.searchApi.doSearch>[0],
  maxRetries = 5
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.contacts.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const base = Math.pow(2, attempt) * 1100;
        const jitter = Math.random() * 400;
        await sleep(Math.round(base + jitter));
        continue;
      }
      Sentry.addBreadcrumb({
        category: "customer-resolver",
        message: "Contact search failed after retries",
        level: "error",
        data: { attempt, statusCode },
      });
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Search companies with rate-limit retry.
 * Mirrors searchTicketsWithRetry() in hubspot-tickets.ts.
 */
export async function searchCompaniesWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.companies.searchApi.doSearch>[0],
  maxRetries = 5
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.companies.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const base = Math.pow(2, attempt) * 1100;
        const jitter = Math.random() * 400;
        await sleep(Math.round(base + jitter));
        continue;
      }
      Sentry.addBreadcrumb({
        category: "customer-resolver",
        message: "Company search failed after retries",
        level: "error",
        data: { attempt, statusCode },
      });
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

/**
 * Resolve company → contact associations via batch API.
 * Returns Map<companyId, contactId[]>.
 */
async function resolveCompanyContacts(companyIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();

  for (const batch of chunk(companyIds, BATCH_SIZE)) {
    try {
      const resp = await hubspotClient.crm.associations.batchApi.read(
        "companies",
        "contacts",
        { inputs: batch.map(id => ({ id })) }
      );
      for (const result of resp.results || []) {
        const companyId = result._from?.id;
        if (!companyId) continue;
        const contactIds = (result.to || []).map((t: { id: string }) => t.id);
        map.set(companyId, contactIds);
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Company→contact association batch failed:", err);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Phase 1: Multi-Entity Search
// ---------------------------------------------------------------------------

/** Intermediate type — a single contact record from either contact or company search */
export interface RawSearchHit {
  type: "contact" | "company";
  id: string;          // contact ID
  companyId: string | null;
  street: string | null;
  zip: string | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Group raw search hits by canonical identity: Company ID + normalized address.
 * Deduplicates contacts by ID. Skips hits with no resolvable address.
 * Returns CustomerSummary[] with counts set to -1 (resolved lazily on detail).
 */
export function groupSearchHits(hits: RawSearchHit[]): CustomerSummary[] {
  // Deduplicate by contact ID
  const seen = new Set<string>();
  const unique: RawSearchHit[] = [];
  for (const hit of hits) {
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      unique.push(hit);
    }
  }

  // Group by canonical key
  const groups = new Map<string, {
    companyId: string | null;
    companyName: string | null;
    address: string;  // formatted display address (original casing)
    contactIds: string[];
    contacts: Array<{ lastName: string | null }>;
  }>();

  for (const hit of unique) {
    const normalizedAddr = normalizeAddress(hit.street, hit.zip);
    if (!normalizedAddr) continue;

    const groupKey = hit.companyId
      ? `company:${hit.companyId}:${normalizedAddr}`
      : `addr:${normalizedAddr}`;

    const existing = groups.get(groupKey);
    if (existing) {
      if (!existing.contactIds.includes(hit.id)) {
        existing.contactIds.push(hit.id);
        existing.contacts.push({ lastName: hit.lastName });
      }
    } else {
      // Build display address from original values
      const displayAddress = [hit.street, hit.zip].filter(Boolean).join(", ").trim();
      groups.set(groupKey, {
        companyId: hit.companyId,
        companyName: hit.companyName,
        address: displayAddress,
        contactIds: [hit.id],
        contacts: [{ lastName: hit.lastName }],
      });
    }
  }

  // Convert to CustomerSummary[]
  const results: CustomerSummary[] = [];
  for (const [groupKey, group] of groups) {
    results.push({
      groupKey,
      displayName: deriveDisplayName(group.companyName, group.contacts, group.address),
      address: group.address,
      contactIds: group.contactIds,
      companyId: group.companyId,
      dealCount: -1,
      ticketCount: -1,
      jobCount: -1,
    });
  }

  return results;
}

/**
 * Execute Phase 1: search both contacts and companies in HubSpot.
 * Returns raw hits + truncated flag.
 */
export async function executeSearch(query: string): Promise<{ hits: RawSearchHit[]; truncated: boolean }> {
  const hits: RawSearchHit[] = [];
  let truncated = false;

  // Search contacts and companies in parallel
  const [contactResults, companyResults] = await Promise.allSettled([
    searchContactsWithRetry({
      filterGroups: [{
        filters: [
          { propertyName: "firstname", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "lastname", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "email", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "phone", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }],
      properties: ["firstname", "lastname", "email", "phone", "address", "city", "state", "zip"],
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
    searchCompaniesWithRetry({
      filterGroups: [{
        filters: [
          { propertyName: "name", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }, {
        filters: [
          { propertyName: "address", operator: "CONTAINS_TOKEN" as unknown as "EQ", value: `*${query}*` },
        ],
      }],
      properties: ["name", "address", "city", "state", "zip"],
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
  ]);

  // Process contact results
  if (contactResults.status === "fulfilled") {
    const res = contactResults.value;
    if (res.paging?.next?.after) truncated = true;

    for (const c of res.results || []) {
      hits.push({
        type: "contact",
        id: c.id,
        companyId: null, // resolved in Phase 2
        street: c.properties?.address || null,
        zip: c.properties?.zip || null,
        companyName: null, // resolved in Phase 2
        firstName: c.properties?.firstname || null,
        lastName: c.properties?.lastname || null,
        email: c.properties?.email || null,
        phone: c.properties?.phone || null,
      });
    }
  } else {
    Sentry.captureException(contactResults.reason);
    console.error("[CustomerResolver] Contact search failed:", contactResults.reason);
  }

  // Process company results — need to resolve company → contacts
  if (companyResults.status === "fulfilled") {
    const res = companyResults.value;
    if (res.paging?.next?.after) truncated = true;

    // Batch-fetch contacts for each matched company
    const companyIds = res.results?.map(c => c.id) || [];
    if (companyIds.length > 0) {
      try {
        const companyContactMap = await resolveCompanyContacts(companyIds);

        for (const company of res.results || []) {
          const contactIds = companyContactMap.get(company.id) || [];
          if (contactIds.length > 0) {
            for (const batch of chunk(contactIds, BATCH_SIZE)) {
              const batchResp = await hubspotClient.crm.contacts.batchApi.read({
                inputs: batch.map(id => ({ id })),
                properties: ["firstname", "lastname", "email", "phone", "address", "zip"],
                propertiesWithHistory: [],
              });
              for (const contact of batchResp.results || []) {
                hits.push({
                  type: "company",
                  id: contact.id,
                  companyId: company.id,
                  street: contact.properties?.address || company.properties?.address || null,
                  zip: contact.properties?.zip || company.properties?.zip || null,
                  companyName: company.properties?.name || null,
                  firstName: contact.properties?.firstname || null,
                  lastName: contact.properties?.lastname || null,
                  email: contact.properties?.email || null,
                  phone: contact.properties?.phone || null,
                });
              }
            }
          }
        }
      } catch (err) {
        Sentry.captureException(err);
        console.error("[CustomerResolver] Company contact resolution failed:", err);
      }
    }
  } else {
    Sentry.captureException(companyResults.reason);
    console.error("[CustomerResolver] Company search failed:", companyResults.reason);
  }

  return { hits, truncated };
}

// ---------------------------------------------------------------------------
// Phase 2: Identity Grouping + Expansion
// ---------------------------------------------------------------------------

/**
 * Filter expanded contacts to only those whose resolved address matches
 * the group's normalized address key. This prevents multi-site companies
 * from over-merging unrelated properties.
 */
export function filterExpandedContactsByAddress(
  contacts: Array<{ id: string; street: string | null; zip: string | null }>,
  groupNormalizedAddr: string
): Array<{ id: string; street: string | null; zip: string | null }> {
  return contacts.filter(c => {
    const normalized = normalizeAddress(c.street, c.zip);
    return normalized === groupNormalizedAddr;
  });
}

/**
 * Expand customer groups by fetching all contacts for each company,
 * then filtering back to the matching address.
 * Mutates the groups array — adds new contactIds from expansion.
 */
export async function expandGroups(groups: CustomerSummary[]): Promise<void> {
  // Collect unique company IDs that need expansion
  const companyGroups = groups.filter(g => g.companyId);
  if (companyGroups.length === 0) return;

  const uniqueCompanyIds = [...new Set(companyGroups.map(g => g.companyId!))];
  const companyContactMap = await resolveCompanyContacts(uniqueCompanyIds);

  // For each company group, fetch expanded contacts and filter by address
  for (const group of companyGroups) {
    const allContactIds = companyContactMap.get(group.companyId!) || [];
    const newContactIds = allContactIds.filter(id => !group.contactIds.includes(id));

    if (newContactIds.length === 0) continue;

    // Batch-read contact properties to check addresses
    const matchedIds: string[] = [];
    for (const batch of chunk(newContactIds, BATCH_SIZE)) {
      try {
        const batchResp = await hubspotClient.crm.contacts.batchApi.read({
          inputs: batch.map(id => ({ id })),
          properties: ["firstname", "lastname", "email", "phone", "address", "zip"],
          propertiesWithHistory: [],
        });

        // Extract normalized address portion from groupKey
        const addrPart = group.groupKey.includes(":")
          ? group.groupKey.split(":").slice(2).join(":")
          : group.groupKey.replace("addr:", "");

        const filtered = filterExpandedContactsByAddress(
          (batchResp.results || []).map(c => ({
            id: c.id,
            street: c.properties?.address || null,
            zip: c.properties?.zip || null,
          })),
          addrPart
        );

        matchedIds.push(...filtered.map(c => c.id));
      } catch (err) {
        Sentry.captureException(err);
        console.error("[CustomerResolver] Expansion batch read failed:", err);
      }
    }

    // Add matched contacts to the group
    for (const id of matchedIds) {
      if (!group.contactIds.includes(id)) {
        group.contactIds.push(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Association Resolution (Detail only)
// ---------------------------------------------------------------------------
// (Implemented in Task 6)
