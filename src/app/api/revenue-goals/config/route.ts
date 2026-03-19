import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import { REVENUE_GROUPS } from "@/lib/revenue-groups-config";

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);

  const goals = await prisma.revenueGoal.findMany({
    where: { year },
    orderBy: [{ groupKey: "asc" }, { month: "asc" }],
  });

  const config: Record<string, { month: number; target: number }[]> = {};
  for (const [groupKey, group] of Object.entries(REVENUE_GROUPS)) {
    config[groupKey] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      target: group.annualTarget / 12,
    }));
  }
  for (const goal of goals) {
    if (config[goal.groupKey]) {
      const idx = config[goal.groupKey].findIndex((m) => m.month === goal.month);
      if (idx >= 0) config[goal.groupKey][idx].target = Number(goal.target);
    }
  }

  return NextResponse.json({ year, groups: config });
}

export async function PUT(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (auth.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await request.json();
  const { year, targets } = body as {
    year: number;
    targets: { groupKey: string; month: number; target: number }[];
  };

  if (!year || !targets || !Array.isArray(targets)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const validKeys = new Set(Object.keys(REVENUE_GROUPS));
  for (const t of targets) {
    if (!validKeys.has(t.groupKey)) {
      return NextResponse.json({ error: `Invalid group: ${t.groupKey}` }, { status: 400 });
    }
    if (t.month < 1 || t.month > 12) {
      return NextResponse.json({ error: `Invalid month: ${t.month}` }, { status: 400 });
    }
  }

  await prisma.$transaction(
    targets.map((t) =>
      prisma.revenueGoal.upsert({
        where: { year_groupKey_month: { year, groupKey: t.groupKey, month: t.month } },
        update: { target: t.target, updatedBy: auth.email },
        create: { year, groupKey: t.groupKey, month: t.month, target: t.target, updatedBy: auth.email },
      })
    )
  );

  // Audit log — use userEmail (not userId which expects a cuid)
  await prisma.activityLog.create({
    data: {
      type: "REVENUE_GOAL_UPDATED",
      userEmail: auth.email,
      description: `Updated ${targets.length} revenue goal targets for ${year}`,
      metadata: { year, targetCount: targets.length },
    },
  });

  // Invalidate cache for all years (not just current)
  appCache.invalidateByPrefix("revenue-goals");

  return NextResponse.json({ success: true });
}
