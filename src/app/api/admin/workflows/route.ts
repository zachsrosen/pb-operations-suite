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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";
import {
  getActionByKind,
} from "@/lib/admin-workflows/actions";
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
  try {
    trigger.configSchema.parse(body.triggerConfig);
  } catch (e) {
    return NextResponse.json(
      { error: "Invalid trigger config", detail: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }

  // Validate each step's action kind exists
  for (const stepDef of body.definition.steps) {
    if (!getActionByKind(stepDef.kind)) {
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
      triggerConfig: body.triggerConfig as object,
      definition: body.definition as object,
      createdById: user.id,
      status: "DRAFT",
    },
  });

  return NextResponse.json({ workflow: created });
}
