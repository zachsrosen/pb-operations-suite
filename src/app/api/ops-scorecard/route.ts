import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { fetchAllProjects, searchWithRetry, Project } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { getDealSyncSource } from "@/lib/deal-sync";
import { dealToProject } from "@/lib/deal-reader";
import { prisma } from "@/lib/db";
import { computeOpsScorecard, median, TopFunnelCounts, SalesForecastInputs } from "@/lib/ops-scorecard";

export const dynamic = "force-dynamic";

const SCORECARD_TTL = 30 * 60 * 1000; // 30 minutes
const SCORECARD_STALE_TTL = 60 * 60 * 1000;

/**
 * GET /api/ops-scorecard
 *
 * Server-computed Operations Scorecard (see docs/superpowers/specs/
 * 2026-07-18-ops-scorecard-dashboard-design.md). All metric math lives in
 * src/lib/ops-scorecard.ts; this route only sources the full Project
 * population (ALL pipeline stages — completed and cancelled deals are
 * required for historical counts and cancellation cohorts) and caches the
 * result. Access is role-gated by middleware (ADMIN/OWNER wildcard,
 * OPERATIONS_MANAGER, PROJECT_MANAGER).
 */
export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";

    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.OPS_SCORECARD,
      async () => {
        const [projects, topFunnel] = await Promise.all([
          loadAllProjects(),
          fetchTopFunnel(),
        ]);
        const forecastInputs = await fetchForecastInputs(projects);
        return computeOpsScorecard(projects, new Date(), topFunnel, forecastInputs);
      },
      forceRefresh,
      { ttl: SCORECARD_TTL, staleTtl: SCORECARD_STALE_TTL }
    );

    return NextResponse.json(
      { scorecard: data, cached, stale, lastUpdated },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (error) {
    Sentry.captureException(error);
    console.error("[ops-scorecard] failed:", error);
    return NextResponse.json(
      { error: "Failed to compute ops scorecard" },
      { status: 500 }
    );
  }
}

/**
 * Full Project-pipeline population (no stage exclusions), honoring the
 * deal-mirror feature flag the same way /api/projects does.
 */
async function loadAllProjects(): Promise<Project[]> {
  const syncSource = await getDealSyncSource("projects");
  if (syncSource === "local" || syncSource === "local-with-verify") {
    const deals = await prisma.deal.findMany({ where: { pipeline: "PROJECT" } });
    const projects = deals.map(dealToProject);
    // The Deal mirror doesn't sync cancellation_date or first_consult_date
    // (deal-reader hardcodes both null), but the cancellation cohorts and the
    // consult → sale leg need them. Overlay each from a scoped HubSpot query.
    const [cancelledDates, consultDates] = await Promise.all([
      fetchCancelledDates(),
      fetchFirstConsultDates(),
    ]);
    for (const p of projects) {
      const d = cancelledDates.get(String(p.id));
      if (d) p.cancelledDate = d;
      const c = consultDates.get(String(p.id));
      if (c) p.firstConsultDate = c;
    }
    return projects;
  }
  const { data } = await appCache.getOrFetch<Project[]>(
    CACHE_KEYS.PROJECTS_ALL,
    () => fetchAllProjects({ activeOnly: false })
  );
  return data || [];
}

const CANCELLED_STAGE_ID = "68229433";

/** dealId → cancellation_date (YYYY-MM-DD) for all cancelled Project-pipeline deals. */
async function fetchCancelledDates(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let after: string | undefined;
  do {
    const response = await searchWithRetry({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: "6900017" },
            { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: CANCELLED_STAGE_ID },
          ],
        },
      ],
      properties: ["cancellation_date"],
      limit: 100,
      after,
    });
    for (const deal of response.results) {
      const d = deal.properties.cancellation_date;
      if (d) out.set(deal.id, d.slice(0, 10));
    }
    after = response.paging?.next?.after;
  } while (after);
  return out;
}

// ---------------------------------------------------------------------------
// Top of funnel — leads + consults (outside the Project pipeline)
// ---------------------------------------------------------------------------

/**
 * Leads = deals created in the Sales Pipeline ("default"); consults set =
 * meeting engagements titled consult* (matches "Consult", "Consultation", any
 * case) excluding Canceled ones — the same definitions as Matt's scorecard
 * artifact (verified to reproduce its FY24/FY25 numbers exactly). Only the
 * search `total` is read, so the 10k pagination cap doesn't apply. Returns
 * null on failure so the page can hide the rows rather than 500.
 */
async function fetchTopFunnel(): Promise<{
  leads: TopFunnelCounts;
  consults: TopFunnelCounts;
  monthly: { leads: Record<string, number>; consults: Record<string, number> };
} | null> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) return null;

  const searchTotal = async (
    objectType: "deals" | "meetings",
    filters: Array<Record<string, string>>
  ): Promise<number> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://api.hubapi.com/crm/v3/objects/${objectType}/search`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`${objectType} search ${res.status}`);
      const body = (await res.json()) as { total: number };
      return body.total;
    }
    throw new Error(`${objectType} search rate-limited after retries`);
  };

  const epochMs = (d: string) => String(Date.parse(`${d}T00:00:00Z`));
  const epochMsEnd = (d: string) => String(Date.parse(`${d}T23:59:59Z`));

  const now = new Date();
  const cy = now.getUTCFullYear();
  const monthDay = now.toISOString().slice(5, 10);

  const leadsIn = (lo: string, hi: string) =>
    searchTotal("deals", [
      { propertyName: "pipeline", operator: "EQ", value: "default" },
      { propertyName: "createdate", operator: "BETWEEN", value: epochMs(lo), highValue: epochMsEnd(hi) },
    ]);
  const consultsIn = (lo: string, hi: string) =>
    searchTotal("meetings", [
      { propertyName: "hs_meeting_title", operator: "CONTAINS_TOKEN", value: "consult*" },
      { propertyName: "hs_meeting_title", operator: "NOT_CONTAINS_TOKEN", value: "Canceled" },
      { propertyName: "hs_meeting_start_time", operator: "BETWEEN", value: epochMs(lo), highValue: epochMsEnd(hi) },
    ]);

  const windows: Record<keyof TopFunnelCounts, [string, string]> = {
    py2: [`${cy - 2}-01-01`, `${cy - 2}-12-31`],
    py: [`${cy - 1}-01-01`, `${cy - 1}-12-31`],
    ytd: [`${cy}-01-01`, `${cy}-${monthDay}`],
    py2SamePoint: [`${cy - 2}-01-01`, `${cy - 2}-${monthDay}`],
    pySamePoint: [`${cy - 1}-01-01`, `${cy - 1}-${monthDay}`],
  };

  try {
    const keys = Object.keys(windows) as Array<keyof TopFunnelCounts>;
    const leads = {} as TopFunnelCounts;
    const consults = {} as TopFunnelCounts;
    // Sequential to stay under HubSpot's per-second search limit.
    for (const key of keys) {
      const [lo, hi] = windows[key];
      leads[key] = await leadsIn(lo, hi);
      consults[key] = await consultsIn(lo, hi);
    }
    // Current-year monthly counts for the monthly funnel table.
    const monthly = { leads: {} as Record<string, number>, consults: {} as Record<string, number> };
    for (let mo = 1; mo <= now.getUTCMonth() + 1; mo++) {
      const mm = String(mo).padStart(2, "0");
      const lo = `${cy}-${mm}-01`;
      const lastDay = new Date(Date.UTC(cy, mo, 0)).getUTCDate();
      const hi = `${cy}-${mm}-${String(lastDay).padStart(2, "0")}`;
      monthly.leads[`${cy}-${mm}`] = await leadsIn(lo, hi);
      monthly.consults[`${cy}-${mm}`] = await consultsIn(lo, hi);
    }
    return { leads, consults, monthly };
  } catch (error) {
    Sentry.captureException(error);
    console.error("[ops-scorecard] top-funnel fetch failed:", error);
    return null;
  }
}

/** dealId → first_consult_date for all stamped Project-pipeline deals. */
async function fetchFirstConsultDates(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let after: string | undefined;
  do {
    const response = await searchWithRetry({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: "6900017" },
            { propertyName: "first_consult_date", operator: FilterOperatorEnum.HasProperty },
          ],
        },
      ],
      properties: ["first_consult_date"],
      limit: 100,
      after,
    });
    for (const deal of response.results) {
      const d = deal.properties.first_consult_date;
      if (d) out.set(deal.id, d.slice(0, 10));
    }
    after = response.paging?.next?.after;
  } while (after);
  return out;
}

/**
 * Consult windows for the sales forecast. The lag comes from the stamped
 * first_consult_date data on deals sold in the last year; the two consult
 * counts reuse the meetings-search definition from fetchTopFunnel. Null until
 * enough stamped data exists (pre-backfill) or on fetch failure.
 */
async function fetchForecastInputs(
  projects: Array<{ closeDate: string | null; firstConsultDate: string | null }>
): Promise<SalesForecastInputs | null> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) return null;

  const now = Date.now();
  const yearAgo = new Date(now - 365 * 86_400_000).toISOString().slice(0, 10);
  const lags = projects
    .filter((p) => p.firstConsultDate && p.closeDate && p.closeDate >= yearAgo)
    .map((p) => (Date.parse(p.closeDate!) - Date.parse(p.firstConsultDate!)) / 86_400_000)
    .filter((d) => d >= 0 && d < 400);
  if (lags.length < 50) return null;
  const lagDays = Math.round(median(lags) ?? 0);

  const consultsBetween = async (loMs: number, hiMs: number): Promise<number> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch("https://api.hubapi.com/crm/v3/objects/meetings/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                { propertyName: "hs_meeting_title", operator: "CONTAINS_TOKEN", value: "consult*" },
                { propertyName: "hs_meeting_title", operator: "NOT_CONTAINS_TOKEN", value: "Canceled" },
                { propertyName: "hs_meeting_start_time", operator: "BETWEEN", value: String(loMs), highValue: String(hiMs) },
              ],
            },
          ],
          limit: 1,
        }),
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`meetings search ${res.status}`);
      return ((await res.json()) as { total: number }).total;
    }
    throw new Error("meetings search rate-limited after retries");
  };

  try {
    const day = 86_400_000;
    const consultsLast30 = await consultsBetween(now - 30 * day, now);
    const consultsRateWindow = await consultsBetween(
      now - (lagDays + 90) * day,
      now - lagDays * day
    );
    return { lagDays, consultsLast30, consultsRateWindow };
  } catch (error) {
    Sentry.captureException(error);
    console.error("[ops-scorecard] forecast inputs fetch failed:", error);
    return null;
  }
}
