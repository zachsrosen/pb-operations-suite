import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createAdder, listAdders } from "@/lib/adders/catalog";
import { CreateAdderSchema } from "@/lib/adders/zod-schemas";
import { AdderCategory } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const categoryRaw = sp.get("category");
  const activeRaw = sp.get("active");
  const shop = sp.get("shop") ?? undefined;

  const category =
    categoryRaw && categoryRaw in AdderCategory
      ? (categoryRaw as AdderCategory)
      : undefined;
  const active = activeRaw == null ? undefined : activeRaw === "true";

  const adders = await listAdders({ category, active, shop });
  return NextResponse.json({ adders });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // TODO: once next-auth session callback pipes canManageAdders from the User
  // row, replace this with a proper boolean check. For now, Chunk 1 has only
  // ADMIN/OWNER as canManageAdders=true roles, so a roles-based gate is
  // functionally equivalent and actually works without session-type changes.
  const roles = session.user.roles ?? [];
  const canManage = roles.includes("ADMIN") || roles.includes("OWNER");
  if (!canManage) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = CreateAdderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    // TODO(session-type): session.user.id may be undefined in types; runtime is guaranteed by auth guard above.
    const adder = await createAdder(parsed.data, { userId: session.user.id as string });
    return NextResponse.json({ adder }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "unknown";
    if (msg.includes("Unique")) {
      return NextResponse.json({ error: "duplicate code" }, { status: 409 });
    }
    throw e;
  }
}
