/**
 * POST /api/admin/workflows/import
 *
 * Create a new DRAFT workflow from an exported JSON blob.
 * Body: { exportVersion, workflow: {...} } (shape matches GET /[id]/export)
 *
 * Always creates DRAFT, always clones (never tries to "update in place").
 * Admin can activate after reviewing.
 *
 * ADMIN only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";
import { getActionByKind } from "@/lib/admin-workflows/actions";
import { isControlFlowKind } from "@/lib/admin-workflows/control-flow";
import { getTriggerByKind } from "@/lib/admin-workflows/triggers";

import { WORKFLOW_EXPORT_VERSION } from "@/app/api/admin/workflows/[id]/export/route";

const importSchema = z.object({
  exportVersion: z.number().int().min(1).max(WORKFLOW_EXPORT_VERSION),
  workflow: z.object({
    name: z.string().min(1).max(200),
    description: z.string().nullable().optional(),
    triggerType: z.enum([
      "MANUAL",
      "HUBSPOT_PROPERTY_CHANGE",
      "ZUPER_PROPERTY_CHANGE",
      "CRON",
      "CUSTOM_EVENT",
    ]),
    triggerConfig: z.record(z.string(), z.unknown()),
    definition: z.object({
      steps: z.array(
        z.object({
          id: z.string().min(1),
          kind: z.string().min(1),
          inputs: z.record(z.string(), z.string()),
        }),
      ),
    }),
    maxRunsPerHour: z.number().int().min(0).max(100_000).optional(),
  }),
});

export async function POST(request: NextRequest) {
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

  let body: z.infer<typeof importSchema>;
  try {
    body = importSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid import payload", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Validate trigger
  const trigger = getTriggerByKind(body.workflow.triggerType);
  if (!trigger) {
    return NextResponse.json(
      { error: `Unknown triggerType: ${body.workflow.triggerType}` },
      { status: 400 },
    );
  }

  let normalizedTriggerConfig: object;
  try {
    normalizedTriggerConfig = trigger.configSchema.parse(body.workflow.triggerConfig) as object;
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid trigger config in import", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Validate each step kind exists (reject imports that reference actions
  // not available in this environment)
  for (const stepDef of body.workflow.definition.steps) {
    if (!getActionByKind(stepDef.kind) && !isControlFlowKind(stepDef.kind)) {
      return NextResponse.json(
        { error: `Unknown action kind in import: ${stepDef.kind}` },
        { status: 400 },
      );
    }
  }

  const created = await prisma.adminWorkflow.create({
    data: {
      name: `${body.workflow.name} (imported)`,
      description: body.workflow.description ?? null,
      status: "DRAFT",
      triggerType: body.workflow.triggerType,
      triggerConfig: normalizedTriggerConfig,
      definition: body.workflow.definition as object,
      maxRunsPerHour: body.workflow.maxRunsPerHour ?? 60,
      createdById: user.id,
    },
  });

  return NextResponse.json({ workflow: created });
}
