/**
 * Catalog Review API — Phase 2
 *
 * GET  /api/catalog/review  — List match groups (filterable by status, confidence)
 * POST /api/catalog/review  — Approve / reject / merge a match group
 *
 * Requires ADMIN or OWNER role.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import type { MatchConfidence, MatchDecisionStatus } from "@/generated/prisma/enums";

// ── GET: List match groups ──────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { role } = authResult;
  if (role !== "ADMIN" && role !== "OWNER") {
    return NextResponse.json(
      { error: "Admin or Owner access required" },
      { status: 403 },
    );
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const params = request.nextUrl.searchParams;

  // Parse query params
  const status = (params.get("status") ?? "PENDING") as MatchDecisionStatus;
  const confidence = params.get("confidence") as MatchConfidence | null;
  const limit = Math.min(Number(params.get("limit")) || 50, 200);
  const offset = Number(params.get("offset")) || 0;

  // Validate status
  const validStatuses: MatchDecisionStatus[] = [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "MERGED",
  ];
  if (!validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
      { status: 400 },
    );
  }

  // Validate confidence if provided
  const validConfidences: MatchConfidence[] = ["HIGH", "MEDIUM", "LOW"];
  if (confidence && !validConfidences.includes(confidence)) {
    return NextResponse.json(
      {
        error: `Invalid confidence. Must be one of: ${validConfidences.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const where: Record<string, unknown> = { decision: status };
    if (confidence) {
      where.confidence = confidence;
    }

    const [groups, total] = await Promise.all([
      prisma.catalogMatchGroup.findMany({
        where,
        orderBy: [{ needsReview: "desc" }, { score: "desc" }],
        take: limit,
        skip: offset,
      }),
      prisma.catalogMatchGroup.count({ where }),
    ]);

    return NextResponse.json({ groups, total, limit, offset });
  } catch (err) {
    console.error("[catalog/review] GET error:", err);
    return NextResponse.json(
      {
        error: "Failed to list match groups",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

// ── POST: Approve / reject / merge a match group ────────────────────────────

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { role, email } = authResult;
  if (role !== "ADMIN" && role !== "OWNER") {
    return NextResponse.json(
      { error: "Admin or Owner access required" },
      { status: 403 },
    );
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  let body: { matchGroupKey?: string; decision?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { matchGroupKey, decision, note } = body;

  if (!matchGroupKey || typeof matchGroupKey !== "string") {
    return NextResponse.json(
      { error: "matchGroupKey is required" },
      { status: 400 },
    );
  }

  const validDecisions = ["APPROVED", "REJECTED", "MERGED"] as const;
  if (
    !decision ||
    !validDecisions.includes(decision as (typeof validDecisions)[number])
  ) {
    return NextResponse.json(
      {
        error: `decision is required and must be one of: ${validDecisions.join(", ")}`,
      },
      { status: 400 },
    );
  }

  try {
    const existing = await prisma.catalogMatchGroup.findUnique({
      where: { matchGroupKey },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Match group not found" },
        { status: 404 },
      );
    }

    const updated = await prisma.catalogMatchGroup.update({
      where: { matchGroupKey },
      data: {
        decision: decision as MatchDecisionStatus,
        decidedBy: email,
        decidedAt: new Date(),
        decisionNote: note ?? null,
        needsReview: false,
      },
    });

    return NextResponse.json({ updated });
  } catch (err) {
    console.error("[catalog/review] POST error:", err);
    return NextResponse.json(
      {
        error: "Failed to update match group",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
