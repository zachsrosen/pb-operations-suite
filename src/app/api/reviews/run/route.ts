/**
 * POST /api/reviews/run
 *
 * Run all checks for a skill against a HubSpot deal.
 * Saves result to ProjectReview table.
 *
 * Body: { dealId: string, skill: SkillName, trigger?: "manual" | "webhook" }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { runChecks } from "@/lib/checks/runner";
import { VALID_SKILLS, SKILL_ALLOWED_ROLES } from "@/lib/checks/types";
import type { SkillName } from "@/lib/checks/types";
// Load check modules so they register with the engine
import "@/lib/checks/design-review";
import "@/lib/checks/engineering-review";
import "@/lib/checks/sales-advisor";

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

  // Fetch deal properties from HubSpot
  let properties: Record<string, string | null>;
  try {
    const { getHubSpotClient } = await import("@/lib/hubspot");
    const client = getHubSpotClient();
    const deal = await client.crm.deals.basicApi.getById(dealId, [
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
    ]);
    properties = deal.properties;
  } catch (err) {
    return NextResponse.json(
      {
        error: `Failed to fetch deal: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 502 }
    );
  }

  const projectIdMatch = properties.dealname?.match(/PROJ-\d+/);
  const projectId = projectIdMatch?.[0] ?? null;

  const result = await runChecks(skillName, { dealId, properties });

  const review = await prisma.projectReview.create({
    data: {
      dealId,
      projectId,
      skill: skillName,
      trigger,
      triggeredBy: trigger === "webhook" ? "system" : email,
      findings: result.findings,
      errorCount: result.errorCount,
      warningCount: result.warningCount,
      passed: result.passed,
      durationMs: result.durationMs,
    },
  });

  return NextResponse.json({ id: review.id, ...result });
}
