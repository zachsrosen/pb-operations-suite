/**
 * POST /api/workflow-map/refresh
 *
 * Admin-triggered on-demand sync of the Workflow Map. Defense-in-depth: the
 * route is also covered by `ADMIN_ONLY_ROUTES` in middleware, but we re-check
 * the session roles here. Rate-limited to one refresh per 5 minutes via a
 * SystemConfig timestamp row (`workflow_map_last_refresh`).
 *
 * Session + role resolution mirrors `src/app/api/admin/sop/sections/[id]/route.ts`.
 * SystemConfig read/write mirrors `src/lib/pe-uploader-overrides.ts`.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { syncFlowMap } from "@/lib/flow-map/sync";

// The first backfill is ~870 HubSpot calls / several minutes; mirror the cron
// route's ceiling so a cold sync isn't killed at the default 10s/60s. The sync
// itself persists progress incrementally, so even a timeout is recoverable.
export const maxDuration = 300;

const REFRESH_TS_KEY = "workflow_map_last_refresh";
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 503 },
      );
    }

    // Defense-in-depth: verify ADMIN (route also gated by ADMIN_ONLY_ROUTES).
    const currentUser = await getUserByEmail(session.user.email);
    const rawRoles: UserRole[] =
      currentUser?.roles && currentUser.roles.length > 0 ? currentUser.roles : [];
    const normalizedRoles = rawRoles.map((r) => ROLES[r]?.normalizesTo ?? r);
    if (!normalizedRoles.some((r) => r === "ADMIN")) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    // Rate-limit: bail if a refresh ran < 5 minutes ago.
    const row = await prisma.systemConfig.findUnique({
      where: { key: REFRESH_TS_KEY },
    });
    if (row?.value) {
      const last = Date.parse(row.value);
      if (!Number.isNaN(last) && Date.now() - last < MIN_INTERVAL_MS) {
        return NextResponse.json(
          { error: "Refreshed recently, try again shortly" },
          { status: 429 },
        );
      }
    }

    // Stamp the timestamp BEFORE the (slow) sync so concurrent calls are
    // rate-limited against the in-flight refresh.
    await prisma.systemConfig.upsert({
      where: { key: REFRESH_TS_KEY },
      create: { key: REFRESH_TS_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    });

    const result = await syncFlowMap();
    return NextResponse.json({ status: "ok", ...result });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
