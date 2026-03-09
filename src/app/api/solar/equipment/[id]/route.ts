/**
 * /api/solar/equipment/[id]
 *
 * PUT    — Update custom equipment (creator or ADMIN/MANAGER/OWNER)
 * DELETE — Soft archive custom equipment (ADMIN/MANAGER/OWNER only)
 *
 * Security: requireSolarAuth + CSRF + rate limit (PBO-002)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireSolarAuth,
  validateCsrfHeader,
  checkSolarRateLimit,
  isElevatedRole,
} from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  canonicalizeKeyTransform,
  PROFILE_SCHEMAS,
} from "@/lib/solar/equipment-schemas";

// ── Zod Schemas ───────────────────────────────────────────

const UpdateEquipmentSchema = z.object({
  key: canonicalizeKeyTransform.optional(),
  profile: z.record(z.string(), z.unknown()).optional(),
});

// ── Helpers ───────────────────────────────────────────────

type RouteContext = { params: Promise<{ id: string }> };

// ── PUT — Update custom equipment ─────────────────────────

export async function PUT(req: NextRequest, context: RouteContext) {
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

  const { id } = await context.params;

  // Find existing equipment
  const existing = await prisma.solarCustomEquipment.findUnique({
    where: { id },
  });

  if (!existing || existing.isArchived) {
    return NextResponse.json(
      { error: "Equipment not found" },
      { status: 404 }
    );
  }

  // RBAC: creator OR elevated role
  if (existing.createdById !== user.id && !isElevatedRole(user.role)) {
    return NextResponse.json(
      { error: "Not authorized to update this equipment" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateEquipmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Validate profile against existing record's category schema
  if (parsed.data.profile !== undefined) {
    const profileSchema = PROFILE_SCHEMAS[existing.category];
    const profileParsed = profileSchema.safeParse(parsed.data.profile);
    if (!profileParsed.success) {
      return NextResponse.json(
        {
          error: `Invalid ${existing.category.toLowerCase()} profile`,
          details: profileParsed.error.flatten(),
        },
        { status: 400 }
      );
    }
    // Use validated data (strips unknown fields)
    parsed.data.profile = profileParsed.data as Record<string, unknown>;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.key !== undefined) updates.key = parsed.data.key;
  if (parsed.data.profile !== undefined) updates.profile = parsed.data.profile;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  try {
    const updated = await prisma.solarCustomEquipment.update({
      where: { id },
      data: updates,
    });

    console.log(
      JSON.stringify({
        event: "equipment_updated",
        userId: user.id,
        equipmentId: id,
        fields: Object.keys(updates),
      })
    );

    return NextResponse.json({
      id: updated.id,
      category: updated.category,
      key: updated.key,
      profile: updated.profile,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err: unknown) {
    // Unique constraint violation → new key collides with another active entry
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: `Active equipment with this category and key already exists`,
        },
        { status: 409 }
      );
    }
    throw err;
  }
}

// ── DELETE — Soft archive custom equipment ────────────────

export async function DELETE(req: NextRequest, context: RouteContext) {
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

  const { id } = await context.params;

  // RBAC: ADMIN/MANAGER/OWNER only
  if (!isElevatedRole(user.role)) {
    return NextResponse.json(
      { error: "Only admins/managers can archive equipment" },
      { status: 403 }
    );
  }

  const existing = await prisma.solarCustomEquipment.findUnique({
    where: { id },
  });

  if (!existing) {
    return NextResponse.json(
      { error: "Equipment not found" },
      { status: 404 }
    );
  }

  if (existing.isArchived) {
    return NextResponse.json(
      { error: "Equipment is already archived" },
      { status: 409 }
    );
  }

  await prisma.solarCustomEquipment.update({
    where: { id },
    data: { isArchived: true },
  });

  console.log(
    JSON.stringify({
      event: "equipment_archived",
      userId: user.id,
      equipmentId: id,
      category: existing.category,
      key: existing.key,
    })
  );

  return NextResponse.json({ archived: true, id });
}
