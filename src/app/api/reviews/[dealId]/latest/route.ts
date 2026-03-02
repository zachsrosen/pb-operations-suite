/**
 * GET /api/reviews/:dealId/latest
 *
 * Most recent review for each skill on a deal (at most 3 records).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { VALID_SKILLS } from "@/lib/checks/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;

  const latest = await Promise.all(
    VALID_SKILLS.map((skill) =>
      prisma.projectReview.findFirst({
        where: { dealId, skill },
        orderBy: { createdAt: "desc" },
      })
    )
  );

  return NextResponse.json({ reviews: latest.filter(Boolean) });
}
