/**
 * POST /api/reviews/run
 *
 * Start a design review for a HubSpot deal. Returns immediately with
 * { id, status: "running" } — the actual review executes in background
 * via safeWaitUntil(). Poll GET /api/reviews/status/[id] for results.
 *
 * On duplicate (deal already has a RUNNING review): returns 409 with
 * { existingReviewId, status: "already_running" } so clients can attach
 * to the in-flight run and poll its status.
 *
 * Body: { dealId: string, skill: "design-review", trigger?: "manual" | "webhook" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { runChecks } from "@/lib/checks/runner";
import { VALID_SKILLS, SKILL_ALLOWED_ROLES } from "@/lib/checks/types";
import type { SkillName } from "@/lib/checks/types";
import {
  acquireReviewLock,
  completeReviewRun,
  failReviewRun,
  touchReviewRun,
  DuplicateReviewError,
} from "@/lib/review-lock";
// Side-effect import: registers design-review checks with the engine
import { safeWaitUntil } from "@/lib/safe-wait-until";
import "@/lib/checks/design-review";

// ---------------------------------------------------------------------------
// Deal properties to fetch
// ---------------------------------------------------------------------------

const DEAL_PROPERTIES = [
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
];

// ---------------------------------------------------------------------------
// Background worker
// ---------------------------------------------------------------------------

async function executeReview(
  reviewId: string,
  dealId: string,
  skillName: SkillName,
) {
  const start = Date.now();

  // 1. Fetch deal properties from HubSpot
  const { hubspotClient } = await import("@/lib/hubspot");
  const deal = await hubspotClient.crm.deals.basicApi.getById(dealId, DEAL_PROPERTIES);
  const properties = deal.properties as Record<string, string | null>;

  await touchReviewRun(reviewId);

  // 2. Run checks (deterministic or AI depending on feature flag)
  const result = await runChecks(skillName, { dealId, properties }, () => touchReviewRun(reviewId));

  // 3. Extract projectId from deal name
  const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
  const projectId = projectIdMatch?.[0] ?? null;

  // 4. Complete the review run
  await completeReviewRun(reviewId, {
    findings: result.findings,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
    passed: result.passed,
    durationMs: Date.now() - start,
    projectId,
  });

  console.log(
    `[review] Deal ${dealId} (${skillName}): ${result.passed ? "PASSED" : "FAILED"} ` +
    `(${result.errorCount}E/${result.warningCount}W) in ${Date.now() - start}ms`
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { email, role } = authResult;

  let body: { dealId?: string; skill?: string; trigger?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { dealId, skill, trigger = "manual" } = body;

  if (!dealId || typeof dealId !== "string") {
    return NextResponse.json({ error: "dealId is required" }, { status: 400 });
  }
  if (!skill || !VALID_SKILLS.includes(skill as SkillName)) {
    return NextResponse.json(
      { error: `skill must be one of: ${VALID_SKILLS.join(", ")}` },
      { status: 400 }
    );
  }

  const skillName = skill as SkillName;
  const allowedRoles = SKILL_ALLOWED_ROLES[skillName];
  if (!allowedRoles.includes(role)) {
    return NextResponse.json(
      { error: "Insufficient permissions for this skill" },
      { status: 403 }
    );
  }

  // Acquire lock — insert RUNNING placeholder row
  let reviewId: string;
  try {
    reviewId = await acquireReviewLock(
      dealId,
      skillName,
      trigger,
      trigger === "webhook" ? "system" : email,
    );
  } catch (err) {
    if (err instanceof DuplicateReviewError) {
      // 409 = attach flow, not error. Client polls existingReviewId.
      return NextResponse.json(
        {
          existingReviewId: err.existingReviewId,
          status: "already_running",
          message: `Design review already running for deal ${dealId}`,
        },
        { status: 409 }
      );
    }
    throw err;
  }

  // Execute review in background — respond immediately
  safeWaitUntil(
    executeReview(reviewId, dealId, skillName).catch(async (err) => {
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error(`[review] Failed for deal ${dealId}:`, msg);
      await failReviewRun(reviewId, msg).catch(() => {});
    })
  );

  return NextResponse.json({ id: reviewId, status: "running" });
}
