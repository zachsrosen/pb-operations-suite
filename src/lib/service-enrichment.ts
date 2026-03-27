// ---------------------------------------------------------------------------
// Canonical enrichment types — shared across all service API routes
// ---------------------------------------------------------------------------

import { hubspotClient } from "@/lib/hubspot";
import { getCachedZuperJobsByDealIds } from "@/lib/db";
import { chunk } from "@/lib/utils";
import { getZuperJobUrl } from "@/lib/external-links";

export interface ServiceEnrichment {
  serviceType: string | null;
  lastContactDate: string | null;
  lastContactSource: "contact" | "deal" | "ticket" | null;
  lineItems: ServiceLineItem[] | null;
  zuperJobs: ServiceZuperJob[] | null;
}

export interface ServiceLineItem {
  name: string;
  quantity: number;
  category: string | null;
  unitPrice: number | null;
}

export interface ServiceZuperJob {
  jobUid: string;
  title: string;
  category: string;
  status: string;
  assignedUsers: string[];
  scheduledDate: string | null;
  completedDate: string | null;
  zuperUrl: string;
}

export type ReasonCategory =
  | "no_contact"
  | "warranty_expiring"
  | "stuck_in_stage"
  | "high_value"
  | "stage_urgency";

export const ALL_REASON_CATEGORIES: ReasonCategory[] = [
  "no_contact",
  "warranty_expiring",
  "stuck_in_stage",
  "high_value",
  "stage_urgency",
];

export interface EnrichmentInput {
  itemId: string;
  itemType: "deal" | "ticket";
  contactIds: string[];
  /** Raw service_type from HubSpot (already fetched by the calling route) */
  serviceType?: string | null;
  /** For tickets: the ticket-level notes_last_contacted as fallback */
  ticketLastContacted?: string | null;
  /** For deals: the deal-level notes_last_contacted as fallback */
  dealLastContacted?: string | null;
}

export interface EnrichmentOptions {
  includeLineItems?: boolean;
  includeZuperJobs?: boolean;
}

/**
 * Pure function: resolve the best "last contact" timestamp from available sources.
 * Priority: contact-level > deal-level > ticket-level > null
 */
export function resolveLastContact(
  contactTimestamps: Record<string, string | null | undefined>,
  contactIds: string[],
  dealFallback: string | null | undefined,
  ticketFallback?: string | null | undefined,
): { lastContactDate: string | null; lastContactSource: "contact" | "deal" | "ticket" | null } {
  // 1. Try contact-level timestamps — pick most recent
  let best: string | null = null;
  for (const cid of contactIds) {
    const ts = contactTimestamps[cid];
    if (ts && (!best || ts > best)) best = ts;
  }
  if (best) return { lastContactDate: best, lastContactSource: "contact" };

  // 2. Deal-level fallback
  if (dealFallback) return { lastContactDate: dealFallback, lastContactSource: "deal" };

  // 3. Ticket-level fallback
  if (ticketFallback) return { lastContactDate: ticketFallback, lastContactSource: "ticket" };

  return { lastContactDate: null, lastContactSource: null };
}

const HUBSPOT_BATCH_LIMIT = 100;

/**
 * Batch-enrich service items with contact activity, line items, and Zuper jobs.
 * Each API route calls this once for its full result set. Failures are non-blocking.
 */
export async function enrichServiceItems(
  items: EnrichmentInput[],
  options: EnrichmentOptions = {},
): Promise<Map<string, ServiceEnrichment>> {
  const result = new Map<string, ServiceEnrichment>();
  if (items.length === 0) return result;

  const { includeLineItems = false, includeZuperJobs = false } = options;

  // Collect unique contact IDs and deal IDs for batch operations
  const allContactIds = [...new Set(items.flatMap(i => i.contactIds))];
  const dealItems = items.filter(i => i.itemType === "deal");
  const dealIds = dealItems.map(i => i.itemId);

  // 1. Batch-read contact timestamps
  const contactTimestamps: Record<string, string | null> = {};
  if (allContactIds.length > 0) {
    try {
      for (const batch of chunk(allContactIds, HUBSPOT_BATCH_LIMIT)) {
        const response = await hubspotClient.crm.contacts.batchApi.read({
          inputs: batch.map(id => ({ id })),
          properties: ["hs_last_sales_activity_timestamp"],
          propertiesWithHistory: [],
        } as any);
        for (const contact of response.results || []) {
          contactTimestamps[contact.id] =
            contact.properties?.hs_last_sales_activity_timestamp ?? null;
        }
      }
    } catch (err) {
      console.warn("[ServiceEnrichment] Contact timestamp batch read failed:", err);
    }
  }

  // 2. Batch-read line items (deals only)
  const dealLineItems = new Map<string, ServiceLineItem[]>();
  if (includeLineItems && dealIds.length > 0) {
    try {
      // Get deal→line-item associations
      const lineItemIdsByDeal = new Map<string, string[]>();
      const allLineItemIds: string[] = [];
      for (const batch of chunk(dealIds, HUBSPOT_BATCH_LIMIT)) {
        const assocResponse = await hubspotClient.crm.associations.batchApi.read(
          "deals", "line_items",
          { inputs: batch.map(id => ({ id })) } as any,
        );

        for (const r of assocResponse.results || []) {
          const fromId = r._from?.id;
          const ids = (r.to || []).map((t: { id: string }) => t.id);
          if (fromId && ids.length > 0) {
            lineItemIdsByDeal.set(fromId, ids);
            allLineItemIds.push(...ids);
          }
        }
      }

      // Batch read line item properties
      if (allLineItemIds.length > 0) {
        const liProps = new Map<string, { name: string; qty: number; category: string | null; price: number | null }>();
        for (const liBatch of chunk(allLineItemIds, HUBSPOT_BATCH_LIMIT)) {
          const liResponse = await hubspotClient.crm.lineItems.batchApi.read({
            inputs: liBatch.map(id => ({ id })),
            properties: ["name", "quantity", "price", "hs_product_id", "description"],
            propertiesWithHistory: [],
          } as any);
          for (const li of liResponse.results || []) {
            liProps.set(li.id, {
              name: li.properties?.name || li.properties?.description || "Unknown",
              qty: parseFloat(li.properties?.quantity || "1") || 1,
              category: null, // Could look up InternalProduct, but deferred for perf
              price: li.properties?.price ? parseFloat(li.properties.price) : null,
            });
          }
        }

        // Assemble per-deal line items
        for (const [dealId, liIds] of lineItemIdsByDeal) {
          const lineItemsForDeal: ServiceLineItem[] = [];
          for (const liId of liIds) {
            const p = liProps.get(liId);
            if (p) lineItemsForDeal.push({ name: p.name, quantity: p.qty, category: p.category, unitPrice: p.price });
          }
          if (lineItemsForDeal.length > 0) dealLineItems.set(dealId, lineItemsForDeal);
        }
      }
    } catch (err) {
      console.warn("[ServiceEnrichment] Line item batch read failed:", err);
    }
  }

  // 3. Batch-read Zuper jobs
  const dealZuperJobs = new Map<string, ServiceZuperJob[]>();
  if (includeZuperJobs && dealIds.length > 0) {
    try {
      const cachedJobs = await getCachedZuperJobsByDealIds(dealIds);
      for (const j of cachedJobs) {
        const dealId = j.hubspotDealId;
        if (!dealId) continue;
        const job: ServiceZuperJob = {
          jobUid: j.jobUid,
          title: j.jobTitle || "Untitled Job",
          category: j.jobCategory || "Unknown",
          status: j.jobStatus || "Unknown",
          assignedUsers: Array.isArray(j.assignedUsers)
            ? (j.assignedUsers as Array<{ user_name?: string }>).map(u => u.user_name || "Unknown")
            : [],
          scheduledDate: j.scheduledStart?.toISOString() ?? null,
          completedDate: j.completedDate?.toISOString() ?? null,
          zuperUrl: getZuperJobUrl(j.jobUid) ?? `https://app.zuper.co/app/job/${j.jobUid}`,
        };
        const existing = dealZuperJobs.get(dealId) || [];
        existing.push(job);
        dealZuperJobs.set(dealId, existing);
      }
    } catch (err) {
      console.warn("[ServiceEnrichment] Zuper job cache lookup failed:", err);
    }
  }

  // 4. Assemble per-item enrichment
  for (const item of items) {
    const { lastContactDate, lastContactSource } = resolveLastContact(
      contactTimestamps,
      item.contactIds,
      item.dealLastContacted,
      item.ticketLastContacted,
    );

    result.set(item.itemId, {
      serviceType: item.serviceType ?? null,
      lastContactDate,
      lastContactSource,
      lineItems: dealLineItems.get(item.itemId) ?? null,
      zuperJobs: dealZuperJobs.get(item.itemId) ?? null,
    });
  }

  return result;
}
