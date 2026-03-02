/**
 * GET /api/reviews/:dealId
 *
 * Fetch all review results for a deal. Optional ?skill= filter.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;
  const skill = request.nextUrl.searchParams.get("skill");

  const reviews = await prisma.projectReview.findMany({
    where: {
      dealId,
      ...(skill ? { skill } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ reviews });
}
