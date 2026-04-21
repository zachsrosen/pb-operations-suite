/**
 * GET /api/hubspot/tasks/mine/count
 *
 * Lightweight companion to /api/hubspot/tasks/mine — returns just the open
 * task count for the current user. Used to render a badge in the UserMenu
 * dropdown without paying the full association-enrichment cost.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { appCache } from "@/lib/cache";
import { prisma } from "@/lib/db";
import { resolveOwnerIdByEmail, fetchOpenTasksByOwner } from "@/lib/hubspot-tasks";

const cacheKey = (ownerId: string) => `hubspot:tasks:owner:${ownerId}:count`;

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let linkedOwnerId: string | null = null;
  try {
    const user = await prisma?.user.findUnique({
      where: { email },
      select: { hubspotOwnerId: true },
    });
    linkedOwnerId = user?.hubspotOwnerId ?? null;
  } catch {
    // ignore
  }

  const ownerId = await resolveOwnerIdByEmail(email, session?.user?.name, linkedOwnerId);
  if (!ownerId) {
    return NextResponse.json({ openCount: 0, ownerId: null });
  }

  const key = cacheKey(ownerId);
  const cached = appCache.get<{ openCount: number; ownerId: string }>(key);
  if (cached.hit && cached.data) return NextResponse.json(cached.data);

  try {
    const tasks = await fetchOpenTasksByOwner(ownerId);
    const payload = { openCount: tasks.length, ownerId };
    appCache.set(key, payload);
    return NextResponse.json(payload);
  } catch {
    // Don't break the UserMenu when HubSpot is flaky — return 0.
    return NextResponse.json({ openCount: 0, ownerId });
  }
}
