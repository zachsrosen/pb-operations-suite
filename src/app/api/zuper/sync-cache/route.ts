import { NextRequest, NextResponse } from "next/server";
import { syncZuperServiceJobs } from "@/lib/zuper-sync";

/**
 * POST /api/zuper/sync-cache
 * Triggers a full sync of Zuper jobs into ZuperJobCache.
 * Intended for cron (every 30 min) or on-demand trigger.
 * Protected by API_SECRET_TOKEN via middleware MACHINE_TOKEN_ALLOWED_ROUTES.
 */
export async function POST(request: NextRequest) {
  const isAuthed = request.headers.get("x-api-token-authenticated") === "1";
  if (!isAuthed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncZuperServiceJobs();
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[ZuperSync API] Sync failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
