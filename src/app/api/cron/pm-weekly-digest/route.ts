/**
 * GET /api/cron/pm-weekly-digest
 *
 * Monday-morning cron — emails the PM Accountability digest to
 * PM_TRACKER_AUDIENCE. Idempotent via IdempotencyKey on
 * (key=ISO-week, scope="pm-weekly-digest").
 *
 * Sends the email via the existing dual-provider pipeline (Google Workspace
 * primary, Resend fallback).
 */
import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/components";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { audienceList } from "@/lib/pm-tracker/audience-list";
import { PM_NAMES } from "@/lib/pm-tracker/owners";
import {
  PMWeeklyDigest,
  type PmDigestRow,
  type AtRiskRow,
} from "@/emails/PMWeeklyDigest";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoWeekKey(d: Date): string {
  // ISO 8601 week date: YYYY-Www. Cheap implementation: compute Monday of the
  // ISO week and return year + week number from that.
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d.getTime() - day * DAY_MS);
  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((monday.getTime() - yearStart.getTime()) / DAY_MS + yearStart.getUTCDay() + 1) / 7,
  );
  return `${monday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function fmtWeekLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const SCOPE = "pm-weekly-digest";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const weekKey = isoWeekKey(now);

  // Idempotency: bail if we've already sent this week's digest
  const existing = await prisma.idempotencyKey.findUnique({
    where: { key_scope: { key: weekKey, scope: SCOPE } },
  });
  if (existing && existing.status === "completed") {
    return NextResponse.json({ skipped: true, reason: "already sent for week", weekKey });
  }

  // Reserve the slot (best-effort — race-tolerant via unique constraint)
  try {
    await prisma.idempotencyKey.upsert({
      where: { key_scope: { key: weekKey, scope: SCOPE } },
      create: {
        key: weekKey,
        scope: SCOPE,
        status: "processing",
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      },
      update: { status: "processing" },
    });
  } catch (err) {
    console.error("[pm-weekly-digest] idempotency reserve failed:", err);
  }

  try {
    // Fetch latest snapshot per PM + the week-prior snapshot for delta.
    const cutoffPriorWeek = new Date(now.getTime() - 7 * DAY_MS);
    const rows: PmDigestRow[] = [];

    for (const pmName of PM_NAMES) {
      const latest = await prisma.pMSnapshot.findFirst({
        where: { pmName },
        orderBy: { periodEnd: "desc" },
      });
      if (!latest) continue;

      const prior = await prisma.pMSnapshot.findFirst({
        where: { pmName, periodEnd: { lte: cutoffPriorWeek } },
        orderBy: { periodEnd: "desc" },
      });

      rows.push({
        pmName,
        portfolioCount: latest.portfolioCount,
        ghostRate: latest.ghostRate,
        ghostRateDelta: prior ? latest.ghostRate - prior.ghostRate : null,
        stuckCountNow: latest.stuckCountNow,
        stuckCountDelta: prior ? latest.stuckCountNow - prior.stuckCountNow : null,
        readinessScore: latest.readinessScore,
        readinessScoreDelta: prior ? latest.readinessScore - prior.readinessScore : null,
        fieldPopulationScore: latest.fieldPopulationScore,
      });
    }

    // At-risk feed: deferred to Phase 2 PMSave-driven version. For Phase 1
    // we send an empty array — keeps the digest simple while still establishing
    // the cadence and email plumbing.
    const atRisk: AtRiskRow[] = [];

    const dashboardUrl = `${process.env.AUTH_URL ?? "https://ops.photonbrothers.com"}/dashboards/pm-accountability`;
    const html = await render(
      PMWeeklyDigest({
        weekLabel: `Week of ${fmtWeekLabel(now)}`,
        rows,
        atRisk,
        dashboardUrl,
      }),
    );
    const text = await render(
      PMWeeklyDigest({
        weekLabel: `Week of ${fmtWeekLabel(now)}`,
        rows,
        atRisk,
        dashboardUrl,
      }),
      { plainText: true },
    );

    const recipients = [...audienceList()];
    if (recipients.length === 0) {
      return NextResponse.json({ skipped: true, reason: "empty audience" });
    }

    const result = await sendEmailMessage({
      to: recipients,
      subject: `PM Accountability — ${fmtWeekLabel(now)}`,
      html,
      text,
      debugFallbackTitle: "PM Accountability Digest",
      debugFallbackBody: text,
    });

    await prisma.idempotencyKey.update({
      where: { key_scope: { key: weekKey, scope: SCOPE } },
      data: { status: "completed", response: { sent: true, recipientsCount: recipients.length } },
    });

    return NextResponse.json({ sent: true, weekKey, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[pm-weekly-digest] failed:", err);
    try {
      await prisma.idempotencyKey.update({
        where: { key_scope: { key: weekKey, scope: SCOPE } },
        data: { status: "failed", response: { error: message } },
      });
    } catch {
      // best-effort
    }
    return NextResponse.json({ sent: false, error: message }, { status: 500 });
  }
}
