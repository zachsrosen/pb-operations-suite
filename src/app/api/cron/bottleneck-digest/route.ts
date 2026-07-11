import { NextRequest, NextResponse } from "next/server";
import { runBottleneckDigest } from "@/lib/bottleneck-digest";
import {
  runTeamDigest,
  runPersonalWorklists,
  runManagerWorklists,
  TEAM_DIGEST_LABELS,
  type TeamDigestKey,
} from "@/lib/bottleneck-team-digest";

/**
 * GET /api/cron/bottleneck-digest
 * Weekday-morning bottleneck digest to the owner DM (change-driven; Mondays
 * always send with flow trends + refresh derived thresholds).
 * ?preview=1 renders without posting. Protected by CRON_SECRET.
 * ?team=design|permitting|ic|ops|sales|pm|compliance — that team's
 * funnel-bucket WORKLIST digest, sent to the owner DM (test/review sends
 * until bot visibility widens). Always sends; never touches the daily
 * digest's change-detection snapshot.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const preview = request.nextUrl.searchParams.get("preview") === "1";

  // ?personal=preview|dryrun|live — per-person worklists (one DM per lead).
  // preview: JSON summaries only. dryrun: all posted to the owner DM, labeled.
  // live: real DMs — gated on the bottleneck_personal_worklists_enabled
  // SystemConfig flag AND Chat-app visibility that includes the recipients.
  const personal = request.nextUrl.searchParams.get("personal");
  if (personal) {
    if (!["preview", "dryrun", "provision", "live"].includes(personal)) {
      return NextResponse.json({ error: "personal must be preview|dryrun|provision|live" }, { status: 400 });
    }
    const limitParam = Number(request.nextUrl.searchParams.get("limit"));
    const exclude = (request.nextUrl.searchParams.get("exclude") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const out = await runPersonalWorklists({
        mode: personal as "preview" | "dryrun" | "provision" | "live",
        limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
        exclude,
      });
      return NextResponse.json(out);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error("[bottleneck-digest] personal worklists failed:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const teamParam = request.nextUrl.searchParams.get("team");
  if (teamParam && !(teamParam in TEAM_DIGEST_LABELS)) {
    return NextResponse.json(
      { error: `unknown team "${teamParam}" — expected one of: ${Object.keys(TEAM_DIGEST_LABELS).join(", ")}` },
      { status: 400 }
    );
  }
  try {
    if (teamParam) {
      const result = await runTeamDigest(teamParam as TeamDigestKey, { preview });
      return NextResponse.json(result);
    }
    // Default weekday-morning run: Zach's daily digest + everyone's personal
    // worklists (live mode is flag-gated, honors standing exclusions and
    // coverage redirects, and only reaches recorded DM spaces).
    const daily = await runBottleneckDigest({ preview });
    const personal = preview
      ? { results: [], unmatched: [], skipped: "preview" }
      : await runPersonalWorklists({ mode: "live" });
    const managers = preview
      ? { results: [], skipped: "preview" }
      : await runManagerWorklists({ mode: "live" });
    return NextResponse.json({ daily, personal, managers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[bottleneck-digest] failed:", message);
    return NextResponse.json({ posted: false, reason: message }, { status: 500 });
  }
}
