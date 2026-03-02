/**
 * GET /api/reviews/status/[id]
 *
 * Poll endpoint for an exact review run by ID.
 * Returns status + findings when COMPLETED, error when FAILED.
 *
 * Used by both the UI (ReviewActions polling) and the chat tool
 * (get_review_status). Keyed by exact reviewId to avoid ambiguity
 * when multiple runs start quickly.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { SKILL_ALLOWED_ROLES } from "@/lib/checks/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { role } = authResult;

  // Check that user has permission for design-review
  const allowedRoles = SKILL_ALLOWED_ROLES["design-review"];
  if (!allowedRoles.includes(role)) {
    return NextResponse.json(
      { error: "Insufficient permissions" },
      { status: 403 }
    );
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  const review = await prisma.projectReview.findUnique({
    where: { id },
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
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  // Shape response based on status
  if (review.status === "RUNNING") {
    return NextResponse.json({
      id: review.id,
      status: "running",
      skill: review.skill,
      dealId: review.dealId,
      startedAt: review.createdAt,
    });
  }

  if (review.status === "FAILED") {
    return NextResponse.json({
      id: review.id,
      status: "failed",
      skill: review.skill,
      dealId: review.dealId,
      error: review.error,
      createdAt: review.createdAt,
    });
  }

  // COMPLETED
  return NextResponse.json({
    id: review.id,
    status: "completed",
    skill: review.skill,
    dealId: review.dealId,
    findings: review.findings,
    errorCount: review.errorCount,
    warningCount: review.warningCount,
    passed: review.passed,
    durationMs: review.durationMs,
    createdAt: review.createdAt,
  });
}
