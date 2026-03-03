/**
 * POST /api/reviews/batch-status
 *
 * Returns which deal IDs have at least one completed review.
 * Body: { dealIds: string[] }
 * Response: { reviewed: Record<string, boolean> }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = await request.json();
  const dealIds: string[] = body.dealIds || [];

  if (dealIds.length === 0) {
    return NextResponse.json({ reviewed: {} });
  }

  // Find distinct dealIds that have at least one COMPLETED review
  const reviews = await prisma.projectReview.findMany({
    where: { dealId: { in: dealIds }, status: "COMPLETED" },
    select: { dealId: true },
    distinct: ["dealId"],
  });

  const reviewed: Record<string, boolean> = {};
  for (const id of dealIds) reviewed[id] = false;
  for (const r of reviews) reviewed[r.dealId] = true;

  return NextResponse.json({ reviewed });
}
