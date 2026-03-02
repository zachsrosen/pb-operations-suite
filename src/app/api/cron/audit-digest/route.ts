import { NextRequest, NextResponse } from "next/server";
import { sendCronHealthAlert, sendDailyDigest } from "@/lib/audit/alerts";
import { prisma } from "@/lib/db";

/**
 * GET /api/cron/audit-digest
 *
 * Vercel cron job — sends daily audit digest email.
 * Schedule: every day at 7am America/Denver (14:00 UTC in winter).
 * Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDailyDigest(prisma);
    if (!result.sent && result.reason !== "digest recently sent") {
      await sendCronHealthAlert("audit-digest", result.reason ?? "unknown reason");
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    try {
      await sendCronHealthAlert("audit-digest", message);
    } catch {
      // Best-effort notification path; preserve original failure response.
    }
    return NextResponse.json({ sent: false, reason: message }, { status: 500 });
  }
}
