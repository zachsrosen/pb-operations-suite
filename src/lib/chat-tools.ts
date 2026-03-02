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
import { SKILL_ALLOWED_ROLES, type SkillName } from "@/lib/checks/types";
import "@/lib/checks/design-review";
import "@/lib/checks/engineering-review";
import "@/lib/checks/sales-advisor";

const REVIEW_SKILLS = [
  "design-review",
  "engineering-review",
  "sales-advisor",
] as const satisfies ReadonlyArray<SkillName>;

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
      "Get the latest review results for a deal, optionally filtered by skill",
    inputSchema: z.object({
      dealId: z.string().describe("HubSpot deal ID"),
      skill: z
        .string()
        .optional()
        .describe(
          "Optional: design-review, engineering-review, or sales-advisor"
        ),
    }),
    run: async (input) => {
      const { prisma } = await import("@/lib/db");
      if (!prisma) return JSON.stringify([]);
      const reviews = await prisma.projectReview.findMany({
        where: {
          dealId: input.dealId,
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
      "Run a deterministic project review check and persist the result for the specified deal and skill",
    inputSchema: z.object({
      dealId: z.string().describe("HubSpot deal ID"),
      skill: z.enum(REVIEW_SKILLS).describe("Review skill to run"),
    }),
    run: async (input) => {
      const skill = input.skill as SkillName;
      const allowedRoles = SKILL_ALLOWED_ROLES[skill];
      if (!allowedRoles.includes(context.role)) {
        return JSON.stringify({
          error: `Insufficient permissions for ${skill}`,
          allowedRoles,
          role: context.role,
        });
      }

      const [{ hubspotClient }, { prisma }] = await Promise.all([
        import("@/lib/hubspot"),
        import("@/lib/db"),
      ]);

      const deal = await hubspotClient.crm.deals.basicApi.getById(
        input.dealId,
        [...REVIEW_DEAL_PROPERTIES]
      );
      const properties = deal.properties as Record<string, string | null>;
      const result = await runChecks(skill, { dealId: input.dealId, properties });
      const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
      const projectId = projectIdMatch?.[0] ?? null;

      if (!prisma) {
        return JSON.stringify({
          ...result,
          persisted: false,
          error: "Database not configured",
        });
      }

      const review = await prisma.projectReview.create({
        data: {
          dealId: input.dealId,
          projectId,
          skill,
          trigger: "manual",
          triggeredBy: context.email,
          findings: JSON.parse(JSON.stringify(result.findings)),
          errorCount: result.errorCount,
          warningCount: result.warningCount,
          passed: result.passed,
          durationMs: result.durationMs,
        },
      });

      return JSON.stringify({
        id: review.id,
        ...result,
        persisted: true,
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
    filterDealsByStage,
    countDealsByStage,
  ];
}
