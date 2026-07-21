/**
 * GET /api/cron/on-call-reminders
 *
 * Monday-morning cron (15:00 UTC) — sends two reminder emails per weekly
 * on-call pool, built from the persisted OnCallAssignment rows so swaps and
 * split weeks come out right by construction:
 *   - week-of:    "You're on call this week"  to everyone holding days in the
 *                 current Mon–Sun week
 *   - week-ahead: "You're on call next week"  to everyone holding days in the
 *                 following week
 *
 * Fire-and-forget by design (settled with Zach): no idempotency tracking and
 * no catch-up — a failed run drops that week's reminders, and manually
 * re-triggering the route re-sends. An empty week (no persisted rows) is a
 * counted no-op and the signal that the pool's published horizon needs a
 * republish.
 */

import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import * as React from "react";
import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { isOnCallRotationsEnabled } from "@/lib/feature-flags";
import { addDays, mondayOf } from "@/lib/on-call-rotation";
import { todayInTz } from "@/lib/on-call-swap";
import {
  formatDateRanges,
  formatShiftWindow,
  groupWeekAssignments,
  reminderSubject,
  type ReminderVariant,
} from "@/lib/on-call-reminders";
import OnCallReminder from "@/emails/OnCallReminder";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function baseUrl(): string {
  return (
    (process.env.NEXT_PUBLIC_APP_URL || "").trim() ||
    (process.env.APP_URL || "").trim() ||
    "https://www.pbtechops.com"
  );
}

type PoolSummary = {
  pool: string;
  sent: number;
  failed: number;
  missingEmail: number;
  emptyWeeks: number;
};

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Dark-rollout gate: 200 + skipped so Vercel doesn't record failing runs
  // while the feature is off (repo convention, e.g. powerhub-telemetry).
  if (!isOnCallRotationsEnabled() || process.env.ON_CALL_REMINDER_EMAILS_ENABLED !== "true") {
    return NextResponse.json({ skipped: true, reason: "reminder emails disabled" });
  }

  const pools = await prisma.onCallPool.findMany({ where: { isActive: true } });
  const summaries: PoolSummary[] = [];
  const skippedPools: string[] = [];

  for (const pool of pools) {
    if (pool.rotationUnit !== "weekly") {
      // Daily-rotation pools have no "your week" to remind about; none exist today.
      console.warn(`[on-call-reminders] skipping non-weekly pool ${pool.name}`);
      skippedPools.push(pool.name);
      continue;
    }

    const summary: PoolSummary = { pool: pool.name, sent: 0, failed: 0, missingEmail: 0, emptyWeeks: 0 };
    const thisMonday = mondayOf(todayInTz(pool.timezone));
    const weeks: Array<{ variant: ReminderVariant; monday: string }> = [
      { variant: "week-of", monday: thisMonday },
      { variant: "week-ahead", monday: addDays(thisMonday, 7) },
    ];

    for (const { variant, monday } of weeks) {
      const rows = await prisma.onCallAssignment.findMany({
        where: { poolId: pool.id, date: { gte: monday, lte: addDays(monday, 6) } },
        include: { crewMember: { select: { name: true, email: true } } },
        orderBy: { date: "asc" },
      });
      if (rows.length === 0) {
        summary.emptyWeeks += 1;
        console.warn(
          `[on-call-reminders] ${pool.name} has no published assignments for week of ${monday} — republish the pool to extend the horizon`,
        );
        continue;
      }

      for (const member of groupWeekAssignments(rows)) {
        if (!member.email) {
          summary.missingEmail += 1;
          console.warn(`[on-call-reminders] no email for ${member.name} (${pool.name}, week of ${monday})`);
          continue;
        }

        const dateRange = formatDateRanges(member.dates);
        const subject = reminderSubject(variant, pool.name, dateRange);
        const dashboardUrl = `${baseUrl()}/dashboards/on-call/me`;
        const props = {
          variant,
          memberName: member.name,
          poolName: pool.name,
          dateRange,
          weekdayWindow: formatShiftWindow(pool.shiftStart, pool.shiftEnd),
          weekendWindow: formatShiftWindow(pool.weekendShiftStart, pool.weekendShiftEnd),
          coversSundays: pool.coversSundays,
          timezone: pool.timezone,
          dashboardUrl,
        };

        try {
          const html = await render(React.createElement(OnCallReminder, props));
          const text = [
            subject,
            "",
            `Your days: ${dateRange}`,
            `Weekday hours (Mon–Fri): ${props.weekdayWindow}`,
            `${pool.coversSundays ? "Weekend hours (Sat & Sun)" : "Weekend hours (Sat)"}: ${props.weekendWindow}`,
            `Timezone: ${pool.timezone}`,
            "",
            `View the schedule or request a swap: ${dashboardUrl}`,
          ].join("\n");

          const result = await sendEmailMessage({
            to: member.email,
            subject,
            html,
            text,
            debugFallbackTitle: `On-call reminder (${variant})`,
            debugFallbackBody: text,
            // Electrician-only by decision — don't merge the global scheduling BCC list.
            suppressConfiguredBcc: true,
          });
          if (result.success) {
            summary.sent += 1;
          } else {
            summary.failed += 1;
            console.warn(`[on-call-reminders] send failed for ${member.name} (${pool.name})`, result.error);
          }
        } catch (err) {
          summary.failed += 1;
          console.warn(`[on-call-reminders] send threw for ${member.name} (${pool.name})`, err);
        }
      }
    }

    summaries.push(summary);
  }

  return NextResponse.json({ pools: summaries, skippedPools });
}
