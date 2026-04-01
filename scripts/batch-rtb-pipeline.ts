/**
 * Batch BOM Pipeline Trigger for RTB Deals
 *
 * Finds deals that hit RTB since March 5, 2026 without a completed
 * BomPipelineRun, then triggers the pipeline for each via the production
 * webhook endpoint with bearer auth.
 *
 * Usage:
 *   npx tsx scripts/batch-rtb-pipeline.ts          # dry-run (list only)
 *   npx tsx scripts/batch-rtb-pipeline.ts --trigger # trigger on production
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const PROD_URL = "https://www.pbtechops.com";
const RTB_STAGE_ID = "22580871"; // Ready To Build stage in project pipeline

// All 27 deals that hit RTB since March 5, 2026 (from HubSpot search)
const RTB_DEALS = [
  { dealId: "52833472822", name: "PROJ-8914 | Coombs, Michael", rtbDate: "2026-03-05" },
  { dealId: "54267085961", name: "PROJ-9020 | Markland, Wade", rtbDate: "2026-03-06" },
  { dealId: "54693664282", name: "PROJ-9077 | Wahr, Kathleen", rtbDate: "2026-03-06" },
  { dealId: "43602808364", name: "PROJ-9473 | Schmidt, William", rtbDate: "2026-03-10" },
  { dealId: "52607086402", name: "PROJ-8928 | Schraad, Daryl", rtbDate: "2026-03-10" },
  { dealId: "53251048250", name: "PROJ-9034 | White, Frank", rtbDate: "2026-03-10" },
  { dealId: "50880438134", name: "PROJ-8949 | WIEN, MICHEAL", rtbDate: "2026-03-10" },
  { dealId: "46632475737", name: "PROJ-8854 | Browne, Alex", rtbDate: "2026-03-11" },
  { dealId: "19250680712", name: "PROJ-6783 | Harris, Micky", rtbDate: "2026-03-11" },
  { dealId: "52037859506", name: "PROJ-8884 | Davis, John & Patricia", rtbDate: "2026-03-11" },
  { dealId: "53548136054", name: "PROJ-8983 | Maes, Porfillo", rtbDate: "2026-03-11" },
  { dealId: "53692717960", name: "PROJ-9016 | Aung, Tin", rtbDate: "2026-03-11" },
  { dealId: "55042437445", name: "PROJ-9060 | Rifkin, John", rtbDate: "2026-03-11" },
  { dealId: "52367291284", name: "PROJ-9011 | Sydnor, Ryan", rtbDate: "2026-03-11" },
  { dealId: "52342977045", name: "PROJ-9051 | Wilder, Megan", rtbDate: "2026-03-11" },
  { dealId: "13526620495", name: "PROJ-7102 | Rohde, Dan", rtbDate: "2026-03-12" },
  { dealId: "39259676559", name: "PROJ-8788 | Rowe, Brian", rtbDate: "2026-03-12" },
  { dealId: "53076733358", name: "PROJ-8984 | Rothman, Paul", rtbDate: "2026-03-12" },
  { dealId: "56254059185", name: "PROJ-9475 | Slagle, Matthew", rtbDate: "2026-03-12" },
  { dealId: "54551677582", name: "PROJ-9076 | Morse, Todd", rtbDate: "2026-03-16" },
  { dealId: "16253324204", name: "PROJ-5920 | Schmidt, Tucker", rtbDate: "2026-03-16" },
  { dealId: "53684897073", name: "PROJ-9000 | Casterline, Forest", rtbDate: "2026-03-16" },
  { dealId: "52923589186", name: "PROJ-9027 | Grundy, Michael", rtbDate: "2026-03-16" },
  { dealId: "42969431162", name: "PROJ-8787 | Garman, Matthew", rtbDate: "2026-03-17" },
  { dealId: "55133090333", name: "PROJ-9464 | Mucaj, Rigert", rtbDate: "2026-03-18" },
  { dealId: "11759540266", name: "PROJ-8935 | Rooney, Chelsea", rtbDate: "2026-03-19" },
  { dealId: "22983647032", name: "PROJ-8770 | Collins, Logan", rtbDate: "2026-03-19" },
];

async function main() {
  const shouldTrigger = process.argv.includes("--trigger");
  const apiToken = process.env.API_SECRET_TOKEN;

  console.log(`\n=== BOM Pipeline Batch Trigger ===`);
  console.log(`Mode: ${shouldTrigger ? "🔴 TRIGGER (production)" : "🔍 DRY RUN"}`);
  console.log(`Deals to check: ${RTB_DEALS.length}\n`);

  // Query all existing pipeline runs for these deals
  const dealIds = RTB_DEALS.map((d) => d.dealId);
  const existingRuns = await prisma.bomPipelineRun.findMany({
    where: { dealId: { in: dealIds } },
    select: { dealId: true, status: true, trigger: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Group runs by dealId
  const runsByDeal = new Map<string, typeof existingRuns>();
  for (const run of existingRuns) {
    const runs = runsByDeal.get(run.dealId) || [];
    runs.push(run);
    runsByDeal.set(run.dealId, runs);
  }

  const needsTrigger: typeof RTB_DEALS = [];
  const alreadyCompleted: typeof RTB_DEALS = [];
  const hasRunning: typeof RTB_DEALS = [];

  for (const deal of RTB_DEALS) {
    const runs = runsByDeal.get(deal.dealId) || [];
    // Only count WEBHOOK_READY_TO_BUILD completed runs (not our local MANUAL failures)
    const completed = runs.find(
      (r) => (r.status === "SUCCEEDED" || r.status === "PARTIAL") &&
             r.trigger === "WEBHOOK_READY_TO_BUILD"
    );
    const running = runs.find((r) => r.status === "RUNNING");

    if (completed) {
      alreadyCompleted.push(deal);
      console.log(`✅ ${deal.name} (RTB ${deal.rtbDate}) — ${completed.status} run exists`);
    } else if (running) {
      hasRunning.push(deal);
      console.log(`⏳ ${deal.name} (RTB ${deal.rtbDate}) — RUNNING (started ${running.createdAt.toISOString()})`);
    } else {
      needsTrigger.push(deal);
      const failedRuns = runs.filter((r) => r.status === "FAILED");
      if (failedRuns.length > 0) {
        console.log(`❌ ${deal.name} (RTB ${deal.rtbDate}) — ${failedRuns.length} failed run(s) — NEEDS TRIGGER`);
      } else {
        console.log(`❌ ${deal.name} (RTB ${deal.rtbDate}) — NO pipeline run — NEEDS TRIGGER`);
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Already completed: ${alreadyCompleted.length}`);
  console.log(`Currently running: ${hasRunning.length}`);
  console.log(`Needs trigger:     ${needsTrigger.length}`);

  if (!shouldTrigger) {
    if (needsTrigger.length > 0) {
      console.log(`\nRun with --trigger to trigger pipelines for ${needsTrigger.length} deals.`);
    }
    await prisma.$disconnect();
    return;
  }

  // Trigger mode — hit production webhook with bearer auth
  if (!apiToken) {
    console.error("\n❌ API_SECRET_TOKEN not set in .env.local — cannot trigger production pipeline");
    await prisma.$disconnect();
    process.exit(1);
  }

  if (needsTrigger.length === 0) {
    console.log("\nNothing to trigger!");
    await prisma.$disconnect();
    return;
  }

  const webhookUrl = `${PROD_URL}/api/webhooks/hubspot/ready-to-build`;
  console.log(`\nTriggering ${needsTrigger.length} deals via ${webhookUrl}`);
  console.log(`Using bearer auth (API_SECRET_TOKEN)`);
  console.log(`10s delay between each to stagger pipeline runs...\n`);

  let triggered = 0;
  let skipped = 0;
  let failed = 0;

  for (const deal of needsTrigger) {
    const idx = triggered + skipped + failed + 1;
    console.log(`[${idx}/${needsTrigger.length}] Triggering ${deal.name} (deal ${deal.dealId})...`);

    try {
      // Send workflow-style payload to the webhook
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          objectId: deal.dealId,
          stage: RTB_STAGE_ID,
        }),
      });

      const body = await res.json();

      if (res.ok) {
        const result = body.triggered?.[0] || "unknown";
        if (result.includes("started")) {
          triggered++;
          console.log(`  ✅ Pipeline started (${result})`);
        } else if (result.includes("skipped") || result.includes("already_completed")) {
          skipped++;
          console.log(`  ⏭️  Skipped: ${result}`);
        } else {
          triggered++;
          console.log(`  ✅ Response: ${JSON.stringify(body)}`);
        }
      } else {
        failed++;
        console.error(`  ❌ HTTP ${res.status}: ${JSON.stringify(body)}`);
      }
    } catch (e: unknown) {
      failed++;
      console.error(`  ❌ Network error:`, (e as Error).message);
    }

    // Stagger triggers — pipeline runs in background on Vercel via waitUntil
    if (idx < needsTrigger.length) {
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Triggered: ${triggered}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Failed:    ${failed}`);
  console.log(`\nNote: Pipelines run in the background on Vercel. Check BomPipelineRun table for results.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
