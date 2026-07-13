import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";
import { type ActivitySource } from "@/lib/team-activity/metrics";
import { DEFAULT_ROSTER } from "@/lib/team-activity/roster";
import { isTeamActivityEnabled, getReportsAdminEmail } from "@/lib/team-activity/flag";
import { type DateRange } from "@/lib/team-activity/adapters";
import { runTeamActivity } from "@/lib/team-activity/run";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/**
 * GET /api/admin/team-activity?from=YYYY-MM-DD&to=YYYY-MM-DD&only=pbops,aircall
 *
 * ADMIN only (also gated by TEAM_ACTIVITY_DASHBOARD_ENABLED). Runs the
 * same source adapters as the CLI and returns per-person summaries + per-day
 * detail. External sources (hubspot/google) degrade gracefully into `skipped`.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await isTeamActivityEnabled())) {
    return NextResponse.json({ error: "Team Activity dashboard is disabled" }, { status: 503 });
  }

  const url = new URL(request.url);
  const to = url.searchParams.get("to") ? new Date(`${url.searchParams.get("to")}T23:59:59Z`) : new Date();
  const from = url.searchParams.get("from")
    ? new Date(`${url.searchParams.get("from")}T00:00:00Z`)
    : new Date(to.getTime() - 14 * DAY_MS);
  if (isNaN(+from) || isNaN(+to) || from > to) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const only = url.searchParams.get("only")?.split(",").map((s) => s.trim()) as ActivitySource[] | undefined;
  const range: DateRange = { from, to };
  const reportsAdmin = await getReportsAdminEmail();

  // Ad-hoc lookup: `?emails=a@x.com,b@x.com` builds a one-off roster (names
  // resolved from the User directory) instead of the default team. Adapters
  // resolve everything else by email/directory, so no pre-known IDs are needed.
  const emailsParam = url.searchParams
    .get("emails")
    ?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  let roster = DEFAULT_ROSTER;
  if (emailsParam?.length) {
    const users = await prisma.user.findMany({
      where: { email: { in: emailsParam, mode: "insensitive" } },
      select: { email: true, name: true },
    });
    const nameByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
    roster = emailsParam.map((email) => ({ email, name: nameByEmail.get(email) ?? email }));
  }

  const { ran, skipped, totalEvents, personDays, summaries, roster: rosterOut } = await runTeamActivity(
    prisma,
    range,
    roster,
    { only, reportsAdmin },
  );

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    sources: { ran, skipped },
    totalEvents,
    summaries,
    personDays,
    roster: rosterOut,
    lastUpdated: new Date().toISOString(),
  });
}
