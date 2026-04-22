/**
 * GET /api/admin/workflows/runs/[runId] — Fetch a single run with full detail
 * including trigger context, per-step outputs (as a JSON tree), and timing.
 *
 * ADMIN only.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

export async function GET(
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
    include: {
      workflow: {
        select: {
          id: true,
          name: true,
          triggerType: true,
          definition: true,
        },
      },
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ run });
}
