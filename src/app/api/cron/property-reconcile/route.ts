/**
 * GET /api/cron/property-reconcile
 *
 * Nightly reconciliation cron for the HubSpot Property custom object. Pages
 * through all Property records, refreshes the local cache + association
 * links, recomputes rollups, and cleans up expired `PropertySyncWatermark`
 * rows. See `docs/superpowers/plans/2026-04-14-hubspot-property-object.md`
 * Task 3.2 and the spec's §Nightly reconciliation.
 *
 * Auth mirrors `src/app/api/cron/deal-sync/route.ts` — bearer-token compare
 * against `process.env.CRON_SECRET`. Feature flag (`PROPERTY_SYNC_ENABLED`)
 * fails OPEN with `{status:"disabled"}` so Vercel Cron doesn't flag the job.
 */

import { NextRequest, NextResponse } from "next/server";
import { reconcileAllProperties } from "@/lib/property-sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.PROPERTY_SYNC_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  try {
    const result = await reconcileAllProperties();
    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      ...result,
    });
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
