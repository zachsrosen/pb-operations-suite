/**
 * GET /api/reviews/:dealId
 *
 * Fetch all review results for a deal. Optional ?skill= filter.
 *
 * By default, only COMPLETED reviews are returned (avoids surfacing
 * empty RUNNING placeholders). Admins can pass ?includeAll=true to
 * see RUNNING and FAILED rows as well.
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
  const { role } = authResult;

  const { dealId } = await params;
  const skill = request.nextUrl.searchParams.get("skill");
  const includeAll = request.nextUrl.searchParams.get("includeAll") === "true";

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  // Only admins can see non-COMPLETED runs
  const statusFilter = includeAll && role === "ADMIN"
    ? {}
    : { status: "COMPLETED" as const };

  const reviews = await prisma.projectReview.findMany({
    where: {
      dealId,
      ...statusFilter,
      ...(skill ? { skill } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ reviews });
}
