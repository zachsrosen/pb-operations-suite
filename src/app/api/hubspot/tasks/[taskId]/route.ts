/**
 * PATCH /api/hubspot/tasks/[taskId]
 *
 * Updates a HubSpot task. Used by the my-tasks page for:
 *   - snooze / reschedule → { dueAt: ISO | null }
 *   - reopen a completed task → { status: "NOT_STARTED" }
 *   - edit priority/subject/body
 *
 * Does NOT handle completion — use /complete for optimistic semantics.
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { appCache } from "@/lib/cache";
import { updateTask, type UpdateTaskInput } from "@/lib/hubspot-tasks";

const ALLOWED_STATUS = new Set(["NOT_STARTED", "IN_PROGRESS", "WAITING", "DEFERRED"]);
const ALLOWED_PRIORITY = new Set(["HIGH", "MEDIUM", "LOW"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  if (!/^\d{1,20}$/.test(taskId)) {
    return NextResponse.json({ error: "Invalid task id" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: UpdateTaskInput = {};

  if ("dueAt" in body) {
    const raw = body.dueAt;
    if (raw === null) patch.dueAt = null;
    else if (typeof raw === "string" && !isNaN(new Date(raw).getTime())) patch.dueAt = new Date(raw).toISOString();
    else return NextResponse.json({ error: "dueAt must be an ISO string or null" }, { status: 400 });
  }

  if ("status" in body) {
    if (typeof body.status !== "string" || !ALLOWED_STATUS.has(body.status)) {
      return NextResponse.json({ error: `status must be one of ${[...ALLOWED_STATUS].join(", ")}` }, { status: 400 });
    }
    patch.status = body.status as UpdateTaskInput["status"];
  }

  if ("priority" in body) {
    const raw = body.priority;
    if (raw === null) patch.priority = null;
    else if (typeof raw === "string" && ALLOWED_PRIORITY.has(raw)) patch.priority = raw as UpdateTaskInput["priority"];
    else return NextResponse.json({ error: "priority must be HIGH, MEDIUM, LOW, or null" }, { status: 400 });
  }

  if ("subject" in body) {
    if (typeof body.subject !== "string" || body.subject.trim().length === 0) {
      return NextResponse.json({ error: "subject must be a non-empty string" }, { status: 400 });
    }
    patch.subject = body.subject.trim().slice(0, 500);
  }

  if ("body" in body) {
    if (typeof body.body !== "string") {
      return NextResponse.json({ error: "body must be a string" }, { status: 400 });
    }
    patch.body = body.body.slice(0, 10_000);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    await updateTask(taskId, patch);
    appCache.invalidateByPrefix("hubspot:tasks:owner:");
    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { module: "api.hubspot.tasks.patch", taskId } });
    return NextResponse.json({ error: "Failed to update task" }, { status: 502 });
  }
}
