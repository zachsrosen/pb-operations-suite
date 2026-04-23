/**
 * GET /api/admin/workflows/[id]/export
 *
 * Returns a JSON blob representing the workflow, suitable for archiving,
 * cross-environment migration, or version control. Excludes runs and
 * DB-internal fields (id, createdBy, timestamps).
 *
 * The shape matches what POST /api/admin/workflows/import accepts.
 *
 * ADMIN only.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

export const WORKFLOW_EXPORT_VERSION = 1;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  const { id } = await params;
  const workflow = await prisma.adminWorkflow.findUnique({
    where: { id },
    select: {
      name: true,
      description: true,
      triggerType: true,
      triggerConfig: true,
      definition: true,
      maxRunsPerHour: true,
    },
  });
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const payload = {
    exportVersion: WORKFLOW_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    exportedBy: session.user.email,
    workflow,
  };

  const filename = `workflow-${workflow.name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
