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

type StageRevenueFilter = {
  propertyName: string;
  operator: FilterOperatorEnum;
  value: string;
};

/**
 * Sum `amount` across EVERY deal matching the filters. Paginates to
 * completion (terminal stages like "Project Complete" can hold thousands of
 * deals), with a high safety bound of 50 pages (10,000 deals) so a runaway
 * query can't loop forever. `truncated` is true only if that bound is hit —
 * callers must not claim completeness when it is. Sample-based tools must
 * never report revenue from their sample alone; this gives them the true total.
 */
const REVENUE_PAGE_LIMIT = 50; // 50 × 200 = 10,000 deals
async function sumDealRevenue(
  filters: StageRevenueFilter[]
): Promise<{ totalRevenue: number; scanned: number; total: number; truncated: boolean }> {
  const { searchWithRetry } = await import("@/lib/hubspot");
  let total = 0;
  let scanned = 0;
  let totalRevenue = 0;
  let after: string | undefined;
  let truncated = false;
  for (let page = 0; page < REVENUE_PAGE_LIMIT; page++) {
    const req: {
      filterGroups: { filters: StageRevenueFilter[] }[];
      properties: string[];
      limit: number;
      after?: string;
    } = {
      filterGroups: [{ filters }],
      properties: ["amount"],
      limit: 200,
    };
    if (after) req.after = after;
    const res = await searchWithRetry(req);
    total = res.total ?? total;
    for (const d of res.results) {
      scanned++;
      totalRevenue += Number(d.properties?.amount) || 0;
    }
    after = res.paging?.next?.after;
    if (!after) break;
    if (page === REVENUE_PAGE_LIMIT - 1) truncated = true;
  }
  return { totalRevenue: Math.round(totalRevenue), scanned, total, truncated };
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
      "List deals in a specific pipeline stage. Returns the TRUE total count for the " +
      "stage plus a sample of up to 20 deals. For 'how many' questions, use the `total` " +
      "field — never the number of deals in the sample.",
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

      const total = response.total ?? deals.length;
      const revenue = await sumDealRevenue([
        { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: stageId },
      ]);
      const revenueNote = revenue.truncated
        ? `totalRevenue covers the first ${revenue.scanned} of ${total} deals (very large stage) — treat it as a floor, not exact.`
        : `totalRevenue covers ALL ${total} deals, not just the sample.`;
      return JSON.stringify({
        stage: stageName,
        total, // true number of deals in this stage
        totalRevenue: revenue.totalRevenue, // sum across ALL deals in the stage (see revenueTruncated)
        revenueTruncated: revenue.truncated,
        returned: deals.length, // how many are in the sample below
        truncated: total > deals.length,
        ...(total > deals.length
          ? {
              note: `Showing ${deals.length} of ${total}. ${revenueNote} This tool can't filter by sub-status (e.g. "waiting on DA to be sent") — don't infer that from this list.`,
            }
          : {}),
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

/**
 * Read-only subset of chat tools for contexts where write operations
 * (reviews, lock acquisition) are not appropriate — e.g. the Tech Ops bot.
 */
/**
 * Resolve a loose project reference (a PROJ number, a customer name/address, or
 * a raw HubSpot deal ID) to a single deal. Mirrors the matching the bot's task
 * tool uses: match exactly one or ask — never guess.
 */
async function resolveDealRef(
  raw: string
): Promise<
  | { dealId: string; dealName: string }
  | { candidates: Array<{ dealId: string; name: string }> }
  | { notFound: true }
> {
  const { searchWithRetry, hubspotClient } = await import("@/lib/hubspot");
  const q = raw.trim();

  // Long numeric → treat as a raw HubSpot deal ID.
  if (/^\d{8,}$/.test(q)) {
    try {
      const d = await hubspotClient.crm.deals.basicApi.getById(q, ["dealname"]);
      return { dealId: q, dealName: d.properties?.dealname ?? `deal ${q}` };
    } catch {
      return { notFound: true };
    }
  }

  // PROJ number (explicit "PROJ-1234" or a bare project number). Exact-match the
  // token on a word boundary so PROJ-123 never matches PROJ-1234.
  const projMatch = q.match(/PROJ[-\s]?(\d{2,})/i);
  const bareNum = q.match(/^(\d{3,7})$/);
  if (projMatch || bareNum) {
    const digits = (projMatch?.[1] ?? bareNum?.[1])!;
    const token = `PROJ-${digits}`;
    const res = await searchWithRetry({ query: token, limit: 20, properties: ["dealname"] });
    const boundary = new RegExp(`(^|[^0-9])PROJ-${digits}([^0-9]|$)`, "i");
    const matches = Array.from(
      new Map(
        (res.results ?? [])
          .filter((r) => boundary.test(r.properties?.dealname ?? ""))
          .map((r) => [r.id, r])
      ).values()
    );
    if (matches.length === 0) return { notFound: true };
    if (matches.length === 1)
      return { dealId: matches[0].id, dealName: matches[0].properties?.dealname ?? token };
    return {
      candidates: matches
        .slice(0, 5)
        .map((m) => ({ dealId: m.id, name: m.properties?.dealname ?? "" })),
    };
  }

  // Customer name or address → fuzzier full-text deal search.
  const res = await searchWithRetry({ query: q, limit: 20, properties: ["dealname"] });
  const matches = Array.from(new Map((res.results ?? []).map((r) => [r.id, r])).values());
  if (matches.length === 0) return { notFound: true };
  if (matches.length === 1)
    return { dealId: matches[0].id, dealName: matches[0].properties?.dealname ?? q };
  return {
    candidates: matches
      .slice(0, 6)
      .map((m) => ({ dealId: m.id, name: m.properties?.dealname ?? "" })),
  };
}

export function createReadOnlyChatTools() {
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
          "dealname", "dealstage", "amount", "pb_location",
          "design_status", "permitting_status", "site_survey_status",
          "install_date", "inspection_date", "pto_date",
          "hubspot_owner_id", "closedate",
        ]
      );
      return JSON.stringify(deal.properties);
    },
  });

  const searchDeals = betaZodTool({
    name: "search_deals",
    description: "Search HubSpot deals by text query (searches deal name, stage, location)",
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
      return JSON.stringify(response.results.map((r) => r.properties));
    },
  });

  const filterDealsByStage = betaZodTool({
    name: "filter_deals_by_stage",
    description:
      "List deals in a specific pipeline stage, optionally filtered to one PB location. " +
      "Returns the TRUE total count for the stage plus a sample of up to 20 deals. For " +
      "'how many' questions, use the `total` field — never the number of deals in the sample.",
    inputSchema: z.object({
      stage: z.string().describe("Stage display name, e.g. 'Construction'"),
      location: z
        .string()
        .optional()
        .describe(
          "Optional PB location/shop: Westminster (Westy), Centennial (DTC), " +
            "Colorado Springs (COSP), San Luis Obispo (SLO/California), Camarillo"
        ),
    }),
    run: async (input) => {
      const { DEAL_STAGE_MAP, searchWithRetry } = await import("@/lib/hubspot");
      const normalizedStage = input.stage.trim().toLowerCase();
      const stageEntry = Object.entries(DEAL_STAGE_MAP).find(
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

      // Resolve the optional location through the canonical normalizer
      // (handles aliases like Westy/DTC/COSP/SLO). Refuse rather than guess.
      let canonicalLocation: string | null = null;
      if (input.location) {
        const { normalizeLocation, CANONICAL_LOCATIONS } = await import("@/lib/locations");
        canonicalLocation = normalizeLocation(input.location);
        if (!canonicalLocation) {
          return JSON.stringify({
            error: `Unknown location: ${input.location}`,
            knownLocations: CANONICAL_LOCATIONS,
          });
        }
      }

      const [stageId, stageName] = stageEntry;
      const filters = [
        {
          propertyName: "dealstage",
          operator: FilterOperatorEnum.Eq,
          value: stageId,
        },
      ];
      if (canonicalLocation) {
        filters.push({
          propertyName: "pb_location",
          operator: FilterOperatorEnum.Eq,
          value: canonicalLocation,
        });
      }
      const response = await searchWithRetry({
        filterGroups: [{ filters }],
        limit: 20,
        properties: ["dealname", "dealstage", "amount", "pb_location"],
        sorts: ["createdate"],
      });

      const total = response.total ?? response.results.length;
      const returned = response.results.length;
      const revenue = await sumDealRevenue(filters);
      const revenueNote = revenue.truncated
        ? `totalRevenue covers the first ${revenue.scanned} of ${total} deals (very large stage) — treat it as a floor, not exact.`
        : `totalRevenue covers ALL ${total} deals, not just the sample.`;
      return JSON.stringify({
        stage: stageName,
        location: canonicalLocation ?? "all locations",
        total, // true number of deals in this stage (within the location, if given)
        totalRevenue: revenue.totalRevenue, // sum across ALL matching deals (see revenueTruncated)
        revenueTruncated: revenue.truncated,
        returned, // how many are in the `deals` sample below
        truncated: total > returned,
        ...(total > returned
          ? {
              note: `Showing ${returned} of ${total}. ${revenueNote} This tool can't filter by sub-status (e.g. "waiting on DA to be sent") — don't infer that from this list.`,
            }
          : {}),
        deals: response.results.map((deal) => ({
          dealId: deal.id,
          dealname: deal.properties?.dealname ?? "",
          dealstage: stageName,
          amount: deal.properties?.amount ?? "",
          pb_location: deal.properties?.pb_location ?? "",
        })),
      });
    },
  });

  const countDealsByStage = betaZodTool({
    name: "count_deals_by_stage",
    description:
      "Count active deals by stage in the project pipeline, optionally filtered to one PB location",
    inputSchema: z.object({
      location: z
        .string()
        .optional()
        .describe(
          "Optional PB location/shop: Westminster (Westy), Centennial (DTC), " +
            "Colorado Springs (COSP), San Luis Obispo (SLO/California), Camarillo"
        ),
    }),
    run: async (input) => {
      const { fetchAllProjects } = await import("@/lib/hubspot");

      let canonicalLocation: string | null = null;
      if (input.location) {
        const { normalizeLocation, CANONICAL_LOCATIONS } = await import("@/lib/locations");
        canonicalLocation = normalizeLocation(input.location);
        if (!canonicalLocation) {
          return JSON.stringify({
            error: `Unknown location: ${input.location}`,
            knownLocations: CANONICAL_LOCATIONS,
          });
        }
      }

      let projects = await fetchAllProjects({ activeOnly: true });
      if (canonicalLocation) {
        const { normalizeLocation } = await import("@/lib/locations");
        projects = projects.filter(
          (p) => normalizeLocation(p.pbLocation) === canonicalLocation
        );
      }
      const counts: Record<string, number> = {};
      const revenueByStage: Record<string, number> = {};
      let totalRevenue = 0;
      for (const project of projects) {
        const stage = project.stage || "Unknown";
        const amount = Number(project.amount) || 0;
        counts[stage] = (counts[stage] ?? 0) + 1;
        revenueByStage[stage] = Math.round((revenueByStage[stage] ?? 0) + amount);
        totalRevenue += amount;
      }
      return JSON.stringify({
        location: canonicalLocation ?? "all locations",
        total: projects.length,
        totalRevenue: Math.round(totalRevenue),
        counts,
        revenueByStage,
      });
    },
  });

  const countDealsByStatus = betaZodTool({
    name: "count_deals_by_status",
    description:
      "Break down active project-pipeline deals by a status dimension, covering the FULL " +
      "pipeline from survey to PTO. Use this for questions like 'how many are waiting on " +
      "DA to be sent', 'permitting status breakdown', 'construction status', 'how many " +
      "are waiting on inspection', or 'PTO status'. statusType: 'da' = the customer-facing " +
      "Design Approval (layout_status), 'design' = engineering design status, 'permitting', " +
      "'interconnection', 'site_survey', 'construction' (install status), 'inspection' " +
      "(final inspection), 'pto' (Permission To Operate — the utility milestone), " +
      "'pe_m1' or 'pe_m2' (Participate Energy milestone 1 / milestone 2 submission " +
      "statuses — PE deals only; values run Ready to Submit → Waiting on Information → " +
      "Submitted → Rejected → Ready to Resubmit → Resubmitted → Approved → Paid). " +
      "Optionally scope to one pipeline stage. Returns the TRUE count for each exact " +
      "status value — match the user's wording to the right bucket.",
    inputSchema: z.object({
      statusType: z.enum([
        "da",
        "design",
        "permitting",
        "interconnection",
        "site_survey",
        "construction",
        "inspection",
        "pto",
        "pe_m1",
        "pe_m2",
      ]),
      stage: z
        .string()
        .optional()
        .describe(
          "Optional pipeline stage display name to scope to, e.g. 'Design & Engineering'"
        ),
      location: z
        .string()
        .optional()
        .describe(
          "Optional PB location/shop: Westminster (Westy), Centennial (DTC), " +
            "Colorado Springs (COSP), San Luis Obispo (SLO/California), Camarillo"
        ),
    }),
    run: async (input) => {
      const { fetchAllProjects } = await import("@/lib/hubspot");
      const { statusLabel } = await import("@/lib/deal-status-labels");
      const { normalizeLocation, CANONICAL_LOCATIONS } = await import("@/lib/locations");

      let canonicalLocation: string | null = null;
      if (input.location) {
        canonicalLocation = normalizeLocation(input.location);
        if (!canonicalLocation) {
          return JSON.stringify({
            error: `Unknown location: ${input.location}`,
            knownLocations: CANONICAL_LOCATIONS,
          });
        }
      }

      const FIELD_MAP: Record<string, [string, string]> = {
        da: ["layoutStatus", "layout_status"],
        design: ["designStatus", "design_status"],
        permitting: ["permittingStatus", "permitting_status"],
        interconnection: ["interconnectionStatus", "interconnection_status"],
        site_survey: ["siteSurveyStatus", "site_survey_status"],
        // Downstream phases — HubSpot property "install_status" is labeled
        // "Construction Status" in the UI.
        construction: ["constructionStatus", "install_status"],
        inspection: ["finalInspectionStatus", "final_inspection_status"],
        pto: ["ptoStatus", "pto_status"],
        // Participate Energy milestones (PE deals only). statusLabel has no
        // map for these — it falls back to the raw value, which IS the
        // display value (Ready to Submit … Approved, Paid).
        pe_m1: ["peM1Status", "pe_m1_status"],
        pe_m2: ["peM2Status", "pe_m2_status"],
      };
      const [projField, propKey] = FIELD_MAP[input.statusType];
      const isPeMilestone =
        input.statusType === "pe_m1" || input.statusType === "pe_m2";

      let projects = await fetchAllProjects({ activeOnly: true });
      if (isPeMilestone) {
        projects = projects.filter((p) => p.isParticipateEnergy);
      }
      if (canonicalLocation) {
        projects = projects.filter(
          (p) => normalizeLocation(p.pbLocation) === canonicalLocation
        );
      }
      if (input.stage) {
        const want = input.stage.trim().toLowerCase();
        projects = projects.filter(
          (p) => (p.stage || "").toLowerCase() === want
        );
      }

      const counts: Record<string, number> = {};
      const revenueByStatus: Record<string, number> = {};
      let dealsWithThisStatus = 0;
      let totalRevenue = 0;
      for (const p of projects) {
        const raw = (p as unknown as Record<string, string | null>)[projField];
        const label = statusLabel(propKey, raw);
        if (!label) continue;
        const amount = Number(p.amount) || 0;
        counts[label] = (counts[label] ?? 0) + 1;
        revenueByStatus[label] = Math.round((revenueByStatus[label] ?? 0) + amount);
        dealsWithThisStatus++;
        totalRevenue += amount;
      }
      const sorted = Object.fromEntries(
        Object.entries(counts).sort((a, b) => b[1] - a[1])
      );

      // DA (layout) lifecycle phases. "Review In Progress" = INTERNAL review
      // before the DA is sent — pre-send, NOT the customer reviewing. Keyed by
      // display label (what `counts` uses). Confirmed taxonomy w/ Zach 2026-06.
      const DA_PHASE: Record<string, "not_yet_sent" | "with_customer" | "customer_responded"> = {
        "Review In Progress": "not_yet_sent",
        "Draft Complete": "not_yet_sent",
        "DA Revision Ready To Send": "not_yet_sent",
        "In Revision": "not_yet_sent",
        "Pending Review": "not_yet_sent",
        "Pending Sales Changes": "not_yet_sent",
        "Pending Ops Changes": "not_yet_sent",
        "Pending Design Changes": "not_yet_sent",
        "Pending Resurvey": "not_yet_sent",
        "Needs Clarification": "not_yet_sent",
        "Sent For Approval": "with_customer",
        "Resent For Approval": "with_customer",
        "Design Approved": "customer_responded",
        "Design Rejected": "customer_responded",
      };

      if (input.statusType === "da") {
        const phases = {
          not_yet_sent: { total: 0, statuses: {} as Record<string, number> },
          with_customer: { total: 0, statuses: {} as Record<string, number> },
          customer_responded: { total: 0, statuses: {} as Record<string, number> },
          unclassified: { total: 0, statuses: {} as Record<string, number> },
        };
        for (const [label, n] of Object.entries(counts)) {
          const phase = DA_PHASE[label] ?? "unclassified";
          phases[phase].total += n;
          phases[phase].statuses[label] = n;
        }
        return JSON.stringify({
          statusType: "da",
          stage: input.stage ?? "all stages",
          location: canonicalLocation ?? "all locations",
          totalDealsConsidered: projects.length,
          dealsWithThisStatus,
          totalRevenue: Math.round(totalRevenue),
          waitingToBeSent: phases.not_yet_sent.total, // = all pre-send (still on us)
          phases,
          counts: sorted,
          revenueByStatus,
          note: "DA = customer Design Approval (layout_status). 'Review In Progress' means we're reviewing INTERNALLY before sending — it is PRE-SEND, not the customer reviewing. 'Waiting on DA to be sent' = waitingToBeSent (phases.not_yet_sent: everything not yet with the customer). 'with_customer' = already sent.",
        });
      }

      return JSON.stringify({
        statusType: input.statusType,
        stage: input.stage ?? "all stages",
        location: canonicalLocation ?? "all locations",
        totalDealsConsidered: projects.length,
        dealsWithThisStatus,
        totalRevenue: Math.round(totalRevenue),
        counts: sorted,
        revenueByStatus,
        note: isPeMilestone
          ? "Scoped to active Participate Energy deals only (totalDealsConsidered = active PE deals). Deals with no status for this milestone haven't started it. Status flow: Ready to Submit → Waiting on Information → Submitted → Rejected → Ready to Resubmit → Resubmitted → Approved → Paid."
          : "Each key is an exact status value with its true count. Match the user's wording to the right bucket(s); if nothing fits, say so rather than guessing.",
      });
    },
  });

  const countMilestoneInDateRange = betaZodTool({
    name: "count_milestone_in_date_range",
    description:
      "Count project-pipeline deals that hit a milestone within a date range — e.g. " +
      "'how many DAs were approved June 1–10', 'permits issued last week', 'PTOs granted " +
      "this month'. Unlike the status tools, this searches ALL project deals (including " +
      "ones that have since completed or cancelled), so historical counts are accurate. " +
      "Returns the true total, a by-location breakdown, and total revenue. Milestones: " +
      "site_survey_completed, da_sent, da_approved, design_completed, permit_submitted, " +
      "permit_issued, interconnection_submitted, interconnection_approved, rtb, " +
      "construction_completed, inspection_passed, pto_submitted, pto_granted, " +
      "sales_closed, pe_m1_submitted, pe_m1_approved, pe_m2_submitted, pe_m2_approved.",
    inputSchema: z.object({
      milestone: z.enum([
        "site_survey_completed",
        "da_sent",
        "da_approved",
        "design_completed",
        "permit_submitted",
        "permit_issued",
        "interconnection_submitted",
        "interconnection_approved",
        "rtb",
        "construction_completed",
        "inspection_passed",
        "pto_submitted",
        "pto_granted",
        "sales_closed",
        "pe_m1_submitted",
        "pe_m1_approved",
        "pe_m2_submitted",
        "pe_m2_approved",
      ]),
      fromDate: z.string().describe("Start date, YYYY-MM-DD (inclusive)"),
      toDate: z.string().describe("End date, YYYY-MM-DD (inclusive)"),
      location: z
        .string()
        .optional()
        .describe(
          "Optional PB location/shop: Westminster (Westy), Centennial (DTC), " +
            "Colorado Springs (COSP), San Luis Obispo (SLO/California), Camarillo"
        ),
    }),
    run: async (input) => {
      const { searchWithRetry } = await import("@/lib/hubspot");

      // Milestone → HubSpot date property (names verified against the
      // DEAL_PROPERTIES fetch list / payment-tracking usage).
      const MILESTONE_DATE_PROP: Record<string, string> = {
        site_survey_completed: "site_survey_date",
        da_sent: "design_approval_sent_date",
        da_approved: "layout_approval_date",
        design_completed: "design_completion_date",
        permit_submitted: "permit_submit_date",
        permit_issued: "permit_completion_date",
        interconnection_submitted: "interconnections_submit_date",
        interconnection_approved: "interconnections_completion_date",
        rtb: "ready_to_build_date",
        construction_completed: "construction_complete_date",
        inspection_passed: "inspections_completion_date",
        pto_submitted: "pto_start_date",
        pto_granted: "pto_completion_date",
        sales_closed: "closedate",
        pe_m1_submitted: "pe_m1_submission_date",
        pe_m1_approved: "pe_m1_approval_date",
        pe_m2_submitted: "pe_m2_submission_date",
        pe_m2_approved: "pe_m2_approval_date",
      };
      const dateProp = MILESTONE_DATE_PROP[input.milestone];

      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      if (!DATE_RE.test(input.fromDate) || !DATE_RE.test(input.toDate)) {
        return JSON.stringify({
          error: "Dates must be YYYY-MM-DD",
        });
      }
      const fromMs = Date.parse(`${input.fromDate}T00:00:00.000Z`);
      const toMs = Date.parse(`${input.toDate}T23:59:59.999Z`);
      if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
        return JSON.stringify({
          error: `Invalid date range: ${input.fromDate} → ${input.toDate}`,
        });
      }

      let canonicalLocation: string | null = null;
      if (input.location) {
        const { normalizeLocation, CANONICAL_LOCATIONS } = await import("@/lib/locations");
        canonicalLocation = normalizeLocation(input.location);
        if (!canonicalLocation) {
          return JSON.stringify({
            error: `Unknown location: ${input.location}`,
            knownLocations: CANONICAL_LOCATIONS,
          });
        }
      }

      type RangeFilter = {
        propertyName: string;
        operator: typeof FilterOperatorEnum.Between;
        value: string;
        highValue: string;
      };
      type EqFilter = {
        propertyName: string;
        operator: typeof FilterOperatorEnum.Eq;
        value: string;
      };
      const filters: Array<RangeFilter | EqFilter> = [
        { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: "6900017" },
        {
          propertyName: dateProp,
          operator: FilterOperatorEnum.Between,
          value: String(fromMs),
          highValue: String(toMs),
        },
      ];
      if (canonicalLocation) {
        filters.push({
          propertyName: "pb_location",
          operator: FilterOperatorEnum.Eq,
          value: canonicalLocation,
        });
      }

      // Paginate (capped) to build location + revenue rollups; the headline
      // total comes from HubSpot and is always true.
      let total = 0;
      let scanned = 0;
      let totalRevenue = 0;
      const byLocation: Record<string, number> = {};
      let after: string | undefined;
      for (let page = 0; page < 5; page++) {
        const req: {
          filterGroups: { filters: typeof filters }[];
          properties: string[];
          limit: number;
          after?: string;
        } = {
          filterGroups: [{ filters }],
          properties: ["pb_location", "amount"],
          limit: 200,
        };
        if (after) req.after = after;
        const res = await searchWithRetry(req);
        total = res.total ?? total;
        for (const d of res.results) {
          scanned++;
          const loc = d.properties?.pb_location || "Unknown";
          byLocation[loc] = (byLocation[loc] ?? 0) + 1;
          totalRevenue += Number(d.properties?.amount) || 0;
        }
        after = res.paging?.next?.after;
        if (!after) break;
      }

      return JSON.stringify({
        milestone: input.milestone,
        dateProperty: dateProp,
        from: input.fromDate,
        to: input.toDate,
        location: canonicalLocation ?? "all locations",
        total, // true count from HubSpot
        totalRevenue: Math.round(totalRevenue),
        byLocation,
        ...(scanned < total
          ? {
              note: `Revenue and by-location rollups cover the first ${scanned} of ${total} deals; the total count is exact.`,
            }
          : {}),
        includes:
          "All project-pipeline deals, including ones that have since completed or cancelled — the milestone still happened in this window.",
      });
    },
  });

  const getProjectTeam = betaZodTool({
    name: "get_project_team",
    description:
      "Look up the PEOPLE on a project: the customer's contact info (name, phone, " +
      "email, address), the sales owner, and the assigned project manager (PM). " +
      "Accepts a PROJ number, a customer name/address, or a deal ID. Use this for " +
      "'who's the PM on PROJ-1234', 'what's the customer's phone number', 'who owns " +
      "this deal', 'what's the service address'.",
    inputSchema: z.object({
      project: z
        .string()
        .describe("PROJ number, customer name/address, or HubSpot deal ID"),
    }),
    run: async (input) => {
      const ref = await resolveDealRef(input.project);
      if ("notFound" in ref)
        return JSON.stringify({ error: `No deal found for "${input.project}".` });
      if ("candidates" in ref)
        return JSON.stringify({
          needsClarification: true,
          message: `"${input.project}" matches ${ref.candidates.length} deals — which one?`,
          candidates: ref.candidates,
        });

      const {
        getDealOwnerContact,
        getDealProjectManagerContact,
        fetchPrimaryContactId,
        fetchContactById,
      } = await import("@/lib/hubspot");

      const [owner, pm, contactId] = await Promise.all([
        getDealOwnerContact(ref.dealId),
        getDealProjectManagerContact(ref.dealId),
        fetchPrimaryContactId(ref.dealId),
      ]);

      let customer: Record<string, string | null> | string =
        "No primary contact linked to this deal.";
      if (contactId) {
        const c = await fetchContactById(contactId, [
          "firstname",
          "lastname",
          "email",
          "phone",
          "address",
          "city",
          "state",
          "zip",
        ]);
        if (c) {
          const p = c.properties;
          customer = {
            name: [p.firstname, p.lastname].filter(Boolean).join(" ") || null,
            email: p.email ?? null,
            phone: p.phone ?? null,
            address: [p.address, p.city, p.state, p.zip].filter(Boolean).join(", ") || null,
          };
        }
      }

      return JSON.stringify({
        project: ref.dealName,
        dealId: ref.dealId,
        customer,
        salesOwner: owner.ownerName
          ? { name: owner.ownerName, email: owner.ownerEmail }
          : "No sales owner set.",
        projectManager: pm.projectManagerName
          ? { name: pm.projectManagerName, email: pm.projectManagerEmail }
          : "No PM assigned.",
      });
    },
  });

  const getProjectService = betaZodTool({
    name: "get_project_service",
    description:
      "Look up SERVICE + FIELD activity for a project's customer: their service " +
      "tickets (subject + status) and Zuper field-service jobs (with scheduled " +
      "date, status, and assigned crew). Accepts a PROJ number, a customer " +
      "name/address, or a deal ID. Use this for 'are there open tickets on " +
      "PROJ-1234', 'is the install scheduled', 'which crew is on this job'.",
    inputSchema: z.object({
      project: z
        .string()
        .describe("PROJ number, customer name/address, or HubSpot deal ID"),
    }),
    run: async (input) => {
      const ref = await resolveDealRef(input.project);
      if ("notFound" in ref)
        return JSON.stringify({ error: `No deal found for "${input.project}".` });
      if ("candidates" in ref)
        return JSON.stringify({
          needsClarification: true,
          message: `"${input.project}" matches ${ref.candidates.length} deals — which one?`,
          candidates: ref.candidates,
        });

      const { fetchPrimaryContactId } = await import("@/lib/hubspot");
      const contactId = await fetchPrimaryContactId(ref.dealId);
      if (!contactId)
        return JSON.stringify({
          project: ref.dealName,
          note: "No primary contact linked to this deal, so I can't pull their tickets or jobs.",
        });

      const { resolveContactDetail } = await import("@/lib/customer-resolver");
      const detail = await resolveContactDetail(contactId);

      return JSON.stringify({
        project: ref.dealName,
        customer: [detail.firstName, detail.lastName].filter(Boolean).join(" ") || null,
        tickets: detail.tickets.map((t) => ({
          subject: t.subject,
          status: t.status,
          priority: t.priority,
          daysInStage: t.daysInStage ?? null,
        })),
        ticketCount: detail.tickets.length,
        zuperJobs: detail.jobs.map((j) => ({
          title: j.title,
          category: j.category,
          status: j.status,
          scheduledDate: j.scheduledDate,
          crew: j.assignedUsers ?? [],
        })),
      });
    },
  });

  const getPePayments = betaZodTool({
    name: "get_pe_payments",
    description:
      "Participate Energy (PE) payment money — the authoritative source for PE cash. " +
      "Returns how much PE has PAID us (cash received; all-time, or within a date " +
      "window when fromDate/toDate are given), plus the current outstanding buckets: " +
      "in transit (PE remitted, ACH not landed), approved but not yet sent, and " +
      "submitted awaiting PE review. Use for 'how much have we been paid by " +
      "Participate', 'PE cash received in June', 'how much does PE owe us'. " +
      "PE pays per milestone: M1 (~2/3, after inspection) and M2 (~1/3, after PTO).",
    inputSchema: z.object({
      fromDate: z
        .string()
        .optional()
        .describe("Optional window start, YYYY-MM-DD — scopes received/remitted to payments in the window"),
      toDate: z
        .string()
        .optional()
        .describe("Optional window end, YYYY-MM-DD (inclusive). Required if fromDate is set."),
    }),
    run: async (input) => {
      const { searchWithRetry } = await import("@/lib/hubspot");

      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const hasWindow = Boolean(input.fromDate || input.toDate);
      let fromMs = Number.NEGATIVE_INFINITY;
      let toMs = Number.POSITIVE_INFINITY;
      if (hasWindow) {
        if (!input.fromDate || !input.toDate || !DATE_RE.test(input.fromDate) || !DATE_RE.test(input.toDate)) {
          return JSON.stringify({ error: "Provide BOTH fromDate and toDate as YYYY-MM-DD, or neither." });
        }
        fromMs = Date.parse(`${input.fromDate}T00:00:00.000Z`);
        toMs = Date.parse(`${input.toDate}T23:59:59.999Z`);
        if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) {
          return JSON.stringify({ error: `Invalid date range: ${input.fromDate} → ${input.toDate}` });
        }
      }

      // One paginated scan of every Project-pipeline deal with a PE payment
      // split; every bucket is computed from the same date-gated logic as the
      // HubSpot pe_received_total / pe_in_review_total KPI properties.
      type PeDealProps = Record<string, string | null | undefined>;
      const rows: PeDealProps[] = [];
      let after: string | undefined;
      let peTruncated = false;
      const PE_PAGE_LIMIT = 50; // 50 × 200 = 10,000 PE deals — far above the fleet
      for (let page = 0; page < PE_PAGE_LIMIT; page++) {
        const req: {
          filterGroups: { filters: unknown[] }[];
          properties: string[];
          limit: number;
          after?: string;
        } = {
          filterGroups: [
            {
              filters: [
                { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: "6900017" },
                { propertyName: "pe_payment_ic", operator: FilterOperatorEnum.HasProperty },
              ],
            },
          ],
          properties: [
            "pe_payment_ic",
            "pe_payment_pc",
            "pe_m1_paid_date",
            "pe_m2_paid_date",
            "pe_m1_remittance_date",
            "pe_m2_remittance_date",
            "pe_m1_approval_date",
            "pe_m2_approval_date",
            "pe_m1_submission_date",
            "pe_m2_submission_date",
          ],
          limit: 200,
        };
        if (after) req.after = after;
        const res = await searchWithRetry(req as Parameters<typeof searchWithRetry>[0]);
        for (const d of res.results) rows.push(d.properties ?? {});
        after = res.paging?.next?.after;
        if (!after) break;
        if (page === PE_PAGE_LIMIT - 1) peTruncated = true;
      }

      const inWindow = (dateStr: string | null | undefined): boolean => {
        if (!dateStr) return false;
        const ms = Date.parse(dateStr);
        return !Number.isNaN(ms) && ms >= fromMs && ms <= toMs;
      };
      const bucket = () => ({ count: 0, amount: 0 });
      const received = { m1: bucket(), m2: bucket() };
      const remitted = { m1: bucket(), m2: bucket() };
      const inTransit = { m1: bucket(), m2: bucket() };
      const approvedNotSent = { m1: bucket(), m2: bucket() };
      const inReview = { m1: bucket(), m2: bucket() };

      for (const p of rows) {
        for (const m of ["m1", "m2"] as const) {
          const amount = Number(m === "m1" ? p.pe_payment_ic : p.pe_payment_pc) || 0;
          if (!amount) continue;
          const paid = p[`pe_${m}_paid_date`];
          const remit = p[`pe_${m}_remittance_date`];
          const approval = p[`pe_${m}_approval_date`];
          const submission = p[`pe_${m}_submission_date`];
          if (paid && inWindow(paid)) {
            received[m].count++;
            received[m].amount += amount;
          }
          if (remit && inWindow(remit)) {
            remitted[m].count++;
            remitted[m].amount += amount;
          }
          // Outstanding buckets are a CURRENT snapshot — never window-scoped.
          if (remit && !paid) {
            inTransit[m].count++;
            inTransit[m].amount += amount;
          } else if (approval && !remit && !paid) {
            approvedNotSent[m].count++;
            approvedNotSent[m].amount += amount;
          } else if (submission && !approval && !paid) {
            inReview[m].count++;
            inReview[m].amount += amount;
          }
        }
      }

      const roll = (b: { m1: { count: number; amount: number }; m2: { count: number; amount: number } }) => ({
        m1Count: b.m1.count,
        m1Amount: Math.round(b.m1.amount),
        m2Count: b.m2.count,
        m2Amount: Math.round(b.m2.amount),
        totalCount: b.m1.count + b.m2.count,
        totalAmount: Math.round(b.m1.amount + b.m2.amount),
      });

      return JSON.stringify({
        scope: hasWindow ? `payments dated ${input.fromDate} → ${input.toDate}` : "all-time",
        received: roll(received),
        ...(hasWindow ? { remittedInWindow: roll(remitted) } : {}),
        outstanding: {
          inTransit: roll(inTransit),
          approvedNotYetSent: roll(approvedNotSent),
          submittedInReview: roll(inReview),
        },
        dealsScanned: rows.length,
        ...(peTruncated ? { truncated: true } : {}),
        definitions:
          "received = milestone paid date set (cash landed). inTransit = PE remitted, ACH not landed (~4 days). " +
          "approvedNotYetSent = PE approved the docs but hasn't sent payment (also captures a milestone re-rejected " +
          "after its first approval, since the approval date persists). submittedInReview = submitted but never approved, " +
          "awaiting PE review. Outstanding buckets are today's snapshot regardless of any date window." +
          (peTruncated ? " WARNING: hit the scan cap — totals are a floor, not complete." : ""),
      });
    },
  });

  const getRevenueGoals = betaZodTool({
    name: "get_revenue_goals",
    description:
      "Company revenue GOALS vs actuals — the executive Revenue Goal Tracker. Use for " +
      "'how are we pacing against goal', 'is Westminster ahead of target', 'what's the " +
      "annual revenue goal', 'revenue vs goal this month / YTD'. Revenue groups: " +
      "Westminster, DTC (Centennial), Colorado Springs, California, Roofing & D&R, " +
      "Service. Numbers match the executive dashboard exactly — never estimate goal " +
      "progress from other tools.",
    inputSchema: z.object({
      year: z.number().optional().describe("Calendar year; defaults to the current year"),
    }),
    run: async (input) => {
      const { getRevenueGoalSnapshot } = await import("@/lib/revenue-goals");
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const year = input.year ?? currentYear;
      // Guard the DB seed: reject junk years rather than seeding 72 phantom
      // RevenueGoal rows for e.g. 20250 or 1999.
      if (year < 2020 || year > currentYear + 1) {
        return JSON.stringify({
          error: `No revenue goals for ${year}. Ask about ${2020}–${currentYear + 1}.`,
        });
      }
      const { data } = await getRevenueGoalSnapshot(year);
      const isCurrentYear = year === currentYear;
      const currentMonthIdx = now.getUTCMonth();
      return JSON.stringify({
        year: data.year,
        companyTotal: {
          annualTarget: Math.round(data.companyTotal.annualTarget),
          ytdActual: Math.round(data.companyTotal.ytdActual),
          ytdPaceExpected: Math.round(data.companyTotal.ytdPaceExpected),
          paceStatus: data.companyTotal.paceStatus,
        },
        groups: data.groups.map((g) => {
          const m = isCurrentYear ? g.months[currentMonthIdx] : undefined;
          return {
            group: g.displayName,
            annualTarget: Math.round(g.annualTarget),
            ytdActual: Math.round(g.ytdActual),
            ytdPaceExpected: Math.round(g.ytdPaceExpected),
            paceStatus: g.paceStatus,
            ...(m
              ? {
                  currentMonth: {
                    month: m.month,
                    actual: Math.round(m.actual),
                    target: Math.round(m.effectiveTarget),
                    onTarget: m.actual >= m.effectiveTarget,
                  },
                }
              : {}),
          };
        }),
        note:
          "Same data as the executive Revenue Goal Tracker. paceStatus compares YTD actual " +
          "against straight-line pace toward the annual target (closed months only).",
      });
    },
  });

  return [
    getDeal,
    searchDeals,
    filterDealsByStage,
    countDealsByStage,
    countDealsByStatus,
    countMilestoneInDateRange,
    getPePayments,
    getRevenueGoals,
    getProjectTeam,
    getProjectService,
  ];
}
