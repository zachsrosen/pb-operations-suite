import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { appCache, CACHE_KEYS } from "@/lib/cache";
import {
  REVENUE_GROUPS,
  fetchRevenueDeals,
  fetchZuperCompletedRevenue,
  buildRevenueGoalResponse,
} from "@/lib/revenue-goals";
import { prisma } from "@/lib/db";

const ALLOWED_ROLES = ["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];

export async function GET(request: NextRequest) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!ALLOWED_ROLES.includes(auth.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()), 10);
  const forceRefresh = searchParams.get("refresh") === "true";

  if (isNaN(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  try {
    // Note: getOrFetch returns { data, cached, stale, lastUpdated }
    const { data, lastUpdated } = await appCache.getOrFetch(
      CACHE_KEYS.REVENUE_GOALS(year),
      async () => {
        // Fetch base targets from DB
        const goals = await prisma.revenueGoal.findMany({
          where: { year },
          orderBy: [{ groupKey: "asc" }, { month: "asc" }],
        });

        // Auto-seed if no rows exist for this year
        if (goals.length === 0) {
          const seedRows = Object.entries(REVENUE_GROUPS).flatMap(([groupKey, group]) =>
            Array.from({ length: 12 }, (_, i) => ({
              year,
              groupKey,
              month: i + 1,
              target: String(Math.round((group.annualTarget / 12) * 100) / 100),
            }))
          );
          await prisma.revenueGoal.createMany({ data: seedRows });
          const seeded = await prisma.revenueGoal.findMany({
            where: { year },
            orderBy: [{ groupKey: "asc" }, { month: "asc" }],
          });
          return await buildResponse(year, seeded);
        }

        return await buildResponse(year, goals);
      },
      forceRefresh
    );

    return NextResponse.json({ ...data, lastUpdated });
  } catch (error) {
    console.error("[RevenueGoals] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue goals" },
      { status: 500 }
    );
  }
}

async function buildResponse(
  year: number,
  goals: { groupKey: string; month: number; target: unknown }[]
) {
  const baseTargetsMap: Record<string, number[]> = {};
  for (const [groupKey, group] of Object.entries(REVENUE_GROUPS)) {
    baseTargetsMap[groupKey] = Array(12).fill(group.annualTarget / 12);
  }
  for (const goal of goals) {
    if (!baseTargetsMap[goal.groupKey]) continue;
    baseTargetsMap[goal.groupKey][goal.month - 1] = Number(goal.target);
  }

  // Fetch HubSpot deals and Zuper completed jobs in parallel
  const [deals, zuperActuals] = await Promise.all([
    fetchRevenueDeals(year),
    fetchZuperCompletedRevenue(year),
  ]);
  return buildRevenueGoalResponse(year, deals, baseTargetsMap, new Date(), zuperActuals);
}
