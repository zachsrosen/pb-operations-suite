import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { tagSentryRequest } from "@/lib/sentry-request";
import { searchWithRetry } from "@/lib/hubspot";
import { fetchProductionIssueTickets } from "@/lib/hubspot-tickets";

/**
 * Service-side production issues for the Production Issues dashboard (Service view).
 *
 * Merges TWO independent HubSpot sources into one list:
 *   1. Open service-pipeline tickets categorized "Production Guarantee" or
 *      "System Failure/Underperformance" (via lib/hubspot-tickets).
 *   2. PROJECT-pipeline deals at the "Project Complete" stage tagged
 *      "Production Issue - 1 Year" or "Production Issue - 180 Days".
 *
 * Install-side issues live on /api/projects/flagged and are untouched.
 *
 * Auth: browser requests authenticated by middleware; machine-to-machine via
 * API_SECRET_TOKEN bearer (mirrors /api/projects/flagged).
 */

export type ServiceProductionIssue = {
  source: "ticket" | "deal";
  id: string;
  customerName: string | null;
  address: string | null;
  location: string | null;
  issue: string;
  date: string | null; // ISO; ticket createdate or deal Project-Complete entry date
  ageDays: number | null;
  hubspotUrl: string;
};

const PROJECT_PIPELINE_ID = process.env.HUBSPOT_PIPELINE_PROJECT || "6900017";
const PROJECT_COMPLETE_STAGE_ID = "20440343";
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "21710069";

/** tags multi-checkbox values that mark a completed project as a production issue. */
const PRODUCTION_ISSUE_DEAL_TAGS = [
  "Production Issue - 1 Year",
  "Production Issue - 180 Days",
] as const;

const DEAL_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "pb_location",
  "address",
  "city",
  "state",
  "zip",
  "tags",
  "hs_v2_date_entered_20440343", // date entered Project Complete stage
  "closedate",
];

function ageDaysFrom(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const ms = Date.now() - then.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}

/**
 * PROJECT-pipeline deals at Project Complete whose `tags` contains a
 * production-issue value. `tags` is a multi-enum, so HubSpot requires one
 * CONTAINS_TOKEN filter per value, OR'd via separate filterGroups.
 */
async function fetchProductionIssueDeals(): Promise<ServiceProductionIssue[]> {
  const baseFilters = [
    { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PROJECT_PIPELINE_ID },
    { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: PROJECT_COMPLETE_STAGE_ID },
  ];

  const out: ServiceProductionIssue[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  do {
    const response = await searchWithRetry({
      // OR across tag values: one group per tag, each AND'd with pipeline+stage.
      filterGroups: PRODUCTION_ISSUE_DEAL_TAGS.map((tag) => ({
        filters: [
          ...baseFilters,
          { propertyName: "tags", operator: FilterOperatorEnum.ContainsToken, value: tag },
        ],
      })),
      properties: DEAL_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    } as never);

    for (const d of response.results ?? []) {
      const p = d.properties as Record<string, string | undefined>;
      const id = String(p.hs_object_id || d.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const tagList = (p.tags || "").split(";").map((t) => t.trim());
      const matchedTag =
        PRODUCTION_ISSUE_DEAL_TAGS.find((t) => tagList.includes(t)) || "Production Issue";

      const address =
        [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ") || null;
      const date = p.hs_v2_date_entered_20440343 || p.closedate || null;

      out.push({
        source: "deal",
        id,
        customerName: p.dealname || null,
        address,
        location: p.pb_location || null,
        issue: matchedTag,
        date,
        ageDays: ageDaysFrom(date),
        hubspotUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/deal/${id}`,
      });
    }

    const nextAfter = response.paging?.next?.after;
    after = nextAfter && (response.results?.length ?? 0) > 0 ? nextAfter : undefined;
  } while (after);

  return out;
}

export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  try {
    // Machine-to-machine token gate (browser requests authenticated by middleware).
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.API_SECRET_TOKEN;
    if (expectedToken && authHeader && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.HUBSPOT_ACCESS_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "HUBSPOT_ACCESS_TOKEN not configured" },
        { status: 500 }
      );
    }

    const [tickets, deals] = await Promise.all([
      fetchProductionIssueTickets(),
      fetchProductionIssueDeals(),
    ]);

    const ticketIssues: ServiceProductionIssue[] = tickets.map((t) => ({
      source: "ticket",
      id: t.id,
      customerName: t.subject,
      address: t.address,
      location: t.location,
      issue: t.category,
      date: t.createDate,
      ageDays: ageDaysFrom(t.createDate),
      hubspotUrl: t.url,
    }));

    // Merge + sort oldest-first (highest age first); nulls last.
    const issues = [...ticketIssues, ...deals].sort((a, b) => {
      if (a.ageDays === null) return 1;
      if (b.ageDays === null) return -1;
      return b.ageDays - a.ageDays;
    });

    return NextResponse.json({
      issues,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
