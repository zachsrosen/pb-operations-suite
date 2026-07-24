import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { expireStaleInvites } from "@/lib/portal-token";

/**
 * GET /api/cron/survey-invite-expiry
 *
 * Vercel cron job — flips lapsed PENDING survey invites to EXPIRED.
 * Schedule: daily 8am UTC. Protected by CRON_SECRET.
 *
 * Expiry used to be a date nothing acted on: the only code that wrote EXPIRED
 * ran when a customer clicked their dead link, so invites nobody clicked sat
 * PENDING forever and blocked every later invite for that deal (partial unique
 * index on (dealId) WHERE status IN ('PENDING','SCHEDULED')). The invite routes
 * now sweep per-deal at create time; this is the table-wide hygiene pass so
 * counts and dashboards reflect reality for deals nobody re-invites.
 *
 * Only ever touches PENDING — a booking past its token TTL is still a booking.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const startedAt = Date.now();

  try {
    const expired = await expireStaleInvites();

    console.log(`[cron/survey-invite-expiry] Expired ${expired} lapsed invite(s)`);

    return NextResponse.json({
      success: true,
      expired,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("[cron/survey-invite-expiry] Failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sweep failed" },
      { status: 500 },
    );
  }
}
