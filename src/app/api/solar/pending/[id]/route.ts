/**
 * DELETE /api/solar/pending/[id]
 *
 * Delete own pending state row (stale recovery cleanup).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, validateCsrfHeader, checkSolarRateLimit } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const csrfError = validateCsrfHeader(req);
  if (csrfError) return csrfError;

  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Users can only delete their own pending states
  const pending = await prisma.solarPendingState.findUnique({ where: { id } });
  if (!pending || pending.userId !== user.id) {
    return NextResponse.json({ error: "Not found or forbidden" }, { status: 404 });
  }

  await prisma.solarPendingState.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
