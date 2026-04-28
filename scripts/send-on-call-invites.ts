/**
 * Flip every existing on-call Google Calendar event to include the assigned
 * electrician as attendee. Run AFTER the schedule has been confirmed and you
 * are ready for everyone to see their shifts on their primary calendars.
 *
 * Idempotent: re-running just re-attaches the same attendees (no duplicates).
 *
 * Usage:
 *   npx tsx scripts/send-on-call-invites.ts                  # all pools, all dates
 *   npx tsx scripts/send-on-call-invites.ts --pool=California
 *   npx tsx scripts/send-on-call-invites.ts --from=2026-05-04 --to=2026-05-31
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { syncRangeForPool } from "../src/lib/on-call-google-calendar";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found?.slice(prefix.length);
}

async function main() {
  const poolFilter = arg("pool");
  const fromArg = arg("from");
  const toArg = arg("to");

  const pools = await prisma.onCallPool.findMany({
    where: {
      isActive: true,
      ...(poolFilter ? { name: poolFilter } : {}),
    },
    orderBy: { name: "asc" },
  });
  if (pools.length === 0) {
    console.warn("No matching pools.");
    return;
  }

  for (const pool of pools) {
    console.warn(`\n=== ${pool.name} ===`);
    if (!pool.googleCalendarId) {
      console.warn("  No Google Calendar linked yet. Run the backfill script first.");
      continue;
    }

    const earliest = fromArg
      ? { date: fromArg }
      : await prisma.onCallAssignment.findFirst({
          where: { poolId: pool.id },
          orderBy: { date: "asc" },
          select: { date: true },
        });
    const latest = toArg
      ? { date: toArg }
      : await prisma.onCallAssignment.findFirst({
          where: { poolId: pool.id },
          orderBy: { date: "desc" },
          select: { date: true },
        });
    if (!earliest || !latest) {
      console.warn("  No assignments to sync.");
      continue;
    }

    try {
      const result = await syncRangeForPool(
        {
          id: pool.id,
          name: pool.name,
          region: pool.region,
          timezone: pool.timezone,
          shiftStart: pool.shiftStart,
          shiftEnd: pool.shiftEnd,
          weekendShiftStart: pool.weekendShiftStart,
          weekendShiftEnd: pool.weekendShiftEnd,
          googleCalendarId: pool.googleCalendarId,
        },
        earliest.date,
        latest.date,
        { inviteAttendee: true },
      );
      console.warn(`  Updated ${result.synced} events with attendees (${result.failed} failed)`);
    } catch (e) {
      console.error(`  [error] syncRangeForPool failed:`, e);
    }
  }

  console.warn(
    "\nDone. Each electrician should see their shifts appear on their primary Google Calendar within a minute.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
