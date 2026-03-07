/**
 * GET /api/solar/cron/cleanup-pending
 *
 * Vercel cron — deletes SolarPendingState rows older than 7 days.
 * Protected by CRON_SECRET header validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  // Validate cron secret
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  const result = await prisma.solarPendingState.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return NextResponse.json({
    ok: true,
    deleted: result.count,
    cutoff: cutoff.toISOString(),
  });
}
