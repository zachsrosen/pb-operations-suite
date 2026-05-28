import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { getShopHealthOverviewRows, getWeekStart, formatWeekParam } from '@/lib/shop-health';
import type { ShopHealthOverviewData } from '@/lib/shop-health-types';

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get('week');
  const weekStart = weekParam ? getWeekStart(new Date(weekParam)) : getWeekStart();

  try {
    // Lightweight path: ONE Project fetch shared across all 5 locations,
    // ONE bottleneck DB read. No tickets, no D&R/Roofing fetch.
    // (The new columns show 0 placeholders here; per-location dashboards
    // still surface real values for them.)
    const { rows, lastUpdated } = await getShopHealthOverviewRows(weekStart);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const result: ShopHealthOverviewData = {
      rows,
      weekStart: formatWeekParam(weekStart),
      weekEnd: formatWeekParam(weekEnd),
      lastUpdated,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('[shop-health] Overview error:', error);
    return NextResponse.json({ error: 'Failed to fetch overview data' }, { status: 500 });
  }
}
