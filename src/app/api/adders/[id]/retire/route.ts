import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { retireAdder } from "@/lib/adders/catalog";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // TODO(session-type): canManageAdders not yet on Session type.
  if (!(session.user as unknown as { canManageAdders?: boolean }).canManageAdders) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  // TODO(session-type): session.user.id typed optional; runtime guaranteed.
  const adder = await retireAdder(id, { userId: session.user.id as string, reason });
  return NextResponse.json({ adder });
}
