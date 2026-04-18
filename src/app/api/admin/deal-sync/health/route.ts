import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import type { DealPipeline } from "@/generated/prisma/enums";

const ALL_PIPELINES: DealPipeline[] = ["PROJECT", "SALES", "DNR", "SERVICE", "ROOFING"];

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const currentUser = await getUserByEmail(session.user.email);
  const hasAccess = !!currentUser?.roles?.some((r) => r === "ADMIN" || r === "OWNER");
  if (!currentUser || !hasAccess) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const pipelines = await Promise.all(
    ALL_PIPELINES.map(async (pipeline) => {
      const [dealCount, lastSync, recentErrors] = await Promise.all([
        prisma.deal.count({ where: { pipeline } }),
        prisma.dealSyncLog.findFirst({
          where: { source: { startsWith: `batch:${pipeline}` }, status: "SUCCESS" },
          orderBy: { createdAt: "desc" },
        }),
        prisma.dealSyncLog.count({
          where: {
            source: { startsWith: `batch:${pipeline}` },
            status: "FAILED",
            createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
          },
        }),
      ]);

      const watermarkKey = `deal-sync:watermark:${pipeline}`;
      const watermark = await prisma.systemConfig.findUnique({ where: { key: watermarkKey } });

      return {
        pipeline,
        dealCount,
        lastSyncAt: lastSync?.createdAt ?? null,
        lastSyncDurationMs: lastSync?.durationMs ?? null,
        recentErrors,
        watermark: watermark?.value ?? null,
      };
    })
  );

  return NextResponse.json({ pipelines, timestamp: new Date().toISOString() });
}
