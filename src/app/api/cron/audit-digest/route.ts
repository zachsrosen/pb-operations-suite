import { NextRequest, NextResponse } from "next/server";
import { sendDailyDigest } from "@/lib/audit/alerts";
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

  const result = await sendDailyDigest(prisma);
  return NextResponse.json(result);
}
