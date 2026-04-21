/**
 * GET /api/hubspot/tasks/mine
 *
 * Returns the current user's open HubSpot tasks, associations, and
 * available queues. If the user's email doesn't resolve to a HubSpot
 * owner, returns { ownerId: null, reason: "NO_HUBSPOT_OWNER" }.
 */

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { appCache } from "@/lib/cache";
import { prisma } from "@/lib/db";
import {
  resolveOwnerIdByEmail,
  fetchOpenTasksByOwner,
  fetchRecentCompletedByOwner,
  fetchQueues,
  enrichWithAssociations,
  type EnrichedTask,
  type TaskQueue,
} from "@/lib/hubspot-tasks";

const cacheKey = (ownerId: string, includeCompleted: boolean) =>
  `hubspot:tasks:owner:${ownerId}:${includeCompleted ? "withCompleted" : "openOnly"}`;

// Dedupe Sentry noise — only report MISSING_HUBSPOT_OWNER once per hour per email.
const missingOwnerReportedAt = new Map<string, number>();
const MISSING_OWNER_DEDUPE_MS = 60 * 60 * 1000;

interface MyTasksPayload {
  ownerId: string | null;
  reason?: "NO_HUBSPOT_OWNER";
  tasks: EnrichedTask[];
  completedTasks: EnrichedTask[];
  queues: TaskQueue[];
  fetchedAt: string;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  const includeCompleted = request.nextUrl.searchParams.get("includeCompleted") === "1";
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Look up the user's explicit HubSpot owner link, if any. Swallowing errors
  // here — missing column or DB hiccup is recoverable via the heuristic.
  let linkedOwnerId: string | null = null;
  try {
    const user = await prisma?.user.findUnique({
      where: { email },
      select: { hubspotOwnerId: true },
    });
    linkedOwnerId = user?.hubspotOwnerId ?? null;
  } catch {
    // ignore — falls back to heuristic
  }

  const ownerId = await resolveOwnerIdByEmail(email, session?.user?.name, linkedOwnerId);
  if (!ownerId) {
    const lastReported = missingOwnerReportedAt.get(email) ?? 0;
    if (Date.now() - lastReported > MISSING_OWNER_DEDUPE_MS) {
      Sentry.captureMessage("MISSING_HUBSPOT_OWNER", {
        level: "warning",
        tags: { email },
      });
      missingOwnerReportedAt.set(email, Date.now());
    }
    const payload: MyTasksPayload = {
      ownerId: null,
      reason: "NO_HUBSPOT_OWNER",
      tasks: [],
      completedTasks: [],
      queues: [],
      fetchedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  }

  const key = cacheKey(ownerId, includeCompleted);
  const cached = appCache.get<MyTasksPayload>(key);
  if (cached.hit && cached.data) return NextResponse.json(cached.data);

  try {
    const [rawOpen, rawCompleted, queues] = await Promise.all([
      fetchOpenTasksByOwner(ownerId),
      includeCompleted ? fetchRecentCompletedByOwner(ownerId, 7) : Promise.resolve([]),
      fetchQueues(),
    ]);

    // Enrich both sets together to share the single assoc/stage-map fetch.
    const enrichedAll = await enrichWithAssociations([...rawOpen, ...rawCompleted]);
    const tasks = enrichedAll.slice(0, rawOpen.length);
    const completedTasks = enrichedAll.slice(rawOpen.length);

    // Only show queues that at least one open task is in.
    const referencedQueueIds = new Set<string>();
    for (const t of tasks) for (const q of t.queueIds) referencedQueueIds.add(q);
    const visibleQueues = queues.filter((q) => referencedQueueIds.has(q.id));

    const payload: MyTasksPayload = {
      ownerId,
      tasks,
      completedTasks,
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
