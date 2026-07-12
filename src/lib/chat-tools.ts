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
    description:
      "Full state snapshot for ONE deal — accepts a PROJ number, customer name/address, or " +
      "HubSpot deal ID: stage, every workstream status " +
      "(DA/design/permitting/interconnection/site survey/construction/inspection/PTO) as " +
      "display labels, milestone dates, revision counts, and stateContext — the VERBATIM " +
      "reason a deal is in whatever state it's in: pending sales changes, on hold, cancelled, " +
      "RTB blocked, project rejected, DA/permit/interconnection rejected, design/IDR/as-built " +
      "revision, inspection failed, loose ends remaining. For PE (Participate Energy) deals it " +
      "also returns a `pe` block: rejection comments, info needed, per-team rejection notes " +
      "(ops/design/permitting/interconnection/sales/accounting/compliance), and per-document " +
      "notes. Use for 'where is this project', 'what's the DA/permit status', 'why is this " +
      "<state>' (read the reason verbatim), 'what does <team> need to fix for PE', 'what's PE " +
      "waiting on'. For customer/PM/owner use get_project_team; for jobs/tickets use get_project_service.",
    inputSchema: z.object({
      project: z
        .string()
        .describe("PROJ number, customer name/address, or HubSpot deal ID"),
    }),
    run: async (input) => {
      const { hubspotClient, DEAL_STAGE_MAP } = await import("@/lib/hubspot");
      const { statusLabel } = await import("@/lib/deal-status-labels");
      const ref = await resolveDealRef(input.project);
      if ("notFound" in ref)
        return JSON.stringify({ error: `No deal found for "${input.project}".` });
      if ("candidates" in ref)
        return JSON.stringify({
          needsClarification: true,
          message: `"${input.project}" matches ${ref.candidates.length} deals — which one?`,
          candidates: ref.candidates,
        });
      const dealId = ref.dealId;
      const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
        "dealname", "dealstage", "amount", "pb_location", "project_number", "project_type",
        "hubspot_owner_id", "closedate",
        // Workstream statuses (raw values → labeled below)
        "layout_status", "design_status", "permitting_status", "interconnection_status",
        "site_survey_status", "install_status", "final_inspection_status", "pto_status",
        "pe_m1_status", "pe_m2_status",
        // State reason notes — the verbatim "why" for each state a deal can sit in.
        "sales_change_order_notes", "pm_rejection_reason", "rtb_blocked_reason", "kats_notes",
        "on_hold_selection", "on_hold_reason", "cancellation_reason",
        "design_approval_rejection_reason", "design_revision_reason",
        "permit_rejection_reason", "cause_of_permit_rejection_",
        "interconnection_rejection_reason", "cause_of_interconnection_rejection_",
        "idr_revision_reason", "idr_revision_type",
        "inspection_failure_reason", "inspection_fail_count",
        // As-built: inspection_rejection_reason is the current field; numbered ones are history.
        "inspection_rejection_reason", "fourth_asbuilt_revision_reason",
        "third_as_built_revision_reason", "second_as_built_revision_reason",
        "first_as_built_rejection_reason",
        "loose_ends_remaining_", "loose_end_notes_",
        "sales_communication_reason", "pb_shit_show_reason", "additional_visit_reason",
        // Revision counters
        "da_revision_counter", "permit_revision_counter", "interconnection_revision_counter",
        "as_built_revision_counter", "idr_revision_counter", "total_revision_count",
        // PE (Participate Energy) — surfaced only for PE deals, populated fields only.
        "participate_energy_status", "participate_change_order_needed",
        "pe_rejection_comments", "pe_info_needed", "pe_rejection_owner",
        "pe_rejection_date", "pe_m1_rejection_date", "pe_m2_rejection_date",
        "pe_rejection_notes_for_ops", "pe_rejection_notes_for_design",
        "pe_rejection_notes_for_permitting", "pe_rejection_notes_for_intercocnnection",
        "pe_rejection_notes_for_sales", "pe_rejection_notes_for_accounting",
        "pe_rejection_notes_for_compliance", "pe_doc_blocker_notes",
        "pe_doc_access_to_monitoring_notes", "pe_doc_attestation_customer_payment_notes",
        "pe_doc_bill_of_materials_notes", "pe_doc_certificate_of_acceptance_notes",
        "pe_doc_conditional_lien_waiver_notes", "pe_doc_conditional_waiver_final_notes",
        "pe_doc_customer_agreement_notes", "pe_doc_design_plan_notes",
        "pe_doc_installation_order_notes", "pe_doc_permission_to_operate_notes",
        "pe_doc_photos_per_policy_notes", "pe_doc_signed_final_permit_notes",
        "pe_doc_signed_interconnection_notes", "pe_doc_signed_proposal_notes",
        "pe_doc_state_disclosures_notes", "pe_doc_utility_bill_notes",
        // Milestone dates
        "site_survey_date", "design_approval_sent_date", "layout_approval_date",
        "design_completion_date", "permit_submit_date", "permit_completion_date",
        "interconnections_submit_date", "interconnections_completion_date", "ready_to_build_date",
        "construction_complete_date", "inspections_completion_date", "pto_start_date", "pto_completion_date",
      ]);
      const p = deal.properties as Record<string, string | null>;
      const stageName = DEAL_STAGE_MAP[p.dealstage || ""] || p.dealstage || "";
      const lbl = (key: string, raw: string | null | undefined) =>
        raw ? statusLabel(key, raw) || raw : null;
      // A trimmed, non-empty value or null.
      const val = (k: string) => {
        const v = p[k];
        return v != null && String(v).trim() !== "" ? String(v).trim() : null;
      };
      // Join a reason note with its dropdown/cause, skipping blanks.
      const joined = (...keys: string[]) =>
        keys.map(val).filter(Boolean).join(" — ") || null;

      // stateContext: the verbatim "why" for each state, populated fields only.
      // Keys are self-describing so the bot can map a status → its reason. Every
      // value is the note exactly as entered in HubSpot — quote it, don't paraphrase.
      const stateContext: Record<string, string> = {};
      const ctx = (key: string, v: string | null) => {
        if (v) stateContext[key] = v;
      };
      // "Pending Sales Changes": the sales rep must reach the customer to complete the change.
      ctx("pendingSalesChanges", val("sales_change_order_notes"));
      ctx("projectRejected", val("pm_rejection_reason"));
      ctx("rtbBlocked", val("rtb_blocked_reason") || val("kats_notes"));
      // onHold/cancelled are stage-level with no workstream status to cross-check,
      // and their note fields keep stale text after the deal moves on — only surface
      // them when the deal's stage actually is On-Hold / Cancelled.
      ctx("onHold", /on.?hold/i.test(stageName) ? joined("on_hold_selection", "on_hold_reason") : null);
      ctx("cancelled", /cancel/i.test(stageName) ? val("cancellation_reason") : null);
      ctx("daRejected", val("design_approval_rejection_reason"));
      ctx("designRevision", val("design_revision_reason"));
      ctx("permitRejected", joined("permit_rejection_reason", "cause_of_permit_rejection_"));
      ctx(
        "interconnectionRejected",
        joined("interconnection_rejection_reason", "cause_of_interconnection_rejection_")
      );
      ctx("idrRevision", joined("idr_revision_reason", "idr_revision_type"));
      ctx("inspectionFailed", val("inspection_failure_reason"));
      // As-built: current field first, then the most recent numbered history entry.
      ctx(
        "asBuiltRevision",
        val("inspection_rejection_reason") ||
          val("fourth_asbuilt_revision_reason") ||
          val("third_as_built_revision_reason") ||
          val("second_as_built_revision_reason") ||
          val("first_as_built_rejection_reason")
      );
      ctx("looseEnds", joined("loose_ends_remaining_", "loose_end_notes_"));
      ctx("salesCommunication", val("sales_communication_reason"));
      ctx("blocked", val("pb_shit_show_reason"));
      ctx("additionalVisit", val("additional_visit_reason"));

      // Revision counts (only where a bounce has happened).
      const revisionCounts: Record<string, number> = {};
      const cnt = (k: string, name: string) => {
        const n = Number(p[k]);
        if (n > 0) revisionCounts[name] = n;
      };
      cnt("da_revision_counter", "da");
      cnt("permit_revision_counter", "permit");
      cnt("interconnection_revision_counter", "interconnection");
      cnt("as_built_revision_counter", "asBuilt");
      cnt("idr_revision_counter", "idr");
      cnt("total_revision_count", "total");

      // PE block — only for PE deals (any PE field populated), populated fields only.
      const pe: Record<string, unknown> = {};
      const peAdd = (key: string, v: string | null) => {
        if (v) pe[key] = v;
      };
      peAdd("status", val("participate_energy_status"));
      peAdd("m1Status", val("pe_m1_status"));
      peAdd("m2Status", val("pe_m2_status"));
      if (val("participate_change_order_needed") === "true") pe.changeOrderNeeded = true;
      peAdd("rejectionComments", val("pe_rejection_comments"));
      peAdd("infoNeeded", val("pe_info_needed"));
      peAdd("rejectionOwner", val("pe_rejection_owner"));
      peAdd("rejectionDate", val("pe_rejection_date"));
      peAdd("m1RejectionDate", val("pe_m1_rejection_date"));
      peAdd("m2RejectionDate", val("pe_m2_rejection_date"));
      const teamNotes: Record<string, string> = {};
      const teamNote = (name: string, k: string) => {
        const v = val(k);
        if (v) teamNotes[name] = v;
      };
      teamNote("ops", "pe_rejection_notes_for_ops");
      teamNote("design", "pe_rejection_notes_for_design");
      teamNote("permitting", "pe_rejection_notes_for_permitting");
      // Property name is misspelled in HubSpot ("intercocnnection") — use it verbatim.
      teamNote("interconnection", "pe_rejection_notes_for_intercocnnection");
      teamNote("sales", "pe_rejection_notes_for_sales");
      teamNote("accounting", "pe_rejection_notes_for_accounting");
      teamNote("compliance", "pe_rejection_notes_for_compliance");
      if (Object.keys(teamNotes).length > 0) pe.rejectionNotesByTeam = teamNotes;
      const docNotes: Record<string, string> = {};
      const docNote = (name: string, k: string) => {
        const v = val(k);
        if (v) docNotes[name] = v;
      };
      docNote("accessToMonitoring", "pe_doc_access_to_monitoring_notes");
      docNote("attestationOfPayment", "pe_doc_attestation_customer_payment_notes");
      docNote("billOfMaterials", "pe_doc_bill_of_materials_notes");
      docNote("certificateOfAcceptance", "pe_doc_certificate_of_acceptance_notes");
      docNote("conditionalLienWaiver", "pe_doc_conditional_lien_waiver_notes");
      docNote("conditionalWaiverFinal", "pe_doc_conditional_waiver_final_notes");
      docNote("customerAgreement", "pe_doc_customer_agreement_notes");
      docNote("designPlan", "pe_doc_design_plan_notes");
      docNote("installationOrder", "pe_doc_installation_order_notes");
      docNote("permissionToOperate", "pe_doc_permission_to_operate_notes");
      docNote("photosPerPolicy", "pe_doc_photos_per_policy_notes");
      docNote("signedFinalPermit", "pe_doc_signed_final_permit_notes");
      docNote("signedInterconnection", "pe_doc_signed_interconnection_notes");
      docNote("signedProposal", "pe_doc_signed_proposal_notes");
      docNote("stateDisclosures", "pe_doc_state_disclosures_notes");
      docNote("utilityBill", "pe_doc_utility_bill_notes");
      if (Object.keys(docNotes).length > 0) pe.docNotes = docNotes;
      peAdd("docBlockerNotes", val("pe_doc_blocker_notes"));

      return JSON.stringify({
        dealId,
        projectNumber: p.project_number || null,
        name: p.dealname || null,
        stage: stageName || null,
        amount: Number(p.amount) || 0,
        location: p.pb_location || null,
        projectType: p.project_type || null,
        ownerId: p.hubspot_owner_id || null,
        statuses: {
          da: lbl("layout_status", p.layout_status),
          design: lbl("design_status", p.design_status),
          permitting: lbl("permitting_status", p.permitting_status),
          interconnection: lbl("interconnection_status", p.interconnection_status),
          siteSurvey: lbl("site_survey_status", p.site_survey_status),
          construction: lbl("install_status", p.install_status),
          inspection: lbl("final_inspection_status", p.final_inspection_status),
          pto: lbl("pto_status", p.pto_status),
          peM1: p.pe_m1_status || null,
          peM2: p.pe_m2_status || null,
        },
        dates: {
          closed: p.closedate || null,
          surveyCompleted: p.site_survey_date || null,
          daSent: p.design_approval_sent_date || null,
          daApproved: p.layout_approval_date || null,
          designComplete: p.design_completion_date || null,
          permitSubmitted: p.permit_submit_date || null,
          permitIssued: p.permit_completion_date || null,
          icSubmitted: p.interconnections_submit_date || null,
          icApproved: p.interconnections_completion_date || null,
          rtb: p.ready_to_build_date || null,
          constructionComplete: p.construction_complete_date || null,
          inspectionPassed: p.inspections_completion_date || null,
          ptoSubmitted: p.pto_start_date || null,
          ptoGranted: p.pto_completion_date || null,
        },
        // The verbatim reason for whatever state(s) the deal sits in. Populated keys
        // only — an absent key means that state doesn't apply. Read notes verbatim;
        // "pendingSalesChanges" means the sales rep must reach the customer to
        // complete the change. Correlate a key with its status above.
        stateContext,
        ...(Object.keys(revisionCounts).length > 0 ? { revisionCounts } : {}),
        ...(Object.keys(pe).length > 0 ? { pe } : {}),
        note: "Statuses are resolved display labels. stateContext holds the verbatim reason notes for each state the deal is in (quote them). For people use get_project_team; for jobs/tickets use get_project_service.",
      });
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
      "Count active deals by stage in the project pipeline, with per-stage revenue. " +
      "Optionally filter to one PB location and/or to Participate Energy deals only. " +
      "Set participateEnergyOnly=true for any 'how many PE / Participate Energy deals " +
      "in <stage>' question (e.g. 'PE jobs in Inspection', 'Participate Energy deals in " +
      "Construction') — read the stage you want from counts/revenueByStage.",
    inputSchema: z.object({
      location: z
        .string()
        .optional()
        .describe(
          "Optional PB location/shop: Westminster (Westy), Centennial (DTC), " +
            "Colorado Springs (COSP), San Luis Obispo (SLO/California), Camarillo"
        ),
      participateEnergyOnly: z
        .boolean()
        .optional()
        .describe("If true, count only Participate Energy (PE) deals."),
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
      if (input.participateEnergyOnly) {
        projects = projects.filter((p) => p.isParticipateEnergy);
      }
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
        scope: input.participateEnergyOnly ? "Participate Energy deals only" : "all deals",
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
      participateEnergyOnly: z
        .boolean()
        .optional()
        .describe(
          "If true, break down only Participate Energy (PE) deals — e.g. 'inspection " +
            "status of our PE jobs'. (pe_m1/pe_m2 already scope to PE automatically.)"
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
      if (isPeMilestone || input.participateEnergyOnly) {
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

  const queryProjects = betaZodTool({
    name: "query_projects",
    description:
      "Flexible deal query — the GENERAL tool for any 'list/count deals where X, " +
      "optionally grouped by Y, with revenue' question. Give it filters (all ANDed) and " +
      "an optional groupBy; it returns matching deals (with HubSpot links), a total, " +
      "total revenue, and a per-group count+revenue rollup. Owner/lead names and status " +
      "values come back resolved (real names, display labels); only ACTIVE project deals " +
      "count by default. Use THIS instead of saying you need a different tool. " +
      "Filterable/groupable fields: stage, da_status (the layout/DA status — where " +
      "'Pending Sales Changes' lives), design_status, permitting_status, " +
      "interconnection_status, site_survey_status, construction_status, inspection_status, " +
      "pto_status, location, owner (sales deal owner), design_lead, permit_lead, " +
      "interconnection_lead, inspection_lead, project_manager, surveyor, " +
      "participate_energy (true/false), amount, project_number. DATE fields (YYYY-MM-DD, " +
      "filter with gte/lte/gt/lt/present/blank): sales_closed, survey_completed_date, " +
      "da_sent_date, da_approved_date, design_complete_date, permit_submitted_date, " +
      "permit_issued_date, ic_submitted_date, ic_approved_date, rtb_date, " +
      "construction_complete_date, inspection_passed_date, pto_submitted_date, " +
      "pto_granted_date. Operators: equals, in (value = array of strings), not, contains, " +
      "gt, lt, gte, lte, present, blank. Status/name matching is case-insensitive and " +
      "accepts the display label OR raw value. IMPORTANT: to include cancelled/terminal " +
      "deals in a date-window query (e.g. 'ALL deals sold in 2026 including cancelled'), " +
      "set includeInactive:true AND use the date filter together — this is the tool for " +
      "date+cancelled combined, so do NOT say you can't or file a process request. " +
      "Examples: {filters:[{field:'da_status',op:'equals',value:'Pending Sales Changes'}]," +
      "groupBy:'owner'}; {filters:[{field:'sales_closed',op:'gte',value:'2026-01-01'}," +
      "{field:'sales_closed',op:'lte',value:'2026-12-31'}],groupBy:'stage'," +
      "includeInactive:true}. PIPELINE: defaults to the Project pipeline; pass " +
      "pipeline:'sales'|'dnr'|'roofing'|'service' to query those instead (non-project " +
      "pipelines support only the common fields: stage, location, owner, amount, " +
      "sales_closed, project_number). TWO-LEVEL grouping: pass groupBy AND groupBy2 for a " +
      "matrix (e.g. groupBy:'stage', groupBy2:'location' → byGroup2[stage][location]). " +
      "If a filter value matches nothing, the tool returns the available values for that " +
      "field so you can pick the right one — never guess or fabricate. REASONS IN BULK: set " +
      "includeReason:true to get each deal's verbatim reason note inline (cancellation reason " +
      "for cancelled, on-hold reason for on-hold, sales-change/rejection/blocked/revision/" +
      "loose-end reason otherwise). Use this for 'what are the cancellation/on-hold/rejection " +
      "reasons for all of these' — it is ONE call; never loop get_deal across a list of deals.",
    inputSchema: z.object({
      filters: z
        .array(
          z.object({
            field: z.string().describe("A filterable field name (see the tool description)."),
            op: z.enum(["equals", "in", "not", "contains", "gt", "lt", "gte", "lte", "present", "blank"]),
            value: z
              .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
              .optional()
              .describe("The comparison value. Omit for present/blank. Use an array for 'in'."),
          })
        )
        .optional()
        .describe("Conditions, all ANDed. Omit or empty = all active deals."),
      groupBy: z
        .string()
        .optional()
        .describe("Optional field to group the rollup by, e.g. 'owner', 'design_lead', 'location', 'stage'."),
      groupBy2: z
        .string()
        .optional()
        .describe("Optional SECOND group field for a two-level breakdown (e.g. groupBy 'stage' + groupBy2 'location' = stage × location). Requires groupBy."),
      includeInactive: z
        .boolean()
        .optional()
        .describe("Include terminal/cancelled deals too (default false = active only)."),
      pipeline: z
        .enum(["project", "sales", "dnr", "roofing", "service"])
        .optional()
        .describe("Which HubSpot pipeline to query (default 'project'). Non-project pipelines support only the common fields: stage, location, owner, amount, sales_closed, project_number."),
      includeReason: z
        .boolean()
        .optional()
        .describe("Attach each deal's current state reason note (verbatim) as a `reason` field — the cancellation reason for cancelled deals, on-hold reason for on-hold, sales-change/rejection/RTB-blocked/revision/loose-end reason otherwise. Use this for 'what are the cancellation/on-hold/rejection reasons for all of these' — ONE call, do NOT loop get_deal per deal. Project pipeline only."),
    }),
    run: async (input) => {
      const { fetchAllProjects } = await import("@/lib/hubspot");
      const { statusLabel } = await import("@/lib/deal-status-labels");
      const { normalizeLocation } = await import("@/lib/locations");

      const pipeline = input.pipeline ?? "project";
      // Fields available outside the Project pipeline (others are project-only).
      const CROSS_PIPELINE_FIELDS = new Set([
        "stage", "location", "owner", "amount", "sales_closed", "project_number",
      ]);

      type P = Record<string, unknown>;
      const FIELDS: Record<
        string,
        { get: (p: P) => unknown; kind: "status" | "string" | "number" | "bool" | "date"; propKey?: string; isLocation?: boolean }
      > = {
        stage: { get: (p) => p.stage, kind: "string" },
        da_status: { get: (p) => p.layoutStatus, kind: "status", propKey: "layout_status" },
        design_status: { get: (p) => p.designStatus, kind: "status", propKey: "design_status" },
        permitting_status: { get: (p) => p.permittingStatus, kind: "status", propKey: "permitting_status" },
        interconnection_status: { get: (p) => p.interconnectionStatus, kind: "status", propKey: "interconnection_status" },
        site_survey_status: { get: (p) => p.siteSurveyStatus, kind: "status", propKey: "site_survey_status" },
        construction_status: { get: (p) => p.constructionStatus, kind: "status", propKey: "install_status" },
        inspection_status: { get: (p) => p.finalInspectionStatus, kind: "status", propKey: "final_inspection_status" },
        pto_status: { get: (p) => p.ptoStatus, kind: "status", propKey: "pto_status" },
        location: { get: (p) => p.pbLocation, kind: "string", isLocation: true },
        owner: { get: (p) => p.dealOwner, kind: "string" },
        design_lead: { get: (p) => p.designLead, kind: "string" },
        permit_lead: { get: (p) => p.permitLead, kind: "string" },
        interconnection_lead: { get: (p) => p.interconnectionsLead, kind: "string" },
        inspection_lead: { get: (p) => p.inspectionsLead, kind: "string" },
        project_manager: { get: (p) => p.projectManager, kind: "string" },
        surveyor: { get: (p) => p.siteSurveyor, kind: "string" },
        participate_energy: { get: (p) => p.isParticipateEnergy, kind: "bool" },
        amount: { get: (p) => p.amount, kind: "number" },
        project_number: { get: (p) => p.projectNumber, kind: "string" },
        // Date fields (YYYY-MM-DD). Filter with gte/lte/gt/lt/present/blank — e.g.
        // "deals sold in 2026" = sales_closed gte 2026-01-01 AND lte 2026-12-31.
        sales_closed: { get: (p) => p.closeDate, kind: "date" },
        survey_completed_date: { get: (p) => p.siteSurveyCompletionDate, kind: "date" },
        da_sent_date: { get: (p) => p.designApprovalSentDate, kind: "date" },
        da_approved_date: { get: (p) => p.designApprovalDate, kind: "date" },
        design_complete_date: { get: (p) => p.designCompletionDate, kind: "date" },
        permit_submitted_date: { get: (p) => p.permitSubmitDate, kind: "date" },
        permit_issued_date: { get: (p) => p.permitIssueDate, kind: "date" },
        ic_submitted_date: { get: (p) => p.interconnectionSubmitDate, kind: "date" },
        ic_approved_date: { get: (p) => p.interconnectionApprovalDate, kind: "date" },
        rtb_date: { get: (p) => p.readyToBuildDate, kind: "date" },
        construction_complete_date: { get: (p) => p.constructionCompleteDate, kind: "date" },
        inspection_passed_date: { get: (p) => p.inspectionPassDate, kind: "date" },
        pto_submitted_date: { get: (p) => p.ptoSubmitDate, kind: "date" },
        pto_granted_date: { get: (p) => p.ptoGrantedDate, kind: "date" },
      };
      const knownFields = Object.keys(FIELDS);

      // Display value for a status/string field (labels for status codes).
      const displayOf = (spec: (typeof FIELDS)[string], raw: unknown): string => {
        if (raw == null) return "";
        if (spec.kind === "status" && spec.propKey) return statusLabel(spec.propKey, String(raw)) || String(raw);
        return String(raw);
      };

      const filters = input.filters ?? [];
      for (const f of filters) {
        if (!FIELDS[f.field]) return JSON.stringify({ error: `Unknown field "${f.field}"`, knownFields });
      }
      if (input.groupBy && !FIELDS[input.groupBy]) {
        return JSON.stringify({ error: `Unknown groupBy "${input.groupBy}"`, knownFields });
      }
      if (input.groupBy2 && !FIELDS[input.groupBy2]) {
        return JSON.stringify({ error: `Unknown groupBy2 "${input.groupBy2}"`, knownFields });
      }
      if (input.groupBy2 && !input.groupBy) {
        return JSON.stringify({ error: "groupBy2 requires groupBy (a primary group field)." });
      }

      // Non-project pipelines only carry the common fields.
      if (pipeline !== "project") {
        const used = [
          ...filters.map((f) => f.field),
          ...(input.groupBy ? [input.groupBy] : []),
          ...(input.groupBy2 ? [input.groupBy2] : []),
        ];
        const projectOnly = used.filter((f) => !CROSS_PIPELINE_FIELDS.has(f));
        if (projectOnly.length > 0) {
          return JSON.stringify({
            error: `On the '${pipeline}' pipeline these fields aren't available: ${[...new Set(projectOnly)].join(", ")}. Cross-pipeline fields: ${[...CROSS_PIPELINE_FIELDS].join(", ")}.`,
          });
        }
      }

      const projects =
        pipeline === "project"
          ? ((await fetchAllProjects({ activeOnly: !input.includeInactive })) as unknown as P[])
          : ((await (
              await import("@/lib/pipeline-deals-fetch")
            ).fetchPipelineDeals(pipeline, { activeOnly: !input.includeInactive })) as unknown as P[]);

      const matchOne = (p: P, f: { field: string; op: string; value?: unknown }): boolean => {
        const spec = FIELDS[f.field];
        const rawVal = spec.get(p);
        if (f.op === "present") return rawVal != null && String(rawVal).trim() !== "";
        if (f.op === "blank") return rawVal == null || String(rawVal).trim() === "";
        if (spec.kind === "bool") {
          const want = f.value === true || String(f.value).toLowerCase() === "true";
          return Boolean(rawVal) === want;
        }
        if (spec.kind === "number") {
          const n = Number(rawVal) || 0;
          const v = Number(f.value);
          switch (f.op) {
            case "gt": return n > v;
            case "lt": return n < v;
            case "gte": return n >= v;
            case "lte": return n <= v;
            case "equals": return n === v;
            case "not": return n !== v;
            default: return false;
          }
        }
        if (spec.kind === "date") {
          if (rawVal == null || String(rawVal).trim() === "") return false; // no date → not in any range
          const d = Date.parse(String(rawVal));
          const v = Date.parse(String(f.value));
          if (Number.isNaN(d) || Number.isNaN(v)) return false;
          switch (f.op) {
            case "gt": return d > v;
            case "lt": return d < v;
            case "gte": return d >= v;
            case "lte": return d <= v;
            case "equals": return String(rawVal).slice(0, 10) === String(f.value).slice(0, 10);
            case "not": return String(rawVal).slice(0, 10) !== String(f.value).slice(0, 10);
            default: return false;
          }
        }
        const cur = displayOf(spec, rawVal).toLowerCase();
        const rawLower = rawVal == null ? "" : String(rawVal).toLowerCase();
        const eq = (want: string) =>
          cur === want.toLowerCase() ||
          rawLower === want.toLowerCase() ||
          (spec.isLocation ? normalizeLocation(String(rawVal)) != null && normalizeLocation(String(rawVal)) === normalizeLocation(want) : false);
        switch (f.op) {
          case "equals": return typeof f.value === "string" ? eq(f.value) : false;
          case "not": return typeof f.value === "string" ? !eq(f.value) : true;
          case "contains": return typeof f.value === "string" ? cur.includes(f.value.toLowerCase()) : false;
          case "in": return Array.isArray(f.value) ? f.value.some((v) => eq(String(v))) : false;
          default: return false;
        }
      };

      const matched = projects.filter((p) => filters.every((f) => matchOne(p, f)));

      // Recovery: nothing matched but categorical filters were given → surface values.
      if (matched.length === 0 && filters.length > 0) {
        const help: Record<string, Record<string, number>> = {};
        for (const f of filters) {
          const spec = FIELDS[f.field];
          if (spec.kind === "number" || spec.kind === "bool" || spec.kind === "date") continue;
          const vals: Record<string, number> = {};
          for (const p of projects) {
            const d = displayOf(spec, spec.get(p));
            if (d) vals[d] = (vals[d] ?? 0) + 1;
          }
          help[f.field] = Object.fromEntries(Object.entries(vals).sort((a, b) => b[1] - a[1]).slice(0, 30));
        }
        return JSON.stringify({
          matched: 0,
          note: "No deals matched. Available values for the filtered categorical fields are listed — pick the closest, don't fabricate.",
          availableValues: help,
        });
      }

      let totalRevenue = 0;
      for (const p of matched) totalRevenue += Number(p.amount) || 0;

      type Bucket = { count: number; revenue: number };
      const sortByRevenue = <T extends Record<string, Bucket>>(g: T) =>
        Object.fromEntries(Object.entries(g).sort((a, b) => b[1].revenue - a[1].revenue));

      let byGroup: Record<string, Bucket> | undefined;
      let byGroup2: Record<string, Record<string, Bucket>> | undefined;
      if (input.groupBy) {
        const spec1 = FIELDS[input.groupBy];
        const g: Record<string, Bucket> = {};
        for (const p of matched) {
          const key = displayOf(spec1, spec1.get(p)) || "(none)";
          g[key] = g[key] ?? { count: 0, revenue: 0 };
          g[key].count++;
          g[key].revenue = Math.round(g[key].revenue + (Number(p.amount) || 0));
        }
        byGroup = sortByRevenue(g);

        // Two-level breakdown: primary → secondary → {count, revenue}.
        if (input.groupBy2) {
          const spec2 = FIELDS[input.groupBy2];
          const nested: Record<string, Record<string, Bucket>> = {};
          for (const p of matched) {
            const k1 = displayOf(spec1, spec1.get(p)) || "(none)";
            const k2 = displayOf(spec2, spec2.get(p)) || "(none)";
            nested[k1] = nested[k1] ?? {};
            nested[k1][k2] = nested[k1][k2] ?? { count: 0, revenue: 0 };
            nested[k1][k2].count++;
            nested[k1][k2].revenue = Math.round(nested[k1][k2].revenue + (Number(p.amount) || 0));
          }
          byGroup2 = Object.fromEntries(
            Object.keys(byGroup).map((k1) => [k1, sortByRevenue(nested[k1] ?? {})])
          );
        }
      }

      // The deal's current best-known reason note (verbatim). Stage-gates the
      // stage-level states (cancelled/on-hold notes go stale after a deal moves
      // on), then falls back through the workstream reasons by priority. For the
      // full per-state breakdown on a single deal, use get_deal's stateContext.
      const reasonOf = (p: P): string | null => {
        const stage = String(p.stage || "");
        const v = (x: unknown) => {
          const s = x == null ? "" : String(x).trim();
          return s || null;
        };
        const join = (...xs: unknown[]) => xs.map(v).filter(Boolean).join(" — ") || null;
        if (/cancel/i.test(stage)) return v(p.cancellationReason);
        if (/on.?hold/i.test(stage)) return join(p.onHoldReason, p.onHoldNotes);
        return (
          v(p.salesChangeOrderNotes) ||
          v(p.pmRejectionReason) ||
          v(p.rtbBlockedReason) ||
          v(p.katsNotes) ||
          v(p.daRejectionReason) ||
          v(p.designRevisionReason) ||
          join(p.permitRejectionReason, p.causeOfPermitRejection) ||
          join(p.interconnectionRejectionReason, p.causeOfInterconnectionRejection) ||
          v(p.idrRevisionReason) ||
          v(p.inspectionFailureReason) ||
          v(p.asBuiltRevisionReason) ||
          join(p.looseEndsRemaining, p.looseEndNotes) ||
          v(p.salesCommunicationReason) ||
          v(p.pbShitShowReason) ||
          null
        );
      };

      const CAP = 60;
      const deals = matched
        .slice()
        .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0))
        .slice(0, CAP)
        .map((p) => ({
          dealId: String(p.id),
          projectNumber: (p.projectNumber as string) || "",
          name: (p.name as string) || "",
          owner: (p.dealOwner as string) || "",
          projectManager: (p.projectManager as string) || "",
          designLead: (p.designLead as string) || "",
          stage: (p.stage as string) || "",
          location: (p.pbLocation as string) || "",
          participateEnergy: Boolean(p.isParticipateEnergy),
          revenue: Math.round(Number(p.amount) || 0),
          url: (p.url as string) || "",
          ...(input.includeReason ? { reason: reasonOf(p) } : {}),
        }));

      return JSON.stringify({
        pipeline,
        scope: input.includeInactive ? "all deals (incl. terminal)" : "active deals",
        filters,
        groupBy: input.groupBy ?? null,
        groupBy2: input.groupBy2 ?? null,
        total: matched.length,
        totalRevenue: Math.round(totalRevenue),
        ...(byGroup ? { byGroup } : {}),
        ...(byGroup2 ? { byGroup2 } : {}),
        deals,
        ...(matched.length > CAP
          ? { note: `Showing top ${CAP} of ${matched.length} deals by revenue; total + byGroup cover ALL of them.` }
          : {}),
      });
    },
  });

  const queryJobs = betaZodTool({
    name: "query_jobs",
    description:
      "Flexible ZUPER FIELD-JOB query — the query_projects equivalent for field work " +
      "(site surveys, installs/construction, inspections, service visits, D&R). Over the " +
      "nightly-synced job cache. Filters (all ANDed) + optional groupBy/groupBy2; returns " +
      "counts (jobs have no dollar amount, so no revenue). Fields: category (Site Survey, " +
      "Inspection, Construction / Construction - Solar|Battery|EV, Service Visit, Service " +
      "Revisit, Additional Visit, Detach, Reset, …), status (New, Ready To Schedule, " +
      "Scheduled, Started, Construction Complete, Passed, Failed, Completed, …), crew " +
      "(assigned user names — a job can have several), team, scheduled (true/false = has a " +
      "scheduled date), scheduled_date (YYYY-MM-DD, use gte/lte/gt/lt), state, city, " +
      "has_deal (true/false = linked to a HubSpot deal), priority, project. Ops: equals, " +
      "in (value=array), not, contains, present, blank (+ date ops for scheduled_date). " +
      "groupBy any field → per-group count; groupBy2 for a matrix. Examples: 'how many " +
      "installs are unscheduled' → filters:[{field:'category',op:'contains',value:" +
      "'Construction'},{field:'scheduled',op:'equals',value:false}]; 'inspections ready to " +
      "schedule by state' → filters:[{field:'category',op:'equals',value:'Inspection'}," +
      "{field:'status',op:'contains',value:'Ready to Schedule'}], groupBy:'state'. " +
      "CAVEAT: on Construction jobs the assigned crew is the DIRECTOR (who reassigns), NOT " +
      "the physical crew — say so when grouping construction by crew. Data is as of the " +
      "last nightly sync (say 'as of last sync' for scheduling questions).",
    inputSchema: z.object({
      filters: z
        .array(
          z.object({
            field: z.string().describe("A job field (see the tool description)."),
            op: z.enum(["equals", "in", "not", "contains", "gt", "lt", "gte", "lte", "present", "blank"]),
            value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
          })
        )
        .optional(),
      groupBy: z.string().optional().describe("Field to group counts by (e.g. 'category', 'status', 'crew', 'state')."),
      groupBy2: z.string().optional().describe("Optional second group field for a matrix. Requires groupBy."),
    }),
    run: async (input) => {
      const { prisma } = await import("@/lib/db");
      if (!prisma) return JSON.stringify({ error: "database unavailable" });

      type Row = {
        jobUid: string; jobTitle: string; jobCategory: string; jobStatus: string;
        jobPriority: string | null; scheduledStart: Date | null; assignedUsers: unknown;
        assignedTeam: string | null; customerAddress: unknown; hubspotDealId: string | null;
        projectName: string | null; lastSyncedAt: Date;
      };
      const crewNames = (au: unknown): string[] =>
        Array.isArray(au)
          ? (au as { user_name?: string }[]).map((u) => (u?.user_name || "").trim()).filter(Boolean)
          : [];
      const addrPart = (addr: unknown, key: "state" | "city"): string =>
        addr && typeof addr === "object" ? String((addr as Record<string, unknown>)[key] ?? "").trim() : "";
      const ymd = (d: Date | null): string => (d ? d.toISOString().split("T")[0] : "");

      // kind "multi" = crew (array of names); others are scalar.
      const FIELDS: Record<string, { get: (r: Row) => unknown; kind: "string" | "bool" | "date" | "multi" }> = {
        category: { get: (r) => r.jobCategory, kind: "string" },
        status: { get: (r) => r.jobStatus, kind: "string" },
        crew: { get: (r) => crewNames(r.assignedUsers), kind: "multi" },
        team: { get: (r) => r.assignedTeam, kind: "string" },
        scheduled: { get: (r) => Boolean(r.scheduledStart), kind: "bool" },
        scheduled_date: { get: (r) => ymd(r.scheduledStart), kind: "date" },
        state: { get: (r) => addrPart(r.customerAddress, "state"), kind: "string" },
        city: { get: (r) => addrPart(r.customerAddress, "city"), kind: "string" },
        has_deal: { get: (r) => Boolean(r.hubspotDealId), kind: "bool" },
        priority: { get: (r) => r.jobPriority, kind: "string" },
        project: { get: (r) => r.projectName, kind: "string" },
      };
      const knownFields = Object.keys(FIELDS);

      const filters = input.filters ?? [];
      for (const f of filters) if (!FIELDS[f.field]) return JSON.stringify({ error: `Unknown field "${f.field}"`, knownFields });
      if (input.groupBy && !FIELDS[input.groupBy]) return JSON.stringify({ error: `Unknown groupBy "${input.groupBy}"`, knownFields });
      if (input.groupBy2 && !FIELDS[input.groupBy2]) return JSON.stringify({ error: `Unknown groupBy2 "${input.groupBy2}"`, knownFields });
      if (input.groupBy2 && !input.groupBy) return JSON.stringify({ error: "groupBy2 requires groupBy." });

      const rows = (await prisma.zuperJobCache.findMany({
        select: {
          jobUid: true, jobTitle: true, jobCategory: true, jobStatus: true, jobPriority: true,
          scheduledStart: true, assignedUsers: true, assignedTeam: true, customerAddress: true,
          hubspotDealId: true, projectName: true, lastSyncedAt: true,
        },
      })) as unknown as Row[];

      const matchOne = (r: Row, f: { field: string; op: string; value?: unknown }): boolean => {
        const spec = FIELDS[f.field];
        const raw = spec.get(r);
        if (spec.kind === "multi") {
          const names = (raw as string[]).map((n) => n.toLowerCase());
          if (f.op === "present") return names.length > 0;
          if (f.op === "blank") return names.length === 0;
          const v = typeof f.value === "string" ? f.value.toLowerCase() : "";
          switch (f.op) {
            case "equals": return names.includes(v);
            case "not": return !names.includes(v);
            case "contains": return names.some((n) => n.includes(v));
            case "in": return Array.isArray(f.value) ? f.value.some((x) => names.includes(String(x).toLowerCase())) : false;
            default: return false;
          }
        }
        if (f.op === "present") return raw != null && String(raw).trim() !== "";
        if (f.op === "blank") return raw == null || String(raw).trim() === "";
        if (spec.kind === "bool") {
          const want = f.value === true || String(f.value).toLowerCase() === "true";
          return Boolean(raw) === want;
        }
        if (spec.kind === "date") {
          if (!raw) return false;
          const d = Date.parse(String(raw)), v = Date.parse(String(f.value));
          if (Number.isNaN(d) || Number.isNaN(v)) return false;
          switch (f.op) {
            case "gt": return d > v; case "lt": return d < v; case "gte": return d >= v; case "lte": return d <= v;
            case "equals": return String(raw).slice(0, 10) === String(f.value).slice(0, 10);
            case "not": return String(raw).slice(0, 10) !== String(f.value).slice(0, 10);
            default: return false;
          }
        }
        const cur = raw == null ? "" : String(raw).toLowerCase();
        switch (f.op) {
          case "equals": return typeof f.value === "string" ? cur === f.value.toLowerCase() : false;
          case "not": return typeof f.value === "string" ? cur !== f.value.toLowerCase() : true;
          case "contains": return typeof f.value === "string" ? cur.includes(f.value.toLowerCase()) : false;
          case "in": return Array.isArray(f.value) ? f.value.some((x) => cur === String(x).toLowerCase()) : false;
          default: return false;
        }
      };

      const matched = rows.filter((r) => filters.every((f) => matchOne(r, f)));

      // Group keys for a row (crew yields several keys; one job → several buckets).
      const keysFor = (r: Row, field: string): string[] => {
        const spec = FIELDS[field];
        if (spec.kind === "multi") {
          const names = spec.get(r) as string[];
          return names.length ? names : ["(unassigned)"];
        }
        if (spec.kind === "bool") return [spec.get(r) ? "yes" : "no"];
        const v = String(spec.get(r) ?? "").trim();
        return [v || "(none)"];
      };
      const sortCounts = (o: Record<string, number>) =>
        Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

      let byGroup: Record<string, number> | undefined;
      let byGroup2: Record<string, Record<string, number>> | undefined;
      let crewMultiCounted = false;
      if (input.groupBy) {
        const g: Record<string, number> = {};
        for (const r of matched) for (const k of keysFor(r, input.groupBy)) g[k] = (g[k] ?? 0) + 1;
        byGroup = sortCounts(g);
        if (FIELDS[input.groupBy].kind === "multi") crewMultiCounted = true;
        if (input.groupBy2) {
          const nested: Record<string, Record<string, number>> = {};
          for (const r of matched)
            for (const k1 of keysFor(r, input.groupBy))
              for (const k2 of keysFor(r, input.groupBy2)) {
                nested[k1] = nested[k1] ?? {};
                nested[k1][k2] = (nested[k1][k2] ?? 0) + 1;
              }
          if (FIELDS[input.groupBy2].kind === "multi") crewMultiCounted = true;
          byGroup2 = Object.fromEntries(Object.keys(byGroup).map((k1) => [k1, sortCounts(nested[k1] ?? {})]));
        }
      }

      const CAP = 60;
      const jobs = matched.slice(0, CAP).map((r) => ({
        jobUid: r.jobUid,
        title: r.jobTitle,
        category: r.jobCategory,
        status: r.jobStatus,
        scheduled: r.scheduledStart ? r.scheduledStart.toISOString().split("T")[0] : null,
        crew: crewNames(r.assignedUsers),
        project: r.projectName ?? "",
        dealId: r.hubspotDealId ?? "",
      }));
      const dataAsOf = rows.reduce<Date | null>((m, r) => (!m || r.lastSyncedAt > m ? r.lastSyncedAt : m), null);

      return JSON.stringify({
        source: "Zuper job cache (field jobs)",
        dataAsOf: dataAsOf ? dataAsOf.toISOString() : null,
        filters,
        groupBy: input.groupBy ?? null,
        groupBy2: input.groupBy2 ?? null,
        total: matched.length,
        ...(byGroup ? { byGroup } : {}),
        ...(byGroup2 ? { byGroup2 } : {}),
        jobs,
        ...(crewMultiCounted
          ? { note: "Grouped by crew: a job with multiple assignees counts under each, so group counts can exceed the total. On Construction jobs the assignee is the director, not the physical crew." }
          : {}),
        ...(matched.length > CAP ? { listNote: `Showing ${CAP} of ${matched.length} jobs; total + byGroup cover ALL of them.` } : {}),
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
      "PE pays per milestone: M1 (~2/3, after inspection) and M2 (~1/3, after PTO). " +
      "For a WEEK-BY-WEEK breakdown, pass fromDate+toDate AND groupByWeek=true (real " +
      "Monday-start UTC weeks, the PE dashboard convention). basis picks the milestone " +
      "EVENT the windowed total/week/location key off: received (paid, default), approved, " +
      "submitted, or remitted — e.g. 'PE approvals in June by location' → basis:'approved', " +
      "groupByLocation:true. groupByLocation adds a byLocation split. CRITICAL: every dollar " +
      "here is the PE PAYMENT amount (M1=IC, M2=PC), NOT the deal amount — this is the ONLY " +
      "correct source for PE money (received, approved, submitted, or remitted). NEVER use " +
      "count_milestone_in_date_range's revenue for PE dollars — that's the deal amount, ~3× " +
      "too high.",
    inputSchema: z.object({
      fromDate: z
        .string()
        .optional()
        .describe("Optional window start, YYYY-MM-DD — scopes received/remitted to payments in the window"),
      toDate: z
        .string()
        .optional()
        .describe("Optional window end, YYYY-MM-DD (inclusive). Required if fromDate is set."),
      groupByWeek: z
        .boolean()
        .optional()
        .describe(
          "If true (requires fromDate+toDate), also return a weekly series bucketed by " +
            "Monday-start week. Use for any per-week PE payment breakdown."
        ),
      basis: z
        .enum(["received", "approved", "submitted", "remitted"])
        .optional()
        .describe(
          "Which PE MILESTONE EVENT the windowed total/week/location breakdown is keyed to " +
            "(default 'received'): received=paid date, approved=approval date, submitted=" +
            "submission date, remitted=remittance date. ALL use the PE payment amount (M1=IC, " +
            "M2=PC), never the deal amount."
        ),
      groupByLocation: z
        .boolean()
        .optional()
        .describe("If true, also return byLocation: the windowed PE $ split by PB location."),
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
      if (input.groupByWeek && !hasWindow) {
        return JSON.stringify({
          error: "groupByWeek requires fromDate and toDate (a bounded range to bucket into weeks).",
        });
      }
      // The windowed total/week/location breakdown keys off the basis event date;
      // all amounts are the PE payment (IC/PC), never the deal amount.
      const basis = input.basis ?? "received";
      const BASIS_DATE_SUFFIX: Record<string, string> = {
        received: "paid",
        approved: "approval",
        submitted: "submission",
        remitted: "remittance",
      };
      const basisSuffix = BASIS_DATE_SUFFIX[basis];
      // Monday-start UTC week key — identical convention to the PE dashboard's
      // weekly charts, so a "by week" answer matches what the suite shows.
      const { weekStartUTC } = await import("@/lib/pe-analytics");

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
            "pb_location",
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
      type MBucket = { m1: { count: number; amount: number }; m2: { count: number; amount: number } };
      const windowed = { m1: bucket(), m2: bucket() };
      const inTransit = { m1: bucket(), m2: bucket() };
      const approvedNotSent = { m1: bucket(), m2: bucket() };
      const inReview = { m1: bucket(), m2: bucket() };

      // basis-date-keyed breakdowns, populated only when grouping.
      const weekly = new Map<string, MBucket>();
      const byLocation = new Map<string, MBucket>();

      for (const p of rows) {
        const loc = (p.pb_location || "").trim() || "Unknown";
        for (const m of ["m1", "m2"] as const) {
          const amount = Number(m === "m1" ? p.pe_payment_ic : p.pe_payment_pc) || 0;
          if (!amount) continue;
          const paid = p[`pe_${m}_paid_date`];
          const remit = p[`pe_${m}_remittance_date`];
          const approval = p[`pe_${m}_approval_date`];
          const submission = p[`pe_${m}_submission_date`];
          const basisDate = p[`pe_${m}_${basisSuffix}_date`];
          // Windowed PE $ on the chosen basis event (paid/approved/submitted/remitted).
          if (basisDate && inWindow(basisDate)) {
            windowed[m].count++;
            windowed[m].amount += amount;
            if (input.groupByWeek) {
              const wk = weekStartUTC(new Date(Date.parse(basisDate)));
              let wb = weekly.get(wk);
              if (!wb) {
                wb = { m1: bucket(), m2: bucket() };
                weekly.set(wk, wb);
              }
              wb[m].count++;
              wb[m].amount += amount;
            }
            if (input.groupByLocation) {
              let lb = byLocation.get(loc);
              if (!lb) {
                lb = { m1: bucket(), m2: bucket() };
                byLocation.set(loc, lb);
              }
              lb[m].count++;
              lb[m].amount += amount;
            }
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

      // Emit a contiguous week series (Monday-start) across the whole window so
      // zero-payment weeks show as 0 instead of silently vanishing.
      let weeklySeries: Array<Record<string, string | number>> | undefined;
      if (input.groupByWeek) {
        const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const fmt = (ms: number) => {
          const d = new Date(ms);
          return { mon: MON[d.getUTCMonth()], day: d.getUTCDate() };
        };
        // "Mon Jul 6 – Sun Jul 12" style label (start Monday, end Sunday) so the
        // model never has to compute a weekday or shift a date itself.
        const weekLabel = (mondayMs: number) => {
          const s = fmt(mondayMs);
          const e = fmt(mondayMs + 6 * 24 * 60 * 60 * 1000);
          return s.mon === e.mon ? `${s.mon} ${s.day}–${e.day}` : `${s.mon} ${s.day} – ${e.mon} ${e.day}`;
        };
        weeklySeries = [];
        const firstWeekMs = Date.parse(`${weekStartUTC(new Date(fromMs))}T00:00:00.000Z`);
        for (let wkMs = firstWeekMs; wkMs <= toMs; wkMs += 7 * 24 * 60 * 60 * 1000) {
          const wk = new Date(wkMs).toISOString().split("T")[0];
          const wb = weekly.get(wk);
          const m1 = wb?.m1 ?? { count: 0, amount: 0 };
          const m2 = wb?.m2 ?? { count: 0, amount: 0 };
          weeklySeries.push({
            week: weekLabel(wkMs), // Mon–Sun label — render this verbatim, do not recompute
            weekStart: wk,
            m1Amount: Math.round(m1.amount),
            m2Amount: Math.round(m2.amount),
            totalAmount: Math.round(m1.amount + m2.amount),
            payments: m1.count + m2.count,
          });
        }
        weeklySeries.reverse(); // most-recent week first
      }

      const byLocationOut = input.groupByLocation
        ? Object.fromEntries(
            [...byLocation.entries()]
              .map(([loc, b]) => [loc, roll(b)] as const)
              .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
          )
        : undefined;

      return JSON.stringify({
        basis, // received | approved | submitted | remitted
        scope: hasWindow ? `${basis} dated ${input.fromDate} → ${input.toDate}` : `${basis}, all-time`,
        // Windowed PE PAYMENT total on the chosen basis (M1=IC, M2=PC) — NOT deal revenue.
        // Kept as `received` too when basis is the default, for continuity.
        windowTotal: roll(windowed),
        ...(basis === "received" ? { received: roll(windowed) } : {}),
        ...(weeklySeries
          ? {
              weekly: weeklySeries,
              weekConvention:
                "Weeks run Monday–Sunday. Render each row's `week` label VERBATIM and " +
                "use its exact amounts; do NOT recompute dates, shift the weekday, or drop weeks.",
            }
          : {}),
        ...(byLocationOut ? { byLocation: byLocationOut } : {}),
        outstanding: {
          inTransit: roll(inTransit),
          approvedNotYetSent: roll(approvedNotSent),
          submittedInReview: roll(inReview),
        },
        dealsScanned: rows.length,
        ...(peTruncated ? { truncated: true } : {}),
        definitions:
          "ALL amounts are PE PAYMENT dollars (M1 = pe_payment_ic ~2/3, M2 = pe_payment_pc ~1/3), NOT the deal amount. " +
          "windowTotal / weekly / byLocation are keyed to the `basis` event date: received=paid, approved=approval, " +
          "submitted=submission, remitted=remittance. Outstanding: inTransit = PE remitted, ACH not landed (~4 days); " +
          "approvedNotYetSent = PE approved but not yet sent (also captures a milestone re-rejected after its first " +
          "approval); submittedInReview = submitted but not approved. Outstanding buckets are today's snapshot regardless " +
          "of any date window." +
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
    queryProjects,
    queryJobs,
    countMilestoneInDateRange,
    getPePayments,
    getRevenueGoals,
    getProjectTeam,
    getProjectService,
  ];
}
