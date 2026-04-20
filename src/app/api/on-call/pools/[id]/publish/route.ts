import { NextResponse } from "next/server";
import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { canAdminOnCall } from "@/lib/on-call-auth";
import { getCurrentUser } from "@/lib/auth-utils";
import { getPool, getActiveMembersForRotation } from "@/lib/on-call-db";
import { generateAssignments, addDays } from "@/lib/on-call-rotation";
import { prisma, logActivity } from "@/lib/db";
import { appCache } from "@/lib/cache";

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

  const pool = await getPool(id);
  if (!pool) return NextResponse.json({ error: "Pool not found" }, { status: 404 });

  const members = await getActiveMembersForRotation(id);
  if (members.filter((m) => m.isActive).length === 0) {
    return NextResponse.json({ error: "Pool has no active members" }, { status: 409 });
  }

  const from = todayInTz(pool.timezone);
  const to = addDays(from, pool.horizonMonths * 30);

  const generated = generateAssignments({
    startDate: pool.startDate,
    fromDate: from,
    toDate: to,
    members,
  });

  // Existing rows in range keyed by date.
  const existing = await prisma.onCallAssignment.findMany({
    where: { poolId: id, date: { gte: from, lte: to } },
  });
  const existingByDate = new Map(existing.map((e) => [e.date, e]));

  let rowsCreated = 0;
  let rowsUpdated = 0;

  // Advisory lock to prevent concurrent publishes. Hash the pool id into an int.
  // Neon supports pg_try_advisory_lock via $executeRawUnsafe.
  const lockKey = Math.abs(
    id.split("").reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0),
  );
  const [{ locked }] = (await prisma.$queryRawUnsafe(
    `SELECT pg_try_advisory_lock(${lockKey}) AS locked`,
  )) as Array<{ locked: boolean }>;
  if (!locked) {
    return NextResponse.json({ error: "Publish already in progress" }, { status: 409 });
  }

  try {
    // Apply diffs inside a tx. Only touch "generated" rows; leave swap/pto-reassign alone.
    await prisma.$transaction(async (tx) => {
      for (const g of generated) {
        const existing = existingByDate.get(g.date);
        if (!existing) {
          await tx.onCallAssignment.create({
            data: {
              poolId: id,
              date: g.date,
              crewMemberId: g.crewMemberId,
              source: "generated",
            },
          });
          rowsCreated++;
        } else if (existing.source === "generated" && existing.crewMemberId !== g.crewMemberId) {
          await tx.onCallAssignment.update({
            where: { poolId_date: { poolId: id, date: g.date } },
            data: { crewMemberId: g.crewMemberId },
          });
          rowsUpdated++;
        }
      }
      await tx.onCallPool.update({
        where: { id },
        data: {
          lastPublishedAt: new Date(),
          lastPublishedBy: user?.id ?? null,
          lastPublishedThrough: to,
        },
      });
    });
  } finally {
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${lockKey})`);
  }

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

  return NextResponse.json({ rowsCreated, rowsUpdated, from, to });
}
