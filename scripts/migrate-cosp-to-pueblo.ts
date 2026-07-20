/**
 * Migrate stored DB location strings from "Colorado Springs" → "Pueblo"
 * (and estimator "COSP" → "PBLO") after the Pueblo office rename.
 *
 * Dry-run by default: prints would-change counts per table.column and writes
 * NOTHING. Pass --apply to execute the updates. Tables whose unique keys
 * include the location (CrewAvailability, OfficeGoal, GoalsDigestSnapshot,
 * AdderShopOverride, RevenueGoal) migrate per-row: when a Pueblo counterpart
 * already exists the legacy row is deleted instead (OfficeGoal keeps the
 * newer target of the pair). Idempotent — safe to re-run.
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
    // Per-row: @@unique([crewMemberId, location, dayOfWeek, startTime]) — if a
    // Pueblo counterpart already exists for the slot, delete the legacy row.
    async () => {
      const rows = await prisma.crewAvailability.findMany({
        where: { location: { in: CREW_AVAIL_LEGACY } },
        select: { id: true, crewMemberId: true, dayOfWeek: true, startTime: true },
      });
      let n = 0;
      for (const r of rows) {
        try {
          const dup = await prisma.crewAvailability.findFirst({
            where: {
              crewMemberId: r.crewMemberId,
              location: PUEBLO,
              dayOfWeek: r.dayOfWeek,
              startTime: r.startTime,
            },
            select: { id: true },
          });
          if (dup) {
            await prisma.crewAvailability.delete({ where: { id: r.id } });
          } else {
            await prisma.crewAvailability.update({
              where: { id: r.id },
              data: { location: PUEBLO },
            });
          }
          n++;
        } catch (err) {
          console.error(`    CrewAvailability row ${r.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
      return n;
    },
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
    // Per-row: @@unique([location, metric, month, year]) — if a Pueblo
    // counterpart exists, keep the newer (updatedAt) target of the pair and
    // delete the legacy row.
    async () => {
      const rows = await prisma.officeGoal.findMany({
        where: { location: LEGACY_CANONICAL },
      });
      let n = 0;
      for (const r of rows) {
        try {
          const dup = await prisma.officeGoal.findFirst({
            where: { location: PUEBLO, metric: r.metric, month: r.month, year: r.year },
          });
          if (!dup) {
            await prisma.officeGoal.update({
              where: { id: r.id },
              data: { location: PUEBLO },
            });
          } else {
            if (r.updatedAt > dup.updatedAt) {
              await prisma.officeGoal.update({
                where: { id: dup.id },
                data: { target: r.target },
              });
            }
            await prisma.officeGoal.delete({ where: { id: r.id } });
          }
          n++;
        } catch (err) {
          console.error(`    OfficeGoal row ${r.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
      return n;
    },
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
    // Per-row: @@unique([weekKey, location]) — if a Pueblo snapshot already
    // exists for the week (post-rename write), it wins; delete the legacy row.
    async () => {
      const rows = await prisma.goalsDigestSnapshot.findMany({
        where: { location: LEGACY_CANONICAL },
        select: { id: true, weekKey: true },
      });
      let n = 0;
      for (const r of rows) {
        try {
          const dup = await prisma.goalsDigestSnapshot.findFirst({
            where: { weekKey: r.weekKey, location: PUEBLO },
            select: { id: true },
          });
          if (dup) {
            await prisma.goalsDigestSnapshot.delete({ where: { id: r.id } });
          } else {
            await prisma.goalsDigestSnapshot.update({
              where: { id: r.id },
              data: { location: PUEBLO },
            });
          }
          n++;
        } catch (err) {
          console.error(`    GoalsDigestSnapshot row ${r.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
      return n;
    },
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
  eq(
    "AdderShopOverride.shop",
    () =>
      prisma.adderShopOverride.count({ where: { shop: LEGACY_CANONICAL } }),
    // Per-row: @@unique([adderId, shop]) — if a Pueblo override already exists
    // for the adder, it wins; delete the legacy row.
    async () => {
      const rows = await prisma.adderShopOverride.findMany({
        where: { shop: LEGACY_CANONICAL },
        select: { id: true, adderId: true },
      });
      let n = 0;
      for (const r of rows) {
        try {
          const dup = await prisma.adderShopOverride.findFirst({
            where: { adderId: r.adderId, shop: PUEBLO },
            select: { id: true },
          });
          if (dup) {
            await prisma.adderShopOverride.delete({ where: { id: r.id } });
          } else {
            await prisma.adderShopOverride.update({
              where: { id: r.id },
              data: { shop: PUEBLO },
            });
          }
          n++;
        } catch (err) {
          console.error(`    AdderShopOverride row ${r.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
      return n;
    },
  ),
  eq(
    'RevenueGoal.groupKey ("colorado_springs" → "pueblo")',
    () =>
      prisma.revenueGoal.count({ where: { groupKey: "colorado_springs" } }),
    // Per-row: @@unique([year, groupKey, month]) — if a (year, "pueblo", month)
    // row already exists, it wins; delete the legacy row.
    async () => {
      const rows = await prisma.revenueGoal.findMany({
        where: { groupKey: "colorado_springs" },
        select: { id: true, year: true, month: true },
      });
      let n = 0;
      for (const r of rows) {
        try {
          const dup = await prisma.revenueGoal.findFirst({
            where: { year: r.year, groupKey: "pueblo", month: r.month },
            select: { id: true },
          });
          if (dup) {
            await prisma.revenueGoal.delete({ where: { id: r.id } });
          } else {
            await prisma.revenueGoal.update({
              where: { id: r.id },
              data: { groupKey: "pueblo" },
            });
          }
          n++;
        } catch (err) {
          console.error(`    RevenueGoal row ${r.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
      return n;
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
