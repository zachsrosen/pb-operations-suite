import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole } from "@/lib/role-permissions";
import { upsertPropertyFromGeocode } from "@/lib/property-sync";

/**
 * POST /api/properties/manual-create (admin only)
 *
 * Admin-driven creation of a Property from structured address parts, with no
 * contact association. Wraps `upsertPropertyFromGeocode` so webhook and manual
 * paths share the same geocode → find-or-create logic.
 *
 * On geocode miss the caller gets 422 (address is syntactically valid but
 * couldn't be resolved); on success returns 201 + `{ propertyId, created }`
 * regardless of whether a matching Property already existed — clients use the
 * `created` flag to distinguish "created new" vs "matched existing".
 */

const ManualCreateSchema = z.object({
  street: z.string().trim().min(1),
  unit: z.string().nullable().optional(),
  city: z.string().trim().min(1),
  state: z.string().trim().length(2),
  zip: z.string().trim().min(1),
  country: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 403 });
    }

    if (normalizeRole(user.role) !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = ManualCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid address", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await upsertPropertyFromGeocode({
      street: parsed.data.street,
      unit: parsed.data.unit,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
      country: parsed.data.country,
    });

    if ("status" in result) {
      return NextResponse.json(
        { error: "Geocode failed", reason: "geocode failed" },
        { status: 422 },
      );
    }

    // Best-effort activity log — swallow failures to stay consistent with the
    // other property handlers (the sync itself already succeeded).
    try {
      await prisma.activityLog.create({
        data: {
          type: "PROPERTY_CREATED",
          description: result.created
            ? "Property created via admin manual-create"
            : "Existing Property matched via admin manual-create",
          metadata: {
            actorUserId: user.id,
            method: "manual-create",
            propertyCacheId: result.propertyCacheId,
            created: result.created,
          } as never,
          entityType: "Property",
          entityId: result.propertyCacheId,
          userId: user.id,
        },
      });
    } catch {
      /* swallow */
    }

    return NextResponse.json(
      { propertyId: result.hubspotObjectId, created: result.created },
      { status: 201 },
    );
  } catch (error) {
    console.error("[PropertyManualCreate] Error:", error);
    return NextResponse.json(
      { error: "Failed to create property" },
      { status: 500 },
    );
  }
}
