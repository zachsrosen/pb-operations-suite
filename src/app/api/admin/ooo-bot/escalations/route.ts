/**
 * GET /api/admin/ooo-bot/escalations
 * PATCH /api/admin/ooo-bot/escalations
 *
 * Admin-only endpoint for reviewing OOO bot escalations.
 * GET: list pending escalations
 * PATCH: resolve/dismiss an escalation
 *
 * Covered by ADMIN_ONLY_ROUTES prefix check in middleware.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const escalations = await prisma.oooBotEscalation.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ escalations, count: escalations.length });
}

export async function PATCH(request: NextRequest) {
  let body: { id?: string; status?: string; resolvedNote?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.id || !body.status) {
    return NextResponse.json(
      { error: "id and status are required" },
      { status: 400 }
    );
  }

  if (!["RESOLVED", "DISMISSED"].includes(body.status)) {
    return NextResponse.json(
      { error: "status must be RESOLVED or DISMISSED" },
      { status: 400 }
    );
  }

  const updated = await prisma.oooBotEscalation.update({
    where: { id: body.id },
    data: {
      status: body.status,
      resolvedNote: body.resolvedNote ?? null,
      resolvedAt: new Date(),
    },
  });

  return NextResponse.json({ escalation: updated });
}
