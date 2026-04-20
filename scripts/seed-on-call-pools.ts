/**
 * Seed the three starter on-call pools: California, Denver, Southern CO.
 * Matches existing CrewMember rows by name (case-insensitive). Missing members
 * are logged and skipped.
 *
 * Run: npx tsx scripts/seed-on-call-pools.ts
 *
 * Safe to re-run — upserts by pool name. Existing members are NOT reordered.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const POOLS: Array<{
  name: string;
  region: string;
  timezone: string;
  shiftStart: string;
  shiftEnd: string;
  members: string[];
}> = [
  {
    name: "California",
    region: "California",
    timezone: "America/Los_Angeles",
    shiftStart: "17:00",
    shiftEnd: "07:00",
    members: ["Nick", "Lucas", "Charlie", "Ruben"],
  },
  {
    name: "Denver",
    region: "Colorado — Denver Metro",
    timezone: "America/Denver",
    shiftStart: "17:00",
    shiftEnd: "07:00",
    members: ["Adolphe", "Chris K", "Chad", "Nathan", "Rich", "Alan", "Olek", "Gaige", "Paul", "Jeremy"],
  },
  {
    name: "Southern CO",
    region: "Colorado — Colorado Springs + Service",
    timezone: "America/Denver",
    shiftStart: "17:00",
    shiftEnd: "07:00",
    members: ["Alex", "Lenny", "Ro", "Josh H", "Jerry", "Tom", "Christian W", "Terrell"],
  },
];

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  for (const cfg of POOLS) {
    console.log(`\n=== ${cfg.name} ===`);

    const pool = await prisma.onCallPool.upsert({
      where: { name: cfg.name },
      create: {
        name: cfg.name,
        region: cfg.region,
        timezone: cfg.timezone,
        shiftStart: cfg.shiftStart,
        shiftEnd: cfg.shiftEnd,
        startDate: today,
        icalToken: randomBytes(24).toString("hex"),
      },
      update: {
        region: cfg.region,
        timezone: cfg.timezone,
        shiftStart: cfg.shiftStart,
        shiftEnd: cfg.shiftEnd,
      },
    });
    console.log(`  Pool ${pool.id} (${pool.name}) ready.`);

    for (let i = 0; i < cfg.members.length; i++) {
      const nameQuery = cfg.members[i];
      const crewMember = await prisma.crewMember.findFirst({
        where: { name: { contains: nameQuery, mode: "insensitive" } },
      });
      if (!crewMember) {
        console.warn(`  [skip] CrewMember not found for "${nameQuery}"`);
        continue;
      }
      const existing = await prisma.onCallPoolMember.findUnique({
        where: { poolId_crewMemberId: { poolId: pool.id, crewMemberId: crewMember.id } },
      });
      if (existing) {
        console.log(`  [exists] ${crewMember.name} already in pool (orderIndex ${existing.orderIndex})`);
        continue;
      }
      await prisma.onCallPoolMember.create({
        data: { poolId: pool.id, crewMemberId: crewMember.id, orderIndex: i },
      });
      console.log(`  [added] ${crewMember.name} at orderIndex ${i}`);
    }
  }

  console.log("\nSeed complete. Next: run a Publish via /dashboards/on-call/setup.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
