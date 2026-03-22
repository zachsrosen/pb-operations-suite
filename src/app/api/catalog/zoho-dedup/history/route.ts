import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";
import { isCatalogSyncEnabled } from "@/lib/catalog-sync-confirmation";

export const runtime = "nodejs";

const ALLOWED_ROLES = new Set<UserRole>(["ADMIN", "EXECUTIVE"]);

// GET: List past dedup runs for audit
export async function GET() {
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

  const runs = await prisma.zohoDedupRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      itemsDeleted: true,
      itemsSkipped: true,
      itemsFailed: true,
      executedBy: true,
      createdAt: true,
      completedAt: true,
      outcomes: true,
    },
  });

  return NextResponse.json({ runs });
}
