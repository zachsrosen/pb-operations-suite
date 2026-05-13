import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import {
  searchWithRetry,
  DEAL_STAGE_MAP,
} from "@/lib/hubspot";
import { appCache } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { getZuperJobUrl } from "@/lib/external-links";

/**
 * GET /api/deals/pipeline-tracker
 *
 * Returns all project-pipeline deals in Construction and Inspection stages
 * with days-in-stage. General-purpose version of the PE Pipeline Tracker.
 */

const STAGE_IDS = ["20461936", "20440342", "22580872"]; // Site Survey, Construction, Inspection

const PROPERTIES = [
  "dealname",
  "dealstage",
  "pb_location",
  "hs_v2_date_entered_current_stage",
  "amount",
  "is_participate_energy",
  "install_status",
  "final_inspection_status",
  "site_survey_status",
];

interface ZuperJobLink {
  jobUid: string;
  category: string;
  status: string;
  url: string;
}

interface PipelineDeal {
  dealId: string;
  dealName: string;
  stage: string;
  location: string;
  daysInStage: number;
  dateEnteredStage: string | null;
  amount: number | null;
  constructionStatus: string | null;
  finalInspectionStatus: string | null;
  siteSurveyStatus: string | null;
  isPE: boolean;
  zuperJobs: ZuperJobLink[];
}

function computeDaysInStage(dateEntered: string | null | undefined): number {
  if (!dateEntered) return 0;
  const entered = new Date(dateEntered);
  if (isNaN(entered.getTime())) return 0;
  const now = new Date();
  return Math.floor((now.getTime() - entered.getTime()) / (1000 * 60 * 60 * 24));
}

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const CACHE_KEY = "pipeline-tracker";
    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEY,
      async () => {
        const results: Array<{ id: string; properties: Record<string, string | null> }> = [];
        let after: string | undefined;

        do {
          const searchRequest = {
            filterGroups: STAGE_IDS.map((stageId) => ({
              filters: [
                {
                  propertyName: "dealstage",
                  operator: "EQ" as const,
                  value: stageId,
                },
                {
                  propertyName: "pipeline",
                  operator: "EQ" as const,
                  value: "6900017",
                },
              ],
            })),
            properties: PROPERTIES,
            limit: 100,
            sorts: [{ propertyName: "dealname", direction: "ASCENDING" as const }],
            ...(after ? { after } : {}),
          };

          const response = await searchWithRetry(
            searchRequest as unknown as Parameters<typeof searchWithRetry>[0],
          );
          results.push(...(response.results ?? []));
          after = response.paging?.next?.after;
        } while (after);

        const dealIds = results.map((r) => r.id);
        const zuperRows = dealIds.length > 0
          ? await prisma.zuperJobCache.findMany({
              where: { hubspotDealId: { in: dealIds } },
              select: { jobUid: true, jobCategory: true, jobStatus: true, hubspotDealId: true },
            })
          : [];
        const zuperByDeal = new Map<string, ZuperJobLink[]>();
        for (const row of zuperRows) {
          if (!row.hubspotDealId) continue;
          const url = getZuperJobUrl(row.jobUid);
          if (!url) continue;
          const list = zuperByDeal.get(row.hubspotDealId) ?? [];
          list.push({ jobUid: row.jobUid, category: row.jobCategory, status: row.jobStatus, url });
          zuperByDeal.set(row.hubspotDealId, list);
        }

        const deals: PipelineDeal[] = results.map((deal) => {
          const props = deal.properties;
          const stageId = props.dealstage ?? "";
          return {
            dealId: deal.id,
            dealName: props.dealname ?? `Deal ${deal.id}`,
            stage: DEAL_STAGE_MAP[stageId] ?? stageId,
            location: props.pb_location ?? "",
            daysInStage: computeDaysInStage(props.hs_v2_date_entered_current_stage),
            dateEnteredStage: props.hs_v2_date_entered_current_stage ?? null,
            amount: props.amount ? parseFloat(props.amount) : null,
            constructionStatus: props.install_status || null,
            finalInspectionStatus: props.final_inspection_status || null,
            siteSurveyStatus: props.site_survey_status || null,
            isPE: props.is_participate_energy === "true",
            zuperJobs: zuperByDeal.get(deal.id) ?? [],
          };
        });

        deals.sort((a, b) => b.daysInStage - a.daysInStage);

        return { deals };
      },
    );

    return NextResponse.json({ ...data, cached, stale, lastUpdated });
  } catch (error) {
    console.error("[pipeline-tracker] Error fetching pipeline deals:", error);
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("429") || message.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again shortly." },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch pipeline data", details: message },
      { status: 500 },
    );
  }
}
