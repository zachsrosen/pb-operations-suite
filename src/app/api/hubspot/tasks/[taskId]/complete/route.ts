/**
 * POST /api/hubspot/tasks/[taskId]/complete
 *
 * Marks a HubSpot task as COMPLETED. Invalidates the owner's cached
 * task list so the next load refetches fresh data.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { appCache } from "@/lib/cache";
import { markTaskComplete } from "@/lib/hubspot-tasks";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  if (!/^\d{1,20}$/.test(taskId)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  try {
    await markTaskComplete(taskId);
    // Bust every owner's task cache — cheap and correct. We don't know which
    // owner this task belongs to without an extra round trip.
    appCache.invalidateByPrefix("hubspot:tasks:owner:");
    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "api.hubspot.tasks.complete", taskId } });
    return NextResponse.json({ error: "Failed to mark complete" }, { status: 502 });
  }
}
