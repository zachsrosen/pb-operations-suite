/**
 * Check BOM Pipeline Run results for the 27 RTB deals.
 * Shows status, SO creation, PO creation, and any errors.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const RTB_DEALS = [
  "52833472822", "54267085961", "54693664282", "43602808364",
  "55048085217", "51906821747", "55456488488", "55618498076",
  "55618498248", "56004282445", "55456488600", "55897891505",
  "56167025637", "55897891463", "56167026253", "56167024821",
  "56517505703", "56517505775", "56517505759", "56853754270",
  "56853754327", "57254803963", "57254803883", "57254803841",
  "57564736668", "57564736687", "57564736631",
];

async function main() {
  const runs = await prisma.bomPipelineRun.findMany({
    where: { dealId: { in: RTB_DEALS } },
    orderBy: [{ dealId: "asc" }, { createdAt: "desc" }],
  });

  // Group by deal, take latest non-FAILED run (or latest overall)
  const byDeal = new Map<string, typeof runs>();
  for (const r of runs) {
    const arr = byDeal.get(r.dealId) || [];
    arr.push(r);
    byDeal.set(r.dealId, arr);
  }

  let succeeded = 0;
  let partial = 0;
  let failed = 0;
  let noRun = 0;
  let withSO = 0;
  let withPO = 0;
  let totalPOs = 0;

  console.log("=== BOM Pipeline Results for 27 RTB Deals ===\n");

  for (const dealId of RTB_DEALS) {
    const dealRuns = byDeal.get(dealId) || [];
    // Pick best run: SUCCEEDED > PARTIAL > RUNNING > FAILED
    const best = dealRuns.find(r => r.status === "SUCCEEDED")
      || dealRuns.find(r => r.status === "PARTIAL")
      || dealRuns.find(r => r.status === "RUNNING")
      || dealRuns[0];

    if (!best) {
      console.log(`${dealId}: NO RUNS`);
      noRun++;
      continue;
    }

    const meta = best.metadata as Record<string, unknown> | null;
    const poCreated = (meta?.poCreated as Array<unknown>) || [];
    const poFailed = (meta?.poFailed as Array<unknown>) || [];
    const poSkipped = (meta?.poSkippedExisting as Array<unknown>) || [];
    const poUnassigned = (meta?.poUnassignedItems as Array<unknown>) || [];
    const hasPOs = poCreated.length > 0 || poSkipped.length > 0;

    const statusIcon = best.status === "SUCCEEDED" ? "✅" :
      best.status === "PARTIAL" ? "⚠️" :
      best.status === "RUNNING" ? "🔄" : "❌";

    let line = `${statusIcon} ${best.dealName || dealId} | ${best.status} | trigger=${best.trigger}`;

    if (best.zohoSoNumber) {
      line += ` | SO=${best.zohoSoNumber}`;
      withSO++;
    }

    if (poCreated.length > 0) {
      line += ` | POs created=${poCreated.length}`;
      totalPOs += poCreated.length;
      withPO++;
    }
    if (poSkipped.length > 0) {
      line += ` | POs existing=${poSkipped.length}`;
      totalPOs += poSkipped.length;
      if (poCreated.length === 0) withPO++;
    }
    if (poFailed.length > 0) {
      line += ` | POs failed=${poFailed.length}`;
    }
    if (poUnassigned.length > 0) {
      line += ` | unassigned items=${poUnassigned.length}`;
    }

    if (best.failedStep) {
      line += ` | failedAt=${best.failedStep}`;
    }
    if (best.errorMessage) {
      line += ` | error=${best.errorMessage.slice(0, 80)}`;
    }

    if (best.durationMs) {
      line += ` | ${(best.durationMs / 1000).toFixed(1)}s`;
    }

    console.log(line);

    if (best.status === "SUCCEEDED") succeeded++;
    else if (best.status === "PARTIAL") partial++;
    else if (best.status === "FAILED") failed++;
  }

  console.log("\n=== Summary ===");
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Partial:   ${partial}`);
  console.log(`Failed:    ${failed}`);
  console.log(`No runs:   ${noRun}`);
  console.log(`With SO:   ${withSO}`);
  console.log(`With POs:  ${withPO} deals (${totalPOs} total POs)`);

  await prisma.$disconnect();
}

main().catch(console.error);
