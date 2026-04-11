import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key") || "";
  const kind = req.nextUrl.searchParams.get("kind") || "sender_pref";

  const prefs = await prisma.commsAiMemory.findMany({
    where: { userId: user.id, kind, ...(key ? { key } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ preferences: prefs });
}

export async function PUT(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { kind, key, data } = await req.json();

  if (!kind || !key || !data) {
    return NextResponse.json({ error: "kind, key, and data are required" }, { status: 400 });
  }

  // Upsert: find existing pref for this user/kind/key, or create
  const existing = await prisma.commsAiMemory.findFirst({
    where: { userId: user.id, kind, key },
  });

  if (existing) {
    await prisma.commsAiMemory.update({
      where: { id: existing.id },
      data: { data },
    });
  } else {
    await prisma.commsAiMemory.create({
      data: { userId: user.id, kind, key, data },
    });
  }

  return NextResponse.json({ ok: true });
}
