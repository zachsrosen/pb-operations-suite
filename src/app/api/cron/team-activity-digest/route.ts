import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { sendEmailMessage } from "@/lib/email";
import { DEFAULT_ROSTER } from "@/lib/team-activity/roster";
import { getReportsAdminEmail } from "@/lib/team-activity/flag";
import { runTeamActivity } from "@/lib/team-activity/run";
import { buildReportCard, type ReportPeriod } from "@/lib/team-activity/report-card";
import { denverWeekBounds, isoWeekKey } from "@/lib/team-activity/week";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // multi-source fan-out runs twice (current + previous week)

const SCOPE = "team-activity-digest";
const RECIPIENT = "zach@photonbrothers.com";
const DAY_MS = 86_400_000;

/**
 * Weekly team-activity report card, emailed to zach@ every Monday 7am MT
 * (with a Tuesday retry). Covers the week that just ended (prior Mon-Sun,
 * Denver-local) vs the week before it for deltas. Idempotent per ISO week.
 * See docs/superpowers/specs/2026-07-11-team-activity-weekly-digest-design.md.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const weekKey = isoWeekKey(now);

  // Idempotency: atomic claim, so the Tuesday retry never double-sends once
  // Monday succeeds. But a Monday that TIMED OUT/crashed leaves a stale
  // "processing" row (the catch below can't run) — the Tuesday retry must be
  // able to reclaim that, or the week's digest is silently lost. So on
  // conflict: skip only if already "completed"; otherwise reclaim and re-run.
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
    if ((err as { code?: string }).code !== "P2002") throw err;
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key_scope: { key: weekKey, scope: SCOPE } },
    });
    if (existing?.status === "completed") {
      return NextResponse.json({ ok: true, skipped: "already sent this week", weekKey });
    }
    // Stale "processing" (timed-out Monday) or "failed" — reclaim for this run.
    await prisma.idempotencyKey.update({
      where: { key_scope: { key: weekKey, scope: SCOPE } },
      data: { status: "processing", expiresAt: new Date(now.getTime() + 7 * DAY_MS) },
    });
  }

  let sent = false;
  try {
    const { current, previous } = denverWeekBounds(now);
    const reportsAdmin = await getReportsAdminEmail();

    // The report card header displays range dates by slicing the ISO date
    // (UTC). Our boundaries are Denver-local, and the Sunday-23:59 end lands on
    // the NEXT UTC day — so pass the Denver-local calendar day (at UTC noon) to
    // display the correct last-included day, not the exclusive boundary.
    const denverDayIso = (d: Date) =>
      `${d.toLocaleDateString("en-CA", { timeZone: "America/Denver" })}T12:00:00.000Z`;
    const toPeriod = (range: { from: Date; to: Date }, r: Awaited<ReturnType<typeof runTeamActivity>>): ReportPeriod => ({
      range: { from: denverDayIso(range.from), to: denverDayIso(range.to) },
      summaries: r.summaries,
      personDays: r.personDays,
      roster: r.roster,
      sources: { ran: r.ran, skipped: r.skipped },
    });

    const curResult = await runTeamActivity(prisma, current, DEFAULT_ROSTER, { reportsAdmin });
    // A prior-week failure must not block the current-week email — the card
    // handles previous=null (drops deltas, adds a caveat).
    let prevPeriod: ReportPeriod | null = null;
    try {
      const prevResult = await runTeamActivity(prisma, previous, DEFAULT_ROSTER, { reportsAdmin });
      prevPeriod = toPeriod(previous, prevResult);
    } catch (e) {
      console.error("team-activity-digest: prior-week run failed", e);
    }

    const card = buildReportCard(toPeriod(current, curResult), prevPeriod);
    const weekLabel = current.from.toLocaleDateString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric" });
    const subject = `Team Activity: week of ${weekLabel}`;
    const html = `<pre style="font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap">${card
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</pre>`;

    // sendEmailMessage does NOT throw on delivery failure — it returns
    // { success: false }. Treat that as a failure so the key is released and
    // the Tuesday retry re-sends (otherwise a failed send is marked completed).
    const result = await sendEmailMessage({
      to: RECIPIENT,
      subject,
      text: card,
      html,
      debugFallbackTitle: subject,
      debugFallbackBody: card,
      suppressConfiguredBcc: true, // per-person productivity data — recipient only
    });
    if (!result.success) throw new Error(`email send failed: ${result.error ?? "unknown"}`);
    sent = true;

    await prisma.idempotencyKey.update({
      where: { key_scope: { key: weekKey, scope: SCOPE } },
      data: { status: "completed" },
    });
    return NextResponse.json({ ok: true, weekKey, sent: RECIPIENT, subject });
  } catch (e) {
    if (sent) {
      // Email already went out; a later failure (e.g. the completion update)
      // must NOT delete the key, or the retry would double-send. Best-effort
      // mark completed and report success.
      await prisma.idempotencyKey
        .update({ where: { key_scope: { key: weekKey, scope: SCOPE } }, data: { status: "completed" } })
        .catch(() => {});
      return NextResponse.json({ ok: true, weekKey, sent: RECIPIENT, warning: "post-send step failed" });
    }
    // Not sent — release the claim so the Tuesday retry / a manual re-hit re-runs.
    await prisma.idempotencyKey
      .delete({ where: { key_scope: { key: weekKey, scope: SCOPE } } })
      .catch(() => {});
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
