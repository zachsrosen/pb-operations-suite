/**
 * GET /api/pm/team-summary
 *
 * Returns the most recent PMSnapshot for each PM in PM_NAMES, plus the
 * shared period bounds from the freshest one.
 */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { checkAudienceAccess } from "@/lib/pm-tracker/audience";
import { PM_NAMES } from "@/lib/pm-tracker/owners";
import type { PmScorecard, TeamSummary } from "@/lib/pm-tracker/types";

export async function GET() {
  try {
    const { ok } = await checkAudienceAccess();
    if (!ok) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scorecards: PmScorecard[] = [];
    let latestPeriodEnd: Date | null = null;
    let latestPeriodStart: Date | null = null;

    for (const pmName of PM_NAMES) {
      const snapshot = await prisma.pMSnapshot.findFirst({
        where: { pmName },
        orderBy: { periodEnd: "desc" },
      });
      if (!snapshot) continue;

      if (!latestPeriodEnd || snapshot.periodEnd > latestPeriodEnd) {
        latestPeriodEnd = snapshot.periodEnd;
        latestPeriodStart = snapshot.periodStart;
      }

      scorecards.push({
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
          medianTimeToUnstick90d: null,
          recoveryRate90d: null,
          reviewRate: snapshot.reviewRate,
          avgReviewScore: snapshot.avgReviewScore,
          complaintRatePer100: snapshot.complaintRatePer100,
        },
      });
    }

    const summary: TeamSummary = {
      scorecards,
      periodStart: (latestPeriodStart ?? new Date(0)).toISOString(),
      periodEnd: (latestPeriodEnd ?? new Date(0)).toISOString(),
    };
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[pm-tracker:team-summary]", err);
    Sentry.captureException(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
