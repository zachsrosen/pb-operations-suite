/**
 * POST /api/admin/workflows/[id]/duplicate
 *
 * Creates a DRAFT copy of the source workflow with a prefixed name.
 * Useful for creating variants without editing a live ACTIVE workflow.
 *
 * ADMIN only. Never copies the source's runs.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

export async function POST(
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
  const source = await prisma.adminWorkflow.findUnique({
    where: { id },
    select: {
      name: true,
      description: true,
      triggerType: true,
      triggerConfig: true,
      definition: true,
    },
  });
  if (!source) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const copy = await prisma.adminWorkflow.create({
    data: {
      name: `Copy of ${source.name}`,
      description: source.description,
      status: "DRAFT",
      triggerType: source.triggerType,
      triggerConfig: source.triggerConfig as object,
      definition: source.definition as object,
      createdById: user.id,
    },
  });

  return NextResponse.json({ workflow: copy });
}
