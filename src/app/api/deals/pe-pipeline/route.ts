import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import {
  searchWithRetry,
  DEAL_STAGE_MAP,
  fetchPrimaryContactId,
  hubspotClient,
} from "@/lib/hubspot";
import { appCache } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { getZuperJobUrl } from "@/lib/external-links";

/**
 * GET /api/deals/pe-pipeline
 *
 * Returns PE-enrolled deals in Construction and Inspection stages with
 * days-in-stage computed from hs_v2_date_entered_current_stage.
 * Used by the PE Pipeline Tracker dashboard to surface stale deals.
 */

const PE_STAGE_IDS = ["20440342", "22580872"]; // Construction, Inspection

const PROPERTIES = [
  "dealname",
  "dealstage",
  "pb_location",
  "hs_v2_date_entered_current_stage",
  "pe_m1_status",
  "pe_m2_status",
  "amount",
  "is_participate_energy",
  "install_status",
  "final_inspection_status",
];

interface ZuperJobLink {
  jobUid: string;
  category: string;
  status: string;
  url: string;
}

interface PeDocReview {
  docName: string;
  status: string;
  notes: string | null;
  reviewedAt: string;
}

interface PeActionItemSummary {
  id: string;
  docLabel: string;
  errorCode: string | null;
  pageNumber: number | null;
  reviewer: string;
  notes: string | null;
  actionDate: string;
  resolved: boolean;
}

interface PePipelineDeal {
  dealId: string;
  dealName: string;
  stage: string;
  location: string;
  daysInStage: number;
  dateEnteredStage: string | null;
  m1Status: string | null;
  m2Status: string | null;
  amount: number | null;
  contactName: string | null;
  constructionStatus: string | null;
  finalInspectionStatus: string | null;
  zuperJobs: ZuperJobLink[];
  docReviews: PeDocReview[];
  actionItems: PeActionItemSummary[];
  actionRequired: number;
  docsApproved: number;
  totalDocs: number;
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

    const CACHE_KEY = "pe-pipeline-tracker";
    const { data, cached, stale, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEY,
      async () => {
        // Search HubSpot for PE deals in Construction or Inspection.
        // HubSpot filter groups are OR'd; filters within a group are AND'd.
        // Two groups: one per stage, both requiring is_participate_energy + pipeline.
        const commonFilters = [
          {
            propertyName: "is_participate_energy",
            operator: "EQ" as const,
            value: "true",
          },
          {
            propertyName: "pipeline",
            operator: "EQ" as const,
            value: "6900017",
          },
        ];

        const results: Array<{ id: string; properties: Record<string, string | null> }> = [];
        let after: string | undefined;

        do {
          const searchRequest = {
            filterGroups: PE_STAGE_IDS.map((stageId) => ({
              filters: [
                {
                  propertyName: "dealstage",
                  operator: "EQ" as const,
                  value: stageId,
                },
                ...commonFilters,
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

        // Batch-resolve primary contacts (best-effort, 5s timeout per)
        const contactMap = new Map<string, string | null>();
        const contactPromises = results.map(async (deal) => {
          try {
            const contactId = await Promise.race([
              fetchPrimaryContactId(deal.id),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
            ]);
            if (contactId) {
              const contact = await hubspotClient.crm.contacts.basicApi.getById(
                contactId,
                ["firstname", "lastname"],
              );
              const first = contact.properties?.firstname ?? "";
              const last = contact.properties?.lastname ?? "";
              contactMap.set(deal.id, [first, last].filter(Boolean).join(" ") || null);
            }
          } catch {
            // Best-effort — skip contact on failure
          }
        });
        await Promise.allSettled(contactPromises);

        const dealIds = results.map((r) => r.id);

        // Parallel fetch: Zuper jobs, PE doc reviews, PE action items
        const [zuperRows, docReviewRows, actionItemRows] = await Promise.all([
          dealIds.length > 0
            ? prisma.zuperJobCache.findMany({
                where: { hubspotDealId: { in: dealIds } },
                select: { jobUid: true, jobCategory: true, jobStatus: true, hubspotDealId: true },
              })
            : [],
          dealIds.length > 0
            ? prisma.peDocumentReview.findMany({
                where: { dealId: { in: dealIds } },
                select: { dealId: true, docName: true, status: true, notes: true, reviewedAt: true },
              })
            : [],
          dealIds.length > 0
            ? prisma.peActionItem.findMany({
                where: { dealId: { in: dealIds } },
                select: {
                  id: true, dealId: true, docLabel: true, errorCode: true,
                  pageNumber: true, reviewer: true, notes: true, actionDate: true, resolvedAt: true,
                },
                orderBy: { actionDate: "desc" },
              })
            : [],
        ]);

        const zuperByDeal = new Map<string, ZuperJobLink[]>();
        for (const row of zuperRows) {
          if (!row.hubspotDealId) continue;
          const url = getZuperJobUrl(row.jobUid);
          if (!url) continue;
          const list = zuperByDeal.get(row.hubspotDealId) ?? [];
          list.push({ jobUid: row.jobUid, category: row.jobCategory, status: row.jobStatus, url });
          zuperByDeal.set(row.hubspotDealId, list);
        }

        // Index doc reviews by deal
        const docsByDeal = new Map<string, PeDocReview[]>();
        for (const row of docReviewRows) {
          const list = docsByDeal.get(row.dealId) ?? [];
          list.push({
            docName: row.docName,
            status: row.status,
            notes: row.notes,
            reviewedAt: row.reviewedAt.toISOString(),
          });
          docsByDeal.set(row.dealId, list);
        }

        // Index action items by deal
        const actionsByDeal = new Map<string, PeActionItemSummary[]>();
        for (const row of actionItemRows) {
          if (!row.dealId) continue;
          const list = actionsByDeal.get(row.dealId) ?? [];
          list.push({
            id: row.id,
            docLabel: row.docLabel,
            errorCode: row.errorCode,
            pageNumber: row.pageNumber,
            reviewer: row.reviewer,
            notes: row.notes,
            actionDate: row.actionDate.toISOString(),
            resolved: row.resolvedAt !== null,
          });
          actionsByDeal.set(row.dealId, list);
        }

        const deals: PePipelineDeal[] = results.map((deal) => {
          const props = deal.properties;
          const stageId = props.dealstage ?? "";
          const docs = docsByDeal.get(deal.id) ?? [];
          const actions = actionsByDeal.get(deal.id) ?? [];
          return {
            dealId: deal.id,
            dealName: props.dealname ?? `Deal ${deal.id}`,
            stage: DEAL_STAGE_MAP[stageId] ?? stageId,
            location: props.pb_location ?? "",
            daysInStage: computeDaysInStage(props.hs_v2_date_entered_current_stage),
            dateEnteredStage: props.hs_v2_date_entered_current_stage ?? null,
            m1Status: props.pe_m1_status || null,
            m2Status: props.pe_m2_status || null,
            amount: props.amount ? parseFloat(props.amount) : null,
            contactName: contactMap.get(deal.id) ?? null,
            constructionStatus: props.install_status || null,
            finalInspectionStatus: props.final_inspection_status || null,
            zuperJobs: zuperByDeal.get(deal.id) ?? [],
            docReviews: docs,
            actionItems: actions,
            actionRequired: docs.filter((d) => d.status === "ACTION_REQUIRED").length,
            docsApproved: docs.filter((d) => d.status === "APPROVED").length,
            totalDocs: docs.length,
          };
        });

        // Sort by days-in-stage descending (stalest first)
        deals.sort((a, b) => b.daysInStage - a.daysInStage);

        return { deals };
      },
    );

    return NextResponse.json({ ...data, cached, stale, lastUpdated });
  } catch (error) {
    console.error("[pe-pipeline] Error fetching PE pipeline deals:", error);
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("429") || message.includes("RATE_LIMIT")) {
      return NextResponse.json(
        { error: "HubSpot API rate limited. Please try again shortly." },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: "Failed to fetch PE pipeline data", details: message },
      { status: 500 },
    );
  }
}
