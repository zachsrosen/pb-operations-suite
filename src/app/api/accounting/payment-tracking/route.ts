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
const CACHE_TTL_MS = 5 * 60 * 1000;

// Terminal stages to exclude from the payment-tracking view.
// Sales pipeline "Closed Lost"-style stages and Project pipeline "Cancelled"
// plus legacy string variants.
const TERMINAL_STAGES = [
  "closedlost",
  "closed_lost",
  "dead",
  "68229433", // Cancelled (Project pipeline)
];

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

  // Fetch deals from Sales + Project pipelines. Exclude terminal stages.
  const props: HubSpotDealPaymentProps[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const response = await searchWithRetry({
      filterGroups: [
        {
          filters: [
            { propertyName: "pipeline", operator: FilterOperatorEnum.In, values: [salesPipeline, projectPipeline] },
            { propertyName: "dealstage", operator: FilterOperatorEnum.NotIn, values: TERMINAL_STAGES },
          ],
        },
      ],
      properties: PAYMENT_TRACKING_PROPERTIES,
      limit: 100,
      ...(after ? { after } : {}),
    });

    for (const r of response.results ?? []) {
      props.push(r.properties as unknown as HubSpotDealPaymentProps);
    }
    const nextAfter = response.paging?.next?.after;
    if (nextAfter) {
      after = nextAfter;
    } else {
      break;
    }
  }

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

  appCache.set(CACHE_KEYS.PAYMENT_TRACKING, response, CACHE_TTL_MS);
  return NextResponse.json(response);
}
