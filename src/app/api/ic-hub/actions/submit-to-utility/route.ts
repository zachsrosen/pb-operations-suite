import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/api-auth";
import {
  completeIcTask,
  recordIcActivity,
  deleteIcDraft,
  isIcHubAllowedRole,
  isIcHubEnabled,
  resolveUserIdByEmail,
} from "@/lib/ic-hub";

const Schema = z.object({
  dealId: z.string().min(1),
  submissionDate: z.string(),
  referenceNumber: z.string().optional(),
  notes: z.string().optional(),
  forceFallback: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  if (!isIcHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!auth.roles.some((r) => isIcHubAllowedRole(r))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const p = parsed.data;

  const noteBody = [
    `<b>Submitted to Utility</b>`,
    `Date: ${p.submissionDate}`,
    p.referenceNumber ? `Reference #: ${p.referenceNumber}` : null,
    p.notes ? `Notes: ${p.notes}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completeIcTask({
    dealId: p.dealId,
    actionKind: "SUBMIT_TO_UTILITY",
    noteBody,
    fallbackProperties: {
      interconnection_status: "Submitted To Utility",
    },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordIcActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "IC_SUBMITTED",
    dealId: p.dealId,
    description: `Submitted interconnection application${p.referenceNumber ? ` (ref ${p.referenceNumber})` : ""}`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deleteIcDraft({
      userId,
      dealId: p.dealId,
      actionKind: "SUBMIT_TO_UTILITY",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
