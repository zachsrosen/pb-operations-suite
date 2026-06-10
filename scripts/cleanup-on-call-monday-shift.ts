/**
 * 2026-06 on-call schedule cleanup: Monday-start weeks + drop California Sundays,
 * WITHOUT reshuffling who owns which week.
 *
 * Two policy changes landed in the rotation engine:
 *   1. Weekly rotations now run Mon-Sun (electrician shifts start Monday,
 *      shifted back from the Sun-Sat weeks used during the May trial).
 *   2. California no longer carries Sunday on-call (coversSundays=false) — the
 *      weekly assignee covers Mon-Sat and Sundays get no row.
 *
 * KEEPING THE SAME PEOPLE
 * -----------------------
 * Naively regenerating a Mon-Sun rotation would re-phase ownership (the person
 * on "the week of July 6" would change). To avoid that, this script re-anchors
 * each pool's rotation forward by exactly one day: it sets startDate to the
 * Monday immediately after the pool's current Sunday anchor. That preserves the
 * existing rotation order and phase, so:
 *   - Every Mon-Sat keeps its CURRENT owner (no change at all).
 *   - Sundays move with the boundary: a Sunday flips from "first day of the next
 *     person's week" to "last day of the current person's week" (Colorado), or
 *     is dropped entirely (California).
 *
 * This cleans up what is ALREADY on the schedule so it matches the new rules,
 * WITHOUT touching anything an electrician or admin set by hand:
 *   - Re-anchors startDate (phase-preserving) and flips California coversSundays.
 *   - For every active pool, re-aligns existing *generated* future assignments
 *     and removes generated California Sunday rows.
 *   - Mirrors each change into the pool's Google Calendar (best-effort).
 *
 * What it will NOT do — by design, to avoid surprises:
 *   - It never edits rows whose source is "manual", "swap", or "pto" (overrides
 *     and approved swaps stay put).
 *   - It never creates brand-new rows / extends the horizon. Click "Publish" on
 *     each pool in On-Call Setup afterward to extend the rotation forward.
 *   - It only touches dates from each pool's "today" onward — the past is frozen.
 *
 * SAFE BY DEFAULT: prints a dry-run plan and changes nothing. Re-run with
 * --apply to write. Idempotent either way.
 *
 *   Dry run:  npx tsx scripts/cleanup-on-call-monday-shift.ts
 *   Apply:    npx tsx scripts/cleanup-on-call-monday-shift.ts --apply
 *
 * Requires the coversSundays migration to be applied first (npm run db:migrate).
 * Google Calendar sync requires the same GOOGLE_SERVICE_ACCOUNT_* envs as the
 * other on-call scripts; it is skipped automatically if those aren't set.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { dayOfWeek } from "../src/lib/on-call-rotation";
import { planPoolCleanup } from "../src/lib/on-call-cleanup";
import { upsertAssignmentEvent, deleteAssignmentEvent } from "../src/lib/on-call-google-calendar";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const APPLY = process.argv.includes("--apply");

// Pools that should drop Sunday coverage. Match on name (case-insensitive).
const NO_SUNDAY_POOLS = new Set(["california"]);

// "Today" in an IANA timezone as YYYY-MM-DD — matches the publish route's clamp.
function todayInTz(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

async function main() {
  console.warn(APPLY ? "Mode: APPLY (writing changes)\n" : "Mode: DRY RUN (no changes) — pass --apply to write\n");

  const pools = await prisma.onCallPool.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });

  let totalUpdated = 0;
  let totalDeleted = 0;

  for (const pool of pools) {
    const dropSundays = NO_SUNDAY_POOLS.has(pool.name.toLowerCase());
    const coversSundays = dropSundays ? false : pool.coversSundays;
    const today = todayInTz(pool.timezone);

    const members = await prisma.onCallPoolMember.findMany({
      where: { poolId: pool.id },
      orderBy: { orderIndex: "asc" },
    });
    const rotationMembers = members.map((m) => ({
      crewMemberId: m.crewMemberId,
      orderIndex: m.orderIndex,
      isActive: m.isActive,
    }));

    // Only existing *generated* rows from today forward are in scope.
    const existing = await prisma.onCallAssignment.findMany({
      where: { poolId: pool.id, source: "generated", date: { gte: today } },
      include: { crewMember: { select: { name: true, email: true } } },
      orderBy: { date: "asc" },
    });

    const plan = planPoolCleanup({
      startDate: pool.startDate,
      rotationUnit: (pool.rotationUnit as "daily" | "weekly") ?? "weekly",
      members: rotationMembers,
      coversSundays,
      existing: existing.map((e) => ({ date: e.date, crewMemberId: e.crewMemberId })),
    });

    console.warn(`\n=== ${pool.name} ===`);
    console.warn(
      `  startDate ${pool.startDate} → ${plan.newStartDate} (phase-preserving Monday); ` +
        `coversSundays ${pool.coversSundays} → ${coversSundays}`,
    );
    console.warn(`  ${existing.length} generated rows from ${today}`);

    // Persist config changes (startDate re-anchor + Sunday flag).
    if (APPLY && (plan.newStartDate !== pool.startDate || coversSundays !== pool.coversSundays)) {
      await prisma.onCallPool.update({
        where: { id: pool.id },
        data: { startDate: plan.newStartDate, coversSundays },
      });
    }

    if (rotationMembers.filter((m) => m.isActive).length === 0) {
      console.warn("  (no active members — skipped row reconcile)");
      continue;
    }

    const rowByDate = new Map(existing.map((e) => [e.date, e]));
    const poolForCal = {
      id: pool.id,
      name: pool.name,
      region: pool.region,
      timezone: pool.timezone,
      shiftStart: pool.shiftStart,
      shiftEnd: pool.shiftEnd,
      weekendShiftStart: pool.weekendShiftStart,
      weekendShiftEnd: pool.weekendShiftEnd,
      googleCalendarId: pool.googleCalendarId,
    };

    // Names for the "to" side of each reassignment (for logging + calendar).
    const toIds = Array.from(new Set(plan.updates.map((u) => u.to)));
    const toCm = toIds.length
      ? await prisma.crewMember.findMany({ where: { id: { in: toIds } }, select: { id: true, name: true, email: true } })
      : [];
    const cmById = new Map(toCm.map((c) => [c.id, c]));

    for (const del of plan.deletes) {
      const row = rowByDate.get(del.date);
      if (!row) continue;
      const why = !coversSundays && dayOfWeek(del.date) === 0 ? "Sunday dropped" : "no longer in rotation";
      console.warn(`  - DELETE ${del.date} (${row.crewMember.name}) [${why}]`);
      if (APPLY) {
        await prisma.onCallAssignment.delete({ where: { id: row.id } });
        // Calendar sync is best-effort — never let it abort the DB cleanup.
        try {
          await deleteAssignmentEvent(poolForCal, row.id);
        } catch (err) {
          console.warn(`    [gcal] failed to delete event for ${del.date}:`, err instanceof Error ? err.message : err);
        }
      }
    }

    for (const upd of plan.updates) {
      const row = rowByDate.get(upd.date);
      if (!row) continue;
      const newCm = cmById.get(upd.to);
      const note = dayOfWeek(upd.date) === 0 ? "Sunday → prior week's owner" : "boundary shift";
      console.warn(`  ~ UPDATE ${upd.date} ${row.crewMember.name} → ${newCm?.name ?? upd.to} [${note}]`);
      if (APPLY) {
        await prisma.onCallAssignment.update({ where: { id: row.id }, data: { crewMemberId: upd.to } });
        if (newCm) {
          // Calendar sync is best-effort — never let it abort the DB cleanup.
          try {
            await upsertAssignmentEvent(poolForCal, {
              id: row.id,
              date: upd.date,
              poolId: pool.id,
              crewMember: { name: newCm.name, email: newCm.email },
            });
          } catch (err) {
            console.warn(`    [gcal] failed to update event for ${upd.date}:`, err instanceof Error ? err.message : err);
          }
        }
      }
    }

    console.warn(
      `  → ${plan.updates.length} reassigned, ${plan.deletes.length} deleted, ${plan.unchanged} unchanged (Mon-Sat owners untouched)`,
    );
    totalUpdated += plan.updates.length;
    totalDeleted += plan.deletes.length;
  }

  console.warn(
    `\n${APPLY ? "Applied" : "Would apply"}: ${totalUpdated} reassignments, ${totalDeleted} deletions.`,
  );
  if (!APPLY) console.warn("Re-run with --apply to write these changes.");
  console.warn("Then click \"Publish\" on each pool in On-Call Setup to extend the rotation forward.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
