/**
 * GET /api/pm/at-risk?pm=<name>
 *
 * Computes at-risk deals on-demand for a given PM. Cached 15 minutes.
 *
 * Reasons surfaced:
 *   - STUCK: in same stage > stuckDays per cached hs_date_entered
 *   - GHOSTED: no engagement on deal for > ghostDays (Phase 1 simplification:
 *     skipped here — would require per-deal HubSpot calls which are too slow
 *     for an on-demand endpoint. Reserved for Phase 2 when ghosted state is
 *     captured nightly in PMSave rows.)
 *   - PERMIT_OVERDUE: permitSubmitDate > permitSlaDays ago AND not isPermitIssued
 *   - READINESS_GAP: install in next 7d AND missing one of (permit, BOM in 30d)
 *
 * GHOSTED is excluded from this v1 endpoint because it would require an
 * engagement API call per deal — which is fine for a nightly cron but slow
 * for an on-demand HTTP request. Phase 2 lands GHOSTED via PMSave.
 */
import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { checkAudienceAccess } from "@/lib/pm-tracker/audience";
import { normalizePmName, rawNamesFor, type PmName } from "@/lib/pm-tracker/owners";
import { THRESHOLDS } from "@/lib/pm-tracker/thresholds";
import { getStageEnteredAt } from "@/lib/pm-tracker/stage-entry";
import { getHubSpotDealUrl } from "@/lib/external-links";
import type { AtRiskDeal } from "@/lib/pm-tracker/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STAGES = ["closedwon", "closedlost"];

async function computeAtRiskForPm(pmName: PmName): Promise<AtRiskDeal[]> {
  const variants = rawNamesFor(pmName);
  const now = new Date();
  const stuckThresholdMs = THRESHOLDS.stuckDays * DAY_MS;
  const permitOverdueCutoff = new Date(now.getTime() - THRESHOLDS.permitSlaDays * DAY_MS);
  const upcomingInstallCutoff = new Date(now.getTime() + 7 * DAY_MS);
  const bomCutoff = new Date(now.getTime() - 30 * DAY_MS);

  const deals = await prisma.deal.findMany({
    where: {
      projectManager: { in: variants, mode: "insensitive" },
      stageId: { notIn: TERMINAL_STAGES },
    },
    select: {
      hubspotDealId: true,
      dealName: true,
      stage: true,
      stageId: true,
      rawProperties: true,
      lastSyncedAt: true,
      permitSubmitDate: true,
      isPermitIssued: true,
      installScheduleDate: true,
    },
  });

  if (deals.length === 0) return [];

  // Batch-load BOM-pushed dealIds so we can answer READINESS_GAP without N+1.
  const upcomingDealIds = deals
    .filter((d) => d.installScheduleDate && d.installScheduleDate <= upcomingInstallCutoff && d.installScheduleDate >= now)
    .map((d) => d.hubspotDealId);
  const bomPushed = upcomingDealIds.length
    ? await prisma.bomHubSpotPushLog.findMany({
        where: {
          dealId: { in: upcomingDealIds },
          status: "SUCCESS",
          createdAt: { gte: bomCutoff },
        },
        select: { dealId: true },
      })
    : [];
  const bomPushedSet = new Set(bomPushed.map((b) => b.dealId));

  const items: AtRiskDeal[] = [];

  for (const d of deals) {
    // STUCK
    const enteredAt = getStageEnteredAt(d.rawProperties, d.stageId) ?? d.lastSyncedAt;
    const ageMs = now.getTime() - enteredAt.getTime();
    if (ageMs > stuckThresholdMs) {
      items.push({
        hubspotDealId: d.hubspotDealId,
        dealName: d.dealName,
        pmName,
        reason: "STUCK",
        daysAtRisk: Math.floor(ageMs / DAY_MS),
        url: getHubSpotDealUrl(d.hubspotDealId),
        detail: `In "${d.stage}" for ${Math.floor(ageMs / DAY_MS)} days`,
      });
    }

    // PERMIT_OVERDUE
    if (
      d.permitSubmitDate &&
      d.permitSubmitDate < permitOverdueCutoff &&
      !d.isPermitIssued
    ) {
      const overdueDays = Math.floor((now.getTime() - d.permitSubmitDate.getTime()) / DAY_MS);
      items.push({
        hubspotDealId: d.hubspotDealId,
        dealName: d.dealName,
        pmName,
        reason: "PERMIT_OVERDUE",
        daysAtRisk: overdueDays,
        url: getHubSpotDealUrl(d.hubspotDealId),
        detail: `Permit submitted ${overdueDays} days ago, not yet approved`,
      });
    }

    // READINESS_GAP: install in next 7d AND missing permit or BOM
    if (
      d.installScheduleDate &&
      d.installScheduleDate >= now &&
      d.installScheduleDate <= upcomingInstallCutoff
    ) {
      const missing: string[] = [];
      if (!d.isPermitIssued) missing.push("permit");
      if (!bomPushedSet.has(d.hubspotDealId)) missing.push("BOM");
      if (missing.length > 0) {
        const daysUntil = Math.ceil((d.installScheduleDate.getTime() - now.getTime()) / DAY_MS);
        items.push({
          hubspotDealId: d.hubspotDealId,
          dealName: d.dealName,
          pmName,
          reason: "READINESS_GAP",
          daysAtRisk: daysUntil,
          url: getHubSpotDealUrl(d.hubspotDealId),
          detail: `Install in ${daysUntil}d — missing: ${missing.join(", ")}`,
        });
      }
    }
  }

  // Sort: most-urgent (shortest daysAtRisk for upcoming events, longest for backlog)
  // Group by reason for stable display, then by daysAtRisk desc
  const reasonOrder: Record<AtRiskDeal["reason"], number> = {
    READINESS_GAP: 0,
    PERMIT_OVERDUE: 1,
    STUCK: 2,
    GHOSTED: 3,
  };
  items.sort((a, b) => {
    const order = reasonOrder[a.reason] - reasonOrder[b.reason];
    if (order !== 0) return order;
    return b.daysAtRisk - a.daysAtRisk;
  });

  return items;
}

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

    const cacheKey = `pm:at-risk:${pmName}`;
    const result = await appCache.getOrFetch(cacheKey, () => computeAtRiskForPm(pmName));
    return NextResponse.json({ items: result.data, cached: result.cached, lastUpdated: result.lastUpdated });
  } catch (err) {
    console.error("[pm-tracker:at-risk]", err);
    Sentry.captureException(err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
