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
  contactDate: z.string(),
  contactMethod: z.enum(["phone", "email", "portal", "in_person"]),
  whatWasSaid: z.string().min(1),
  nextFollowUpDate: z.string().optional(),
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
    `<b>Followed up with AHJ</b>`,
    `Date: ${p.contactDate}`,
    `Method: ${p.contactMethod}`,
    `Summary: ${p.whatWasSaid}`,
    p.nextFollowUpDate ? `Next follow-up: ${p.nextFollowUpDate}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completePermitTask({
    dealId: p.dealId,
    actionKind: "FOLLOW_UP",
    noteBody,
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordPermitActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "PERMIT_FOLLOWUP",
    dealId: p.dealId,
    description: `Followed up with AHJ via ${p.contactMethod}`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deletePermitDraft({ userId, dealId: p.dealId, actionKind: "FOLLOW_UP" });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
