import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const deals = await prisma.deal.findMany({
      where: {
        pipeline: "PROJECT",
        dealName: { contains: q, mode: "insensitive" },
      },
      select: {
        hubspotDealId: true,
        dealName: true,
        stage: true,
        pbLocation: true,
        dealOwnerName: true,
        systemPerformanceReview: true,
        hubspotUrl: true,
      },
      orderBy: { dealName: "asc" },
      take: 20,
    });

    const results = deals.map((d: typeof deals[number]) => ({
      id: d.hubspotDealId,
      name: d.dealName,
      stage: d.stage,
      location: d.pbLocation ?? "",
      dealOwner: d.dealOwnerName ?? "",
      alreadyFlagged: d.systemPerformanceReview === "true",
      url: d.hubspotUrl ?? "",
    }));

    return NextResponse.json({ results });
  } catch (error) {
    Sentry.captureException(error);
    console.error("[Projects Search]", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
