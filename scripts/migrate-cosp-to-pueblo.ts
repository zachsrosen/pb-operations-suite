/**
 * Migrate stored DB location strings from "Colorado Springs" → "Pueblo"
 * (and estimator "COSP" → "PBLO") after the Pueblo office rename.
 *
 * Dry-run by default: prints would-change counts per table.column and writes
 * NOTHING. Pass --apply to execute the updates (one transaction per table).
 *
 * Usage:
 *   npx tsx scripts/migrate-cosp-to-pueblo.ts           # dry run (read-only)
 *   npx tsx scripts/migrate-cosp-to-pueblo.ts --apply   # execute (Zach only)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

const PUEBLO = "Pueblo";
const LEGACY_CANONICAL = "Colorado Springs";
/** CrewAvailability rows historically carry mixed forms (see schema comment). */
const CREW_AVAIL_LEGACY = ["Colorado Springs", "COSP", "CO Springs"];

interface ColumnTask {
  /** Display label, e.g. "ActivityLog.pbLocation" */
  label: string;
  /** Count rows that would change (read-only). */
  count: () => Promise<number>;
  /** Execute the update; returns rows updated. Only called with --apply. */
  apply: () => Promise<number>;
}

/** Simple string-equality column: `from` values → "Pueblo" (or custom `to`). */
function eq(
  label: string,
  count: () => Promise<number>,
  apply: () => Promise<number>,
): ColumnTask {
  return { label, count, apply };
}

const tasks: ColumnTask[] = [
  eq(
    "ActivityLog.pbLocation",
    () => prisma.activityLog.count({ where: { pbLocation: LEGACY_CANONICAL } }),
    async () =>
      (
        await prisma.activityLog.updateMany({
          where: { pbLocation: LEGACY_CANONICAL },
          data: { pbLocation: PUEBLO },
        })
      ).count,
  ),
  eq(
    "BookedSlot.location",
    () => prisma.bookedSlot.count({ where: { location: LEGACY_CANONICAL } }),
    async () =>
      (
        await prisma.bookedSlot.updateMany({
          where: { location: LEGACY_CANONICAL },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "CrewAvailability.location (incl. COSP / CO Springs variants)",
    () =>
      prisma.crewAvailability.count({
        where: { location: { in: CREW_AVAIL_LEGACY } },
      }),
    async () =>
      (
        await prisma.crewAvailability.updateMany({
          where: { location: { in: CREW_AVAIL_LEGACY } },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "CrewAvailability.reportLocation (incl. COSP / CO Springs variants)",
    () =>
      prisma.crewAvailability.count({
        where: { reportLocation: { in: CREW_AVAIL_LEGACY } },
      }),
    async () =>
      (
        await prisma.crewAvailability.updateMany({
          where: { reportLocation: { in: CREW_AVAIL_LEGACY } },
          data: { reportLocation: PUEBLO },
        })
      ).count,
  ),
  eq(
    "AvailabilityChangeRequest.location",
    () =>
      prisma.availabilityChangeRequest.count({
        where: { location: LEGACY_CANONICAL },
      }),
    async () =>
      (
        await prisma.availabilityChangeRequest.updateMany({
          where: { location: LEGACY_CANONICAL },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "InventoryStock.location",
    () => prisma.inventoryStock.count({ where: { location: LEGACY_CANONICAL } }),
    async () =>
      (
        await prisma.inventoryStock.updateMany({
          where: { location: LEGACY_CANONICAL },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "SurveyInvite.pbLocation",
    () => prisma.surveyInvite.count({ where: { pbLocation: LEGACY_CANONICAL } }),
    async () =>
      (
        await prisma.surveyInvite.updateMany({
          where: { pbLocation: LEGACY_CANONICAL },
          data: { pbLocation: PUEBLO },
        })
      ).count,
  ),
  eq(
    "OfficeGoal.location",
    () => prisma.officeGoal.count({ where: { location: LEGACY_CANONICAL } }),
    async () =>
      (
        await prisma.officeGoal.updateMany({
          where: { location: LEGACY_CANONICAL },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "Deal.pbLocation",
    () => prisma.deal.count({ where: { pbLocation: LEGACY_CANONICAL } }),
    async () =>
      (
        await prisma.deal.updateMany({
          where: { pbLocation: LEGACY_CANONICAL },
          data: { pbLocation: PUEBLO },
        })
      ).count,
  ),
  eq(
    "DealStatusSnapshot.pbLocation",
    () =>
      prisma.dealStatusSnapshot.count({
        where: { pbLocation: LEGACY_CANONICAL },
      }),
    async () =>
      (
        await prisma.dealStatusSnapshot.updateMany({
          where: { pbLocation: LEGACY_CANONICAL },
          data: { pbLocation: PUEBLO },
        })
      ).count,
  ),
  eq(
    "ComplianceScoreShadow.location",
    () =>
      prisma.complianceScoreShadow.count({
        where: { location: LEGACY_CANONICAL },
      }),
    async () =>
      (
        await prisma.complianceScoreShadow.updateMany({
          where: { location: LEGACY_CANONICAL },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "GoalsDigestSnapshot.location",
    () =>
      prisma.goalsDigestSnapshot.count({
        where: { location: LEGACY_CANONICAL },
      }),
    async () =>
      (
        await prisma.goalsDigestSnapshot.updateMany({
          where: { location: LEGACY_CANONICAL },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "ZuperStatusDrift.pbLocation",
    () =>
      prisma.zuperStatusDrift.count({ where: { pbLocation: LEGACY_CANONICAL } }),
    async () =>
      (
        await prisma.zuperStatusDrift.updateMany({
          where: { pbLocation: LEGACY_CANONICAL },
          data: { pbLocation: PUEBLO },
        })
      ).count,
  ),
  eq(
    "ShopHealthBottleneck.location",
    () =>
      prisma.shopHealthBottleneck.count({
        where: { location: LEGACY_CANONICAL },
      }),
    async () =>
      (
        await prisma.shopHealthBottleneck.updateMany({
          where: { location: LEGACY_CANONICAL },
          data: { location: PUEBLO },
        })
      ).count,
  ),
  eq(
    "HubSpotProjectCache.pbLocation",
    () =>
      prisma.hubSpotProjectCache.count({
        where: { pbLocation: LEGACY_CANONICAL },
      }),
    async () =>
      (
        await prisma.hubSpotProjectCache.updateMany({
          where: { pbLocation: LEGACY_CANONICAL },
          data: { pbLocation: PUEBLO },
        })
      ).count,
  ),
  eq(
    "HubSpotPropertyCache.pbLocation",
    () =>
      prisma.hubSpotPropertyCache.count({
        where: { pbLocation: LEGACY_CANONICAL },
      }),
    async () =>
      (
        await prisma.hubSpotPropertyCache.updateMany({
          where: { pbLocation: LEGACY_CANONICAL },
          data: { pbLocation: PUEBLO },
        })
      ).count,
  ),
  // ---- String[] columns: replace the array element ----
  eq(
    "User.allowedLocations (array element)",
    () =>
      prisma.user.count({
        where: { allowedLocations: { has: LEGACY_CANONICAL } },
      }),
    async () => {
      const rows = await prisma.user.findMany({
        where: { allowedLocations: { has: LEGACY_CANONICAL } },
        select: { id: true, allowedLocations: true },
      });
      await prisma.$transaction(
        rows.map((r) =>
          prisma.user.update({
            where: { id: r.id },
            data: {
              allowedLocations: [
                ...new Set(
                  r.allowedLocations.map((l) =>
                    l === LEGACY_CANONICAL ? PUEBLO : l,
                  ),
                ),
              ],
            },
          }),
        ),
      );
      return rows.length;
    },
  ),
  eq(
    "CrewMember.locations (array element)",
    () =>
      prisma.crewMember.count({ where: { locations: { has: LEGACY_CANONICAL } } }),
    async () => {
      const rows = await prisma.crewMember.findMany({
        where: { locations: { has: LEGACY_CANONICAL } },
        select: { id: true, locations: true },
      });
      await prisma.$transaction(
        rows.map((r) =>
          prisma.crewMember.update({
            where: { id: r.id },
            data: {
              locations: [
                ...new Set(
                  r.locations.map((l) => (l === LEGACY_CANONICAL ? PUEBLO : l)),
                ),
              ],
            },
          }),
        ),
      );
      return rows.length;
    },
  ),
  // ---- Estimator: abbreviation code, not display name ----
  eq(
    'EstimatorRun.location ("COSP" → "PBLO")',
    () => prisma.estimatorRun.count({ where: { location: "COSP" } }),
    async () =>
      (
        await prisma.estimatorRun.updateMany({
          where: { location: "COSP" },
          data: { location: "PBLO" },
        })
      ).count,
  ),
];

async function main() {
  console.log(APPLY ? "=== LIVE RUN (--apply) ===" : "=== DRY RUN (read-only) ===");
  console.log(`Renaming: "${LEGACY_CANONICAL}" → "${PUEBLO}" (+ EstimatorRun COSP → PBLO)\n`);

  let total = 0;
  let failures = 0;

  for (const task of tasks) {
    if (!APPLY) {
      const n = await task.count();
      total += n;
      console.log(`  ${task.label.padEnd(62)} would change: ${n}`);
      continue;
    }
    try {
      const n = await task.apply();
      total += n;
      console.log(`  ${task.label.padEnd(62)} updated: ${n}`);
    } catch (err) {
      failures++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ${task.label.padEnd(62)} FAILED: ${msg}`);
      if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) {
        console.error(
          "    Unique-constraint conflict: a Pueblo row already exists for the same key.",
        );
        console.error("    Resolve the duplicate manually, then re-run --apply (idempotent).");
      }
    }
  }

  console.log(
    `\nDone. ${APPLY ? "Updated" : "Would change"}: ${total} rows across ${tasks.length} columns.`,
  );
  if (failures > 0) console.log(`Failures: ${failures} (see above; script is safe to re-run)`);
  if (!APPLY) console.log("Re-run with --apply to execute (Zach only, after merge).");
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
