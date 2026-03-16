import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import {
  isCatalogSyncEnabled,
  buildSyncConfirmation,
  type SyncSystem,
} from "@/lib/catalog-sync-confirmation";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "OWNER"]);
const VALID_SYSTEMS = new Set<SyncSystem>(["zoho", "hubspot", "zuper"]);

// POST: Generate HMAC confirmation token for sync
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = normalizeRole((dbUser?.role ?? authResult.role) as UserRole);
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { systems, changesHash } = body as {
    systems?: string[];
    changesHash?: string;
  };

  if (!Array.isArray(systems) || systems.length === 0) {
    return NextResponse.json({ error: "systems array is required" }, { status: 400 });
  }
  if (typeof changesHash !== "string" || !changesHash.trim()) {
    return NextResponse.json({ error: "changesHash is required" }, { status: 400 });
  }

  const validatedSystems = systems.filter((s): s is SyncSystem => VALID_SYSTEMS.has(s as SyncSystem));
  if (validatedSystems.length !== systems.length) {
    return NextResponse.json({ error: "Invalid system in systems array" }, { status: 400 });
  }

  try {
    const confirmation = buildSyncConfirmation({
      internalProductId: id,
      systems: validatedSystems,
      changesHash: changesHash.trim(),
    });

    return NextResponse.json(confirmation);
  } catch (error) {
    console.error("[Sync] Confirmation token generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate confirmation token" },
      { status: 500 },
    );
  }
}
