import { NextResponse } from "next/server";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { getCurrentUser } from "@/lib/auth-utils";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import { searchWithRetry } from "@/lib/hubspot";
import { getStageMaps } from "@/lib/deals-pipeline";
import {
  transformDeal,
  computeSummary,
  PAYMENT_TRACKING_PROPERTIES,
} from "@/lib/payment-tracking";
import { initPaymentTrackingCascade } from "@/lib/payment-tracking-cache";
import type {
  HubSpotDealPaymentProps,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";

// Ensure cascade listener is initialized once per process. Safe to call
// repeatedly — the listener is idempotent.
initPaymentTrackingCascade();

const ALLOWED_ROLES = new Set(["ADMIN", "EXECUTIVE", "ACCOUNTING"]);

// Terminal stage IDs per pipeline. HubSpot's search API has been observed to
// silently return empty results when combining `pipeline IN […]` with
// `dealstage NOT_IN […]`, so we query each pipeline separately with `Eq` on
// pipeline (mirroring the pattern in service/priority-queue and pe-deals).
const TERMINAL_STAGES_BY_PIPELINE: Record<string, string[]> = {
  // Sales pipeline: HubSpot's default pipeline uses string stage IDs
  default: ["closedlost"],
  // Project pipeline (6900017): numeric stage IDs
  "6900017": ["68229433" /* Cancelled */],
};

type SearchBody = Parameters<typeof searchWithRetry>[0];
type SearchFilter = { propertyName: string; operator: FilterOperatorEnum; value?: string; values?: string[] };

async function fetchPipelineDeals(pipelineId: string): Promise<HubSpotDealPaymentProps[]> {
  const terminal = TERMINAL_STAGES_BY_PIPELINE[pipelineId] ?? [];
  const props: HubSpotDealPaymentProps[] = [];

  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const filters: SearchFilter[] = [
      { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId } as SearchFilter,
    ];
    if (terminal.length > 0) {
      filters.push({
        propertyName: "dealstage",
        operator: FilterOperatorEnum.NotIn,
        values: terminal,
      } as SearchFilter);
    }

    const response = await searchWithRetry({
      filterGroups: [{ filters }],
      properties: PAYMENT_TRACKING_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    } as SearchBody);

    const results = response.results ?? [];
    for (const r of results) {
      props.push(r.properties as unknown as HubSpotDealPaymentProps);
    }
    const nextAfter = response.paging?.next?.after;
    if (nextAfter && results.length > 0) {
      after = nextAfter;
    } else {
      break;
    }
  }

  return props;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.some((r: string) => ALLOWED_ROLES.has(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cached = appCache.get<PaymentTrackingResponse>(CACHE_KEYS.PAYMENT_TRACKING);
  if (cached) return NextResponse.json(cached);

  const salesPipeline = process.env.HUBSPOT_PIPELINE_SALES ?? "default";
  const projectPipeline = process.env.HUBSPOT_PIPELINE_PROJECT ?? "6900017";

  // Fetch each pipeline in parallel.
  const [salesProps, projectProps] = await Promise.all([
    fetchPipelineDeals(salesPipeline),
    fetchPipelineDeals(projectPipeline),
  ]);

  const props = [...salesProps, ...projectProps];

  console.log(
    `[payment-tracking] fetched ${salesProps.length} sales + ${projectProps.length} project deals`
  );

  const maps = await getStageMaps().catch(() => ({} as Record<string, Record<string, string>>));
  const mergedStageMap: Record<string, string> = {
    ...(maps[salesPipeline] ?? {}),
    ...(maps[projectPipeline] ?? {}),
  };

  const asOf = new Date();
  const deals = props.map((p) =>
    transformDeal(p, asOf, (stageId) => mergedStageMap[stageId] ?? stageId)
  );

  const summary = computeSummary(deals);
  const response: PaymentTrackingResponse = {
    lastUpdated: asOf.toISOString(),
    summary,
    deals,
  };

  appCache.set(CACHE_KEYS.PAYMENT_TRACKING, response);
  return NextResponse.json(response);
}
