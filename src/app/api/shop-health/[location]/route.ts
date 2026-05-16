import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { getShopHealthData, getWeekStart } from '@/lib/shop-health';
import { resolveDashboardGroup } from '@/lib/dashboard-location-groups';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ location: string }> }
) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { location } = await params;
  const group = resolveDashboardGroup(location);
  if (!group) {
    return NextResponse.json({ error: 'Unknown location' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get('week');
  const weekStart = weekParam ? getWeekStart(new Date(weekParam)) : getWeekStart();

  try {
    const data = await getShopHealthData(group.slug, weekStart);
    return NextResponse.json(data);
  } catch (error) {
    console.error('[shop-health] Error fetching data:', error);
    return NextResponse.json({ error: 'Failed to fetch shop health data' }, { status: 500 });
  }
}
