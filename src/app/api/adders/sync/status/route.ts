/**
 * GET /api/adders/sync/status
 *
 * Surfaces the most recent `AdderSyncRun` (for the current-state badge)
 * and the most recent SUCCESS or PARTIAL run (for "last green" freshness).
 * Any authenticated user may read — it's metadata, not catalog content.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [lastRun, lastSuccess] = await Promise.all([
    prisma.adderSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
    }),
    prisma.adderSyncRun.findFirst({
      where: { status: { in: ["SUCCESS", "PARTIAL"] } },
      orderBy: { startedAt: "desc" },
    }),
  ]);

  return NextResponse.json({ lastRun, lastSuccess });
}
