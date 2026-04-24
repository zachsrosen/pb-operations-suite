import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isPermitHubAllowedRole,
  isPermitHubEnabled,
  resolveUserIdByEmail,
} from "@/lib/permit-hub";

async function gate() {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userId = await resolveUserIdByEmail(auth.email);
  if (!userId) {
    return NextResponse.json({ error: "User record not found" }, { status: 500 });
  }
  return { userId };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string; actionKind: string }> },
) {
  const g = await gate();
  if (g instanceof NextResponse) return g;

  const { dealId, actionKind } = await params;
  const draft = await prisma.permitHubDraft.findUnique({
    where: {
      userId_dealId_actionKind: { userId: g.userId, dealId, actionKind },
    },
  });
  return NextResponse.json({ draft });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string; actionKind: string }> },
) {
  const g = await gate();
  if (g instanceof NextResponse) return g;

  const { dealId, actionKind } = await params;
  await prisma.permitHubDraft.deleteMany({
    where: { userId: g.userId, dealId, actionKind },
  });
  return NextResponse.json({ ok: true });
}
