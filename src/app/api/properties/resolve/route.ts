import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { canAccessRoute } from "@/lib/role-permissions";
import { addressHash } from "@/lib/address-hash";

/**
 * POST /api/properties/resolve
 *
 * Looks up a `HubSpotPropertyCache` row by structured address parts. Returns
 * `{ propertyId }` when a row exists, or `{ propertyId: null }` when no match
 * (never 404 — "no match" is a normal, expected result for this endpoint).
 *
 * Why POST (not GET with `?address=...`): a display-string query param would
 * require server-side parsing back into parts. Two clients with the same
 * logical address but different whitespace/casing/abbreviation conventions
 * would then hash to different values. By accepting structured parts and
 * hashing with the shared `addressHash` normalizer, lookups stay stable no
 * matter how the cache row was originally written (webhook, backfill, legacy
 * resolve).
 *
 * Strictly DB-only: does NOT geocode, does NOT call HubSpot, does NOT create
 * rows. Creation is handled by the sync/backfill paths.
 */

const ResolveSchema = z.object({
  street: z.string().trim().min(1),
  unit: z.string().nullable().optional(),
  city: z.string().trim().min(1),
  state: z.string().trim().length(2),
  zip: z.string().trim().min(1),
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

    // Same gate as the drawer: any role with `/api/service` access can resolve.
    if (!canAccessRoute(user.role, "/api/service")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const parsed = ResolveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid address", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const hash = addressHash({
      street: parsed.data.street,
      unit: parsed.data.unit ?? null,
      city: parsed.data.city,
      state: parsed.data.state,
      zip: parsed.data.zip,
    });

    const row = await prisma.hubSpotPropertyCache.findUnique({
      where: { addressHash: hash },
      select: { hubspotObjectId: true },
    });

    return NextResponse.json({ propertyId: row?.hubspotObjectId ?? null });
  } catch (error) {
    console.error("[PropertyResolve] Error:", error);
    return NextResponse.json(
      { error: "Failed to resolve property" },
      { status: 500 },
    );
  }
}
