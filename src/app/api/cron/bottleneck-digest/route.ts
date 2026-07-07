import { NextRequest, NextResponse } from "next/server";
import { runBottleneckDigest } from "@/lib/bottleneck-digest";

/**
 * GET /api/cron/bottleneck-digest
 * Weekday-morning bottleneck digest to the owner DM (change-driven; Mondays
 * always send with flow trends + refresh derived thresholds).
 * ?preview=1 renders without posting. Protected by CRON_SECRET.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const preview = request.nextUrl.searchParams.get("preview") === "1";
  try {
    const result = await runBottleneckDigest({ preview });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[bottleneck-digest] failed:", message);
    return NextResponse.json({ posted: false, reason: message }, { status: 500 });
  }
}
