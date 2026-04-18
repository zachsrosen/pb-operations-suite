import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import {
  isCatalogSyncEnabled,
  buildPlanConfirmation,
} from "@/lib/catalog-sync-confirmation";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);

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
  const role = (ROLES[((dbUser?.roles?.[0] ?? authResult.roles?.[0] ?? "VIEWER") as UserRole)]?.normalizesTo ?? ((dbUser?.roles?.[0] ?? authResult.roles?.[0] ?? "VIEWER") as UserRole));
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

  const { planHash } = body as {
    planHash?: string;
  };

  if (!planHash || typeof planHash !== "string") {
    return NextResponse.json({ error: "planHash is required" }, { status: 400 });
  }

  const confirmation = buildPlanConfirmation(id, planHash);
  if (!confirmation) {
    return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
  }
  return NextResponse.json(confirmation);
}
