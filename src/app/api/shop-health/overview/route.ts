import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { getShopHealthData, getWeekStart, formatWeekParam } from '@/lib/shop-health';
import { DASHBOARD_LOCATION_GROUPS } from '@/lib/dashboard-location-groups';
import type { HeroMetric, ShopHealthOverviewData, ShopHealthOverviewRow } from '@/lib/shop-health-types';

function toHeroMetric(value: number): HeroMetric {
  return { value, priorWeek: null, delta: null, health: 'green', target: null };
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const weekParam = searchParams.get('week');
  const weekStart = weekParam ? getWeekStart(new Date(weekParam)) : getWeekStart();

  try {
    const settled = await Promise.allSettled(
      DASHBOARD_LOCATION_GROUPS.map(async (group): Promise<ShopHealthOverviewRow> => {
        const data = await getShopHealthData(group.slug, weekStart);
        return {
          location: group.label,
          backlogWeeks: data.heroes.backlogWeeks,
          readyToBuild: data.heroes.readyToBuild,
          scheduledInstalls: data.heroes.scheduledInstalls,
          installsCompleted: data.heroes.installsCompleted,
          ptosReceived: data.heroes.ptosReceived,
          openTickets: data.heroes.openTickets,
          dnrActive: toHeroMetric(data.dnrRoofing?.dnrActive ?? 0),
          roofingActive: toHeroMetric(data.dnrRoofing?.roofingActive ?? 0),
          topBottleneck: data.bottlenecks[0]?.constraint ?? null,
        };
      })
    );

    const rows: ShopHealthOverviewRow[] = [];
    const errors: Array<{ slug: string; name: string; message: string; stack?: string }> = [];
    settled.forEach((result, idx) => {
      const group = DASHBOARD_LOCATION_GROUPS[idx];
      if (result.status === 'fulfilled') {
        rows.push(result.value);
      } else {
        const err = result.reason;
        const name = err instanceof Error ? err.name : 'Unknown';
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5).join(' | ') : undefined;
        errors.push({ slug: group?.slug ?? 'unknown', name, message, stack });
        console.error(
          `[shop-health] Overview row failed for ${group?.slug}: ${name}: ${message}\n${err instanceof Error ? err.stack : ''}`
        );
        // Emit a stub row so the UI knows the location exists but failed.
        rows.push({
          location: group?.label ?? 'Unknown',
          backlogWeeks: toHeroMetric(0),
          readyToBuild: toHeroMetric(0),
          scheduledInstalls: toHeroMetric(0),
          installsCompleted: toHeroMetric(0),
          ptosReceived: toHeroMetric(0),
          openTickets: toHeroMetric(0),
          dnrActive: toHeroMetric(0),
          roofingActive: toHeroMetric(0),
          topBottleneck: null,
        });
      }
    });

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const result: ShopHealthOverviewData & { _diagnostics?: typeof errors } = {
      rows,
      weekStart: formatWeekParam(weekStart),
      weekEnd: formatWeekParam(weekEnd),
      lastUpdated: new Date().toISOString(),
    };
    // TEMP: surface per-location errors in the response for diagnosis
    if (errors.length > 0) result._diagnostics = errors;

    return NextResponse.json(result);
  } catch (error) {
    console.error('[shop-health] Overview error:', error);
    return NextResponse.json({ error: 'Failed to fetch overview data' }, { status: 500 });
  }
}
