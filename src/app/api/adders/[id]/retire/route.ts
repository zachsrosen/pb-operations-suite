import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { retireAdder } from "@/lib/adders/catalog";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // TODO: once next-auth session callback pipes canManageAdders, use that. For
  // Chunk 1, ADMIN/OWNER are the only canManage roles, so a roles gate works.
  const roles = session.user.roles ?? [];
  const canManage = roles.includes("ADMIN") || roles.includes("OWNER");
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  // TODO(session-type): session.user.id typed optional; runtime guaranteed.
  const adder = await retireAdder(id, { userId: session.user.id as string, reason });
  return NextResponse.json({ adder });
}
