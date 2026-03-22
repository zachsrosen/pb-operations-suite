/**
 * POST /api/catalog/expire-pending
 *
 * Cron job: expire PendingCatalogPush records past their expiresAt.
 * Idempotent — safe to re-run.
 *
 * Auth: ADMIN or OWNER only (or API_SECRET_TOKEN in production).
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma, logActivity } from "@/lib/db";

export async function POST() {
  // ── Auth ──────────────────────────────────────────────────────────────
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { role, email } = authResult;
  if (role !== "ADMIN" && role !== "EXECUTIVE") {
    return NextResponse.json(
      { error: "Admin or Owner access required" },
      { status: 403 },
    );
  }

  if (!prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const now = new Date();

  const result = await prisma.pendingCatalogPush.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });

  if (result.count > 0) {
    await logActivity({
      type: "SETTINGS_CHANGED",
      userEmail: email,
      description: `Expired ${result.count} pending catalog push(es)`,
      metadata: { expiredCount: result.count, expiredAt: now.toISOString() },
    });
  }

  return NextResponse.json({
    expired: result.count,
    at: now.toISOString(),
  });
}
