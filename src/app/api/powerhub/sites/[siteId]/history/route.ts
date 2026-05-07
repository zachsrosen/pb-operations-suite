import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const { siteId } = await params;
  const url = new URL(request.url);
  const signals = url.searchParams.get("signals")?.split(",") || [];
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");

  const where: any = { siteId };
  if (signals.length > 0) {
    where.signalName = { in: signals };
  }
  if (start || end) {
    where.timestamp = {};
    if (start) where.timestamp.gte = new Date(start);
    if (end) where.timestamp.lte = new Date(end);
  }

  const history = await prisma.powerhubTelemetryHistory.findMany({
    where,
    orderBy: { timestamp: "desc" },
    take: 1000,
  });

  return NextResponse.json({ history });
}
