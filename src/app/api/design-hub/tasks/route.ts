import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { appCache } from "@/lib/cache";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import {
  resolveOwnerIdByEmail,
  fetchOpenTasksByOwner,
  enrichWithAssociations,
} from "@/lib/hubspot-tasks";

/**
 * GET /api/design-hub/tasks — the signed-in user's open HubSpot tasks, for the
 * Assigned-to-me tab. A designer's real work lives in HubSpot tasks (Send
 * Plans, Close out Design Project, …) alongside the app-local assignments Zach
 * pushes; this surfaces both in one place. Reuses lib/hubspot-tasks so owner
 * resolution and rate-limit handling match /api/hubspot/tasks/mine.
 */
export const runtime = "nodejs";

const TASKS_TTL_MS = 60 * 1000;

interface DesignTask {
  id: string;
  subject: string;
  dueAt: string | null;
  createdAt: string | null;
  hubspotUrl: string;
  deal: { id: string; name: string } | null;
}

export async function GET() {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const roles = (session.user as { roles?: string[] }).roles ?? [];
  if (!isDesignHubAllowedRole(roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Explicit owner link first, heuristic fallback — same as tasks/mine. A DB
  // hiccup here is recoverable via the heuristic, so it's swallowed.
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

  const ownerId = await resolveOwnerIdByEmail(
    email,
    session.user?.name,
    linkedOwnerId,
  );
  // No HubSpot owner ⇒ no tasks, but not an error: the app-assignment section
  // still renders. Signal it so the UI can say why the task list is empty.
  if (!ownerId) {
    return NextResponse.json({ tasks: [], ownerResolved: false });
  }

  const cacheKey = `design-hub:tasks:${ownerId}`;
  const cached = appCache.get<DesignTask[]>(cacheKey);
  if (cached.hit && cached.data && !cached.stale) {
    return NextResponse.json({ tasks: cached.data, ownerResolved: true });
  }

  try {
    const open = await fetchOpenTasksByOwner(ownerId);
    const enriched = await enrichWithAssociations(open);
    const tasks: DesignTask[] = enriched
      .map((t) => ({
        id: t.id,
        subject: t.subject?.trim() || "Untitled task",
        dueAt: t.dueAt,
        createdAt: t.createdAt,
        hubspotUrl: t.hubspotUrl,
        deal: t.associations.deal
          ? { id: t.associations.deal.id, name: t.associations.deal.name }
          : null,
      }))
      // Soonest due first; tasks with no due date sort last rather than
      // masquerading as due now.
      .sort((a, b) => {
        if (!a.dueAt) return b.dueAt ? 1 : 0;
        if (!b.dueAt) return -1;
        return a.dueAt < b.dueAt ? -1 : 1;
      });

    appCache.set(cacheKey, tasks, { ttl: TASKS_TTL_MS });
    return NextResponse.json({ tasks, ownerResolved: true });
  } catch (err) {
    Sentry.captureException(err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
