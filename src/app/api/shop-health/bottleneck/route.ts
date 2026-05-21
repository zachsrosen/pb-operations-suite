import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  createBottleneck,
  updateBottleneck,
  deleteBottleneck,
  getBottleneckHistory,
} from '@/lib/shop-health-bottleneck';
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

/** Create a new bottleneck entry. */
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
    const entry = await createBottleneck({
      location,
      weekStart,
      constraint,
      rootCause,
      actionPlan,
      owner,
      userId: session.user.id as string,
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    console.error('[shop-health] Bottleneck create error:', error);
    return NextResponse.json({ error: 'Failed to create bottleneck' }, { status: 500 });
  }
}

/** Update an existing bottleneck entry by ID. */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await request.json();
  const { id, constraint, rootCause, actionPlan, owner } = body;

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  try {
    const entry = await updateBottleneck({
      id,
      constraint,
      rootCause,
      actionPlan,
      owner,
      userId: session.user.id as string,
    });
    return NextResponse.json(entry);
  } catch (error) {
    console.error('[shop-health] Bottleneck update error:', error);
    return NextResponse.json({ error: 'Failed to update bottleneck' }, { status: 500 });
  }
}

/** Delete a bottleneck entry by ID. */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id param required' }, { status: 400 });
  }

  try {
    await deleteBottleneck(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[shop-health] Bottleneck delete error:', error);
    return NextResponse.json({ error: 'Failed to delete bottleneck' }, { status: 500 });
  }
}
