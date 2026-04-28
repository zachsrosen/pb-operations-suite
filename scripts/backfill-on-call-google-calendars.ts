/**
 * One-shot: provision per-pool Google Calendars + sync every existing
 * OnCallAssignment into them. Idempotent — safe to re-run.
 *
 * Run: npx tsx scripts/backfill-on-call-google-calendars.ts
 *
 * Requires: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
 * GOOGLE_ADMIN_EMAIL (or GMAIL_SENDER_EMAIL) — same envs the existing Drive
 * integration uses.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { ensureCalendarForPool, syncRangeForPool } from "../src/lib/on-call-google-calendar";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Default: stage the schedule WITHOUT inviting electricians. They see nothing
  // on their primary calendars yet; events live only on the shared on-call
  // calendars. Pass --with-invites to attach attendees (run scripts/send-on-call-invites.ts
  // for the dedicated invite-blast variant).
  const withInvites = process.argv.includes("--with-invites");
  const inviteAttendee = withInvites;
  console.warn(`Mode: ${withInvites ? "WITH invites" : "STAGING (no invites)"}`);

  const pools = await prisma.onCallPool.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  for (const pool of pools) {
    console.warn(`\n=== ${pool.name} ===`);

    // Step 1: ensure the calendar exists (creates + shares + persists ID).
    let calendarId: string;
    try {
      calendarId = await ensureCalendarForPool({
        id: pool.id,
        name: pool.name,
        region: pool.region,
        timezone: pool.timezone,
        shiftStart: pool.shiftStart,
        shiftEnd: pool.shiftEnd,
        weekendShiftStart: pool.weekendShiftStart,
        weekendShiftEnd: pool.weekendShiftEnd,
        googleCalendarId: pool.googleCalendarId,
      });
      console.warn(`  Calendar: ${calendarId}`);
    } catch (e) {
      console.error(`  [error] ensureCalendar failed:`, e);
      continue;
    }

    // Step 2: sync every assignment in the pool's date range.
    const earliest = await prisma.onCallAssignment.findFirst({
      where: { poolId: pool.id },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    const latest = await prisma.onCallAssignment.findFirst({
      where: { poolId: pool.id },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    if (!earliest || !latest) {
      console.warn(`  No assignments to sync.`);
      continue;
    }
    const refreshed = await prisma.onCallPool.findUnique({
      where: { id: pool.id },
      select: { googleCalendarId: true },
    });
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
          googleCalendarId: refreshed?.googleCalendarId ?? calendarId,
        },
        earliest.date,
        latest.date,
        { inviteAttendee },
      );
      console.warn(`  Synced ${result.synced} events (${result.failed} failed)`);
    } catch (e) {
      console.error(`  [error] syncRangeForPool failed:`, e);
    }
  }

  console.warn("\nDone. Calendars are shared with photonbrothers.com domain (read access).");
  if (!withInvites) {
    console.warn(
      "Events created WITHOUT attendees. To invite each electrician later, run:",
    );
    console.warn("  npx tsx scripts/send-on-call-invites.ts");
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
