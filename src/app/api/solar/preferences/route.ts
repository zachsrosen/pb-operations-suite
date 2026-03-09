/**
 * /api/solar/preferences
 *
 * GET  — Return current user preferences
 * PATCH — Merge-update user preferences
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireSolarAuth,
  validateCsrfHeader,
  checkSolarRateLimit,
} from "@/lib/solar-auth";
import { prisma, logActivity } from "@/lib/db";
import { z } from "zod";

// ── Schema ──────────────────────────────────────────────────

const PatchPreferencesSchema = z.object({
  solarPreferredEntryMode: z
    .enum(["wizard", "classic", "browser"])
    .optional(),
});

// ── GET — Return preferences ────────────────────────────────

export async function GET(req: NextRequest) {
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!prisma) {
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 }
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { preferences: true },
  });

  return NextResponse.json({ data: dbUser?.preferences ?? {} });
}

// ── PATCH — Merge-update preferences ────────────────────────

export async function PATCH(req: NextRequest) {
  const csrfError = validateCsrfHeader(req);
  if (csrfError) return csrfError;

  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  const rateLimited = checkSolarRateLimit(user.email);
  if (rateLimited) return rateLimited;

  if (!prisma) {
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchPreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Merge with existing preferences
  const existing = await prisma.user.findUnique({
    where: { id: user.id },
    select: { preferences: true },
  });

  const currentPrefs =
    existing?.preferences && typeof existing.preferences === "object"
      ? (existing.preferences as Record<string, unknown>)
      : {};

  const merged = { ...currentPrefs, ...parsed.data };

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { preferences: merged as any },
    select: { preferences: true },
  });

  // Audit log
  await logActivity({
    type: "SETTINGS_CHANGED",
    description: `Solar preferences updated`,
    userId: user.id,
    userEmail: user.email,
    entityType: "User",
    entityId: user.id,
    metadata: {
      changes: parsed.data,
      previous: currentPrefs,
    },
    requestPath: "/api/solar/preferences",
    requestMethod: "PATCH",
    responseStatus: 200,
  });

  return NextResponse.json({ data: updated.preferences });
}
