/**
 * PATCH /api/solar/feedback/[id]
 *
 * Update feedback status (ADMIN/MANAGER only).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSolarAuth, validateCsrfHeader, isElevatedRole, checkSolarRateLimit } from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const UpdateFeedbackSchema = z.object({
  status: z.enum(["NEW", "REVIEWED", "RESOLVED", "WONTFIX"]),
});

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const csrfError = validateCsrfHeader(req);
  if (csrfError) return csrfError;

  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  const { role: userRole } = user;
  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

  if (!isElevatedRole(userRole)) {
    return NextResponse.json({ error: "Forbidden — admin/manager only" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const feedback = await prisma.solarFeedback.update({
      where: { id },
      data: { status: parsed.data.status },
    });
    return NextResponse.json({ data: feedback });
  } catch (err: unknown) {
    // Prisma P2025 = record not found
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2025") {
      return NextResponse.json({ error: "Feedback not found" }, { status: 404 });
    }
    throw err;
  }
}
