import { NextRequest, NextResponse } from "next/server";
import { syncZuperServiceJobs } from "@/lib/zuper-sync";

/**
 * GET /api/zuper/sync-cache
 * Vercel cron job — syncs Zuper service jobs into ZuperJobCache.
 * Schedule: every 30 min.
 * Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncZuperServiceJobs();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[ZuperSync API] Sync failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}

/**
 * POST /api/zuper/sync-cache
 * On-demand trigger for manual sync.
 * Protected by API_SECRET_TOKEN via middleware MACHINE_TOKEN_ALLOWED_ROUTES.
 */
export async function POST(request: NextRequest) {
  const isAuthed = request.headers.get("x-api-token-authenticated") === "1";
  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncZuperServiceJobs();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[ZuperSync API] Sync failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
