import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ siteId: string }> }
) {
  if (process.env.POWERHUB_ENABLED !== "true") {
    return NextResponse.json({ error: "PowerHub disabled" }, { status: 404 });
  }

  const { siteId } = await params;

  const alerts = await prisma.powerhubAlert.findMany({
    where: { siteId },
    orderBy: { reportedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ alerts });
}
