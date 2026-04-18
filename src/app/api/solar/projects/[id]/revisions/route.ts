/**
 * GET /api/solar/projects/[id]/revisions
 *
 * List revisions for a project.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, canReadProject } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  const { role: userRole } = user;
  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const canRead = await canReadProject(user.id, userRole, id);
  if (!canRead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const revisions = await prisma.solarProjectRevision.findMany({
    where: { projectId: id },
    select: {
      id: true,
      version: true,
      note: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
    orderBy: { version: "desc" },
  });

  return NextResponse.json({ data: revisions });
}
