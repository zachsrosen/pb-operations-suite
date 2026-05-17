import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { upsertBottleneck, getBottleneckHistory } from '@/lib/shop-health-bottleneck';
import { getWeekStart } from '@/lib/shop-health';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const location = searchParams.get('location');
  if (!location) {
    return NextResponse.json({ error: 'location param required' }, { status: 400 });
  }

  const weeks = parseInt(searchParams.get('weeks') || '4', 10);
  const entries = await getBottleneckHistory(location, weeks);
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();
  const { location, weekStart: weekStartStr, constraint, rootCause, actionPlan, owner } = body;

  if (!location || !weekStartStr) {
    return NextResponse.json({ error: 'location and weekStart required' }, { status: 400 });
  }

  const weekStart = getWeekStart(new Date(weekStartStr));

  try {
    // session.user.id is typed as optional but runtime-guaranteed by auth guard above.
    const entry = await upsertBottleneck({
      location,
      weekStart,
      constraint,
      rootCause,
      actionPlan,
      owner,
      userId: session.user.id as string,
    });
    return NextResponse.json(entry);
  } catch (error) {
    console.error('[shop-health] Bottleneck upsert error:', error);
    return NextResponse.json({ error: 'Failed to save bottleneck' }, { status: 500 });
  }
}
