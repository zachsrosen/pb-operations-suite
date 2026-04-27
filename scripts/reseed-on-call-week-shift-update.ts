/**
 * 2026-04-22 update: shift hours + Sunday-Saturday weeks.
 *
 * - Weekday shift: 18:00 → 22:00 (was 17:00 → 07:00 overnight)
 * - Weekend shift: 08:00 → 12:00 (new column)
 * - startDate: 2026-05-03 (Sunday, was 2026-05-04 Monday)
 * - May trial seeds re-aligned to Sun-Sat weeks:
 *     California:  Lucas May 3-9, Ruben May 10-16, Charlie May 17-23, Nick May 24-30
 *     Colorado:    Jeremy May 3-9, Chris Kahl May 10-16, Jerry May 17-23, Alex May 24-30
 * - All May 4-31 manual assignments wiped + replaced with Sun-Sat blocks.
 *
 * Run after migration applies. Idempotent — safe to re-run.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type SeedAssignment = { date: string; crewName: string };

function addDaysISO(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function weekBlock(sundayISO: string, crewName: string): SeedAssignment[] {
  return Array.from({ length: 7 }, (_, i) => ({
    date: addDaysISO(sundayISO, i),
    crewName,
  }));
}

const CA_MAY: SeedAssignment[] = weekBlock("2026-05-03", "Lucas Scarpellino")
  .concat(weekBlock("2026-05-10", "Ruben Quintero"))
  .concat(weekBlock("2026-05-17", "Charlie Owens"))
  .concat(weekBlock("2026-05-24", "Nick Scarpellino"));

const CO_MAY: SeedAssignment[] = weekBlock("2026-05-03", "Jeremy Wheeler")
  .concat(weekBlock("2026-05-10", "Chris Kahl"))
  .concat(weekBlock("2026-05-17", "Jerry Hopkins"))
  .concat(weekBlock("2026-05-24", "Alex"));

async function main() {
  // Update both pools to weekday 18:00-22:00 + weekend 08:00-12:00 + start May 3.
  const r = await prisma.onCallPool.updateMany({
    where: { name: { in: ["California", "Colorado"] } },
    data: {
      shiftStart: "18:00",
      shiftEnd: "22:00",
      weekendShiftStart: "08:00",
      weekendShiftEnd: "12:00",
      startDate: "2026-05-03",
    },
  });
  console.warn(`Updated ${r.count} pools (shifts + startDate)`);

  for (const [poolName, seeds] of [
    ["California", CA_MAY] as const,
    ["Colorado", CO_MAY] as const,
  ]) {
    const pool = await prisma.onCallPool.findUnique({ where: { name: poolName } });
    if (!pool) {
      console.warn(`[skip] pool ${poolName} not found`);
      continue;
    }
    // Wipe all May assignments for this pool. Rotation regenerates from scratch on next Publish.
    await prisma.onCallAssignment.deleteMany({
      where: {
        poolId: pool.id,
        date: { gte: "2026-05-01", lte: "2026-05-31" },
      },
    });
    console.warn(`${poolName}: May assignments cleared`);

    // Reseed.
    for (const s of seeds) {
      const cm = await prisma.crewMember.findFirst({ where: { name: s.crewName } });
      if (!cm) {
        console.warn(`  [skip] no CrewMember "${s.crewName}" for ${s.date}`);
        continue;
      }
      await prisma.onCallAssignment.upsert({
        where: { poolId_date: { poolId: pool.id, date: s.date } },
        create: { poolId: pool.id, date: s.date, crewMemberId: cm.id, source: "manual" },
        update: { crewMemberId: cm.id, source: "manual" },
      });
    }
    console.warn(`${poolName}: seeded ${seeds.length} May assignments`);
  }

  console.warn("\nDone. Click Publish on each pool to extend the rotation past May 31.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
