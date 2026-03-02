/**
 * Chat Tool Definitions
 *
 * Tools that Claude can call during chat conversations.
 * Uses Anthropic's betaZodTool helper for type-safe tool execution.
 */

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export function createChatTools() {
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

  return [getDeal, getReviewResults, searchDeals];
}
