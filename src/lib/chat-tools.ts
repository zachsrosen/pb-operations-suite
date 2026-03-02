/**
 * Chat Tool Definitions
 *
 * Tools that Claude can call during chat conversations.
 * Uses Anthropic's betaZodTool helper for type-safe tool execution.
 */

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { z } from "zod";
import { runChecks } from "@/lib/checks/runner";
import { SKILL_ALLOWED_ROLES } from "@/lib/checks/types";
import type { SkillName } from "@/lib/checks/types";
import {
  acquireReviewLock,
  touchReviewRun,
  completeReviewRun,
  failReviewRun,
  DuplicateReviewError,
} from "@/lib/review-lock";
import { safeWaitUntil } from "@/lib/safe-wait-until";
import "@/lib/checks/design-review";

const REVIEW_DEAL_PROPERTIES = [
  "dealname",
  "dealstage",
  "pipeline",
  "amount",
  "pb_location",
  "design_status",
  "permitting_status",
  "site_survey_status",
  "install_date",
  "inspection_date",
  "pto_date",
  "hubspot_owner_id",
  "closedate",
  // Phase 2: folder IDs for planset lookup + equipment for cross-reference
  "design_documents",
  "design_document_folder_id",
  "all_document_parent_folder_id",
  "system_size_kw",
  "module_type",
  "module_count",
  "inverter_type",
  "battery_type",
  "battery_count",
  "roof_type",
] as const;

interface ChatToolContext {
  email: string;
  role: string;
}

export function createChatTools(context: ChatToolContext) {
  const getDeal = betaZodTool({
    name: "get_deal",
    description: "Get HubSpot deal properties for a specific deal by ID",
    inputSchema: z.object({
      dealId: z.string().describe("HubSpot deal ID"),
    }),
    run: async (input) => {
      const { hubspotClient } = await import("@/lib/hubspot");
      const deal = await hubspotClient.crm.deals.basicApi.getById(
        input.dealId,
        [
          "dealname",
          "dealstage",
          "amount",
          "pb_location",
          "design_status",
          "permitting_status",
          "site_survey_status",
          "install_date",
          "inspection_date",
          "pto_date",
          "hubspot_owner_id",
          "closedate",
        ]
      );
      return JSON.stringify(deal.properties);
    },
  });

  const getReviewResults = betaZodTool({
    name: "get_review_results",
    description:
      "Get the latest completed review results for a deal, optionally filtered by skill",
    inputSchema: z.object({
      dealId: z.string().describe("HubSpot deal ID"),
      skill: z
        .string()
        .optional()
        .describe("Optional: design-review"),
    }),
    run: async (input) => {
      const { prisma } = await import("@/lib/db");
      if (!prisma) return JSON.stringify([]);
      const reviews = await prisma.projectReview.findMany({
        where: {
          dealId: input.dealId,
          status: "COMPLETED",
          ...(input.skill ? { skill: input.skill } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      return JSON.stringify(reviews);
    },
  });

  const searchDeals = betaZodTool({
    name: "search_deals",
    description:
      "Search HubSpot deals by text query (searches deal name, stage, location)",
    inputSchema: z.object({
      query: z.string().describe("Search text"),
    }),
    run: async (input) => {
      const { hubspotClient } = await import("@/lib/hubspot");
      const response = await hubspotClient.crm.deals.searchApi.doSearch({
        query: input.query,
        limit: 10,
        properties: ["dealname", "dealstage", "amount", "pb_location"],
        sorts: ["createdate"],
      });
      return JSON.stringify(
        response.results.map((r) => r.properties)
      );
    },
  });

  const runReview = betaZodTool({
    name: "run_review",
    description:
      "Start a design review for a deal. Returns immediately with a review ID. " +
      "Use get_review_status to check progress. Takes ~5-30s to complete.",
    inputSchema: z.object({
      dealId: z.string().describe("HubSpot deal ID"),
    }),
    run: async (input) => {
      const skill: SkillName = "design-review";
      const allowedRoles = SKILL_ALLOWED_ROLES[skill];
      if (!allowedRoles.includes(context.role)) {
        return JSON.stringify({
          error: `Insufficient permissions for ${skill}`,
          allowedRoles,
          role: context.role,
        });
      }

      // Acquire lock — fire-and-forget pattern
      let reviewId: string;
      try {
        reviewId = await acquireReviewLock(
          input.dealId,
          skill,
          "manual",
          context.email,
        );
      } catch (err) {
        if (err instanceof DuplicateReviewError) {
          // 409 attach flow — return existing run ID for polling
          return JSON.stringify({
            status: "already_running",
            reviewId: err.existingReviewId,
            message: `Design review already running for deal ${input.dealId}. Use get_review_status to check progress.`,
          });
        }
        throw err;
      }

      // Execute review in background — do NOT await
      const reviewPromise = (async () => {
        const start = Date.now();
        try {
          const { hubspotClient } = await import("@/lib/hubspot");
          const deal = await hubspotClient.crm.deals.basicApi.getById(
            input.dealId,
            [...REVIEW_DEAL_PROPERTIES]
          );
          const properties = deal.properties as Record<string, string | null>;
          const result = await runChecks(skill, { dealId: input.dealId, properties }, () => touchReviewRun(reviewId));
          const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
          const projectId = projectIdMatch?.[0] ?? null;

          await completeReviewRun(reviewId, {
            findings: result.findings,
            errorCount: result.errorCount,
            warningCount: result.warningCount,
            passed: result.passed,
            durationMs: Date.now() - start,
            projectId,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          await failReviewRun(reviewId, msg).catch(() => {});
        }
      })();

      // Anchor to Vercel runtime when available; falls back to fire-and-forget locally
      safeWaitUntil(reviewPromise);

      return JSON.stringify({
        status: "running",
        reviewId,
        message: `Design review started (ID: ${reviewId}). It takes ~5-30s. Use get_review_status to check progress.`,
      });
    },
  });

  const getReviewStatus = betaZodTool({
    name: "get_review_status",
    description:
      "Check the status of a running design review by its ID. " +
      "Returns status (running/completed/failed) and findings when complete.",
    inputSchema: z.object({
      reviewId: z.string().describe("Review ID returned by run_review"),
    }),
    run: async (input) => {
      const { prisma } = await import("@/lib/db");
      if (!prisma) return JSON.stringify({ error: "Database not configured" });

      const review = await prisma.projectReview.findUnique({
        where: { id: input.reviewId },
        select: {
          id: true,
          status: true,
          findings: true,
          errorCount: true,
          warningCount: true,
          passed: true,
          durationMs: true,
          error: true,
          createdAt: true,
          skill: true,
          dealId: true,
        },
      });

      if (!review) {
        return JSON.stringify({ error: "Review not found" });
      }

      if (review.status === "RUNNING") {
        return JSON.stringify({
          id: review.id,
          status: "running",
          dealId: review.dealId,
          startedAt: review.createdAt,
        });
      }

      if (review.status === "FAILED") {
        return JSON.stringify({
          id: review.id,
          status: "failed",
          dealId: review.dealId,
          error: review.error,
        });
      }

      // COMPLETED
      return JSON.stringify({
        id: review.id,
        status: "completed",
        dealId: review.dealId,
        findings: review.findings,
        errorCount: review.errorCount,
        warningCount: review.warningCount,
        passed: review.passed,
        durationMs: review.durationMs,
      });
    },
  });

  const filterDealsByStage = betaZodTool({
    name: "filter_deals_by_stage",
    description:
      "Find deals in a specific pipeline stage by stage display name, returning up to 20 matches",
    inputSchema: z.object({
      stage: z.string().describe("Stage display name, e.g. 'Construction'"),
    }),
    run: async (input) => {
      const { DEAL_STAGE_MAP, searchWithRetry } = await import("@/lib/hubspot");
      const normalizedStage = input.stage.trim().toLowerCase();

      const stageEntry =
        Object.entries(DEAL_STAGE_MAP).find(
          ([stageId, stageName]) =>
            stageName.toLowerCase() === normalizedStage ||
            stageId.toLowerCase() === normalizedStage
        ) ?? null;

      if (!stageEntry) {
        return JSON.stringify({
          error: `Unknown stage: ${input.stage}`,
          knownStages: Object.values(DEAL_STAGE_MAP),
        });
      }

      const [stageId, stageName] = stageEntry;
      const response = await searchWithRetry({
        filterGroups: [
          {
            filters: [
              {
                propertyName: "dealstage",
                operator: FilterOperatorEnum.Eq,
                value: stageId,
              },
            ],
          },
        ],
        limit: 20,
        properties: ["dealname", "dealstage", "amount", "pb_location"],
        sorts: ["createdate"],
      });

      const deals = response.results.map((deal) => ({
        dealId: deal.id,
        dealname: deal.properties?.dealname ?? "",
        dealstage: stageName,
        amount: deal.properties?.amount ?? "",
        pb_location: deal.properties?.pb_location ?? "",
      }));

      return JSON.stringify({
        stage: stageName,
        count: deals.length,
        deals,
      });
    },
  });

  const countDealsByStage = betaZodTool({
    name: "count_deals_by_stage",
    description: "Count active deals by stage in the project pipeline",
    inputSchema: z.object({}),
    run: async () => {
      const { fetchAllProjects } = await import("@/lib/hubspot");
      const projects = await fetchAllProjects({ activeOnly: true });
      const counts = projects.reduce<Record<string, number>>((acc, project) => {
        const stage = project.stage || "Unknown";
        acc[stage] = (acc[stage] ?? 0) + 1;
        return acc;
      }, {});

      return JSON.stringify({
        total: projects.length,
        counts,
      });
    },
  });

  return [
    getDeal,
    getReviewResults,
    searchDeals,
    runReview,
    getReviewStatus,
    filterDealsByStage,
    countDealsByStage,
  ];
}
