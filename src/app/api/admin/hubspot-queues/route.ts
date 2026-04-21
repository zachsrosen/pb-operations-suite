/**
 * GET  /api/admin/hubspot-queues — list queue-name mappings
 * POST /api/admin/hubspot-queues — upsert { queueId, name }
 * DELETE /api/admin/hubspot-queues?queueId=... — remove a mapping
 *
 * Admin-only. HubSpot doesn't expose queue listing via public API, so we
 * maintain the id→name map ourselves.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { appCache } from "@/lib/cache";

const CACHE_KEY = "hubspot:queue-names:all";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const me = await getUserByEmail(session.user.email);
  if (!me?.roles?.includes("ADMIN")) {
    return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const queues = await prisma.hubspotQueueName.findMany({
    orderBy: { name: "asc" },
    select: { id: true, queueId: true, name: true, updatedAt: true },
  });
  return NextResponse.json({ queues });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { queueId?: unknown; name?: unknown };
  const queueId = typeof body.queueId === "string" ? body.queueId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!/^\d{1,20}$/.test(queueId)) {
    return NextResponse.json({ error: "queueId must be numeric" }, { status: 400 });
  }
  if (name.length === 0 || name.length > 120) {
    return NextResponse.json({ error: "name must be 1-120 chars" }, { status: 400 });
  }

  const saved = await prisma.hubspotQueueName.upsert({
    where: { queueId },
    create: { queueId, name },
    update: { name },
    select: { id: true, queueId: true, name: true, updatedAt: true },
  });
  appCache.invalidate(CACHE_KEY);
  return NextResponse.json({ queue: saved });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const queueId = request.nextUrl.searchParams.get("queueId") ?? "";
  if (!/^\d{1,20}$/.test(queueId)) {
    return NextResponse.json({ error: "queueId must be numeric" }, { status: 400 });
  }
  await prisma.hubspotQueueName.delete({ where: { queueId } }).catch(() => null);
  appCache.invalidate(CACHE_KEY);
  return NextResponse.json({ ok: true });
}
