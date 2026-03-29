/**
 * /api/solar/equipment
 *
 * GET  — List all equipment (built-in + custom)
 * POST — Create custom equipment
 *
 * Security: requireSolarAuth + CSRF + rate limit on mutations (PBO-002)
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireSolarAuth,
  validateCsrfHeader,
  checkSolarRateLimit,
} from "@/lib/solar-auth";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getBuiltInEquipment } from "@/lib/solar/equipment-catalog";
import {
  canonicalizeKeyTransform,
  PROFILE_SCHEMAS,
} from "@/lib/solar/equipment-schemas";

// ── Zod Schemas ───────────────────────────────────────────

const CreateEquipmentSchema = z.object({
  category: z.enum(["PANEL", "INVERTER", "ESS", "OPTIMIZER"]),
  key: canonicalizeKeyTransform,
  profile: z.record(z.string(), z.unknown()), // validated per-category below
});

// ── GET — List equipment ──────────────────────────────────

export async function GET(req: NextRequest) {
  const [user, authError] = await requireSolarAuth(req);
  if (authError) return authError;

  if (!prisma) {
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 503 }
    );
  }

  // Fetch custom equipment (active only)
  const SAFETY_CAP = 1000;
  const custom = await prisma.solarCustomEquipment.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: "desc" },
    take: SAFETY_CAP + 1,
  });
  const hasMore = custom.length > SAFETY_CAP;
  if (hasMore) custom.pop();

  const builtIn = getBuiltInEquipment();

  return NextResponse.json({
    builtIn,
    custom: custom.map((c) => ({
      id: c.id,
      category: c.category,
      key: c.key,
      profile: c.profile,
      createdById: c.createdById,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
    hasMore,
  });
}

// ── POST — Create custom equipment ───────────────────────

export async function POST(req: NextRequest) {
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

  // Step 1: validate top-level shape + canonicalize key
  const parsed = CreateEquipmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { category, key, profile } = parsed.data;

  // Step 2: validate profile against category-specific schema
  const profileSchema = PROFILE_SCHEMAS[category];
  const profileParsed = profileSchema.safeParse(profile);
  if (!profileParsed.success) {
    return NextResponse.json(
      {
        error: `Invalid ${category.toLowerCase()} profile`,
        details: profileParsed.error.flatten(),
      },
      { status: 400 }
    );
  }

  // Step 3: insert — partial unique index enforces active-only uniqueness
  try {
    const created = await prisma.solarCustomEquipment.create({
      data: {
        category,
        key,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        profile: profileParsed.data as any,
        createdById: user.id,
      },
    });

    console.log(
      JSON.stringify({
        event: "equipment_created",
        userId: user.id,
        equipmentId: created.id,
        category,
        key,
      })
    );

    return NextResponse.json(
      {
        id: created.id,
        category: created.category,
        key: created.key,
        profile: created.profile,
        createdAt: created.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    // Unique constraint violation → duplicate active key
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        {
          error: `Active equipment with category=${category} key="${key}" already exists`,
        },
        { status: 409 }
      );
    }
    throw err;
  }
}
