import { NextRequest, NextResponse } from "next/server";
import { batchSyncPipeline, syncPipelineConfigs } from "@/lib/deal-sync";
import type { DealPipeline } from "@/generated/prisma";

export const maxDuration = 300;

const ALL_PIPELINES: DealPipeline[] = ["PROJECT", "SALES", "DNR", "SERVICE", "ROOFING"];

function isFullSyncCycle(): boolean {
  const hour = new Date().getUTCHours();
  return hour % 6 === 0 && new Date().getUTCMinutes() < 10;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const full = isFullSyncCycle();
  const results = [];

  try {
    await syncPipelineConfigs();
  } catch (err) {
    console.error("[deal-sync] Pipeline config sync failed:", err);
  }

  for (const pipeline of ALL_PIPELINES) {
    try {
      const result = await batchSyncPipeline(pipeline, { full });
      results.push(result);
    } catch (err) {
      console.error(`[deal-sync] ${pipeline} sync failed:`, err);
      results.push({
        pipeline,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    syncType: full ? "full" : "incremental",
    timestamp: new Date().toISOString(),
    results,
  });
}
