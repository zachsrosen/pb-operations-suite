import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { createHubspotTaskForAssignment } from "@/lib/shit-show/hubspot-task";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const assignments = await prisma.shitShowAssignment.findMany({
    where: { sessionItemId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ assignments });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json()) as {
    assigneeUserId?: string;
    dueDate?: string | null;
    actionText?: string;
  };
  if (!body.assigneeUserId || !body.actionText) {
    return NextResponse.json(
      { error: "assigneeUserId and actionText required" },
      { status: 400 },
    );
  }

  const item = await prisma.shitShowSessionItem.findUnique({
    where: { id },
    select: { dealId: true },
  });
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const assignment = await prisma.shitShowAssignment.create({
    data: {
      sessionItemId: id,
      assigneeUserId: body.assigneeUserId,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      actionText: body.actionText,
      createdBy: auth.email,
    },
  });

  // Best-effort HubSpot task creation
  try {
    const assignedUser = await prisma.user.findUnique({
      where: { id: body.assigneeUserId },
      select: { email: true, name: true },
    });
    const taskId = await createHubspotTaskForAssignment({
      dealId: item.dealId,
      assigneeHubspotOwnerId: null, // future: lookup HubSpot owner from email
      subject: `Shit Show follow-up: ${assignment.actionText.slice(0, 50)}`,
      body: `${assignment.actionText}\n\nAssigned to: ${assignedUser?.email ?? "unknown"}`,
      dueDate: assignment.dueDate,
    });
    if (taskId) {
      await prisma.shitShowAssignment.update({
        where: { id: assignment.id },
        data: { hubspotTaskId: taskId, taskSyncStatus: "SYNCED" },
      });
    } else {
      await prisma.shitShowAssignment.update({
        where: { id: assignment.id },
        data: {
          taskSyncStatus: "FAILED",
          taskSyncError: "task create returned null",
        },
      });
    }
  } catch (e) {
    await prisma.shitShowAssignment.update({
      where: { id: assignment.id },
      data: {
        taskSyncStatus: "FAILED",
        taskSyncError: e instanceof Error ? e.message : String(e),
      },
    });
  }

  const final = await prisma.shitShowAssignment.findUnique({
    where: { id: assignment.id },
  });
  return NextResponse.json({ assignment: final });
}
