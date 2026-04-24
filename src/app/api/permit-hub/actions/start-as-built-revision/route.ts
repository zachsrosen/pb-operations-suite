import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-auth";
import {
  completePermitTask,
  recordPermitActivity,
  deletePermitDraft,
  isPermitHubAllowedRole,
  isPermitHubEnabled,
  resolveUserIdByEmail,
} from "@/lib/permit-hub";

const Schema = z.object({
  dealId: z.string().min(1),
  trigger: z.enum(["ahj_requested", "qc_caught", "customer"]),
  scopeNotes: z.string().min(1),
  forceFallback: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  if (!isPermitHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isPermitHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const p = parsed.data;

  const noteBody = [
    `<b>Started as-built revision</b>`,
    `Trigger: ${p.trigger}`,
    `Scope: ${p.scopeNotes}`,
    `By: ${auth.email}`,
  ].join("<br>");

  const result = await completePermitTask({
    dealId: p.dealId,
    actionKind: "START_AS_BUILT_REVISION",
    noteBody,
    fallbackProperties: { permitting_status: "As-Built Revision In Progress" },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordPermitActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "PERMIT_AS_BUILT_STARTED",
    dealId: p.dealId,
    description: `Started as-built revision (${p.trigger})`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deletePermitDraft({
      userId,
      dealId: p.dealId,
      actionKind: "START_AS_BUILT_REVISION",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
