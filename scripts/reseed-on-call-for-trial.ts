/**
 * Weekly rotation + merged Colorado pool + May trial seed.
 *
 * Transforms:
 * - California: rotationUnit -> weekly, purge assignments, seed May weeks
 *   (Lucas May 4-10, Ruben 11-17, Charlie 18-24, Nick 25-31)
 * - Denver + Southern CO -> merged "Colorado" pool (18 members in order),
 *   + Dan Kelly added inactive (flips active late June when he's back).
 *   Old pools deleted.
 * - Colorado May seed: Jeremy May 4-10, Chris Kahl 11-17, Jerry 18-24, Alex 25-31.
 *
 * Safe to run once after the schema migration lands. Idempotent on re-run —
 * checks pool existence by name before each transform.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { randomBytes } from "node:crypto";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

type SeedAssignment = { date: string; crewName: string };

// Mon-Sun week blocks for May 2026.
const CA_MAY: SeedAssignment[] = weekBlock("2026-05-04", "Lucas Scarpellino")
  .concat(weekBlock("2026-05-11", "Ruben Quintero"))
  .concat(weekBlock("2026-05-18", "Charlie Owens"))
  .concat(weekBlock("2026-05-25", "Nick Scarpellino"));

const CO_MAY: SeedAssignment[] = weekBlock("2026-05-04", "Jeremy Wheeler")
  .concat(weekBlock("2026-05-11", "Chris Kahl"))
  .concat(weekBlock("2026-05-18", "Jerry Hopkins"))
  .concat(weekBlock("2026-05-25", "Alex"));

// Colorado pool ordering — Denver first, then Southern CO. Dan Kelly appended inactive.
const COLORADO_ORDER: Array<{ name: string; isActive: boolean }> = [
  // From old Denver
  { name: "Adolphe", isActive: true },
  { name: "Chris Kahl", isActive: true },
  { name: "Chad Schollmann", isActive: true },
  { name: "Nathan Kirkegaard", isActive: true },
  { name: "Richard Szymanski", isActive: true },
  { name: "Alan", isActive: true },
  { name: "Oleksandr Haidar", isActive: true },
  { name: "Gaige Hayse", isActive: true },
  { name: "Paul Cougill", isActive: true },
  { name: "Jeremy Wheeler", isActive: true },
  // From old Southern CO
  { name: "Alex", isActive: true },
  { name: "Lenny", isActive: true },
  { name: "Rolando", isActive: true },
  { name: "Josh Hager", isActive: true },
  { name: "Jerry Hopkins", isActive: true },
  { name: "Tom St. Denis", isActive: true },
  { name: "Christian White", isActive: true },
  { name: "Terrell Sanks", isActive: true },
  // New — out until late June/early July
  { name: "Dan Kelly", isActive: false },
];

function addDaysISO(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function weekBlock(mondayISO: string, crewName: string): SeedAssignment[] {
  return Array.from({ length: 7 }, (_, i) => ({
    date: addDaysISO(mondayISO, i),
    crewName,
  }));
}

async function ensureCrewMember(name: string, extras: { email?: string } = {}) {
  let cm = await prisma.crewMember.findFirst({ where: { name } });
  if (!cm) {
    cm = await prisma.crewMember.create({
      data: {
        name,
        email: extras.email ?? null,
        role: "electrician",
        zuperUserUid: "",
        locations: [],
        isActive: true,
      },
    });
    console.warn(`  [created] CrewMember ${name}`);
  }
  return cm;
}

async function main() {
  // ────── 1. California: weekly + purge + May seed ──────
  const cali = await prisma.onCallPool.findUnique({ where: { name: "California" } });
  if (!cali) throw new Error("California pool not found");
  await prisma.onCallPool.update({
    where: { id: cali.id },
    data: { rotationUnit: "weekly" },
  });
  await prisma.onCallAssignment.deleteMany({ where: { poolId: cali.id } });
  console.warn("California: rotationUnit=weekly, assignments purged");
  await seedAssignments(cali.id, CA_MAY);
  console.warn(`California: seeded ${CA_MAY.length} May assignment rows`);

  // ────── 2. Merge Denver + Southern CO → Colorado ──────
  const denver = await prisma.onCallPool.findUnique({ where: { name: "Denver" } });
  const southern = await prisma.onCallPool.findUnique({ where: { name: "Southern CO" } });

  let colorado = await prisma.onCallPool.findUnique({ where: { name: "Colorado" } });
  if (!colorado) {
    // Use Denver as the donor pool if present, else create fresh.
    if (denver) {
      colorado = await prisma.onCallPool.update({
        where: { id: denver.id },
        data: {
          name: "Colorado",
          region: "Colorado — statewide",
          rotationUnit: "weekly",
        },
      });
      console.warn(`Renamed Denver pool ${denver.id} → Colorado`);
    } else {
      colorado = await prisma.onCallPool.create({
        data: {
          name: "Colorado",
          region: "Colorado — statewide",
          timezone: "America/Denver",
          shiftStart: "17:00",
          shiftEnd: "07:00",
          startDate: "2026-05-04",
          rotationUnit: "weekly",
          icalToken: randomBytes(24).toString("hex"),
        },
      });
      console.warn(`Created Colorado pool ${colorado.id}`);
    }
  } else {
    await prisma.onCallPool.update({
      where: { id: colorado.id },
      data: { region: "Colorado — statewide", rotationUnit: "weekly" },
    });
  }

  // Purge Colorado's assignments before reseeding.
  await prisma.onCallAssignment.deleteMany({ where: { poolId: colorado.id } });

  // Delete the Southern CO pool if still present. Cascading wipes its members
  // and any residual assignments. (We'll re-add the Southern members to Colorado.)
  if (southern) {
    await prisma.onCallPool.delete({ where: { id: southern.id } });
    console.warn(`Deleted Southern CO pool ${southern.id}`);
  }

  // ────── 3. Colorado membership rebuild ──────
  // Strategy: wipe current membership, re-insert in the configured order.
  // Assignments with a preserved swap/pto source would be lost, but we just
  // purged all assignments above so there's nothing to preserve.
  await prisma.onCallPoolMember.deleteMany({ where: { poolId: colorado.id } });

  for (let i = 0; i < COLORADO_ORDER.length; i++) {
    const entry = COLORADO_ORDER[i];
    const email =
      entry.name === "Dan Kelly" ? "dan.kelly@photonbrothers.com" : undefined;
    const cm = await ensureCrewMember(entry.name, email ? { email } : {});
    await prisma.onCallPoolMember.create({
      data: {
        poolId: colorado.id,
        crewMemberId: cm.id,
        orderIndex: i,
        isActive: entry.isActive,
      },
    });
  }
  console.warn(`Colorado membership rebuilt (${COLORADO_ORDER.length} slots)`);

  await seedAssignments(colorado.id, CO_MAY);
  console.warn(`Colorado: seeded ${CO_MAY.length} May assignment rows`);

  console.warn("\nDone. Rotation takes over naturally after May 31.");
}

async function seedAssignments(poolId: string, assignments: SeedAssignment[]) {
  for (const a of assignments) {
    const cm = await prisma.crewMember.findFirst({ where: { name: a.crewName } });
    if (!cm) {
      console.warn(`  [skip] no CrewMember "${a.crewName}" for ${a.date}`);
      continue;
    }
    await prisma.onCallAssignment.upsert({
      where: { poolId_date: { poolId, date: a.date } },
      create: { poolId, date: a.date, crewMemberId: cm.id, source: "manual" },
      update: { crewMemberId: cm.id, source: "manual" },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
