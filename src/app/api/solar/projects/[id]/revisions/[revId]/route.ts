/**
 * GET /api/solar/projects/[id]/revisions/[revId]
 *
 * Load a specific revision snapshot.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, canReadProject } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string; revId: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { id, revId } = await context.params;
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const canRead = await canReadProject(user.id, user.role, id);
  if (!canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const revision = await prisma.solarProjectRevision.findFirst({
    where: { id: revId, projectId: id },
    include: {
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!revision) {
    return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  }

  return NextResponse.json({ data: revision });
}
