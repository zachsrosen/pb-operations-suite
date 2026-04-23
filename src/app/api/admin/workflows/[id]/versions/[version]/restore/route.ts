/**
 * POST /api/admin/workflows/[id]/versions/[version]/restore
 *
 * Roll a workflow back to a previous version. Creates a NEW version
 * row from the restored snapshot so the rollback is itself recorded.
 *
 * ADMIN only. Always resets status to DRAFT as a safety measure —
 * admin must re-activate.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";
import { snapshotWorkflow } from "@/lib/admin-workflows/versioning";

interface Snapshot {
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: unknown;
  definition: unknown;
  maxRunsPerHour: number;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> },
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

  const { id, version: versionStr } = await params;
  const version = parseInt(versionStr, 10);
  if (!Number.isFinite(version) || version < 1) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }

  const row = await prisma.adminWorkflowVersion.findUnique({
    where: { workflowId_version: { workflowId: id, version } },
  });
  if (!row) {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  const snap = row.snapshot as unknown as Snapshot;

  const updated = await prisma.adminWorkflow.update({
    where: { id },
    data: {
      name: snap.name,
      description: snap.description,
      triggerConfig: snap.triggerConfig as object,
      definition: snap.definition as object,
      maxRunsPerHour: snap.maxRunsPerHour,
      // Safety: rollback never auto-reactivates
      status: "DRAFT",
    },
  });

  // Record the rollback as its own new version
  await snapshotWorkflow({
    workflowId: id,
    savedByEmail: session.user.email,
    note: `Restored from version ${version}`,
    snapshot: {
      name: updated.name,
      description: updated.description,
      triggerType: updated.triggerType,
      triggerConfig: updated.triggerConfig,
      definition: updated.definition,
      maxRunsPerHour: updated.maxRunsPerHour,
    },
  });

  return NextResponse.json({ workflow: updated, restoredFromVersion: version });
}
