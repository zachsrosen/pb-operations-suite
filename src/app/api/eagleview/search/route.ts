/**
 * GET /api/eagleview/search?q=…
 *
 * Searches HubSpot deals and tickets in parallel, then batch-checks the DB
 * for existing EagleView orders on each result.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { searchWithRetry } from "@/lib/hubspot";
import { searchTicketsWithRetry } from "@/lib/hubspot-tickets";
import { prisma } from "@/lib/db";

const DEAL_PROPS = [
  "dealname", "dealstage", "amount", "deal_currency_code",
  "address_line_1", "address", "city", "state", "postal_code", "zip",
];

const TICKET_PROPS = [
  "subject", "hs_pipeline_stage", "hs_ticket_priority",
  "address", "city", "state", "zip",
];

interface SearchResult {
  id: string;
  type: "deal" | "ticket";
  title: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  stage: string | null;
  amount: string | null;
  priority: string | null;
  eagleviewOrder: {
    id: string;
    reportId: string;
    status: string;
    triggeredBy: string;
    orderedAt: string;
    deliveredAt: string | null;
    driveFolderId: string | null;
    errorMessage: string | null;
    ticketId: string | null;
  } | null;
}

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Search deals and tickets in parallel
  // HubSpot Search API requires filterGroups (even if empty) alongside query
  const [dealResults, ticketResults] = await Promise.allSettled([
    searchWithRetry({
      query: q,
      filterGroups: [],
      properties: DEAL_PROPS,
      limit: 10,
    }),
    searchTicketsWithRetry({
      query: q,
      filterGroups: [],
      properties: TICKET_PROPS,
      limit: 10,
    }),
  ]);

  const results: SearchResult[] = [];
  const dealIds: string[] = [];

  // Process deals
  if (dealResults.status === "fulfilled" && dealResults.value?.results) {
    for (const d of dealResults.value.results) {
      const p = d.properties;
      const id = d.id;
      dealIds.push(id);
      results.push({
        id,
        type: "deal",
        title: p.dealname ?? `Deal ${id}`,
        address: p.address_line_1 ?? p.address ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        zip: p.postal_code ?? p.zip ?? null,
        stage: p.dealstage ?? null,
        amount: p.amount ?? null,
        priority: null,
        eagleviewOrder: null, // hydrated below
      });
    }
  }

  // Process tickets
  if (ticketResults.status === "fulfilled" && ticketResults.value?.results) {
    for (const t of ticketResults.value.results) {
      const p = t.properties;
      const id = t.id;
      results.push({
        id,
        type: "ticket",
        title: p.subject ?? `Ticket ${id}`,
        address: p.address ?? null,
        city: p.city ?? null,
        state: p.state ?? null,
        zip: p.zip ?? null,
        stage: p.hs_pipeline_stage ?? null,
        amount: null,
        priority: p.hs_ticket_priority ?? null,
        eagleviewOrder: null,
      });
    }
  }

  // Batch-check for existing EagleView orders
  if (dealIds.length > 0) {
    const orders = await prisma.eagleViewOrder.findMany({
      where: { dealId: { in: dealIds }, productCode: "TDP" },
      orderBy: { orderedAt: "desc" },
    });
    const orderByDeal = new Map<string, typeof orders[0]>();
    for (const o of orders) {
      if (!orderByDeal.has(o.dealId)) orderByDeal.set(o.dealId, o);
    }
    for (const r of results) {
      if (r.type === "deal") {
        const o = orderByDeal.get(r.id);
        if (o) {
          r.eagleviewOrder = {
            id: o.id,
            reportId: o.reportId,
            status: o.status,
            triggeredBy: o.triggeredBy,
            orderedAt: o.orderedAt.toISOString(),
            deliveredAt: o.deliveredAt?.toISOString() ?? null,
            driveFolderId: o.driveFolderId ?? null,
            errorMessage: o.errorMessage ?? null,
            ticketId: o.ticketId ?? null,
          };
        }
      }
    }
  }

  // Also check ticket-keyed orders
  const ticketIds = results.filter((r) => r.type === "ticket").map((r) => r.id);
  if (ticketIds.length > 0) {
    const ticketOrders = await prisma.eagleViewOrder.findMany({
      where: { ticketId: { in: ticketIds }, productCode: "TDP" },
      orderBy: { orderedAt: "desc" },
    });
    const orderByTicket = new Map<string, typeof ticketOrders[0]>();
    for (const o of ticketOrders) {
      if (o.ticketId && !orderByTicket.has(o.ticketId))
        orderByTicket.set(o.ticketId, o);
    }
    for (const r of results) {
      if (r.type === "ticket") {
        const o = orderByTicket.get(r.id);
        if (o) {
          r.eagleviewOrder = {
            id: o.id,
            reportId: o.reportId,
            status: o.status,
            triggeredBy: o.triggeredBy,
            orderedAt: o.orderedAt.toISOString(),
            deliveredAt: o.deliveredAt?.toISOString() ?? null,
            driveFolderId: o.driveFolderId ?? null,
            errorMessage: o.errorMessage ?? null,
            ticketId: o.ticketId ?? null,
          };
        }
      }
    }
  }

  return NextResponse.json({ results });
}
