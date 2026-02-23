// src/app/api/catalog/push-requests/[id]/reject/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

const ADMIN_ROLES = ["ADMIN", "OWNER", "MANAGER"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!ADMIN_ROLES.includes(authResult.role)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  const { id } = await params;
  const push = await prisma.pendingCatalogPush.findUnique({ where: { id } });
  if (!push) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (push.status !== "PENDING") {
    return NextResponse.json({ error: `Already ${push.status.toLowerCase()}` }, { status: 409 });
  }

  let note: string | undefined;
  try {
    const body = await request.json() as { note?: string };
    note = body.note;
  } catch { /* optional body */ }

  const updated = await prisma.pendingCatalogPush.update({
    where: { id },
    data: { status: "REJECTED", resolvedAt: new Date(), note: note ?? null },
  });

  return NextResponse.json({ push: updated });
}
