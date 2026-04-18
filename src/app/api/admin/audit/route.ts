import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);
  const environment = searchParams.get("environment");
  const clientType = searchParams.get("clientType");
  const minRisk = parseInt(searchParams.get("minRisk") || "0");
  const email = searchParams.get("email");
  const sinceParam = searchParams.get("since");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (environment) where.environment = environment;
  if (clientType) where.clientType = clientType;
  if (minRisk > 0) where.riskScore = { gte: minRisk };
  if (email) where.userEmail = { contains: email, mode: "insensitive" };
  if (sinceParam) {
    const since = new Date(sinceParam);
    if (!isNaN(since.getTime())) where.startedAt = { gte: since };
  }

  // Stats mode for metric cards
  if (searchParams.get("meta") === "stats") {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalToday, anomalyCount, activeSessions, envBreakdown] = await Promise.all([
      prisma.auditSession.count({ where: { startedAt: { gte: todayStart } } }),
      prisma.auditAnomalyEvent.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.auditSession.count({
        where: { endedAt: null, lastActiveAt: { gte: fiveMinAgo } },
      }),
      prisma.auditSession.groupBy({
        by: ["environment"],
        where: { startedAt: { gte: todayStart } },
        _count: true,
      }),
    ]);

    return NextResponse.json({
      totalToday,
      anomalyCount,
      activeSessions,
      envBreakdown: envBreakdown.map((e: { environment: string; _count: number }) => ({ environment: e.environment, count: e._count })),
    });
  }

  const [sessions, total] = await Promise.all([
    prisma.auditSession.findMany({
      where,
      include: {
        _count: { select: { activities: true, anomalyEvents: true } },
      },
      orderBy: { startedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditSession.count({ where }),
  ]);

  return NextResponse.json({ sessions, total, limit, offset });
}
