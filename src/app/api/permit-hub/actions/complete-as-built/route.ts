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
  completionDate: z.string(),
  updatedPlansetUrl: z.string().url().optional(),
  notes: z.string().optional(),
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
    `<b>Completed as-built — ready to resubmit</b>`,
    `Completion date: ${p.completionDate}`,
    p.updatedPlansetUrl ? `Updated planset: ${p.updatedPlansetUrl}` : null,
    p.notes ? `Notes: ${p.notes}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completePermitTask({
    dealId: p.dealId,
    actionKind: "COMPLETE_AS_BUILT",
    noteBody,
    fallbackProperties: { permitting_status: "As-Built Ready To Resubmit" },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordPermitActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "PERMIT_AS_BUILT_COMPLETED",
    dealId: p.dealId,
    description: "Completed as-built revision",
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deletePermitDraft({
      userId,
      dealId: p.dealId,
      actionKind: "COMPLETE_AS_BUILT",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
