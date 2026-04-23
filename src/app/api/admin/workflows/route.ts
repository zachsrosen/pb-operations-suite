/**
 * POST /api/admin/workflows — Create a new admin workflow (DRAFT).
 *
 * ADMIN role only. Returns the created workflow row.
 *
 * Body:
 *   {
 *     name: string,
 *     description?: string,
 *     triggerType: AdminWorkflowTriggerType,
 *     triggerConfig: object,
 *     definition: { steps: [...] }
 *   }
 *
 * Phase 1 scope: create only. List / update / delete ship with the UI PR.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";
import {
  getActionByKind,
} from "@/lib/admin-workflows/actions";
import { isControlFlowKind } from "@/lib/admin-workflows/control-flow";
import {
  getTriggerByKind,
} from "@/lib/admin-workflows/triggers";
import type { AdminWorkflowTriggerType } from "@/generated/prisma/enums";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  triggerType: z.enum([
    "MANUAL",
    "HUBSPOT_PROPERTY_CHANGE",
    "ZUPER_PROPERTY_CHANGE",
    "CRON",
  ] as const satisfies readonly AdminWorkflowTriggerType[]),
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
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  if (!user.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid body", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Validate trigger config against the trigger's schema
  const trigger = getTriggerByKind(body.triggerType);
  if (!trigger) {
    return NextResponse.json({ error: `Unknown triggerType: ${body.triggerType}` }, { status: 400 });
  }
  let normalizedTriggerConfig: object;
  try {
    normalizedTriggerConfig = trigger.configSchema.parse(body.triggerConfig) as object;
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid trigger config", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Validate each step's action kind exists (regular actions OR control-flow)
  for (const stepDef of body.definition.steps) {
    if (!getActionByKind(stepDef.kind) && !isControlFlowKind(stepDef.kind)) {
      return NextResponse.json(
        { error: `Unknown action kind: ${stepDef.kind}` },
        { status: 400 },
      );
    }
  }

  const created = await prisma.adminWorkflow.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      triggerType: body.triggerType,
      triggerConfig: normalizedTriggerConfig,
      definition: body.definition as object,
      createdById: user.id,
      status: "DRAFT",
    },
  });

  return NextResponse.json({ workflow: created });
}

/**
 * GET /api/admin/workflows — List all workflows (ADMIN only).
 * Simple, no pagination (expect <100 workflows).
 */
export async function GET() {
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

  const workflows = await prisma.adminWorkflow.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      triggerType: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { email: true, name: true } },
      _count: { select: { runs: true } },
    },
  });

  return NextResponse.json({ workflows });
}
