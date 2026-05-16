import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  if (process.env.PE_FILE_PREP_ENABLED !== "true") {
    return NextResponse.json({ error: "Not enabled" }, { status: 404 });
  }

  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { dealId } = await params;

  const latestRun = await prisma.peAuditRun.findFirst({
    where: { dealId, status: { in: ["completed", "running"] } },
    orderBy: { startedAt: "desc" },
  });

  if (!latestRun) {
    return NextResponse.json({ auditRun: null });
  }

  return NextResponse.json({ auditRun: latestRun });
}
