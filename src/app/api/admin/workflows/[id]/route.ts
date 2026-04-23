/**
 * GET /api/admin/workflows/[id] — Fetch a single workflow with recent runs.
 * PATCH /api/admin/workflows/[id] — Update fields (status / name / triggerConfig / definition).
 * DELETE /api/admin/workflows/[id] — Hard delete. Consider ARCHIVED status for soft delete.
 *
 * ADMIN only.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";
import { getActionByKind } from "@/lib/admin-workflows/actions";
import { isControlFlowKind } from "@/lib/admin-workflows/control-flow";
import { getTriggerByKind } from "@/lib/admin-workflows/triggers";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) return { error: NextResponse.json({ error: "Admin required" }, { status: 403 }) };
  return { user, session };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  const workflow = await prisma.adminWorkflow.findUnique({
    where: { id },
    include: {
      createdBy: { select: { email: true, name: true } },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          triggeredByEmail: true,
          triggerContext: true,
          result: true,
          errorMessage: true,
          durationMs: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });

  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  return NextResponse.json({ workflow });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  maxRunsPerHour: z.number().int().min(0).max(100_000).optional(),
  definition: z.object({
    steps: z.array(
      z.object({
        id: z.string().min(1),
        kind: z.string().min(1),
        inputs: z.record(z.string(), z.string()),
      }),
    ),
  }).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const authResult = await requireAdmin();
  if ("error" in authResult) return authResult.error;
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Validate definition.steps if present (regular actions OR control-flow)
  if (body.definition) {
    for (const step of body.definition.steps) {
      if (!getActionByKind(step.kind) && !isControlFlowKind(step.kind)) {
        return NextResponse.json(
          { error: `Unknown action kind: ${step.kind}` },
          { status: 400 },
        );
      }
    }
  }

  // If changing triggerConfig, validate it against the existing trigger's schema.
  // Keep the PARSED version — it may have coerced types (e.g. comma-separated
  // string → string[]) so the stored data always matches the schema.
  let normalizedTriggerConfig: object | undefined;
  if (body.triggerConfig) {
    const existing = await prisma.adminWorkflow.findUnique({
      where: { id },
      select: { triggerType: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }
    const trigger = getTriggerByKind(existing.triggerType);
    if (trigger) {
      try {
        normalizedTriggerConfig = trigger.configSchema.parse(body.triggerConfig) as object;
      } catch (e) {
        return NextResponse.json(
          { error: "Invalid trigger config", detail: e instanceof Error ? e.message : String(e) },
          { status: 400 },
        );
      }
    } else {
      normalizedTriggerConfig = body.triggerConfig as object;
    }
  }

  const updated = await prisma.adminWorkflow.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.maxRunsPerHour !== undefined ? { maxRunsPerHour: body.maxRunsPerHour } : {}),
      ...(normalizedTriggerConfig !== undefined ? { triggerConfig: normalizedTriggerConfig } : {}),
      ...(body.definition !== undefined ? { definition: body.definition as object } : {}),
    },
  });

  return NextResponse.json({ workflow: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const authResult = await requireAdmin();
  if ("error" in authResult) return authResult.error;
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { id } = await params;
  await prisma.adminWorkflow.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
