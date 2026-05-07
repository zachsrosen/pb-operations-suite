import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const sites = await prisma.powerhubSite.findMany({
    orderBy: { siteName: "asc" },
    include: {
      telemetrySnapshot: true,
      alerts: {
        where: { isActive: true },
        select: { id: true, severity: true, alertName: true },
      },
    },
  });

  return NextResponse.json({ sites });
}
