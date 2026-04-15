/**
 * Customer Resolver Module (v2)
 *
 * Contact-based lookup: search HubSpot contacts → select one → resolve
 * their deals, tickets, and Zuper jobs.
 *
 * Spec: docs/superpowers/specs/2026-03-17-customer-history-design.md
 */

import * as Sentry from "@sentry/nextjs";
import { hubspotClient } from "@/lib/hubspot";
import { chunk } from "@/lib/utils";
import { getCachedZuperJobsByDealIds, prisma } from "@/lib/db";
import { FilterOperatorEnum as ContactFilterOp } from "@hubspot/api-client/lib/codegen/crm/contacts";
import { FilterOperatorEnum as CompanyFilterOp } from "@hubspot/api-client/lib/codegen/crm/companies";
import { enrichServiceItems, type EnrichmentInput } from "@/lib/service-enrichment";
import { getZuperJobUrl } from "@/lib/external-links";
import {
  computeEquipmentSummary,
  createEmptySummary,
  dedupeContactLinksByProperty,
  mapCacheRowToPropertyDetail,
  normalizeOwnershipLabel,
  type PropertyDetail,
} from "@/lib/property-detail";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 100;
const MAX_SEARCH_RESULTS = 25;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContactSearchResult {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  companyName: string | null;
}

export interface SearchResult {
  results: ContactSearchResult[];
  truncated: boolean;
}

export interface ContactDeal {
  id: string;
  name: string;
  stage: string;
  pipeline: string;
  amount: string | null;
  location: string | null;
  closeDate: string | null;
  lastModified: string;
  serviceType?: string | null;
  lastContactDate?: string | null;
  daysInStage?: number | null;
  lineItems?: Array<{ name: string; quantity: number; category: string | null; unitPrice: number | null }> | null;
  hubspotUrl?: string | null;
}

export interface ContactTicket {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  createDate: string;
  lastModified: string;
  serviceType?: string | null;
  daysInStage?: number | null;
}

export interface ContactJob {
  uid: string;
  title: string;
  category: string | null;
  status: string | null;
  scheduledDate: string | null;
  createdAt: string | null;
  assignedUsers?: string[];
  completedDate?: string | null;
  zuperUrl?: string | null;
}

export interface ContactDetail {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  companyName: string | null;
  deals: ContactDeal[];
  tickets: ContactTicket[];
  jobs: ContactJob[];
  properties: PropertyDetail[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a formatted address string from contact properties.
 */
function formatContactAddress(props: Record<string, string | null> | undefined): string | null {
  if (!props) return null;
  const parts = [props.address, props.city, props.state, props.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Retry Wrappers
// ---------------------------------------------------------------------------

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
// Contact Search Properties
// ---------------------------------------------------------------------------

const CONTACT_SEARCH_PROPERTIES = [
  "firstname", "lastname", "email", "phone",
  "address", "city", "state", "zip", "company",
];

const COMPANY_SEARCH_PROPERTIES = ["name", "address"];

// ---------------------------------------------------------------------------
// Public API: searchContacts
// ---------------------------------------------------------------------------

/**
 * Search for contacts by query string.
 * Searches both HubSpot contacts (by name, email, phone, address) and
 * companies (by name, address) — company hits are resolved to their contacts.
 * Returns deduped contacts up to MAX_SEARCH_RESULTS.
 */
export async function searchContacts(query: string): Promise<SearchResult> {
  const contactMap = new Map<string, ContactSearchResult>();
  let truncated = false;

  // Search contacts and companies in parallel
  const [contactResults, companyResults] = await Promise.allSettled([
    searchContactsWithRetry({
      filterGroups: [
        { filters: [{ propertyName: "firstname", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "lastname", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "email", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "phone", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "address", operator: ContactFilterOp.ContainsToken, value: `*${query}*` }] },
      ],
      properties: CONTACT_SEARCH_PROPERTIES,
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
    searchCompaniesWithRetry({
      filterGroups: [
        { filters: [{ propertyName: "name", operator: CompanyFilterOp.ContainsToken, value: `*${query}*` }] },
        { filters: [{ propertyName: "address", operator: CompanyFilterOp.ContainsToken, value: `*${query}*` }] },
      ],
      properties: COMPANY_SEARCH_PROPERTIES,
      limit: MAX_SEARCH_RESULTS,
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }] as unknown as string[],
      after: "0",
    }),
  ]);

  // Process direct contact results
  if (contactResults.status === "fulfilled") {
    const res = contactResults.value;
    if (res.paging?.next?.after) truncated = true;

    for (const c of res.results || []) {
      contactMap.set(c.id, {
        contactId: c.id,
        firstName: c.properties?.firstname || null,
        lastName: c.properties?.lastname || null,
        email: c.properties?.email || null,
        phone: c.properties?.phone || null,
        address: formatContactAddress(c.properties),
        companyName: c.properties?.company || null,
      });
    }
  } else {
    Sentry.captureException(contactResults.reason);
    console.error("[CustomerResolver] Contact search failed:", contactResults.reason);
  }

  // Process company results — resolve to contacts
  if (companyResults.status === "fulfilled") {
    const res = companyResults.value;
    if (res.paging?.next?.after) truncated = true;

    const companyIds = res.results?.map(c => c.id) || [];
    if (companyIds.length > 0) {
      try {
        const companyContactMap = await resolveCompanyContacts(companyIds);

        for (const company of res.results || []) {
          const contactIds = companyContactMap.get(company.id) || [];
          if (contactIds.length === 0) continue;

          // Batch-read contact properties for company-sourced contacts
          for (const batch of chunk(contactIds, BATCH_SIZE)) {
            try {
              const batchResp = await hubspotClient.crm.contacts.batchApi.read({
                inputs: batch.map(id => ({ id })),
                properties: CONTACT_SEARCH_PROPERTIES,
                propertiesWithHistory: [],
              });
              for (const contact of batchResp.results || []) {
                if (!contactMap.has(contact.id)) {
                  contactMap.set(contact.id, {
                    contactId: contact.id,
                    firstName: contact.properties?.firstname || null,
                    lastName: contact.properties?.lastname || null,
                    email: contact.properties?.email || null,
                    phone: contact.properties?.phone || null,
                    address: formatContactAddress(contact.properties),
                    // Prefer company name from the matched company, fall back to contact's company property
                    companyName: company.properties?.name || contact.properties?.company || null,
                  });
                }
              }
            } catch (err) {
              Sentry.captureException(err);
              console.error("[CustomerResolver] Company contact batch read failed:", err);
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

  // Convert to array, cap at MAX_SEARCH_RESULTS
  const results = Array.from(contactMap.values()).slice(0, MAX_SEARCH_RESULTS);

  return {
    results,
    truncated: truncated || contactMap.size > MAX_SEARCH_RESULTS,
  };
}

// ---------------------------------------------------------------------------
// Public API: resolveContactDetail
// ---------------------------------------------------------------------------

/**
 * Resolve full detail for a single contact: contact info, deals, tickets,
 * Zuper jobs, and linked Properties (HubSpot Property custom objects).
 *
 * Properties are surfaced from `PropertyContactLink` — all cache rows this
 * contact is linked to, most-recently-associated first, each carrying the
 * per-link `ownershipLabel` + `associatedAt`. The fetch is non-blocking: if
 * the Property lookup or any per-property equipment summary fails, the
 * customer view still renders with `properties` defaulting to an empty array.
 */
export async function resolveContactDetail(contactId: string): Promise<ContactDetail> {
  // 1. Batch-read contact properties
  let contactProps: Record<string, string | null> = {};
  try {
    const batchResp = await hubspotClient.crm.contacts.batchApi.read({
      inputs: [{ id: contactId }],
      properties: CONTACT_SEARCH_PROPERTIES,
      propertiesWithHistory: [],
    });
    const contact = batchResp.results?.[0];
    if (contact?.properties) {
      contactProps = contact.properties as Record<string, string | null>;
    }
  } catch (err) {
    Sentry.captureException(err);
    console.error("[CustomerResolver] Contact batch read failed:", err);
  }

  // 2. Resolve contact → deal associations
  const dealIdSet = new Set<string>();
  try {
    const resp = await hubspotClient.crm.associations.batchApi.read(
      "contacts",
      "deals",
      { inputs: [{ id: contactId }] }
    );
    for (const result of resp.results || []) {
      for (const to of (result.to || []) as Array<{ id: string }>) {
        dealIdSet.add(to.id);
      }
    }
  } catch (err) {
    Sentry.captureException(err);
    console.error("[CustomerResolver] Contact→deal association failed:", err);
  }

  // 3. Resolve contact → ticket associations
  const ticketIdSet = new Set<string>();
  try {
    const resp = await hubspotClient.crm.associations.batchApi.read(
      "contacts",
      "tickets",
      { inputs: [{ id: contactId }] }
    );
    for (const result of resp.results || []) {
      for (const to of (result.to || []) as Array<{ id: string }>) {
        ticketIdSet.add(to.id);
      }
    }
  } catch (err) {
    Sentry.captureException(err);
    console.error("[CustomerResolver] Contact→ticket association failed:", err);
  }

  // 3b. Resolve contact → company association for company name
  // The contact's own `company` property may be blank even when associated.
  let resolvedCompanyName: string | null = contactProps.company || null;
  if (!resolvedCompanyName) {
    try {
      const resp = await hubspotClient.crm.associations.batchApi.read(
        "contacts",
        "companies",
        { inputs: [{ id: contactId }] }
      );
      const companyIds: string[] = [];
      for (const result of resp.results || []) {
        for (const to of (result.to || []) as Array<{ id: string }>) {
          companyIds.push(to.id);
        }
      }
      if (companyIds.length > 0) {
        const companyResp = await hubspotClient.crm.companies.batchApi.read({
          inputs: [{ id: companyIds[0] }],
          properties: ["name"],
          propertiesWithHistory: [],
        });
        resolvedCompanyName = companyResp.results?.[0]?.properties?.name || null;
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Contact→company association failed:", err);
    }
  }

  // 4. Batch-read deal properties
  const deals: ContactDeal[] = [];
  const rawDealProps = new Map<string, Record<string, string | null>>();
  const dealIds = Array.from(dealIdSet);
  for (const batch of chunk(dealIds, BATCH_SIZE)) {
    try {
      const batchResp = await hubspotClient.crm.deals.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: [
          "dealname", "dealstage", "pipeline", "amount",
          "pb_location", "closedate", "hs_lastmodifieddate",
          "service_type", "notes_last_contacted",
        ],
        propertiesWithHistory: [],
      });
      for (const d of batchResp.results || []) {
        rawDealProps.set(d.id, d.properties as Record<string, string | null>);
        deals.push({
          id: d.id,
          name: d.properties?.dealname || "Untitled Deal",
          stage: d.properties?.dealstage || "unknown",
          pipeline: d.properties?.pipeline || "unknown",
          amount: d.properties?.amount || null,
          location: d.properties?.pb_location || null,
          closeDate: d.properties?.closedate || null,
          lastModified: d.properties?.hs_lastmodifieddate || "",
        });
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Deal batch read failed:", err);
    }
  }

  // Sort deals by lastModified descending
  deals.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // Enrich deals with contact-level activity, line items
  if (deals.length > 0) {
    try {
      const dealEnrichInputs: EnrichmentInput[] = deals.map(d => ({
        itemId: d.id,
        itemType: "deal" as const,
        contactIds: [contactId],
        serviceType: rawDealProps.get(d.id)?.service_type ?? null,
        dealLastContacted: rawDealProps.get(d.id)?.notes_last_contacted ?? null,
      }));

      const dealEnrichments = await enrichServiceItems(dealEnrichInputs, {
        includeLineItems: true,
        includeZuperJobs: false,
      });

      for (const deal of deals) {
        const e = dealEnrichments.get(deal.id);
        if (e) {
          deal.serviceType = e.serviceType ?? null;
          deal.lastContactDate = e.lastContactDate ?? null;
          deal.lineItems = e.lineItems ?? null;
        }
        deal.daysInStage = deal.lastModified
          ? Math.floor((Date.now() - new Date(deal.lastModified).getTime()) / 86400000)
          : null;
        deal.hubspotUrl = `https://app.hubspot.com/contacts/${process.env.HUBSPOT_PORTAL_ID || ""}/deal/${deal.id}`;
      }
    } catch (err) {
      console.warn("[CustomerResolver] Deal enrichment failed:", err);
      // Non-blocking — deals will have null enrichment fields
    }
  }

  // 5. Batch-read ticket properties
  const tickets: ContactTicket[] = [];
  const rawTicketProps = new Map<string, Record<string, string | null>>();
  const ticketIds = Array.from(ticketIdSet);
  for (const batch of chunk(ticketIds, BATCH_SIZE)) {
    try {
      const batchResp = await hubspotClient.crm.tickets.batchApi.read({
        inputs: batch.map(id => ({ id })),
        properties: [
          "subject", "hs_pipeline_stage", "hs_ticket_priority",
          "createdate", "hs_lastmodifieddate",
          "service_type", "notes_last_contacted",
        ],
        propertiesWithHistory: [],
      });
      for (const t of batchResp.results || []) {
        rawTicketProps.set(t.id, t.properties as Record<string, string | null>);
        tickets.push({
          id: t.id,
          subject: t.properties?.subject || "Untitled Ticket",
          status: t.properties?.hs_pipeline_stage || "unknown",
          priority: t.properties?.hs_ticket_priority || null,
          createDate: t.properties?.createdate || "",
          lastModified: t.properties?.hs_lastmodifieddate || "",
        });
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Ticket batch read failed:", err);
    }
  }

  // Sort tickets by lastModified descending
  tickets.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

  // Enrich tickets with service type
  if (tickets.length > 0) {
    try {
      const ticketEnrichInputs: EnrichmentInput[] = tickets.map(t => ({
        itemId: t.id,
        itemType: "ticket" as const,
        contactIds: [contactId],
        serviceType: rawTicketProps.get(t.id)?.service_type ?? null,
        ticketLastContacted: rawTicketProps.get(t.id)?.notes_last_contacted ?? null,
      }));

      const ticketEnrichments = await enrichServiceItems(ticketEnrichInputs);

      for (const ticket of tickets) {
        const e = ticketEnrichments.get(ticket.id);
        if (e) {
          ticket.serviceType = e.serviceType ?? null;
        }
        ticket.daysInStage = ticket.lastModified
          ? Math.floor((Date.now() - new Date(ticket.lastModified).getTime()) / 86400000)
          : null;
      }
    } catch (err) {
      console.warn("[CustomerResolver] Ticket enrichment failed:", err);
    }
  }

  // 6. Zuper jobs via two paths
  const jobMap = new Map<string, ContactJob>();

  // 6a. Deal-linked jobs
  if (dealIds.length > 0) {
    try {
      const zuperJobs = await getCachedZuperJobsByDealIds(dealIds);
      for (const j of zuperJobs || []) {
        jobMap.set(j.jobUid, {
          uid: j.jobUid,
          title: j.jobTitle || "Untitled Job",
          category: j.jobCategory || null,
          status: j.jobStatus || null,
          scheduledDate: j.scheduledStart?.toISOString() || null,
          createdAt: j.lastSyncedAt?.toISOString() || null,
          assignedUsers: Array.isArray(j.assignedUsers)
            ? (j.assignedUsers as Array<{ user_name?: string }>).map(u => u.user_name || "Unknown")
            : [],
          completedDate: j.completedDate?.toISOString() ?? null,
          zuperUrl: getZuperJobUrl(j.jobUid) ?? `https://app.zuper.co/app/job/${j.jobUid}`,
        });
      }
    } catch (err) {
      Sentry.captureException(err);
      console.error("[CustomerResolver] Zuper deal-linked job lookup failed:", err);
    }
  }

  // 6b. Name/address heuristic — only when deal-linked path found nothing.
  // This catches jobs not linked via deal ID (e.g., jobs created before sync).
  // To avoid false positives, require both name AND address when both are available.
  if (jobMap.size === 0) {
    const fullName = [contactProps.firstname, contactProps.lastname].filter(Boolean).join(" ").trim();
    const contactAddress = contactProps.address?.trim() || "";

    // Build WHERE conditions: AND when both available, single-field only as last resort
    let whereClause: Record<string, unknown> | null = null;

    if (fullName && contactAddress) {
      // Both available — require both to match (tightest filter)
      whereClause = {
        AND: [
          { projectName: { contains: fullName, mode: "insensitive" } },
          { customerAddress: { path: ["street"], string_contains: contactAddress } },
        ],
      };
    } else if (fullName) {
      // Name only — use it alone (last resort)
      whereClause = { projectName: { contains: fullName, mode: "insensitive" } };
    } else if (contactAddress) {
      // Address only — use it alone (last resort)
      whereClause = {
        customerAddress: { path: ["street"], string_contains: contactAddress },
      };
    }

    if (whereClause) {
      try {
        const nameAddressJobs = await prisma.zuperJobCache.findMany({
          where: whereClause,
        });
        for (const j of nameAddressJobs) {
          if (!jobMap.has(j.jobUid)) {
            jobMap.set(j.jobUid, {
              uid: j.jobUid,
              title: j.jobTitle || "Untitled Job",
              category: j.jobCategory || null,
              status: j.jobStatus || null,
              scheduledDate: j.scheduledStart?.toISOString() || null,
              createdAt: j.lastSyncedAt?.toISOString() || null,
              assignedUsers: Array.isArray(j.assignedUsers)
                ? (j.assignedUsers as Array<{ user_name?: string }>).map(u => u.user_name || "Unknown")
                : [],
              completedDate: j.completedDate?.toISOString() ?? null,
              zuperUrl: getZuperJobUrl(j.jobUid) ?? `https://app.zuper.co/app/job/${j.jobUid}`,
            });
          }
        }
      } catch (err) {
        Sentry.captureException(err);
        console.error("[CustomerResolver] Zuper name/address job lookup failed:", err);
      }
    }
  }

  // Sort jobs by scheduledDate descending, fallback to createdAt
  const jobs = Array.from(jobMap.values());
  jobs.sort((a, b) => {
    const dateA = a.scheduledDate || a.createdAt || "";
    const dateB = b.scheduledDate || b.createdAt || "";
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  // 7. Properties — surface all Property cache rows the contact is linked to,
  //    most-recently-associated first. Equipment summary fetched live per property.
  const properties: PropertyDetail[] = [];
  try {
    const rawPropertyLinks = await prisma.propertyContactLink.findMany({
      where: { contactId },
      include: {
        property: {
          include: {
            dealLinks: true,
            ticketLinks: true,
            contactLinks: true,
          },
        },
      },
      orderBy: { associatedAt: "desc" },
    });

    // A contact can be linked to the same property under multiple labels
    // (Current Owner + Authorized Contact, etc.). Surface one card per
    // property with the highest-precedence label.
    const propertyLinks = dedupeContactLinksByProperty(rawPropertyLinks);

    for (const link of propertyLinks) {
      const base = mapCacheRowToPropertyDetail(link.property, {
        ownershipLabel: normalizeOwnershipLabel(link.label),
        associatedAt: link.associatedAt,
      });
      let equipmentSummary;
      try {
        equipmentSummary = await computeEquipmentSummary(base.dealIds);
      } catch (err) {
        console.error("[CustomerResolver] Property equipment fetch failed:", err);
        equipmentSummary = createEmptySummary();
      }
      properties.push({ ...base, equipmentSummary });
    }
  } catch (err) {
    Sentry.captureException(err);
    console.error("[CustomerResolver] Property fetch failed:", err);
  }

  return {
    contactId,
    firstName: contactProps.firstname || null,
    lastName: contactProps.lastname || null,
    email: contactProps.email || null,
    phone: contactProps.phone || null,
    address: formatContactAddress(contactProps),
    companyName: resolvedCompanyName,
    deals,
    tickets,
    jobs,
    properties,
  };
}
