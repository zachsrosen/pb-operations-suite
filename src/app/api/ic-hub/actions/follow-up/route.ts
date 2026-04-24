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
  contactDate: z.string(),
  contactMethod: z.enum(["phone", "email", "portal", "in_person"]),
  whatWasSaid: z.string().min(1),
  nextFollowUpDate: z.string().optional(),
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
    `<b>Followed up with Utility</b>`,
    `Date: ${p.contactDate}`,
    `Method: ${p.contactMethod}`,
    `Summary: ${p.whatWasSaid}`,
    p.nextFollowUpDate ? `Next follow-up: ${p.nextFollowUpDate}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completeIcTask({
    dealId: p.dealId,
    actionKind: "FOLLOW_UP_UTILITY",
    noteBody,
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordIcActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "IC_FOLLOWUP",
    dealId: p.dealId,
    description: `Followed up with utility via ${p.contactMethod}`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deleteIcDraft({
      userId,
      dealId: p.dealId,
      actionKind: "FOLLOW_UP_UTILITY",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
