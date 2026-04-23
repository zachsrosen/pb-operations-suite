/**
 * POST /api/admin/workflows/[id]/run — Trigger a manual workflow run.
 *
 * ADMIN role only. Creates an AdminWorkflowRun row, emits the Inngest event,
 * and returns the run ID. The executor function picks it up async.
 *
 * Body (optional):
 *   { triggerContext?: Record<string, unknown> }
 * Use this to pass in test data for HUBSPOT_PROPERTY_CHANGE / etc. triggers
 * even when firing manually.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import {
  adminWorkflowRunRequested,
  inngest,
  isAdminWorkflowsEnabled,
} from "@/lib/inngest-client";

const runSchema = z.object({
  triggerContext: z.record(z.string(), z.unknown()).optional(),
  /** When true, the executor skips external side effects. */
  dryRun: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
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
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  if (!user.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const { id } = await params;

  let body: z.infer<typeof runSchema> = {};
  try {
    // Body is optional — allow empty
    const raw = await request.text();
    if (raw.trim().length > 0) {
      body = runSchema.parse(JSON.parse(raw));
    }
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  const workflow = await prisma.adminWorkflow.findUnique({
    where: { id },
    select: { id: true, status: true, triggerType: true },
  });
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  // Create the run row first so the executor has something to update.
  // We accept DRAFT runs from manual triggers (admin testing); webhook
  // fan-out will filter to ACTIVE only.
  const triggerContext = body.triggerContext ?? {};
  const run = await prisma.adminWorkflowRun.create({
    data: {
      workflowId: id,
      status: "RUNNING",
      triggeredByEmail: session.user.email,
      triggerContext: triggerContext as object,
    },
  });

  // ACTIVE required for real runs. DRY RUN bypasses this so admins can
  // test DRAFT workflows safely before flipping to ACTIVE.
  if (workflow.status !== "ACTIVE" && !body.dryRun) {
    await prisma.adminWorkflowRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorMessage: `Workflow is ${workflow.status}; set status=ACTIVE to run (or use Dry run)`,
        completedAt: new Date(),
      },
    });
    return NextResponse.json(
      {
        error: `Workflow is ${workflow.status}; set status=ACTIVE to run (or use Dry run)`,
        runId: run.id,
      },
      { status: 400 },
    );
  }

  await inngest.send(
    adminWorkflowRunRequested.create({
      runId: run.id,
      workflowId: id,
      triggeredByEmail: session.user.email,
      triggerContext,
      ...(body.dryRun ? { dryRun: true } : {}),
    }),
  );

  return NextResponse.json({ runId: run.id, status: "queued" });
}
