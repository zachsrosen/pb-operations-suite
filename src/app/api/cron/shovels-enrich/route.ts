/**
 * GET /api/cron/shovels-enrich
 *
 * Picks up HubSpotPropertyCache records with shovelsEnrichmentStatus
 * IN ('PENDING', 'ERROR') AND shovelsRetryCount < 3, enriches them
 * from the Shovels API. Runs every 15 minutes via Vercel Cron.
 *
 * Auth: CRON_SECRET bearer token (same as other cron routes).
 * Feature flag: SHOVELS_ENRICHMENT_ENABLED must be "true".
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enrichPropertyFromShovels } from "@/lib/shovels-enrichment";
import { createShovelsClient } from "@/lib/shovels";

export const maxDuration = 300;

const BATCH_SIZE = 25;
const TIME_BUDGET_MS = 250_000; // Stop processing 50s before maxDuration

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.SHOVELS_ENRICHMENT_ENABLED !== "true") {
    return NextResponse.json({ status: "disabled" });
  }

  // Check credit budget before starting
  try {
    const client = createShovelsClient();
    const usage = await client.getUsage();
    const remaining = (usage.credit_limit ?? 25000) - usage.credits_used;
    if (usage.is_over_limit || remaining < 500) {
      return NextResponse.json({
        status: "skipped",
        reason: "credit budget low",
        credits_remaining: remaining,
      });
    }
  } catch (err) {
    console.error("[shovels-cron] usage check failed:", err);
  }

  // Fetch PENDING first, then ERROR with retries left
  const properties = await prisma.hubSpotPropertyCache.findMany({
    where: {
      OR: [
        { shovelsEnrichmentStatus: "PENDING" },
        {
          shovelsEnrichmentStatus: "ERROR",
          shovelsRetryCount: { lt: 3 },
        },
      ],
    },
    select: { id: true, shovelsEnrichmentStatus: true },
    orderBy: [
      { shovelsEnrichmentStatus: "asc" },
      { createdAt: "asc" },
    ],
    take: BATCH_SIZE,
  });

  if (properties.length === 0) {
    return NextResponse.json({ status: "idle", message: "no pending properties" });
  }

  const startTime = Date.now();
  const results = { enriched: 0, noMatch: 0, rejected: 0, errors: 0, skipped: 0 };
  let processed = 0;
  let timedOut = false;

  for (const prop of properties) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const result = await enrichPropertyFromShovels(prop.id);
    processed++;
    switch (result.status) {
      case "enriched":
        results.enriched++;
        break;
      case "no-match":
        results.noMatch++;
        break;
      case "rejected":
      case "low-confidence":
        results.rejected++;
        break;
      case "error":
        results.errors++;
        break;
      case "skipped":
        results.skipped++;
        break;
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  return NextResponse.json({
    status: timedOut ? "partial" : "ok",
    processed,
    queued: properties.length,
    ...results,
    elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
    timestamp: new Date().toISOString(),
  });
}
