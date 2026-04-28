import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { getPool, getActiveMembersForRotation } from "@/lib/on-call-db";
import { generateAssignments, addDays } from "@/lib/on-call-rotation";
import { prisma, logActivity } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { syncRangeForPool } from "@/lib/on-call-google-calendar";

export const dynamic = "force-dynamic";

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

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const user = await getCurrentUser();
  if (!canAdminOnCall(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  try {
    const pool = await getPool(id);
    if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 });

    const members = await getActiveMembersForRotation(id);
    if (members.filter((m) => m.isActive).length === 0) {
      return NextResponse.json({ error: "Pool has no active members" }, { status: 409 });
    }

    const today = todayInTz(pool.timezone);
    // Never generate assignments before pool.startDate — rotation begins there.
    const from = today >= pool.startDate ? today : pool.startDate;
    const to = addDays(from, pool.horizonMonths * 30);

    const generated = generateAssignments({
      startDate: pool.startDate,
      fromDate: from,
      toDate: to,
      members,
      rotationUnit: (pool.rotationUnit as "daily" | "weekly") ?? "weekly",
    });

    // Existing rows in range keyed by date — used to partition into net-new
    // inserts vs in-place updates.
    const existing = await prisma.onCallAssignment.findMany({
      where: { poolId: id, date: { gte: from, lte: to } },
    });
    const existingByDate = new Map(existing.map((e) => [e.date, e]));

    // Only touch "generated" rows; leave swap/pto-reassign alone.
    const toCreate: Array<{ poolId: string; date: string; crewMemberId: string; source: string }> = [];
    const toUpdate: Array<{ date: string; crewMemberId: string }> = [];
    for (const g of generated) {
      const hit = existingByDate.get(g.date);
      if (!hit) {
        toCreate.push({ poolId: id, date: g.date, crewMemberId: g.crewMemberId, source: "generated" });
      } else if (hit.source === "generated" && hit.crewMemberId !== g.crewMemberId) {
        toUpdate.push({ date: g.date, crewMemberId: g.crewMemberId });
      }
    }
    const rowsCreated = toCreate.length;
    const rowsUpdated = toUpdate.length;

    // Concurrent-publish safety comes from:
    // 1. @@unique([poolId, date]) + skipDuplicates on createMany — idempotent
    // 2. Admin-only route with low call frequency
    // (Advisory locks don't work reliably on Neon's serverless pooler.)
    await prisma.$transaction(
      async (tx) => {
        if (toCreate.length > 0) {
          await tx.onCallAssignment.createMany({ data: toCreate, skipDuplicates: true });
        }
        for (const u of toUpdate) {
          await tx.onCallAssignment.update({
            where: { poolId_date: { poolId: id, date: u.date } },
            data: { crewMemberId: u.crewMemberId },
          });
        }
        await tx.onCallPool.update({
          where: { id },
          data: {
            lastPublishedAt: new Date(),
            lastPublishedBy: user?.id ?? null,
            lastPublishedThrough: to,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    appCache.invalidateByPrefix("on-call:tonight");
    await logActivity({
      type: "ON_CALL_PUBLISHED",
      description: `Published ${pool.name}: +${rowsCreated} created, ${rowsUpdated} updated, through ${to}`,
      userId: user?.id,
      userEmail: user?.email,
      entityType: "OnCallPool",
      entityId: id,
      metadata: { rowsCreated, rowsUpdated, from, to },
    });

    // Push the synced range to the pool's Google Calendar (creates the calendar
    // on first publish, then upserts events idempotently). Failures here are
    // logged inside syncRangeForPool and don't fail the publish — the events
    // can be reconciled by re-running publish or the manual sync script.
    let gcal: { synced: number; failed: number; calendarId: string | null } = {
      synced: 0,
      failed: 0,
      calendarId: pool.googleCalendarId,
    };
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
        from,
        to,
      );
      const refreshed = await prisma.onCallPool.findUnique({
        where: { id: pool.id },
        select: { googleCalendarId: true },
      });
      gcal = { ...result, calendarId: refreshed?.googleCalendarId ?? null };
    } catch (err) {
      console.warn("[on-call/publish] Google Calendar sync failed", err);
    }

    return NextResponse.json({ rowsCreated, rowsUpdated, from, to, gcal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publish failed";
    console.error("[on-call/publish] error", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
