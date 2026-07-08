import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { tagSentryRequest } from "@/lib/sentry-request";
import {
  getTeamSections,
  getAllTeamSections,
  getPersonalSections,
  TEAM_DIGEST_LABELS,
  type TeamDigestKey,
} from "@/lib/bottleneck-team-digest";

/**
 * GET /api/bottlenecks/worklist?team=design|permitting|ic|ops|sales|pm|compliance
 * GET /api/bottlenecks/worklist?person=Peter+Zaun
 * The same funnel-bucket worklist sections the digests send — for the
 * Bottlenecks tab's team and personal views. Browser auth via middleware +
 * roles allowlist (/api/bottlenecks is in FUNNEL_VIEW_ROUTES).
 */
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  tagSentryRequest(request);
  const team = request.nextUrl.searchParams.get("team");
  const person = request.nextUrl.searchParams.get("person");
  if (!person && team !== "all" && (!team || !(team in TEAM_DIGEST_LABELS))) {
    return NextResponse.json(
      { error: `team must be "all" or one of: ${Object.keys(TEAM_DIGEST_LABELS).join(", ")} (or pass person=)` },
      { status: 400 }
    );
  }
  try {
    if (team === "all" && !person) {
      // Every team's worklist in one response — one deal-load + funnel build.
      const teams = await getAllTeamSections();
      return NextResponse.json({ teams, lastUpdated: new Date().toISOString() });
    }
    const sections = person
      ? await getPersonalSections(person)
      : await getTeamSections(team as TeamDigestKey);
    return NextResponse.json({
      team: person ? "personal" : team,
      label: person ?? TEAM_DIGEST_LABELS[team as TeamDigestKey],
      sections,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    Sentry.captureException(error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
