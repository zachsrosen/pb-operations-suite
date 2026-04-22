import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdderById, updateAdder } from "@/lib/adders/catalog";
import { UpdateAdderSchema } from "@/lib/adders/zod-schemas";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const adder = await getAdderById(id);
  if (!adder) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ adder });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const body = await req.json();
  const parsed = UpdateAdderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    // TODO(session-type): session.user.id typed optional; runtime guaranteed.
    const adder = await updateAdder(id, parsed.data, { userId: session.user.id as string });
    return NextResponse.json({ adder });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg.match(/invalid shop/i)) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    throw e;
  }
}
