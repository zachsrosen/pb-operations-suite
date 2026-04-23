/**
 * GET /api/admin/workflows/[id]/versions
 *
 * List saved versions (edit history) for a workflow, newest first.
 * Limited to 50 most recent. ADMIN only.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

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
  const versions = await prisma.adminWorkflowVersion.findMany({
    where: { workflowId: id },
    orderBy: { version: "desc" },
    take: 50,
    select: {
      id: true,
      version: true,
      savedByEmail: true,
      note: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ versions });
}
