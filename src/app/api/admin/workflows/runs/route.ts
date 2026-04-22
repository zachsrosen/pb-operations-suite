/**
 * GET /api/admin/workflows/runs
 *
 * List recent admin workflow runs across all workflows with optional
 * filters. ADMIN only. Returns the 100 most recent matching rows —
 * tighter than paginating for now; bump or paginate when needed.
 *
 * Query params:
 *   - workflowId: filter to one workflow
 *   - status: RUNNING | SUCCEEDED | FAILED
 *   - since: ISO timestamp; only runs after this
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

export async function GET(request: NextRequest) {
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

  const url = new URL(request.url);
  const workflowId = url.searchParams.get("workflowId") || undefined;
  const status = url.searchParams.get("status") || undefined;
  const since = url.searchParams.get("since") || undefined;

  const where: {
    workflowId?: string;
    status?: "RUNNING" | "SUCCEEDED" | "FAILED";
    startedAt?: { gt: Date };
  } = {};
  if (workflowId) where.workflowId = workflowId;
  if (status === "RUNNING" || status === "SUCCEEDED" || status === "FAILED") {
    where.status = status;
  }
  if (since) {
    const d = new Date(since);
    if (!isNaN(d.getTime())) where.startedAt = { gt: d };
  }

  const runs = await prisma.adminWorkflowRun.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 100,
    select: {
      id: true,
      workflowId: true,
      status: true,
      triggeredByEmail: true,
      durationMs: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
      workflow: { select: { name: true, triggerType: true } },
    },
  });

  return NextResponse.json({ runs });
}
