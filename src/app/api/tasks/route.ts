import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  fetchTasksForDeal,
  completeTask,
  addTaskNote,
  HubSpotTaskStatus,
} from "@/lib/hubspot";

export const runtime = "nodejs";

/**
 * GET /api/tasks?dealId=<id>&status=<status>
 *
 * Fetch HubSpot tasks associated with a deal.
 *   - dealId (required): HubSpot deal ID
 *   - status (optional): filter by task status (NOT_STARTED, IN_PROGRESS, COMPLETED, WAITING, DEFERRED)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");
  const status = searchParams.get("status") as HubSpotTaskStatus | null;

  if (!dealId) {
    return NextResponse.json(
      { error: "Missing required query parameter: dealId" },
      { status: 400 }
    );
  }

  const validStatuses: HubSpotTaskStatus[] = [
    "NOT_STARTED",
    "IN_PROGRESS",
    "COMPLETED",
    "WAITING",
    "DEFERRED",
  ];

  if (status && !validStatuses.includes(status)) {
    return NextResponse.json(
      {
        error: `Invalid status filter: "${status}". Must be one of: ${validStatuses.join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const tasks = await fetchTasksForDeal(dealId, status || undefined);

    return NextResponse.json({
      dealId,
      tasks,
      count: tasks.length,
    });
  } catch (error) {
    console.error("[API /tasks] Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks for deal" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tasks
 *
 * Update a HubSpot task.
 * Body: { taskId: string, action: "complete" | "add_note", notes?: string }
 *   - action "complete": marks the task as completed, optionally with notes
 *   - action "add_note": appends notes to the task body (notes required)
 */
export async function PATCH(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  let body: { taskId?: string; action?: string; notes?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { taskId, action, notes } = body;

  if (!taskId) {
    return NextResponse.json(
      { error: "Missing required field: taskId" },
      { status: 400 }
    );
  }

  if (!action || !["complete", "add_note"].includes(action)) {
    return NextResponse.json(
      { error: 'Missing or invalid action. Must be "complete" or "add_note"' },
      { status: 400 }
    );
  }

  if (action === "add_note" && !notes) {
    return NextResponse.json(
      { error: 'Field "notes" is required for action "add_note"' },
      { status: 400 }
    );
  }

  try {
    let task;

    if (action === "complete") {
      task = await completeTask(taskId, notes);
    } else {
      task = await addTaskNote(taskId, notes!);
    }

    return NextResponse.json({
      success: true,
      taskId,
      action,
      task,
    });
  } catch (error) {
    console.error(`[API /tasks] Error performing ${action} on task ${taskId}:`, error);
    return NextResponse.json(
      { error: `Failed to ${action} task` },
      { status: 500 }
    );
  }
}
