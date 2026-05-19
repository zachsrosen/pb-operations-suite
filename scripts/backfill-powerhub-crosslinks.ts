// scripts/backfill-powerhub-crosslinks.ts
/**
 * One-time backfill: walk every currently-linked PowerhubSite, group by
 * propertyId, run resolvePrimarySite + pushToHubSpotForProperty per property.
 *
 * Resumable via PowerhubCrosslinkBackfillRun cursor.
 * Rate-limited to 5 properties/sec (HubSpot floor).
 *
 * Usage:
 *   npx tsx scripts/backfill-powerhub-crosslinks.ts
 *
 * IMPORTANT: This must NOT be invoked by a subagent. Orchestrator runs it
 * with explicit user approval. See spec § "Execution gate".
 */
import { prisma } from "@/lib/db";
import {
  acquireBackfillLock,
  heartbeatBackfillLock,
  releaseBackfillLock,
  updateBackfillCursor,
  HEARTBEAT_MS,
} from "@/lib/powerhub-crosslink-backfill-lock";
import { enqueueCrossSystemPush } from "@/lib/powerhub-crosslink";

const RATE_PER_SECOND = 5;
const SLEEP_MS = Math.ceil(1000 / RATE_PER_SECOND);

async function main() {
  if (process.env.POWERHUB_CROSSLINK_ENABLED !== "true") {
    console.error(
      "POWERHUB_CROSSLINK_ENABLED is not 'true' — push functions will no-op. Aborting.",
    );
    process.exit(1);
  }

  const lock = await acquireBackfillLock();
  if ("reason" in lock) {
    console.error(`Another backfill is in progress (runId=${lock.existingRunId}). Exiting.`);
    process.exit(1);
  }
  console.log(`Acquired backfill lock: runId=${lock.runId}`);

  const heartbeat = setInterval(() => {
    heartbeatBackfillLock(lock.runId).catch((e) => console.warn("Heartbeat failed:", e));
  }, HEARTBEAT_MS);

  try {
    const after = lock.cursor;
    const properties = await prisma.powerhubSite.findMany({
      where: {
        propertyId: { not: null },
        ...(after ? { propertyId: { gt: after } } : {}),
      },
      distinct: ["propertyId"],
      select: { propertyId: true },
      orderBy: { propertyId: "asc" },
    });
    const propertyIds = properties.map((p) => p.propertyId!).filter(Boolean);
    console.log(`Found ${propertyIds.length} distinct properties to process`);

    await prisma.powerhubCrosslinkBackfillRun.update({
      where: { id: lock.runId },
      data: { totalCount: propertyIds.length },
    });

    let processed = 0;
    let failed = 0;
    for (const propertyId of propertyIds) {
      try {
        await enqueueCrossSystemPush(propertyId);
        processed++;
      } catch (err) {
        failed++;
        console.warn(`Failed for property ${propertyId}:`, err);
      }
      if (processed % 50 === 0) {
        await updateBackfillCursor(lock.runId, propertyId, processed, failed);
        console.log(`Progress: ${processed}/${propertyIds.length} (${failed} failed)`);
      }
      await new Promise((r) => setTimeout(r, SLEEP_MS));
    }

    await releaseBackfillLock(lock.runId, "completed");
    console.log(`Done. Processed ${processed}, failed ${failed}.`);
  } catch (err) {
    await releaseBackfillLock(lock.runId, "failed", String(err));
    console.error("Backfill failed:", err);
    process.exit(1);
  } finally {
    clearInterval(heartbeat);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
