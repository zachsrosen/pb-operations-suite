/**
 * For each active PROJECT deal, show: stage, snapshot history, computed daysInStage.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { daysInCurrentStage } from "../src/lib/pm-flag-rules";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TERMINAL = new Set([
  "Closed Won","Closed Lost","Cancelled","Cancelled Project","On Hold","On-Hold","PTO Complete","Project Complete",
]);

async function main() {
  const deals = await prisma.deal.findMany({
    where: { pipeline: "PROJECT", stage: { notIn: [...TERMINAL] } },
    select: { hubspotDealId: true, dealName: true, stage: true, updatedAt: true, createdAt: true },
  });
  console.log(`=== ${deals.length} active PROJECT deals ===`);
  for (const d of deals) {
    const snapshots = await prisma.dealStatusSnapshot.findMany({
      where: { dealId: d.hubspotDealId },
      orderBy: { snapshotDate: "desc" },
      take: 5,
      select: { snapshotDate: true, dealStage: true },
    });
    const days = await daysInCurrentStage(d.hubspotDealId, d.stage);
    const ageDays = Math.floor((Date.now() - d.createdAt.getTime()) / 86_400_000);
    console.log(`\n[${d.hubspotDealId}] stage="${d.stage}" daysInStage=${days} dealAge=${ageDays}d`);
    if (snapshots.length === 0) {
      console.log(`  (no snapshots)`);
    } else {
      for (const s of snapshots.slice(0, 3)) {
        console.log(`  ${s.snapshotDate.toISOString().slice(0, 10)} stage="${s.dealStage}"`);
      }
    }
  }

  // Also check date-field availability across all active deals
  console.log("\n=== Date field non-null counts across active deals ===");
  const fields = ["installScheduleDate", "constructionCompleteDate", "inspectionScheduleDate", "inspectionPassDate", "ptoStartDate", "ptoCompletionDate"] as const;
  for (const f of fields) {
    const count = await prisma.deal.count({
      where: { pipeline: "PROJECT", stage: { notIn: [...TERMINAL] }, [f]: { not: null } } as never,
    });
    console.log(`  ${f.padEnd(30)} ${count}`);
  }

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
