/**
 * GET /api/pm/scorecard?pm=<name>
 *
 * Returns the most recent PMSnapshot for the named PM. Audience-gated.
 */
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { checkAudienceAccess } from "@/lib/pm-tracker/audience";
import { normalizePmName } from "@/lib/pm-tracker/owners";
import type { PmScorecard } from "@/lib/pm-tracker/types";

export async function GET(request: NextRequest) {
  try {
    const { ok } = await checkAudienceAccess();
    if (!ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const pmRaw = new URL(request.url).searchParams.get("pm");
    const pmName = normalizePmName(pmRaw);
    if (!pmName) {
      return NextResponse.json(
        { error: "Invalid or missing pm parameter" },
        { status: 400 },
      );
    }

    const snapshot = await prisma.pMSnapshot.findFirst({
      where: { pmName },
      orderBy: { periodEnd: "desc" },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: `No snapshot yet for ${pmName} — run /api/cron/pm-snapshot first` },
        { status: 404 },
      );
    }

    const scorecard: PmScorecard = {
      pmName,
      periodStart: snapshot.periodStart.toISOString(),
      periodEnd: snapshot.periodEnd.toISOString(),
      portfolioCount: snapshot.portfolioCount,
      computedAt: snapshot.computedAt.toISOString(),
      metrics: {
        ghostRate: snapshot.ghostRate,
        medianDaysSinceLastTouch: snapshot.medianDaysSinceLastTouch,
        touchFrequency30d: snapshot.touchFrequency30d,
        readinessScore: snapshot.readinessScore,
        dayOfFailures90d: snapshot.dayOfFailures90d,
        fieldPopulationScore: snapshot.fieldPopulationScore,
        staleDataCount: snapshot.staleDataCount,
        stuckCountNow: snapshot.stuckCountNow,
        medianTimeToUnstick90d: null, // Phase 2
        recoveryRate90d: null, // Phase 2
        reviewRate: snapshot.reviewRate,
        avgReviewScore: snapshot.avgReviewScore,
        complaintRatePer100: snapshot.complaintRatePer100,
      },
    };

    return NextResponse.json(scorecard);
  } catch (err) {
    console.error("[pm-tracker:scorecard]", err);
    Sentry.captureException(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
