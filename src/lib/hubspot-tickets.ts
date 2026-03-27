/**
 * HubSpot Tickets API Client
 *
 * Parallel to hubspot.ts (deals), this module handles ticket search,
 * detail fetching, updates, and association resolution.
 *
 * Namespaced under "service-tickets" to avoid collision with
 * /api/admin/tickets (Prisma BugReport system).
 */

import * as Sentry from "@sentry/nextjs";
import { hubspotClient } from "@/lib/hubspot";
import type { PriorityItem } from "@/lib/service-priority";
import { chunk } from "@/lib/utils";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/tickets";
import {
  FilterOperatorEnum as NotesFilterOperatorEnum,
  AssociationSpecAssociationCategoryEnum,
} from "@hubspot/api-client/lib/codegen/crm/objects/notes";
import { FilterOperatorEnum as EmailsFilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/objects/emails";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** HubSpot batch API limit — matches BATCH_SIZE in hubspot.ts */
const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HubSpotTicket {
  id: string;
  properties: Record<string, string | undefined>;
  /** Derived from associated deal — populated by fetchServiceTickets() */
  _derivedLocation?: string | null;
}

/** Extends PriorityItem with ticket-specific display fields for the Ticket Board */
export interface EnrichedTicketItem extends PriorityItem {
  priority: string | null;   // HubSpot hs_ticket_priority (HIGH/MEDIUM/LOW/NONE)
  ownerId: string | null;
}

export interface TimelineEntry {
  type: "note" | "email" | "call" | "meeting" | "task";
  timestamp: string;
  body: string;
  createdBy?: string | null;
}

export interface TicketDetail {
  id: string;
  subject: string;
  content: string;
  priority: string;
  stage: string;
  stageName: string;
  pipeline: string;
  createDate: string;
  lastModified: string;
  lastContactDate: string | null;
  ownerId: string | null;
  location: string | null;
  url: string;
  associations: {
    contacts: Array<{ id: string; name: string; email: string }>;
    deals: Array<{
      id: string;
      name: string;
      amount: string | null;
      location: string | null;
      url: string;
      lineItems?: Array<{ name: string; quantity: number; category: string | null; unitPrice: number | null }> | null;
      serviceType?: string | null;
    }>;
    companies: Array<{ id: string; name: string }>;
  };
  timeline: TimelineEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Service ticket pipeline ID — set via env var, discovered from HubSpot */
const SERVICE_TICKET_PIPELINE_ID = process.env.HUBSPOT_SERVICE_TICKET_PIPELINE_ID || "0";

const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "";

const TICKET_PROPERTIES = [
  "hs_object_id",
  "subject",
  "content",
  "hs_pipeline",
  "hs_pipeline_stage",
  "hs_ticket_priority",
  "createdate",
  "hs_lastmodifieddate",
  "notes_last_contacted",
  "hubspot_owner_id",
  "service_type",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search tickets with rate-limit retry (mirrors searchWithRetry in hubspot.ts)
 */
export async function searchTicketsWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.tickets.searchApi.doSearch>[0],
  maxRetries = 5
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.tickets.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;

      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        const base = Math.pow(2, attempt) * 1100;
        const jitter = Math.random() * 400;
        const delay = Math.round(base + jitter);
        Sentry.addBreadcrumb({
          category: "hubspot-tickets",
          message: `Rate limited, retry ${attempt + 1}/${maxRetries}`,
          level: "warning",
          data: { delay, attempt },
        });
        await sleep(delay);
        continue;
      }
      Sentry.addBreadcrumb({
        category: "hubspot-tickets",
        message: "Ticket search failed after retries",
        level: "error",
        data: { attempt, statusCode },
      });
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Transform a HubSpot ticket into the PriorityItem shape used by the scoring engine.
 * Pure function — safe to unit test.
 */
export function transformTicketToPriorityItem(
  ticket: HubSpotTicket,
  stageMap: Record<string, string>
): EnrichedTicketItem {
  const props = ticket.properties;
  const stageId = props.hs_pipeline_stage ?? "";

  return {
    id: props.hs_object_id || ticket.id,
    type: "ticket",
    title: props.subject || "Untitled Ticket",
    stage: stageMap[stageId] || stageId || "Unknown",
    lastModified: props.hs_lastmodifieddate || props.createdate || new Date().toISOString(),
    lastContactDate: props.notes_last_contacted || null,
    createDate: props.createdate || new Date().toISOString(),
    amount: null, // Tickets don't have amounts
    location: ticket._derivedLocation || null,
    url: `https://app.hubspot.com/contacts/${PORTAL_ID}/ticket/${ticket.id}`,
    priority: props.hs_ticket_priority || null,
    ownerId: props.hubspot_owner_id || null,
    serviceType: props.service_type || null,
  };
}

// ---------------------------------------------------------------------------
// Fetch functions
// ---------------------------------------------------------------------------

/**
 * Discover ticket pipeline stages from HubSpot.
 * Returns a map of stageId → stageName.
 */
export interface TicketStageMapResult {
  map: Record<string, string>;        // stageId → stageName
  orderedStageIds: string[];           // stage IDs in HubSpot pipeline display order
}

let cachedStageResult: TicketStageMapResult | null = null;
let stageMapFetchedAt = 0;
const STAGE_MAP_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Discover ticket pipeline stages from HubSpot.
 * Returns both a map (stageId → stageName) and an ordered array of stage IDs
 * sorted by HubSpot's displayOrder, so kanban columns match the real pipeline.
 */
export async function getTicketStageMap(): Promise<TicketStageMapResult> {
  if (cachedStageResult && Date.now() - stageMapFetchedAt < STAGE_MAP_TTL) return cachedStageResult;

  try {
    const response = await hubspotClient.crm.pipelines.pipelinesApi.getById(
      "tickets",
      SERVICE_TICKET_PIPELINE_ID
    );
    const map: Record<string, string> = {};
    const stages = (response.stages || []).sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)
    );
    const orderedStageIds: string[] = [];
    for (const stage of stages) {
      map[stage.id] = stage.label;
      orderedStageIds.push(stage.id);
    }
    cachedStageResult = { map, orderedStageIds };
    stageMapFetchedAt = Date.now();
    return cachedStageResult;
  } catch (error) {
    console.error("[HubSpotTickets] Failed to fetch pipeline stages:", error);
    return { map: {}, orderedStageIds: [] };
  }
}

/**
 * Fetch open service tickets from HubSpot.
 * Resolves ticket → deal associations to derive location (pb_location).
 */
export async function fetchServiceTickets(): Promise<EnrichedTicketItem[]> {
  try {
    const { map: stageMap } = await getTicketStageMap();

    // Get all closed/resolved stage IDs to EXCLUDE them server-side
    // Convention: stages whose label contains "Closed", "Done", "Resolved", or "Completed"
    const closedStageIds = Object.entries(stageMap)
      .filter(([, label]) => /closed|done|resolved|completed/i.test(label))
      .map(([id]) => id);

    // Paginate through open tickets only — exclude closed stages server-side
    // to avoid fetching thousands of historical tickets and filtering client-side
    let tickets: HubSpotTicket[] = [];
    let after: string | undefined;

    do {
      const filters: Array<Record<string, unknown>> = [
        {
          propertyName: "hs_pipeline",
          operator: FilterOperatorEnum.Eq,
          value: SERVICE_TICKET_PIPELINE_ID,
        },
      ];

      // Exclude closed stages server-side via NOT_IN filter
      if (closedStageIds.length > 0) {
        filters.push({
          propertyName: "hs_pipeline_stage",
          operator: "NOT_IN",
          values: closedStageIds,
        });
      }

      const searchRequest = {
        filterGroups: [{ filters }],
        properties: TICKET_PROPERTIES,
        limit: 100,
        ...(after ? { after } : {}),
      };

      const response = await searchTicketsWithRetry(searchRequest as Parameters<typeof searchTicketsWithRetry>[0]);
      const page = (response.results || []).map(t => ({
        id: t.id,
        properties: t.properties as Record<string, string | undefined>,
      }));
      tickets = tickets.concat(page);

      after = response.paging?.next?.after;
    } while (after);

    // Batch-resolve ticket → deal associations for location derivation
    const ticketIds = tickets.map(t => t.id);
    const locationMap = await resolveTicketLocations(ticketIds);

    // Attach derived locations and transform
    return tickets.map(ticket => {
      ticket._derivedLocation = locationMap.get(ticket.id) || null;
      return transformTicketToPriorityItem(ticket, stageMap);
    });
  } catch (error) {
    console.error("[HubSpotTickets] Error fetching service tickets:", error);
    return [];
  }
}

/**
 * Resolve ticket → deal associations to derive locations.
 * Ticket → associated deal → pb_location.
 * Falls back to company address if no deal association.
 */
async function resolveTicketLocations(
  ticketIds: string[]
): Promise<Map<string, string>> {
  const locationMap = new Map<string, string>();
  if (ticketIds.length === 0) return locationMap;

  try {
    // Batch read associations: tickets → deals (chunked at 100)
    const dealIdsByTicket = new Map<string, string[]>();
    const allDealIds = new Set<string>();

    for (const batch of chunk(ticketIds, BATCH_SIZE)) {
      const batchResponse = await hubspotClient.crm.associations.batchApi.read(
        "tickets",
        "deals",
        { inputs: batch.map(id => ({ id })) }
      );
      for (const result of batchResponse.results || []) {
        const ticketId = result._from?.id;
        if (!ticketId) continue;
        const dealIds = (result.to || []).map((t: { id: string }) => t.id);
        if (dealIds.length > 0) {
          dealIdsByTicket.set(ticketId, dealIds);
          dealIds.forEach((id: string) => allDealIds.add(id));
        }
      }
    }

    // Batch-fetch deal pb_location for all associated deals
    if (allDealIds.size > 0) {
      const dealLocations = new Map<string, string>();

      for (const batch of chunk(Array.from(allDealIds), BATCH_SIZE)) {
        const batchReadResponse = await hubspotClient.crm.deals.batchApi.read({
          inputs: batch.map(id => ({ id })),
          properties: ["pb_location"],
          propertiesWithHistory: [],
        });
        for (const deal of batchReadResponse.results || []) {
          const loc = deal.properties?.pb_location;
          if (loc) dealLocations.set(deal.id, loc);
        }
      }

      // Map ticket → first deal's location
      for (const [ticketId, dealIds] of dealIdsByTicket) {
        for (const dealId of dealIds) {
          const loc = dealLocations.get(dealId);
          if (loc) {
            locationMap.set(ticketId, loc);
            break;
          }
        }
      }
    }

    // Fallback: tickets without a deal-derived location → try company address
    const unresolved = ticketIds.filter(id => !locationMap.has(id));
    if (unresolved.length > 0) {
      try {
        const companyIds = new Set<string>();
        const companyByTicket = new Map<string, string>();

        for (const batch of chunk(unresolved, BATCH_SIZE)) {
          const companyBatch = await hubspotClient.crm.associations.batchApi.read(
            "tickets",
            "companies",
            { inputs: batch.map(id => ({ id })) }
          );
          for (const result of companyBatch.results || []) {
            const ticketId = result._from?.id;
            if (!ticketId) continue;
            const firstCompany = (result.to || [])[0];
            if (firstCompany) {
              companyByTicket.set(ticketId, firstCompany.id);
              companyIds.add(firstCompany.id);
            }
          }
        }

        if (companyIds.size > 0) {
          const companyLocations = new Map<string, string>();
          for (const batch of chunk(Array.from(companyIds), BATCH_SIZE)) {
            const companyRead = await hubspotClient.crm.companies.batchApi.read({
              inputs: batch.map(id => ({ id })),
              properties: ["city", "state"],
              propertiesWithHistory: [],
            });
            for (const co of companyRead.results || []) {
              const city = co.properties?.city;
              if (city) companyLocations.set(co.id, city);
            }
          }

          for (const [ticketId, companyId] of companyByTicket) {
            const loc = companyLocations.get(companyId);
            if (loc) locationMap.set(ticketId, loc);
          }
        }
      } catch (err) {
        console.warn("[HubSpotTickets] Company fallback location resolution failed:", err);
      }
    }
  } catch (error) {
    console.error("[HubSpotTickets] Error resolving ticket locations:", error);
  }

  return locationMap;
}

/**
 * Get a single ticket with full detail + associations.
 */
export async function getTicketDetail(ticketId: string): Promise<TicketDetail | null> {
  try {
    const { map: stageMap } = await getTicketStageMap();

    // Fetch ticket with associations
    const ticket = await hubspotClient.crm.tickets.basicApi.getById(
      ticketId,
      TICKET_PROPERTIES,
      undefined, // propertiesWithHistory
      ["contacts", "deals", "companies"]
    );

    const props = ticket.properties as Record<string, string | undefined>;
    const stageId = props.hs_pipeline_stage ?? "";

    // Resolve associated contacts
    const contactIds = (ticket.associations?.contacts?.results || []).map(
      (a: { id: string }) => a.id
    );
    const contacts: TicketDetail["associations"]["contacts"] = [];
    if (contactIds.length > 0) {
      const contactBatch = await hubspotClient.crm.contacts.batchApi.read({
        inputs: contactIds.map((id: string) => ({ id })),
        properties: ["firstname", "lastname", "email"],
        propertiesWithHistory: [],
      });
      for (const c of contactBatch.results || []) {
        contacts.push({
          id: c.id,
          name: `${c.properties.firstname || ""} ${c.properties.lastname || ""}`.trim() || "Unknown",
          email: c.properties.email || "",
        });
      }
    }

    // Resolve associated deals
    const dealIds = (ticket.associations?.deals?.results || []).map(
      (a: { id: string }) => a.id
    );
    const deals: TicketDetail["associations"]["deals"] = [];
    let derivedLocation: string | null = null;
    if (dealIds.length > 0) {
      const dealBatch = await hubspotClient.crm.deals.batchApi.read({
        inputs: dealIds.map((id: string) => ({ id })),
        properties: ["dealname", "amount", "pb_location", "service_type"],
        propertiesWithHistory: [],
      });
      for (const d of dealBatch.results || []) {
        const loc = d.properties?.pb_location || null;
        if (loc && !derivedLocation) derivedLocation = loc;
        deals.push({
          id: d.id,
          name: d.properties.dealname || "Untitled Deal",
          amount: d.properties.amount || null,
          location: loc,
          url: `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${d.id}`,
          serviceType: d.properties.service_type || null,
        });
      }
    }

    // Resolve associated companies
    const companyIds = (ticket.associations?.companies?.results || []).map(
      (a: { id: string }) => a.id
    );
    const companies: TicketDetail["associations"]["companies"] = [];
    if (companyIds.length > 0) {
      const companyBatch = await hubspotClient.crm.companies.batchApi.read({
        inputs: companyIds.map((id: string) => ({ id })),
        properties: ["name"],
        propertiesWithHistory: [],
      });
      for (const co of companyBatch.results || []) {
        companies.push({
          id: co.id,
          name: co.properties.name || "Unknown Company",
        });
      }
    }

    // Fetch timeline: notes, emails associated with this ticket
    const timeline: TimelineEntry[] = [];
    try {
      // Fetch notes associated with the ticket via search
      const notesResponse = await hubspotClient.crm.objects.notes.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: "associations.ticket",
            operator: NotesFilterOperatorEnum.Eq,
            value: ticketId,
          }],
        }],
        properties: ["hs_note_body", "hs_timestamp", "hubspot_owner_id", "hs_created_by"],
        limit: 50,
        // API accepts object-form sorts but TS types expect string[] — cast to get newest first
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }] as unknown as string[],
      });

      for (const note of notesResponse.results || []) {
        timeline.push({
          type: "note",
          timestamp: note.properties.hs_timestamp || note.properties.hs_createdate || "",
          body: note.properties.hs_note_body || "",
          createdBy: note.properties.hs_created_by || null,
        });
      }

      // Fetch emails associated with the ticket
      const emailsResponse = await hubspotClient.crm.objects.emails.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: "associations.ticket",
            operator: EmailsFilterOperatorEnum.Eq,
            value: ticketId,
          }],
        }],
        properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hs_email_direction"],
        limit: 50,
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }] as unknown as string[],
      });

      for (const email of emailsResponse.results || []) {
        const direction = email.properties.hs_email_direction === "INCOMING_EMAIL" ? "Received" : "Sent";
        const subject = email.properties.hs_email_subject || "No subject";
        timeline.push({
          type: "email",
          timestamp: email.properties.hs_timestamp || "",
          body: `[${direction}] ${subject}`,
          createdBy: null,
        });
      }

      // Sort timeline by timestamp descending (most recent first)
      timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (timelineError) {
      // Timeline is best-effort — don't fail the whole detail request
      console.warn("[HubSpotTickets] Failed to fetch timeline:", timelineError);
    }

    return {
      id: props.hs_object_id || ticket.id,
      subject: props.subject || "Untitled Ticket",
      content: props.content || "",
      priority: props.hs_ticket_priority || "NONE",
      stage: stageId,
      stageName: stageMap[stageId] || stageId || "Unknown",
      pipeline: props.hs_pipeline || SERVICE_TICKET_PIPELINE_ID,
      createDate: props.createdate || new Date().toISOString(),
      lastModified: props.hs_lastmodifieddate || props.createdate || new Date().toISOString(),
      lastContactDate: props.notes_last_contacted || null,
      ownerId: props.hubspot_owner_id || null,
      location: derivedLocation,
      url: `https://app.hubspot.com/contacts/${PORTAL_ID}/ticket/${ticket.id}`,
      associations: { contacts, deals, companies },
      timeline,
    };
  } catch (error) {
    console.error("[HubSpotTickets] Error fetching ticket detail:", error);
    return null;
  }
}

/**
 * Update a ticket in HubSpot (assign, change status, add note).
 * Requires tickets.write scope on the HubSpot private app.
 */
export async function updateTicket(
  ticketId: string,
  updates: {
    ownerId?: string;
    stageId?: string;
    note?: string;
  }
): Promise<boolean> {
  try {
    const properties: Record<string, string> = {};
    // ownerId === "" explicitly clears the owner (unassign)
    if (updates.ownerId !== undefined) properties.hubspot_owner_id = updates.ownerId;
    if (updates.stageId) properties.hs_pipeline_stage = updates.stageId;

    if (Object.keys(properties).length > 0) {
      await hubspotClient.crm.tickets.basicApi.update(ticketId, { properties });
    }

    // Add note as engagement if provided
    if (updates.note) {
      await hubspotClient.crm.objects.notes.basicApi.create({
        properties: {
          hs_note_body: updates.note,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [
          {
            to: { id: ticketId },
            types: [{ associationCategory: AssociationSpecAssociationCategoryEnum.HubspotDefined, associationTypeId: 18 }],
          },
        ],
      });
    }

    return true;
  } catch (error) {
    console.error("[HubSpotTickets] Error updating ticket:", error);
    return false;
  }
}
