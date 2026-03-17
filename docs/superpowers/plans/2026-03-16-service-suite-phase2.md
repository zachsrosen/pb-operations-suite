# Phase 2: HubSpot Tickets Integration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate HubSpot service tickets into the priority queue and build a dedicated Ticket Board dashboard.

**Architecture:** New `hubspot-tickets.ts` module parallels the existing `hubspot.ts` deals client but targets the HubSpot Tickets v3 API. Tickets feed into the existing priority scoring engine alongside deals. A new Ticket Board dashboard provides a kanban-style view with filtering, detail panels, and bulk actions (assign, status change, notes). All ticket routes live under `/api/service/tickets/` to avoid collision with the existing `/api/admin/tickets` bug report system.

**Tech Stack:** Next.js 16.1, React 19, TypeScript 5, @hubspot/api-client, Prisma 7.3, Tailwind v4, SSE via useSSE hook

---

## Prerequisites

- **HubSpot scopes:** The private app needs `tickets` read scope and `tickets.write` scope added via HubSpot admin settings. Without these, the API calls will return 403.
- **Environment variable:** `HUBSPOT_PORTAL_ID` must be set (already used by deal URLs in Phase 1).

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/lib/hubspot-tickets.ts` | HubSpot Tickets API client — search, get, update, associations |
| Create | `src/__tests__/lib/hubspot-tickets.test.ts` | Unit tests for ticket → PriorityItem transform |
| Create | `src/app/api/service/tickets/route.ts` | GET list/search service tickets |
| Create | `src/app/api/service/tickets/[id]/route.ts` | GET single ticket detail + PATCH update |
| Create | `src/app/dashboards/service-tickets/page.tsx` | Ticket Board dashboard (kanban) |
| Modify | `src/lib/service-priority-cache.ts:32` | Add `service-tickets:` prefix to cascade watcher |
| Modify | `src/app/api/service/priority-queue/route.ts:86` | Merge tickets into priority queue fetcher |
| Modify | `src/lib/cache.ts:266` | Add `SERVICE_TICKETS` cache key |
| Modify | `src/lib/query-keys.ts:50-76` | Add `serviceTickets` query key domain + cache mapping |
| Modify | `src/lib/page-directory.ts:44` | Register `/dashboards/service-tickets` route |
| Modify | `src/lib/role-permissions.ts` | Add `/dashboards/service-tickets` to permitted roles |
| Modify | `src/app/suites/service/page.tsx:5-34` | Add Ticket Board card to suite landing |
| Modify | `src/app/dashboards/service-overview/page.tsx:256-258` | Update "Open Tickets" StatCard with live count |

---

## Chunk 1: HubSpot Tickets API Client + Tests

### Task 1: Create HubSpot Tickets Client

**Files:**
- Create: `src/lib/hubspot-tickets.ts`
- Test: `src/__tests__/lib/hubspot-tickets.test.ts`

**Context:** The HubSpot `@hubspot/api-client` package has a `crm.tickets` namespace that works identically to `crm.deals` — same `searchApi.doSearch()`, `basicApi.getById()`, `basicApi.update()` methods. The existing `hubspotClient` singleton from `src/lib/hubspot.ts` already has access to `crm.tickets` — we just need to call it.

Ticket pipeline stages are not hardcoded in `deals-pipeline.ts` — they'll be discovered dynamically from HubSpot, since ticket pipelines vary per account. We store the pipeline ID in an env var.

The `PriorityItem` type from `src/lib/service-priority.ts` already supports `type: "ticket"`.

- [ ] **Step 1: Write the test file**

Create `src/__tests__/lib/hubspot-tickets.test.ts`:

```typescript
import { transformTicketToPriorityItem, type HubSpotTicket, type EnrichedTicketItem } from "@/lib/hubspot-tickets";

describe("transformTicketToPriorityItem", () => {
  it("transforms a HubSpot ticket to a PriorityItem", () => {
    const ticket: HubSpotTicket = {
      id: "12345",
      properties: {
        hs_object_id: "12345",
        subject: "AC not working after install",
        content: "Customer reports AC issue",
        hs_pipeline: "0",
        hs_pipeline_stage: "1",
        hs_ticket_priority: "HIGH",
        createdate: "2026-03-10T12:00:00Z",
        hs_lastmodifieddate: "2026-03-14T12:00:00Z",
        notes_last_contacted: "2026-03-13T12:00:00Z",
        hubspot_owner_id: "123",
      },
    };

    const stageMap: Record<string, string> = {
      "1": "New",
      "2": "In Progress",
      "3": "Closed",
    };

    const result = transformTicketToPriorityItem(ticket, stageMap);

    expect(result).toEqual({
      id: "12345",
      type: "ticket",
      title: "AC not working after install",
      stage: "New",
      lastModified: "2026-03-14T12:00:00Z",
      lastContactDate: "2026-03-13T12:00:00Z",
      createDate: "2026-03-10T12:00:00Z",
      amount: null,
      location: null,
      url: expect.stringContaining("/ticket/12345"),
      priority: "HIGH",
      ownerId: "123",
    });
  });

  it("falls back to stage ID when stage name not found in map", () => {
    const ticket: HubSpotTicket = {
      id: "99",
      properties: {
        hs_object_id: "99",
        subject: "Test",
        content: "",
        hs_pipeline: "0",
        hs_pipeline_stage: "unknown-stage",
        hs_ticket_priority: "LOW",
        createdate: "2026-03-10T12:00:00Z",
        hs_lastmodifieddate: "2026-03-10T12:00:00Z",
      },
    };

    const result = transformTicketToPriorityItem(ticket, {});
    expect(result.stage).toBe("unknown-stage");
  });

  it("derives location from associated deal pb_location", () => {
    const ticket: HubSpotTicket = {
      id: "55",
      properties: {
        hs_object_id: "55",
        subject: "Follow up",
        content: "",
        hs_pipeline: "0",
        hs_pipeline_stage: "1",
        hs_ticket_priority: "MEDIUM",
        createdate: "2026-03-10T12:00:00Z",
        hs_lastmodifieddate: "2026-03-10T12:00:00Z",
      },
      _derivedLocation: "Denver",
    };

    const result = transformTicketToPriorityItem(ticket, { "1": "Open" });
    expect(result.location).toBe("Denver");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx jest src/__tests__/lib/hubspot-tickets.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '@/lib/hubspot-tickets'`

- [ ] **Step 3: Implement the tickets client**

Create `src/lib/hubspot-tickets.ts`:

```typescript
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
    deals: Array<{ id: string; name: string; amount: string | null; location: string | null; url: string }>;
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

    // Get all closed/resolved stage IDs to EXCLUDE them
    // Convention: stages with displayOrder >= 900 or label containing "Closed"/"Done"
    const closedStageIds = Object.entries(stageMap)
      .filter(([, label]) => /closed|done|resolved|completed/i.test(label))
      .map(([id]) => id);

    // Paginate through all tickets in the service pipeline
    let tickets: HubSpotTicket[] = [];
    let after: string | undefined;

    do {
      const searchRequest = {
        filterGroups: [{
          filters: [
            {
              propertyName: "hs_pipeline",
              operator: "EQ" as const,
              value: SERVICE_TICKET_PIPELINE_ID,
            },
          ],
        }],
        properties: TICKET_PROPERTIES,
        limit: 100,
        ...(after ? { after } : {}),
      };

      const response = await searchTicketsWithRetry(searchRequest);
      const page = (response.results || []).map(t => ({
        id: t.id,
        properties: t.properties as Record<string, string | undefined>,
      }));
      tickets = tickets.concat(page);

      after = response.paging?.next?.after;
    } while (after);

    // Filter out closed tickets client-side
    if (closedStageIds.length > 0) {
      const closedSet = new Set(closedStageIds);
      tickets = tickets.filter(t => !closedSet.has(t.properties.hs_pipeline_stage ?? ""));
    }

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
    // Batch read associations: tickets → deals
    const batchResponse = await hubspotClient.crm.associations.batchApi.read(
      "tickets",
      "deals",
      { inputs: ticketIds.map(id => ({ id })) }
    );

    // Collect unique deal IDs that have associations
    const dealIdsByTicket = new Map<string, string[]>();
    const allDealIds = new Set<string>();

    for (const result of batchResponse.results || []) {
      const ticketId = result.from?.id;
      if (!ticketId) continue;
      const dealIds = (result.to || []).map((t: { id: string }) => t.id);
      if (dealIds.length > 0) {
        dealIdsByTicket.set(ticketId, dealIds);
        dealIds.forEach((id: string) => allDealIds.add(id));
      }
    }

    // Batch-fetch deal pb_location for all associated deals
    if (allDealIds.size > 0) {
      const dealLocations = new Map<string, string>();

      const batchReadResponse = await hubspotClient.crm.deals.batchApi.read({
        inputs: Array.from(allDealIds).map(id => ({ id })),
        properties: ["pb_location"],
        propertiesWithHistory: [],
      });

      for (const deal of batchReadResponse.results || []) {
        const loc = deal.properties?.pb_location;
        if (loc) dealLocations.set(deal.id, loc);
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
        const companyBatch = await hubspotClient.crm.associations.batchApi.read(
          "tickets",
          "companies",
          { inputs: unresolved.map(id => ({ id })) }
        );

        const companyIds = new Set<string>();
        const companyByTicket = new Map<string, string>();

        for (const result of companyBatch.results || []) {
          const ticketId = result.from?.id;
          if (!ticketId) continue;
          const firstCompany = (result.to || [])[0];
          if (firstCompany) {
            companyByTicket.set(ticketId, firstCompany.id);
            companyIds.add(firstCompany.id);
          }
        }

        if (companyIds.size > 0) {
          const companyRead = await hubspotClient.crm.companies.batchApi.read({
            inputs: Array.from(companyIds).map(id => ({ id })),
            properties: ["city", "state"],
            propertiesWithHistory: [],
          });

          const companyLocations = new Map<string, string>();
          for (const co of companyRead.results || []) {
            const city = co.properties?.city;
            if (city) companyLocations.set(co.id, city);
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
        properties: ["dealname", "amount", "pb_location"],
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

    // Fetch timeline: notes, emails, calls, meetings, tasks associated with this ticket
    const timeline: TimelineEntry[] = [];
    try {
      // Fetch notes associated with the ticket via search
      const notesResponse = await hubspotClient.crm.objects.notes.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: "associations.ticket",
            operator: "EQ" as const,
            value: ticketId,
          }],
        }],
        properties: ["hs_note_body", "hs_timestamp", "hubspot_owner_id", "hs_created_by"],
        limit: 50,
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
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
            operator: "EQ" as const,
            value: ticketId,
          }],
        }],
        properties: ["hs_email_subject", "hs_email_text", "hs_timestamp", "hs_email_direction"],
        limit: 50,
        sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
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
    if (updates.ownerId) properties.hubspot_owner_id = updates.ownerId;
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
            types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 18 }],
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx jest src/__tests__/lib/hubspot-tickets.test.ts --no-coverage`
Expected: PASS — 3 tests passing

- [ ] **Step 5: Lint the new files**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx eslint src/lib/hubspot-tickets.ts src/__tests__/lib/hubspot-tickets.test.ts`
Expected: Clean

- [ ] **Step 6: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/lib/hubspot-tickets.ts src/__tests__/lib/hubspot-tickets.test.ts
git commit -m "feat(service): add HubSpot tickets API client with transform tests"
```

---

### Task 2: Add Cache Keys, Query Keys, and Cascade Watcher

**Files:**
- Modify: `src/lib/cache.ts:256-267`
- Modify: `src/lib/query-keys.ts:50-76`
- Modify: `src/lib/service-priority-cache.ts:29-33`

**Context:** The cache infrastructure needs ticket-specific keys, and the priority queue cascade listener (Phase 1 left a `// Phase 2: will add service-tickets:* prefix check` comment) needs to watch for ticket cache invalidations.

- [ ] **Step 1: Add SERVICE_TICKETS cache key**

In `src/lib/cache.ts`, add to the CACHE_KEYS object after line 266 (`SERVICE_PRIORITY_QUEUE`):

```typescript
  SERVICE_TICKETS: "service-tickets:all",
```

- [ ] **Step 2: Add serviceTickets query key domain**

In `src/lib/query-keys.ts`, add after the `servicePriority` block (line 54):

```typescript
  serviceTickets: {
    root: ["serviceTickets"] as const,
    list: (params?: Record<string, unknown>) =>
      [...queryKeys.serviceTickets.root, "list", params] as const,
    detail: (ticketId: string) =>
      [...queryKeys.serviceTickets.root, "detail", ticketId] as const,
  },
```

And in `cacheKeyToQueryKeys()`, add before the `// pipelines` line (line 73):

```typescript
  if (serverKey.startsWith("service-tickets")) return [queryKeys.serviceTickets.root];
```

- [ ] **Step 3: Update cascade listener to watch ticket keys**

In `src/lib/service-priority-cache.ts`, replace lines 30-33:

```typescript
    // Phase 1: deals:service — Phase 2: also service-tickets:*
    const isUpstream =
      key.startsWith("deals:service") ||
      key.startsWith("service-tickets");
```

- [ ] **Step 4: Run build to verify types**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx jest --no-coverage`
Expected: All tests pass (7 priority engine + 3 ticket transform)

- [ ] **Step 6: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/lib/cache.ts src/lib/query-keys.ts src/lib/service-priority-cache.ts
git commit -m "feat(service): add ticket cache keys and cascade watcher for priority queue"
```

---

### Task 3: Merge Tickets into Priority Queue API

**Files:**
- Modify: `src/app/api/service/priority-queue/route.ts:1-9,83-111`

**Context:** The priority queue currently only fetches deals. We need to add a parallel ticket fetch and merge both arrays before scoring. The `PriorityItem` type already supports `type: "ticket"`.

- [ ] **Step 1: Add ticket import**

At the top of `src/app/api/service/priority-queue/route.ts`, add after the existing imports:

```typescript
import { fetchServiceTickets } from "@/lib/hubspot-tickets";
import { CACHE_KEYS } from "@/lib/cache";
```

- [ ] **Step 2: Merge tickets into the fetcher**

Replace the cache fetcher inside the GET handler (the `async () => {` block around lines 85-109) with:

```typescript
      async () => {
        // Fetch deals and tickets in parallel
        const [deals, tickets] = await Promise.all([
          fetchServiceDeals(),
          fetchServiceTickets(),
        ]);

        const allItems = [...deals, ...tickets];

        // Fetch overrides from DB
        const overrides = prisma
          ? await prisma.servicePriorityOverride.findMany({
              where: {
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            })
          : [];

        const queue = buildPriorityQueue(
          allItems,
          overrides.map(o => ({
            itemId: o.itemId,
            itemType: o.itemType,
            overridePriority: o.overridePriority as PriorityTier,
          }))
        );

        return { queue, fetchedAt: new Date().toISOString() };
      },
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/app/api/service/priority-queue/route.ts
git commit -m "feat(service): merge tickets into priority queue alongside deals"
```

---

## Chunk 2: Ticket API Routes

### Task 4: Create Ticket List API Route

**Files:**
- Create: `src/app/api/service/tickets/route.ts`

**Context:** This route lists service tickets with optional filters (location, priority, stage). It uses the same auth pattern as the priority queue route. The cache key is `service-tickets:all`.

- [ ] **Step 1: Create the route**

Create `src/app/api/service/tickets/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  fetchServiceTickets,
  getTicketStageMap,
  type EnrichedTicketItem,
} from "@/lib/hubspot-tickets";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const location = searchParams.get("location");
    const priority = searchParams.get("priority");
    const stage = searchParams.get("stage");
    const search = searchParams.get("search");
    const forceRefresh = searchParams.get("refresh") === "true";

    const { data: tickets, lastUpdated } = await appCache.getOrFetch<EnrichedTicketItem[]>(
      CACHE_KEYS.SERVICE_TICKETS,
      fetchServiceTickets,
      forceRefresh
    );

    let filtered = tickets;

    // Apply filters
    if (location && location !== "all") {
      filtered = filtered.filter(t => t.location === location);
    }
    if (priority && priority !== "all") {
      filtered = filtered.filter(t => t.priority === priority);
    }
    if (stage && stage !== "all") {
      filtered = filtered.filter(t => t.stage === stage);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.id.includes(q)
      );
    }

    // Get unique locations for filter dropdown
    const locations = [...new Set(tickets.map(t => t.location).filter((l): l is string => !!l))].sort();

    // Fetch stage map for metadata + pipeline display order
    const { map: stageMap, orderedStageIds } = await getTicketStageMap();

    // Return stages in pipeline display order (not alphabetical)
    // Only include stages that have tickets OR are in the pipeline
    const stageNames = orderedStageIds.map(id => stageMap[id]).filter(Boolean);

    return NextResponse.json({
      tickets: filtered,
      total: tickets.length,
      filteredCount: filtered.length,
      locations,
      stages: stageNames,
      stageMap: stageMap,
      lastUpdated,
    });
  } catch (error) {
    console.error("[ServiceTickets] Error:", error);
    return NextResponse.json({ error: "Failed to load service tickets" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/app/api/service/tickets/route.ts
git commit -m "feat(service): add GET /api/service/tickets list endpoint"
```

---

### Task 5: Create Ticket Detail + Update API Route

**Files:**
- Create: `src/app/api/service/tickets/[id]/route.ts`

**Context:** GET returns a single ticket with full associations (contacts, deals, companies). PATCH updates ticket properties (assign, status change) and optionally adds a note. Uses Next.js 16 async params.

- [ ] **Step 1: Create the route**

Create `src/app/api/service/tickets/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { getTicketDetail, updateTicket, getTicketStageMap } from "@/lib/hubspot-tickets";
import { appCache, CACHE_KEYS } from "@/lib/cache";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { id } = await params;
    const ticket = await getTicketDetail(id);

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Include stage map for context
    const stageMap = await getTicketStageMap();

    return NextResponse.json({ ticket, stageMap });
  } catch (error) {
    console.error("[ServiceTickets] Detail error:", error);
    return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const { ownerId, stageId, note } = body as {
      ownerId?: string;
      stageId?: string;
      note?: string;
    };

    if (!ownerId && !stageId && !note) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const success = await updateTicket(id, { ownerId, stageId, note });

    if (!success) {
      return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
    }

    // Invalidate ticket cache so priority queue and ticket list refresh
    appCache.invalidate(CACHE_KEYS.SERVICE_TICKETS);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ServiceTickets] Update error:", error);
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/app/api/service/tickets/\[id\]/route.ts
git commit -m "feat(service): add GET/PATCH /api/service/tickets/[id] detail endpoint"
```

---

## Chunk 3: Ticket Board Dashboard + Wiring

### Task 6: Register Route and Permissions

**Files:**
- Modify: `src/lib/page-directory.ts:44`
- Modify: `src/lib/role-permissions.ts` (multiple role blocks)

**Context:** The `/dashboards/service-tickets` route needs to be in the page directory (for middleware matching) and in role permissions. The breadcrumb SUITE_MAP entry was already added in Phase 1.

- [ ] **Step 1: Add to page directory**

In `src/lib/page-directory.ts`, add after `"/dashboards/service-scheduler",` (line 45):

```typescript
  "/dashboards/service-tickets",
```

Keep the array alphabetically sorted.

- [ ] **Step 2: Add to role permissions**

In `src/lib/role-permissions.ts`, add `/dashboards/service-tickets` to the `allowedRoutes` array of every role that currently has `/dashboards/service-overview`. These roles are:

- MANAGER (line ~80, already has service routes via suite access)
- OPERATIONS (has `/dashboards/service-overview` in allowedRoutes)
- OPERATIONS_MANAGER (has `/dashboards/service-overview`)
- PROJECT_MANAGER (has `/dashboards/service-overview`)
- TECH_OPS (has individual service dashboard routes)

Add the route right after `/dashboards/service-overview` in each role's `allowedRoutes` array. **Exception:** TECH_OPS does not have `/dashboards/service-overview` — add `/dashboards/service-tickets` after `/dashboards/service` in the TECH_OPS block instead.

- [ ] **Step 3: Verify no type errors**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/lib/page-directory.ts src/lib/role-permissions.ts
git commit -m "feat(auth): register service-tickets route and add to role permissions"
```

---

### Task 7: Add Ticket Board Card to Suite Landing

**Files:**
- Modify: `src/app/suites/service/page.tsx:5-34`

**Context:** The service suite landing page needs a card for the Ticket Board, positioned after the Overview card.

- [ ] **Step 1: Add Ticket Board card**

In `src/app/suites/service/page.tsx`, add after the Service Overview card object (after line 12):

```typescript
  {
    href: "/dashboards/service-tickets",
    title: "Ticket Board",
    description: "Kanban board for HubSpot service tickets — filter, assign, and track status.",
    tag: "TICKETS",
    section: "Service",
  },
```

- [ ] **Step 2: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/app/suites/service/page.tsx
git commit -m "feat(service): add Ticket Board card to service suite landing page"
```

---

### Task 8: Create Ticket Board Dashboard

**Files:**
- Create: `src/app/dashboards/service-tickets/page.tsx`

**Context:** This is the main ticket board — a kanban-style view where columns are ticket pipeline stages. Uses the same patterns as other dashboards: `DashboardShell`, `StatCard`, `useSSE`, theme tokens. Includes a detail panel that opens when clicking a ticket, and action buttons for assign/status change/notes.

The component fetches from `/api/service/tickets` and uses SSE with cache key filter `service-tickets` for real-time updates.

- [ ] **Step 1: Create the dashboard page**

Create `src/app/dashboards/service-tickets/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard } from "@/components/ui/MetricCard";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { useSSE } from "@/hooks/useSSE";
import { useActivityTracking } from "@/hooks/useActivityTracking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TicketItem {
  id: string;
  type: "ticket";
  title: string;
  stage: string;
  lastModified: string;
  lastContactDate?: string | null;
  createDate: string;
  amount?: number | null;
  location?: string | null;
  url?: string;
  priority?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
}

interface TimelineEntry {
  type: "note" | "email" | "call" | "meeting" | "task";
  timestamp: string;
  body: string;
  createdBy?: string | null;
}

interface TicketDetail {
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
    deals: Array<{ id: string; name: string; amount: string | null; location: string | null; url: string }>;
    companies: Array<{ id: string; name: string }>;
  };
  timeline: TimelineEntry[];
}

interface TicketListResponse {
  tickets: TicketItem[];
  total: number;
  filteredCount: number;
  locations: string[];
  stages: string[];
  stageMap: Record<string, string>;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Priority badge config
// ---------------------------------------------------------------------------

const PRIORITY_CONFIG: Record<string, { bg: string; text: string; label: string }> = {
  HIGH: { bg: "bg-red-500/20", text: "text-red-400", label: "High" },
  MEDIUM: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "Medium" },
  LOW: { bg: "bg-green-500/20", text: "text-green-400", label: "Low" },
  NONE: { bg: "bg-zinc-500/20", text: "text-zinc-400", label: "None" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysSince(dateStr: string): number {
  return Math.max(0, (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

function ageLabel(dateStr: string): string {
  const days = Math.floor(daysSince(dateStr));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ServiceTicketBoardPage() {
  const [data, setData] = useState<TicketListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterLocation, setFilterLocation] = useState("all");
  const [filterStage, setFilterStage] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [noteText, setNoteText] = useState("");

  const { trackDashboardView } = useActivityTracking();
  const hasTrackedView = useRef(false);

  // ---- Data fetching --------------------------------------------------------

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterLocation !== "all") params.set("location", filterLocation);
      if (filterPriority !== "all") params.set("priority", filterPriority);
      if (searchQuery) params.set("search", searchQuery);

      const res = await fetch(`/api/service/tickets?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: TicketListResponse = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tickets");
    } finally {
      setLoading(false);
    }
  }, [filterLocation, filterPriority, searchQuery]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // SSE real-time
  const { connected } = useSSE(fetchData, {
    url: "/api/stream",
    cacheKeyFilter: "service-tickets",
  });

  // Activity tracking
  useEffect(() => {
    if (!loading && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackDashboardView("service-tickets", {
        ticketCount: data?.total ?? 0,
      });
    }
  }, [loading, data?.total, trackDashboardView]);

  // ---- Ticket detail --------------------------------------------------------

  const openDetail = useCallback(async (ticketId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/service/tickets/${ticketId}`);
      if (!res.ok) throw new Error("Failed to load ticket");
      const json = await res.json();
      setSelectedTicket(json.ticket);
    } catch {
      console.error("[TicketBoard] Failed to load ticket detail");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ---- Ticket actions -------------------------------------------------------

  const handleStatusChange = useCallback(async (ticketId: string, stageId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/service/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      if (!res.ok) throw new Error("Failed to update ticket");
      await fetchData();
      if (selectedTicket?.id === ticketId) {
        await openDetail(ticketId);
      }
    } catch (err) {
      console.error("[TicketBoard] Status change failed:", err);
    } finally {
      setActionLoading(false);
    }
  }, [fetchData, openDetail, selectedTicket?.id]);

  const handleAddNote = useCallback(async (ticketId: string) => {
    if (!noteText.trim()) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/service/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteText }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      setNoteText("");
      if (selectedTicket?.id === ticketId) {
        await openDetail(ticketId);
      }
    } catch (err) {
      console.error("[TicketBoard] Add note failed:", err);
    } finally {
      setActionLoading(false);
    }
  }, [noteText, openDetail, selectedTicket?.id]);

  // ---- Derived data ---------------------------------------------------------

  // Stage filter is client-side (lightweight); location + priority are server-side
  const filteredTickets = data?.tickets.filter(t => {
    if (filterStage !== "all" && t.stage !== filterStage) return false;
    return true;
  }) ?? [];

  // Unique priorities for filter
  const priorities = [...new Set(
    (data?.tickets ?? []).map(t => t.priority).filter((p): p is string => !!p)
  )];

  // Group tickets by stage for kanban columns
  const stageOrder = data?.stages ?? [];
  const ticketsByStage = new Map<string, TicketItem[]>();
  for (const stage of stageOrder) {
    ticketsByStage.set(stage, []);
  }
  for (const ticket of filteredTickets) {
    const list = ticketsByStage.get(ticket.stage);
    if (list) {
      list.push(ticket);
    } else {
      ticketsByStage.set(ticket.stage, [ticket]);
    }
  }

  // ---- Loading / error states -----------------------------------------------

  if (loading && !data) {
    return (
      <DashboardShell title="Ticket Board" accentColor="cyan">
        <LoadingSpinner color="cyan" message="Loading tickets..." />
      </DashboardShell>
    );
  }

  if (error && !data) {
    return (
      <DashboardShell title="Ticket Board" accentColor="cyan">
        <ErrorState message={error} onRetry={fetchData} color="cyan" />
      </DashboardShell>
    );
  }

  // ---- Header controls ------------------------------------------------------

  const headerRight = (
    <div className="flex items-center gap-2">
      <span
        className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-zinc-500"}`}
        title={connected ? "Live" : "Disconnected"}
      />
      <button
        onClick={() => { setLoading(true); fetchData(); }}
        className="bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white"
      >
        Refresh
      </button>
    </div>
  );

  // ---- Render ---------------------------------------------------------------

  return (
    <DashboardShell
      title="Ticket Board"
      accentColor="cyan"
      lastUpdated={data?.lastUpdated ?? null}
      headerRight={headerRight}
      fullWidth
    >
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          label="Open Tickets"
          value={data?.total ?? 0}
          color="cyan"
        />
        <StatCard
          label="Filtered"
          value={data?.filteredCount ?? 0}
          color="blue"
        />
        <StatCard
          label="Locations"
          value={data?.locations.length ?? 0}
          color="purple"
        />
        <StatCard
          label="Stages"
          value={stageOrder.length}
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="text"
          placeholder="Search tickets..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted w-64"
        />
        <select
          value={filterLocation}
          onChange={(e) => setFilterLocation(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          <option value="all">All Locations</option>
          {(data?.locations ?? []).map(loc => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          <option value="all">All Priorities</option>
          {priorities.map(p => (
            <option key={p} value={p}>{PRIORITY_CONFIG[p]?.label ?? p}</option>
          ))}
        </select>
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground"
        >
          <option value="all">All Stages</option>
          {stageOrder.map(stage => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </select>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stageOrder
          .filter(stage => filterStage === "all" || stage === filterStage)
          .map(stage => {
            const tickets = ticketsByStage.get(stage) ?? [];
            return (
              <div
                key={stage}
                className="flex-shrink-0 w-72 bg-surface rounded-xl border border-t-border"
              >
                {/* Column header */}
                <div className="px-3 py-3 border-b border-t-border">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground truncate">
                      {stage}
                    </h3>
                    <span className="text-xs text-muted bg-surface-2 px-2 py-0.5 rounded-full">
                      {tickets.length}
                    </span>
                  </div>
                </div>

                {/* Ticket cards */}
                <div className="p-2 space-y-2 max-h-[60vh] overflow-y-auto">
                  {tickets.length === 0 ? (
                    <div className="text-xs text-muted text-center py-4">
                      No tickets
                    </div>
                  ) : (
                    tickets.map(ticket => (
                      <button
                        key={ticket.id}
                        onClick={() => openDetail(ticket.id)}
                        className="w-full text-left bg-surface-2 hover:bg-surface-elevated rounded-lg p-3 border border-t-border transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-foreground line-clamp-2 flex-1">
                            {ticket.title}
                          </p>
                          {ticket.priority && PRIORITY_CONFIG[ticket.priority] && (
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_CONFIG[ticket.priority].bg} ${PRIORITY_CONFIG[ticket.priority].text}`}>
                              {PRIORITY_CONFIG[ticket.priority].label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted">
                          {ticket.location && (
                            <span>{ticket.location}</span>
                          )}
                          <span>{ageLabel(ticket.createDate)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Detail Panel (slide-over) */}
      {(selectedTicket || detailLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { setSelectedTicket(null); setNoteText(""); }}
          />

          {/* Panel */}
          <div className="relative w-full max-w-lg bg-surface border-l border-t-border overflow-y-auto">
            {detailLoading && !selectedTicket ? (
              <div className="flex items-center justify-center h-full">
                <LoadingSpinner color="cyan" message="Loading ticket..." />
              </div>
            ) : selectedTicket ? (
              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg font-semibold text-foreground mb-1">
                      {selectedTicket.subject}
                    </h2>
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <span>{selectedTicket.stageName}</span>
                      <span className="opacity-40">·</span>
                      <span>{ageLabel(selectedTicket.createDate)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedTicket(null); setNoteText(""); }}
                    className="text-muted hover:text-foreground p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Content */}
                {selectedTicket.content && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Description</h3>
                    <p className="text-sm text-muted whitespace-pre-wrap">
                      {selectedTicket.content}
                    </p>
                  </div>
                )}

                {/* Status change */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-2">Change Status</h3>
                  <select
                    value={selectedTicket.stage}
                    onChange={(e) => handleStatusChange(selectedTicket.id, e.target.value)}
                    disabled={actionLoading}
                    className="bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground w-full disabled:opacity-50"
                  >
                    {Object.entries(data?.stageMap ?? {}).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* Associations */}
                {selectedTicket.associations.contacts.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Contacts</h3>
                    <div className="space-y-1">
                      {selectedTicket.associations.contacts.map(c => (
                        <div key={c.id} className="text-sm text-muted">
                          {c.name} {c.email && <span className="opacity-60">({c.email})</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTicket.associations.deals.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Linked Deals</h3>
                    <div className="space-y-2">
                      {selectedTicket.associations.deals.map(d => (
                        <a
                          key={d.id}
                          href={d.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block bg-surface-2 rounded-lg p-2 text-sm hover:bg-surface-elevated transition-colors"
                        >
                          <span className="text-foreground font-medium">{d.name}</span>
                          {d.amount && <span className="text-muted ml-2">${Number(d.amount).toLocaleString()}</span>}
                          {d.location && <span className="text-muted ml-2">· {d.location}</span>}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {selectedTicket.associations.companies.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Companies</h3>
                    <div className="space-y-1">
                      {selectedTicket.associations.companies.map(co => (
                        <div key={co.id} className="text-sm text-muted">{co.name}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Activity Timeline */}
                {selectedTicket.timeline.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">
                      Activity Timeline ({selectedTicket.timeline.length})
                    </h3>
                    <div className="space-y-3 max-h-64 overflow-y-auto">
                      {selectedTicket.timeline.map((entry, idx) => {
                        const typeIcon: Record<string, string> = {
                          note: "📝", email: "📧", call: "📞", meeting: "📅", task: "✅",
                        };
                        return (
                          <div key={idx} className="border-l-2 border-t-border pl-3">
                            <div className="flex items-center gap-2 text-xs text-muted mb-1">
                              <span>{typeIcon[entry.type] || "•"}</span>
                              <span className="capitalize font-medium">{entry.type}</span>
                              <span className="opacity-40">·</span>
                              <span>{ageLabel(entry.timestamp)}</span>
                            </div>
                            <p className="text-sm text-foreground line-clamp-3 whitespace-pre-wrap">
                              {entry.body.replace(/<[^>]*>/g, "")}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Add note */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-foreground mb-2">Add Note</h3>
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Type a note..."
                    rows={3}
                    className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted resize-none"
                  />
                  <button
                    onClick={() => handleAddNote(selectedTicket.id)}
                    disabled={actionLoading || !noteText.trim()}
                    className="mt-2 bg-cyan-600 hover:bg-cyan-700 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                  >
                    {actionLoading ? "Saving..." : "Add Note"}
                  </button>
                </div>

                {/* HubSpot link */}
                <a
                  href={selectedTicket.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-cyan-400 hover:text-cyan-300"
                >
                  Open in HubSpot
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
```

- [ ] **Step 2: Verify build passes**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx next build`
Expected: Build passes, page compiles

- [ ] **Step 3: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/app/dashboards/service-tickets/page.tsx
git commit -m "feat(service): add Ticket Board dashboard with kanban view and detail panel"
```

---

### Task 9: Update Service Overview Open Tickets KPI

**Files:**
- Modify: `src/app/dashboards/service-overview/page.tsx:256-258`

**Context:** The Service Overview currently shows "Open Tickets: 0" with "Coming in Phase 2" subtitle. Now that tickets are integrated, we need to show the actual count from the queue data.

- [ ] **Step 1: Update the StatCard**

In `src/app/dashboards/service-overview/page.tsx`, find the "Open Tickets" StatCard (around line 256-260). Replace:

```tsx
        <StatCard
          label="Open Tickets"
          subtitle="Coming in Phase 2"
          value={0}
          color="blue"
        />
```

With:

```tsx
        <StatCard
          label="Open Tickets"
          value={data?.queue.filter(i => i.item.type === "ticket").length ?? 0}
          color="blue"
        />
```

- [ ] **Step 2: Verify types compile**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/app/dashboards/service-overview/page.tsx
git commit -m "feat(service): wire live ticket count into Service Overview KPI"
```

---

### Task 10: Build Verification and Final Lint

**Files:** All new/modified files

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx jest --no-coverage`
Expected: All tests pass (7 priority engine + 3 ticket transform = 10 total)

- [ ] **Step 2: Run ESLint on all new files**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npx eslint src/lib/hubspot-tickets.ts src/app/api/service/tickets/route.ts src/app/api/service/tickets/\[id\]/route.ts src/app/dashboards/service-tickets/page.tsx`
Expected: Clean

- [ ] **Step 3: Run full build**

Run: `cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1 && npm run build`
Expected: Build passes with no errors

- [ ] **Step 4: Fix any issues found, commit fixes**

If any lint/type/build errors, fix them and commit:

```bash
cd /Users/zach/Downloads/Dev\ Projects/PB-Operations-Suite/.worktrees/service-suite-phase1
git add src/lib/hubspot-tickets.ts src/app/api/service/tickets/ src/app/dashboards/service-tickets/page.tsx src/lib/cache.ts src/lib/query-keys.ts src/lib/service-priority-cache.ts src/app/api/service/priority-queue/route.ts
git commit -m "fix: address build/lint issues for Phase 2"
```

---

## Environment Variables Required

Add to `.env` (and Vercel env vars):

```
HUBSPOT_SERVICE_TICKET_PIPELINE_ID=0    # Default pipeline; update to actual service ticket pipeline ID
```

**Note:** `HUBSPOT_PORTAL_ID` is already set and used server-side. The ticket detail API response includes the HubSpot URL with portal ID embedded, so no `NEXT_PUBLIC_` variant is needed — the client never constructs HubSpot URLs directly.

## Verification Checklist

- [ ] `npm run build` passes
- [ ] 10/10 tests pass (7 priority engine + 3 ticket transform)
- [ ] Lint clean on all new files
- [ ] HubSpot tickets API returns data (requires `tickets` read scope)
- [ ] Ticket Board kanban view renders with columns per pipeline stage
- [ ] Kanban columns follow HubSpot pipeline display order (not alphabetical)
- [ ] Ticket detail panel shows associations (contacts, deals, companies)
- [ ] Ticket detail panel shows activity timeline (notes + emails)
- [ ] Status change from detail panel updates HubSpot (requires `tickets.write` scope)
- [ ] Add note from detail panel creates engagement in HubSpot
- [ ] Priority queue now includes both deals and tickets
- [ ] Service Overview "Open Tickets" shows live count
- [ ] SSE real-time updates work for `service-tickets` cache key
- [ ] No collision with `/api/admin/tickets` bug report system
- [ ] Location filter works (derived from associated deals)
- [ ] Priority filter works server-side
- [ ] Pagination fetches all tickets (not just first 100)
