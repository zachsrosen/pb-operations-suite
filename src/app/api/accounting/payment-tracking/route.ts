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
import { attachInvoicesToDeals } from "@/lib/payment-tracking-invoices";
import { initPaymentTrackingCascade } from "@/lib/payment-tracking-cache";
import type {
  HubSpotDealPaymentProps,
  PaymentTrackingResponse,
} from "@/lib/payment-tracking-types";

// Ensure cascade listener is initialized once per process. Safe to call
// repeatedly — the listener is idempotent.
initPaymentTrackingCascade();

const ALLOWED_ROLES = new Set(["ADMIN", "EXECUTIVE", "ACCOUNTING"]);

// Project pipeline stages excluded from the payment-tracking view. Active
// deals are post-RTB / mid-construction / post-PTO but NOT yet wound down.
// We do NOT fetch the Sales pipeline at all — it's the entire sales funnel
// (~4,700 leads) with no payment activity. Won sales deals migrate to
// Project pipeline within hours.
const EXCLUDED_PROJECT_STAGES = [
  "68229433", // Cancelled
  "20440344", // On Hold
  "20461935", // Project Rejected - Needs Review
  "20440343", // Project Complete
];

type SearchBody = Parameters<typeof searchWithRetry>[0];
type SearchFilter = { propertyName: string; operator: FilterOperatorEnum; value?: string; values?: string[] };

async function fetchProjectPipelineDeals(pipelineId: string): Promise<HubSpotDealPaymentProps[]> {
  const props: HubSpotDealPaymentProps[] = [];

  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const filters: SearchFilter[] = [
      { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: pipelineId } as SearchFilter,
      {
        propertyName: "dealstage",
        operator: FilterOperatorEnum.NotIn,
        values: EXCLUDED_PROJECT_STAGES,
      } as SearchFilter,
    ];

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

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.some((r: string) => ALLOWED_ROLES.has(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const skipCache = url.searchParams.get("fresh") === "1";
  if (skipCache) {
    appCache.invalidate(CACHE_KEYS.PAYMENT_TRACKING);
    console.log(`[payment-tracking] cache invalidated by ?fresh=1`);
  }

  const cached = appCache.get<PaymentTrackingResponse>(CACHE_KEYS.PAYMENT_TRACKING);
  if (cached.hit && cached.data) {
    console.log(
      `[payment-tracking] served from cache: ${cached.data.deals.length} deals (stale=${cached.stale})`
    );
    return NextResponse.json(cached.data);
  }

  const projectPipeline = process.env.HUBSPOT_PIPELINE_PROJECT ?? "6900017";

  console.log(`[payment-tracking] cache miss; project pipeline=${projectPipeline}`);

  // Project pipeline only — Sales pipeline is the entire pre-sale funnel
  // (~4,700 leads) with no payment activity. Won deals migrate to Project
  // pipeline within hours.
  const props = await fetchProjectPipelineDeals(projectPipeline);

  console.log(`[payment-tracking] fetched ${props.length} project deals`);

  const maps = await getStageMaps().catch(() => ({} as Record<string, Record<string, string>>));
  const mergedStageMap: Record<string, string> = maps.project ?? {};
  console.log(
    `[payment-tracking] stage map size: ${Object.keys(mergedStageMap).length} entries`
  );

  const asOf = new Date();
  const deals = props.map((p) =>
    transformDeal(p, asOf, (stageId) => mergedStageMap[stageId] ?? stageId)
  );

  // Augment with invoice records (DA/CC via line item product, PE M1/M2 via
  // amount match). Failures are logged but don't break the page — falls back
  // to deal-property-only display for any deal where invoice fetch fails.
  try {
    await attachInvoicesToDeals(deals);
  } catch (err) {
    console.error("[payment-tracking] invoice attachment failed:", err);
  }

  const summary = computeSummary(deals);
  const response: PaymentTrackingResponse = {
    lastUpdated: asOf.toISOString(),
    summary,
    deals,
  };

  appCache.set(CACHE_KEYS.PAYMENT_TRACKING, response);
  return NextResponse.json(response);
}
