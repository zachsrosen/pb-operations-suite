import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);
  const rule = searchParams.get("rule");
  const acknowledged = searchParams.get("acknowledged");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  if (rule) where.rule = rule;
  if (acknowledged === "true") where.acknowledgedAt = { not: null };
  if (acknowledged === "false") where.acknowledgedAt = null;

  const [alerts, total] = await Promise.all([
    prisma.auditAnomalyEvent.findMany({
      where,
      include: {
        session: {
          select: {
            id: true,
            userEmail: true,
            clientType: true,
            environment: true,
            ipAddress: true,
            riskScore: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditAnomalyEvent.count({ where }),
  ]);

  return NextResponse.json({ alerts, total, limit, offset });
}

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { alertId, note } = body;
  if (!alertId) {
    return NextResponse.json({ error: "alertId required" }, { status: 400 });
  }

  const updated = await prisma.auditAnomalyEvent.update({
    where: { id: alertId },
    data: {
      acknowledgedAt: new Date(),
      acknowledgedBy: currentUser.id,
      acknowledgeNote: note || null,
    },
  });

  await logActivity({
    type: "FEATURE_USED",
    description: `Acknowledged audit alert: ${updated.rule} (session ${updated.sessionId})`,
    userEmail: session.user.email,
    userName: session.user.name || undefined,
    entityType: "audit_alert",
    entityId: alertId,
    metadata: { rule: updated.rule, sessionId: updated.sessionId, note },
  });

  return NextResponse.json({ alert: updated });
}
