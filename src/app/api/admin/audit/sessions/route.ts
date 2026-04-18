import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }
  const currentUser = await getUserByEmail(authSession.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("id");
  if (!sessionId) {
    return NextResponse.json({ error: "Session ID required" }, { status: 400 });
  }

  const session = await prisma.auditSession.findUnique({
    where: { id: sessionId },
    include: {
      activities: {
        orderBy: { createdAt: "asc" },
        take: 200,
      },
      anomalyEvents: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ session });
}
