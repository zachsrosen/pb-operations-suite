/**
 * GET /api/cron/zuper-property-sync
 *
 * Picks up HubSpotPropertyCache records that are dirty (updatedAt > zuperPropertySyncedAt
 * or zuperPropertyUid is null) and syncs them to Zuper's Property module.
 * Runs every 15 minutes via Vercel Cron.
 *
 * Auth: CRON_SECRET bearer token.
 * Feature flag: ZUPER_PROPERTY_SYNC_ENABLED must be "true".
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findDirtyProperties, syncPropertyToZuper } from "@/lib/zuper-property-sync";

export const maxDuration = 300;

const BATCH_SIZE = 20;
const TIME_BUDGET_MS = 250_000; // Stop processing 50s before maxDuration

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.ZUPER_PROPERTY_SYNC_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  const startTime = Date.now();
  const dirtyProperties = await findDirtyProperties(BATCH_SIZE);

  if (dirtyProperties.length === 0) {
    return NextResponse.json({ status: "idle", message: "no dirty properties" });
  }

  const results = { created: 0, updated: 0, errors: 0, jobsLinked: 0 };
  let processed = 0;
  let timedOut = false;

  for (const { id } of dirtyProperties) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    try {
      const result = await syncPropertyToZuper(id);
      if (result.action === "created") results.created++;
      else if (result.action === "updated") results.updated++;
      results.jobsLinked += result.jobsLinked;
      processed++;
    } catch (err) {
      results.errors++;
      processed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[zuper-property-sync-cron] Error syncing property ${id}:`, msg);

      // Increment fail count on the property
      await prisma.hubSpotPropertyCache
        .update({
          where: { id },
          data: { zuperSyncFailCount: { increment: 1 } },
        })
        .catch(() => {}); // Don't let the fail-count update itself fail the loop
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  return NextResponse.json({
    status: "ok",
    processed,
    ...results,
    timedOut,
    elapsed: `${elapsed}s`,
  });
}
