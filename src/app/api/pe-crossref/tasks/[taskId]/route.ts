import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { TaskStatus } from "@/lib/pe-crossref/types";
import { computeManualStatusChange, type ManualAction } from "./_lifecycle";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = (await request.json()) as { action: ManualAction; reason?: string };

  const existing = await prisma.peActionTask.findUnique({ where: { id: taskId } });
  if (!existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let change: ReturnType<typeof computeManualStatusChange>;
  try {
    change = computeManualStatusChange({
      currentStatus: existing.status as TaskStatus,
      action: body.action,
      userEmail: session.user.email,
      reason: body.reason,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const updated = await prisma.peActionTask.update({
    where: { id: taskId },
    data: {
      status: change.status,
      resolvedAt: change.resolvedAt,
      resolvedBy: change.resolvedBy,
      manualResolvedAt: change.manualResolvedAt,
      dismissedReason: change.dismissedReason,
    },
  });

  return NextResponse.json({ task: updated });
}
