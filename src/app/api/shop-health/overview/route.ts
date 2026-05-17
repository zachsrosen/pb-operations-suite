import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { getShopHealthData, getWeekStart, formatWeekParam } from '@/lib/shop-health';
import { DASHBOARD_LOCATION_GROUPS } from '@/lib/dashboard-location-groups';
import type { ShopHealthOverviewData, ShopHealthOverviewRow } from '@/lib/shop-health-types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get('week');
  const weekStart = weekParam ? getWeekStart(new Date(weekParam)) : getWeekStart();

  try {
    const rows: ShopHealthOverviewRow[] = await Promise.all(
      DASHBOARD_LOCATION_GROUPS.map(async (group) => {
        const data = await getShopHealthData(group.slug, weekStart);
        return {
          location: group.label,
          backlogWeeks: data.heroes.backlogWeeks,
          readyToBuild: data.heroes.readyToBuild,
          scheduledInstalls: data.heroes.scheduledInstalls,
          installsCompleted: data.heroes.installsCompleted,
          ptosReceived: data.heroes.ptosReceived,
          topBottleneck: data.bottleneck?.constraint ?? null,
        };
      })
    );

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const result: ShopHealthOverviewData = {
      rows,
      weekStart: formatWeekParam(weekStart),
      weekEnd: formatWeekParam(weekEnd),
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('[shop-health] Overview error:', error);
    return NextResponse.json({ error: 'Failed to fetch overview data' }, { status: 500 });
  }
}
