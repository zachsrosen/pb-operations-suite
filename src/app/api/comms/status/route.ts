import { NextResponse } from "next/server";
import { getActualCommsUser } from "@/lib/comms-auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const { user, blocked } = await getActualCommsUser();
  if (blocked) {
    return NextResponse.json({ connected: false, impersonating: true });
  }
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const token = await prisma.commsGmailToken.findUnique({
    where: { userId: user.id },
    select: { chatEnabled: true, scopes: true, createdAt: true },
  });

  return NextResponse.json({
    connected: !!token,
    chatEnabled: token?.chatEnabled ?? false,
    connectedAt: token?.createdAt ?? null,
  });
}
