/**
 * POST /api/admin/aircall/backfill
 *
 * Admin-gated backfill trigger. Pulls the requested number of days of
 * Aircall calls and refreshes the user roster. Runs synchronously up to
 * the function timeout (300s) and returns a summary; longer windows
 * should be split into multiple calls.
 *
 * Body: { days?: number }
 */

import { NextRequest, NextResponse } from "next/server";

import { aircall } from "@/lib/aircall";
import { syncCallsRange, syncUsers } from "@/lib/aircall-sync";
import { requireRole } from "@/lib/auth-utils";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

export async function POST(req: NextRequest) {
  let user;
  try {
    user = await requireRole("ADMIN");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!aircall.isConfigured()) {
    return NextResponse.json({ error: "Aircall API not configured" }, { status: 503 });
  }

  let days = DEFAULT_DAYS;
  try {
    const body = (await req.json()) as { days?: unknown };
    if (typeof body.days === "number" && Number.isFinite(body.days)) {
      days = Math.max(1, Math.min(MAX_DAYS, Math.floor(body.days)));
    }
  } catch {
    // Empty body is fine — use defaults.
  }

  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const calls = await syncCallsRange(from, now, { pageDelayMs: 1100 });
    const users = await syncUsers();
    void prisma.activityLog
      .create({
        data: {
          type: "AIRCALL_BACKFILL_RUN",
          description: `Aircall backfill: ${days}d, ${calls.upserted} calls, ${users.upserted} users`,
          userEmail: user.email,
          userName: user.name ?? null,
          metadata: { days, calls, users } as object,
        },
      })
      .catch(() => {});
    return NextResponse.json({ ok: true, days, calls, users });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
