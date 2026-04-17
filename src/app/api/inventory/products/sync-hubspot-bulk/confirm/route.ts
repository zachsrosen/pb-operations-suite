import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";
import { buildBulkSyncConfirmation } from "@/lib/bulk-sync-confirmation";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);

export async function POST(request: NextRequest) {
  if (!isCatalogSyncEnabled()) {
    return NextResponse.json({ error: "Catalog sync is not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const dbUser = await getUserByEmail(authResult.email);
  const role = (ROLES[((dbUser?.role ?? authResult.role) as UserRole)]?.normalizesTo ?? ((dbUser?.role ?? authResult.role) as UserRole));
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: "Admin or owner access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { changesHash } = body as { changesHash?: string };

  if (typeof changesHash !== "string" || !changesHash.trim()) {
    return NextResponse.json({ error: "changesHash is required" }, { status: 400 });
  }

  try {
    const confirmation = buildBulkSyncConfirmation({
      operation: "hubspot-product-bulk-sync",
      operationId: "all",
      changesHash: changesHash.trim(),
    });

    return NextResponse.json(confirmation);
  } catch (error) {
    console.error("[BulkSync] Confirmation token generation failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate confirmation token" },
      { status: 500 },
    );
  }
}
