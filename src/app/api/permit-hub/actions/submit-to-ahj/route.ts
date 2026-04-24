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
  submissionDate: z.string(),
  method: z.enum(["portal", "paper", "solarapp_plus", "other"]),
  referenceNumber: z.string().optional(),
  feePaid: z.boolean().optional(),
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
    `<b>Submitted to AHJ</b>`,
    `Date: ${p.submissionDate}`,
    `Method: ${p.method}`,
    p.referenceNumber ? `Reference #: ${p.referenceNumber}` : null,
    p.feePaid !== undefined ? `Permit fee paid: ${p.feePaid ? "Yes" : "No"}` : null,
    p.notes ? `Notes: ${p.notes}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completePermitTask({
    dealId: p.dealId,
    actionKind: "SUBMIT_TO_AHJ",
    noteBody,
    fallbackProperties: {
      permit_submit: p.submissionDate,
      permitting_status: "Submitted to AHJ",
    },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordPermitActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "PERMIT_SUBMITTED",
    dealId: p.dealId,
    description: `Submitted permit to AHJ (${p.method}${p.referenceNumber ? `, ref ${p.referenceNumber}` : ""})`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deletePermitDraft({
      userId,
      dealId: p.dealId,
      actionKind: "SUBMIT_TO_AHJ",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
