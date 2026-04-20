import { assertOnCallEnabled } from "@/lib/on-call-guard";
import { prisma } from "@/lib/db";
import { generateIcal } from "@/lib/on-call-ical";
import { addDays } from "@/lib/on-call-rotation";

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

export async function GET(req: Request, { params }: { params: Promise<{ poolId: string }> }) {
  const gate = assertOnCallEnabled();
  if (gate) return gate;
  const { poolId } = await params;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  const pool = await prisma.onCallPool.findUnique({ where: { id: poolId } });
  if (!pool || !pool.icalToken || pool.icalToken !== token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const today = todayInTz(pool.timezone);
  const from = addDays(today, -30);
  const to = pool.lastPublishedThrough ?? addDays(today, pool.horizonMonths * 30);

  const assignments = await prisma.onCallAssignment.findMany({
    where: { poolId, date: { gte: from, lte: to } },
    include: { crewMember: true },
    orderBy: { date: "asc" },
  });

  const ical = generateIcal({
    poolName: pool.name,
    poolTz: pool.timezone,
    shiftStart: pool.shiftStart,
    shiftEnd: pool.shiftEnd,
    assignments: assignments.map((a) => ({
      id: a.id,
      date: a.date,
      crewMemberName: a.crewMember.name,
    })),
  });

  const slug = pool.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return new Response(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="on-call-${slug}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
