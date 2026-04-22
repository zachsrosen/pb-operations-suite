/**
 * POST /api/admin/workflows/runs/[runId]/mark-failed
 *
 * Admin action to manually mark a stuck RUNNING row as FAILED. Useful
 * for orphaned runs caused by Inngest function unregistration or
 * worker crashes, when you don't want to wait for the cleanup cron.
 *
 * ADMIN only. No-ops if the run is already in a terminal state.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { runId } = await params;
  const run = await prisma.adminWorkflowRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  if (run.status !== "RUNNING") {
    return NextResponse.json(
      { error: `Run is ${run.status}; cannot mark failed` },
      { status: 400 },
    );
  }

  await prisma.adminWorkflowRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      errorMessage: `Manually marked FAILED by ${session.user.email}.`,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
