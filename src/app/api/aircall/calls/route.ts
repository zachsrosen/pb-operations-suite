import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";
import { isFlagEnabled, parseFilter } from "../_filter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isFlagEnabled()) {
    return NextResponse.json({ error: "Aircall dashboard is disabled" }, { status: 404 });
  }
  try {
    await requireRole("ADMIN", "OWNER", "EXECUTIVE");
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = parseFilter(req);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const f = parsed.filter;

  const where: Record<string, unknown> = {
    provider: "aircall",
    startedAt: { gte: f.from, lt: f.to },
  };
  if (f.direction) where.direction = f.direction;
  if (f.status?.length) where.status = { in: f.status };
  if (f.userIds?.length) where.userAircallId = { in: f.userIds };

  const [total, rows] = await Promise.all([
    prisma.aircallCallCache.count({ where }),
    prisma.aircallCallCache.findMany({
      where,
      orderBy: { [f.sort]: f.order },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true,
        direction: true,
        status: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
        talkTimeSec: true,
        timeToAnswerSec: true,
        userAircallId: true,
        userName: true,
        customerNumber: true,
      },
    }),
  ]);

  return NextResponse.json({
    calls: rows.map((r) => ({
      ...r,
      startedAt: r.startedAt.toISOString(),
      endedAt: r.endedAt?.toISOString() ?? null,
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
  });
}
