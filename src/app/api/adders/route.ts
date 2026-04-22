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
  // TODO(session-type): canManageAdders will be on the session once the Prisma
  // client is regenerated (adder_can_manage_permission migration applied) and
  // the next-auth session callback pipes the user's canManageAdders column.
  if (!(session.user as unknown as { canManageAdders?: boolean }).canManageAdders) {
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
