import { NextRequest, NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) return NextResponse.json({ error: "Comms unavailable while impersonating" }, { status: 403 });
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { rating, draftBody, originalSubject, provider } = await req.json();

  if (!rating || !["good", "needs_work"].includes(rating)) {
    return NextResponse.json({ error: "rating must be 'good' or 'needs_work'" }, { status: 400 });
  }

  await prisma.commsAiMemory.create({
    data: {
      userId: user.id,
      kind: "feedback",
      data: { rating, draftBody, originalSubject, provider, timestamp: new Date().toISOString() },
    },
  });

  return NextResponse.json({ ok: true });
}
