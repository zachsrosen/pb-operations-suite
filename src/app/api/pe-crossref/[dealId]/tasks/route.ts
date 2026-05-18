import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { dealId } = await params;

  const [tasks, latestRun] = await Promise.all([
    prisma.peActionTask.findMany({
      where: { dealId },
      orderBy: [{ status: "asc" }, { severity: "asc" }, { createdAt: "asc" }],
    }),
    prisma.crossRefRun.findFirst({
      where: { dealId, status: "completed" },
      orderBy: { startedAt: "desc" },
      select: { id: true, completedAt: true, triggeredBy: true, durationMs: true },
    }),
  ]);

  return NextResponse.json({ tasks, latestRun });
}
