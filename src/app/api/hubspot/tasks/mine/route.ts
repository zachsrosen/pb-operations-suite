/**
 * GET /api/hubspot/tasks/mine
 *
 * Returns the current user's open HubSpot tasks, associations, and
 * available queues. If the user's email doesn't resolve to a HubSpot
 * owner, returns { ownerId: null, reason: "NO_HUBSPOT_OWNER" }.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { appCache } from "@/lib/cache";
import {
  resolveOwnerIdByEmail,
  fetchOpenTasksByOwner,
  fetchQueues,
  enrichWithAssociations,
  type EnrichedTask,
  type TaskQueue,
} from "@/lib/hubspot-tasks";

const cacheKey = (ownerId: string) => `hubspot:tasks:owner:${ownerId}`;

interface MyTasksPayload {
  ownerId: string | null;
  reason?: "NO_HUBSPOT_OWNER";
  tasks: EnrichedTask[];
  queues: TaskQueue[];
  fetchedAt: string;
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerId = await resolveOwnerIdByEmail(email);
  if (!ownerId) {
    Sentry.captureMessage("MISSING_HUBSPOT_OWNER", {
      level: "warning",
      tags: { email },
    });
    const payload: MyTasksPayload = {
      ownerId: null,
      reason: "NO_HUBSPOT_OWNER",
      tasks: [],
      queues: [],
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  }

  const key = cacheKey(ownerId);
  const cached = appCache.get<MyTasksPayload>(key);
  if (cached.hit && cached.data) return NextResponse.json(cached.data);

  try {
    const [rawTasks, queues] = await Promise.all([
      fetchOpenTasksByOwner(ownerId),
      fetchQueues(),
    ]);
    const tasks = await enrichWithAssociations(rawTasks);

    // Only show queues that at least one task is in (keeps filter dropdown tidy)
    const referencedQueueIds = new Set<string>();
    for (const t of tasks) for (const q of t.queueIds) referencedQueueIds.add(q);
    const visibleQueues = queues.filter((q) => referencedQueueIds.has(q.id));

    const payload: MyTasksPayload = {
      ownerId,
      tasks,
      queues: visibleQueues,
      fetchedAt: new Date().toISOString(),
    };
    appCache.set(key, payload);
    return NextResponse.json(payload);
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "api.hubspot.tasks.mine", email } });
    return NextResponse.json({ error: "HubSpot unavailable" }, { status: 502 });
  }
}
