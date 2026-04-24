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
  resubmissionDate: z.string(),
  referenceNumber: z.string().optional(),
  whatChanged: z.string().min(1),
  notes: z.string().optional(),
  forceFallback: z.boolean().optional(),
  asBuilt: z.boolean().optional(),
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
    `<b>${p.asBuilt ? "Resubmitted as-built to AHJ" : "Resubmitted to AHJ"}</b>`,
    `Date: ${p.resubmissionDate}`,
    p.referenceNumber ? `Reference #: ${p.referenceNumber}` : null,
    `What changed: ${p.whatChanged}`,
    p.notes ? `Notes: ${p.notes}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completePermitTask({
    dealId: p.dealId,
    actionKind: "RESUBMIT_TO_AHJ",
    noteBody,
    fallbackProperties: {
      permit_submit: p.resubmissionDate,
      permitting_status: p.asBuilt
        ? "As-Built Revision Resubmitted"
        : "Resubmitted to AHJ",
    },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordPermitActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "PERMIT_RESUBMITTED",
    dealId: p.dealId,
    description: `Resubmitted permit to AHJ — ${p.whatChanged.slice(0, 80)}`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deletePermitDraft({ userId, dealId: p.dealId, actionKind: "RESUBMIT_TO_AHJ" });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
