/**
 * GET /api/hubspot/search?type=deal|contact|ticket&q=<text>
 *
 * Lightweight typeahead endpoint used by the My Tasks create/edit modal
 * to resolve deal/contact/ticket IDs by searching names instead of making
 * users paste HubSpot IDs.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { hubspotClient } from "@/lib/hubspot";

const VALID_TYPES = new Set(["deal", "contact", "ticket"]);

interface SearchHit {
  id: string;
  label: string;
  subtitle?: string | null;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type");
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (!type || !VALID_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be deal, contact, or ticket" }, { status: 400 });
  }
  if (q.length < 2) {
    return NextResponse.json({ hits: [] });
  }

  try {
    const hits = await (type === "deal"
      ? searchDeals(q)
      : type === "contact"
        ? searchContacts(q)
        : searchTickets(q));
    return NextResponse.json({ hits });
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "api.hubspot.search", type } });
    return NextResponse.json({ hits: [] });
  }
}

async function searchDeals(q: string): Promise<SearchHit[]> {
  const resp = await hubspotClient.crm.deals.searchApi.doSearch({
    query: q,
    properties: ["dealname", "dealstage", "pb_location"],
    limit: 10,
  } as never) as { results?: Array<{ id?: string; properties?: Record<string, string | null> }> };
  return (resp.results ?? []).map((r) => ({
    id: r.id ?? "",
    label: r.properties?.dealname ?? `Deal ${r.id}`,
    subtitle: r.properties?.pb_location ?? null,
  })).filter((h) => h.id);
}

async function searchContacts(q: string): Promise<SearchHit[]> {
  const resp = await hubspotClient.crm.contacts.searchApi.doSearch({
    query: q,
    properties: ["firstname", "lastname", "email", "phone"],
    limit: 10,
  } as never) as { results?: Array<{ id?: string; properties?: Record<string, string | null> }> };
  return (resp.results ?? []).map((r) => {
    const name = [r.properties?.firstname, r.properties?.lastname].filter(Boolean).join(" ").trim();
    return {
      id: r.id ?? "",
      label: name || r.properties?.email || `Contact ${r.id}`,
      subtitle: r.properties?.email ?? null,
    };
  }).filter((h) => h.id);
}

async function searchTickets(q: string): Promise<SearchHit[]> {
  const resp = await hubspotClient.crm.tickets.searchApi.doSearch({
    query: q,
    properties: ["subject", "hs_pipeline_stage"],
    limit: 10,
  } as never) as { results?: Array<{ id?: string; properties?: Record<string, string | null> }> };
  return (resp.results ?? []).map((r) => ({
    id: r.id ?? "",
    label: r.properties?.subject ?? `Ticket ${r.id}`,
    subtitle: null,
  })).filter((h) => h.id);
}
