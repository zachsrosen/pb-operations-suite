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
  sentDate: z.string(),
  infoRequested: z.string().min(1),
  whatWasSent: z.string().min(1),
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
    `<b>Information provided to utility</b>`,
    `Sent date: ${p.sentDate}`,
    `Requested: ${p.infoRequested}`,
    `Sent: ${p.whatWasSent}`,
    p.notes ? `Notes: ${p.notes}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completeIcTask({
    dealId: p.dealId,
    actionKind: "PROVIDE_INFORMATION",
    noteBody,
    fallbackProperties: {
      interconnection_status: "Resubmitted To Utility",
    },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordIcActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "IC_INFO_PROVIDED",
    dealId: p.dealId,
    description: `Sent requested info to utility: ${p.infoRequested.slice(0, 80)}`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deleteIcDraft({
      userId,
      dealId: p.dealId,
      actionKind: "PROVIDE_INFORMATION",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
