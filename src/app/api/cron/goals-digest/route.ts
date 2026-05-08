/**
 * GET /api/cron/goals-digest
 *
 * Monday-morning cron — sends one Goals Digest email per office
 * (Westminster, Centennial, Colorado Springs, California) to leadership
 * and ops directors. Each email focuses on that office's goals with
 * company-wide context as a secondary section.
 *
 * Idempotent via IdempotencyKey on (key=ISO-week, scope="goals-weekly-digest").
 *
 * Flow:
 *   1. Fetch live goals-pipeline data for all 5 canonical locations
 *   2. Read prior week's GoalsDigestSnapshot rows for delta calculation
 *   3. Build 4 per-office email payloads
 *   4. Send each via dual-provider pipeline (Google Workspace → Resend fallback)
 *   5. Save current week's snapshot for next week's deltas
 */

import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/components";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { getGoalsPipelineData } from "@/lib/goals-pipeline";
import { CANONICAL_LOCATIONS } from "@/lib/locations";
import type { GoalsPipelineData } from "@/lib/goals-pipeline-types";
import { GoalsWeeklyDigest } from "@/emails/GoalsWeeklyDigest";
import { getGoalsDigestAudience } from "@/lib/goals-digest/audience";
import {
  buildPerOfficeDigests,
  extractSnapshotValues,
  type GoalsSnapshotValues,
} from "@/lib/goals-digest/build-digest-data";

export const maxDuration = 120;

const DAY_MS = 24 * 60 * 60 * 1000;
const SCOPE = "goals-weekly-digest";

function isoWeekKey(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d.getTime() - day * DAY_MS);
  const yearStart = new Date(Date.UTC(monday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((monday.getTime() - yearStart.getTime()) / DAY_MS +
      yearStart.getUTCDay() +
      1) /
      7,
  );
  return `${monday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function priorWeekKey(d: Date): string {
  return isoWeekKey(new Date(d.getTime() - 7 * DAY_MS));
}

function fmtWeekLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const weekKey = isoWeekKey(now);

  // ---- Idempotency: atomic claim ----
  try {
    await prisma.idempotencyKey.create({
      data: {
        key: weekKey,
        scope: SCOPE,
        status: "processing",
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key_scope: { key: weekKey, scope: SCOPE } },
      });
      return NextResponse.json({
        skipped: true,
        reason:
          existing?.status === "completed"
            ? "already sent for week"
            : "another invocation in flight",
        weekKey,
      });
    }
    console.error("[goals-digest] idempotency reserve failed:", err);
    throw err;
  }

  try {
    // ---- 1. Fetch live goals data for all canonical locations ----
    console.log("[goals-digest] Fetching goals data for all locations...");
    const perLocationData: GoalsPipelineData[] = [];

    for (const loc of CANONICAL_LOCATIONS) {
      try {
        const data = await getGoalsPipelineData(loc);
        perLocationData.push(data);
        await sleep(200);
      } catch (err) {
        console.error(`[goals-digest] Failed to fetch ${loc}:`, err);
      }
    }

    if (perLocationData.length === 0) {
      throw new Error("No location data fetched — all locations failed");
    }

    console.log(
      `[goals-digest] Fetched ${perLocationData.length}/${CANONICAL_LOCATIONS.length} locations`,
    );

    // ---- 2. Read prior week's snapshots for delta calculation ----
    const prevKey = priorWeekKey(now);
    const priorRows = await prisma.goalsDigestSnapshot.findMany({
      where: { weekKey: prevKey },
    });

    const priorSnapshots: Record<string, GoalsSnapshotValues> = {};
    let priorAllSnapshot: GoalsSnapshotValues | undefined;
    for (const row of priorRows) {
      const values = row.goals as unknown as GoalsSnapshotValues;
      if (row.location === "all") {
        priorAllSnapshot = values;
      } else {
        priorSnapshots[row.location] = values;
      }
    }

    console.log(
      `[goals-digest] Prior week ${prevKey}: ${priorRows.length} snapshots found`,
    );

    // ---- 3. Build per-office email data ----
    const baseUrl = process.env.AUTH_URL ?? "https://pbtechops.com";
    const officeDigests = buildPerOfficeDigests({
      perLocationData,
      priorSnapshots,
      priorAllSnapshot,
      baseUrl,
      referenceDate: now,
    });

    // ---- 4. Get audience and send one email per office ----
    const recipients = await getGoalsDigestAudience();
    if (recipients.length === 0) {
      console.warn("[goals-digest] No recipients — skipping send");
      await prisma.idempotencyKey.update({
        where: { key_scope: { key: weekKey, scope: SCOPE } },
        data: { status: "completed", response: { skipped: true, reason: "empty audience" } },
      });
      return NextResponse.json({ skipped: true, reason: "empty audience" });
    }

    console.log(
      `[goals-digest] Sending ${officeDigests.length} office emails to ${recipients.length} recipients...`,
    );

    const sendResults: Array<{ office: string; success: boolean; error?: string }> = [];

    for (const digest of officeDigests) {
      try {
        const html = await render(GoalsWeeklyDigest(digest.props));
        const text = await render(GoalsWeeklyDigest(digest.props), {
          plainText: true,
        });

        const result = await sendEmailMessage({
          to: [...recipients],
          subject: `${digest.label} Goals — Week of ${fmtWeekLabel(now)}`,
          html,
          text,
          debugFallbackTitle: `${digest.label} Goals Weekly Digest`,
          debugFallbackBody: text,
        });

        sendResults.push({
          office: digest.label,
          success: result.success,
          error: result.error,
        });

        // Small delay between sends to avoid rate limiting
        await sleep(500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.error(`[goals-digest] Failed to send ${digest.label}:`, err);
        sendResults.push({ office: digest.label, success: false, error: msg });
      }
    }

    const sentCount = sendResults.filter((r) => r.success).length;
    console.log(
      `[goals-digest] Sent ${sentCount}/${officeDigests.length} office emails`,
    );

    // ---- 5. Save this week's snapshot for next week's deltas ----
    const snapshotOps = perLocationData.map((d) =>
      prisma.goalsDigestSnapshot.upsert({
        where: {
          weekKey_location: { weekKey, location: d.location },
        },
        create: {
          weekKey,
          location: d.location,
          goals: extractSnapshotValues(d.goals) as object,
        },
        update: {
          goals: extractSnapshotValues(d.goals) as object,
        },
      }),
    );

    // Also save the "all" company-wide snapshot
    const allGoalValues: GoalsSnapshotValues = {
      sales: perLocationData.reduce((s, d) => s + d.goals.sales.current, 0),
      surveys: perLocationData.reduce((s, d) => s + d.goals.surveys.current, 0),
      da: perLocationData.reduce((s, d) => s + d.goals.da.current, 0),
      cc: perLocationData.reduce((s, d) => s + d.goals.cc.current, 0),
      inspections: perLocationData.reduce(
        (s, d) => s + d.goals.inspections.current,
        0,
      ),
      pto: perLocationData.reduce((s, d) => s + d.goals.pto.current, 0),
      reviews: perLocationData.reduce(
        (s, d) => s + d.goals.reviews.current,
        0,
      ),
    };

    snapshotOps.push(
      prisma.goalsDigestSnapshot.upsert({
        where: { weekKey_location: { weekKey, location: "all" } },
        create: {
          weekKey,
          location: "all",
          goals: allGoalValues as object,
        },
        update: {
          goals: allGoalValues as object,
        },
      }),
    );

    await prisma.$transaction(snapshotOps);

    console.log(
      `[goals-digest] Saved ${snapshotOps.length} snapshots for week ${weekKey}`,
    );

    // ---- 6. Mark idempotency as complete ----
    await prisma.idempotencyKey.update({
      where: { key_scope: { key: weekKey, scope: SCOPE } },
      data: {
        status: "completed",
        response: {
          sent: true,
          officesSent: sentCount,
          officesTotal: officeDigests.length,
          recipientsCount: recipients.length,
          locationsCount: perLocationData.length,
          results: sendResults,
        },
      },
    });

    return NextResponse.json({
      sent: true,
      weekKey,
      officesSent: sentCount,
      officesTotal: officeDigests.length,
      recipientsCount: recipients.length,
      locationsCount: perLocationData.length,
      results: sendResults,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[goals-digest] failed:", err);
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
