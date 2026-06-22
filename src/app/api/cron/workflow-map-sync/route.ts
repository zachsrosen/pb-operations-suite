/**
 * GET /api/cron/workflow-map-sync
 *
 * Nightly sync for the Workflow Map feature. Re-fetches HubSpot flows +
 * pipelines and rebuilds the rendered snapshot stored in SystemConfig.
 *
 * Auth mirrors `src/app/api/cron/property-reconcile/route.ts` — bearer-token
 * compare against `process.env.CRON_SECRET`.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncFlowMap } from "@/lib/flow-map/sync";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Dark-launch kill switch: no-op until the sync flag is flipped on. The admin
  // manual refresh route (/api/workflow-map/refresh) stays available so
  // reviewers can populate the snapshot on demand while the cron is off.
  if (process.env.WORKFLOW_MAP_SYNC_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  try {
    const result = await syncFlowMap();
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
