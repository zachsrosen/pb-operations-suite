/**
 * Diagnose why certain PM flag rules return 0 matches.
 * Prints distributions of the fields each rule depends on.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TERMINAL = new Set([
  "Closed Won", "Closed Lost", "Cancelled", "Cancelled Project",
  "On Hold", "PTO Complete", "Project Complete",
]);

const STAGE_NORMALIZE: Record<string, string> = {
  "site survey": "Survey", "survey": "Survey",
  "design": "Design", "design approval": "Design",
  "permitting": "Permit", "permit": "Permit", "interconnection": "Permit",
  "ready to build": "RTB", "rtb": "RTB",
  "construction": "Install", "install": "Install", "installation": "Install",
  "inspection": "Inspect", "pto": "PTO",
};
const norm = (s: string) => STAGE_NORMALIZE[s.toLowerCase().trim()] ?? `<UNMAPPED:${s}>`;

async function main() {
  // 1) Active PROJECT deals — count by stage
  const stages = await prisma.deal.groupBy({
    by: ["stage"],
    where: { pipeline: "PROJECT" },
    _count: { _all: true },
    orderBy: { stage: "desc" },
  });
  console.log("=== ALL PROJECT pipeline stages (count) — normalized to → ===");
  for (const s of stages) {
    const flag = TERMINAL.has(s.stage) ? "TERMINAL" : "active";
    console.log(`  ${s._count._all.toString().padStart(4)}  ${s.stage.padEnd(40)} → ${norm(s.stage).padEnd(20)} ${flag}`);
  }

  // 2) DealStatusSnapshot coverage on active deals
  const activeDealCount = await prisma.deal.count({
    where: { pipeline: "PROJECT", stage: { notIn: [...TERMINAL] } },
  });
  const distinctSnapshotDeals = await prisma.dealStatusSnapshot.findMany({
    where: {},
    select: { dealId: true },
    distinct: ["dealId"],
  });
  console.log(`\n=== Snapshot coverage ===`);
  console.log(`  Active PROJECT deals: ${activeDealCount}`);
  console.log(`  Distinct deals in DealStatusSnapshot: ${distinctSnapshotDeals.length}`);

  // 3) For install-overdue: how many deals have past installScheduleDate + null constructionCompleteDate
  const today = new Date();
  const installCandidates = await prisma.deal.count({
    where: {
      pipeline: "PROJECT",
      stage: { notIn: [...TERMINAL] },
      installScheduleDate: { not: null, lt: today },
      constructionCompleteDate: null,
    },
  });
  console.log(`\n=== Install-overdue raw candidates: ${installCandidates} ===`);

  // 4) For missing-ahj: deals in Permit/RTB-ish stages with null AHJ
  const ahjCandidates = await prisma.deal.findMany({
    where: {
      pipeline: "PROJECT",
      stage: { notIn: [...TERMINAL] },
      OR: [{ ahj: null }, { ahj: "" }],
    },
    select: { stage: true },
  });
  const ahjByStage: Record<string, number> = {};
  for (const d of ahjCandidates) ahjByStage[d.stage] = (ahjByStage[d.stage] ?? 0) + 1;
  console.log(`\n=== Active deals with NULL/empty AHJ (by raw stage) ===`);
  for (const [stage, n] of Object.entries(ahjByStage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${stage.padEnd(40)} → ${norm(stage)}`);
  }

  // 5) For missing-utility: same shape
  const utilCandidates = await prisma.deal.findMany({
    where: {
      pipeline: "PROJECT",
      stage: { notIn: [...TERMINAL] },
      OR: [{ utility: null }, { utility: "" }],
    },
    select: { stage: true },
  });
  const utilByStage: Record<string, number> = {};
  for (const d of utilCandidates) utilByStage[d.stage] = (utilByStage[d.stage] ?? 0) + 1;
  console.log(`\n=== Active deals with NULL/empty Utility (by raw stage) ===`);
  for (const [stage, n] of Object.entries(utilByStage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${stage.padEnd(40)} → ${norm(stage)}`);
  }

  // 6) For inspection-outstanding: completed install with no inspection schedule
  const inspectionCandidates = await prisma.deal.count({
    where: {
      pipeline: "PROJECT",
      stage: { notIn: [...TERMINAL] },
      constructionCompleteDate: { not: null },
      inspectionScheduleDate: null,
      inspectionPassDate: null,
    },
  });
  console.log(`\n=== Inspection-outstanding raw candidates (any age): ${inspectionCandidates} ===`);

  // 7) For permit/IC rejection: count by status patterns
  const rejectionStatuses = await prisma.deal.groupBy({
    by: ["permittingStatus"],
    where: { pipeline: "PROJECT", stage: { notIn: [...TERMINAL] }, permittingStatus: { not: null } },
    _count: { _all: true },
    orderBy: { stage: "desc" },
  });
  console.log(`\n=== Active permittingStatus values ===`);
  for (const s of rejectionStatuses) {
    console.log(`  ${s._count._all.toString().padStart(4)}  ${s.permittingStatus}`);
  }

  const icStatuses = await prisma.deal.groupBy({
    by: ["icStatus"],
    where: { pipeline: "PROJECT", stage: { notIn: [...TERMINAL] }, icStatus: { not: null } },
    _count: { _all: true },
    orderBy: { stage: "desc" },
  });
  console.log(`\n=== Active icStatus values ===`);
  for (const s of icStatuses) {
    console.log(`  ${s._count._all.toString().padStart(4)}  ${s.icStatus}`);
  }

  await prisma.$disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
