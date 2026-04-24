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
  issueDate: z.string(),
  permitNumber: z.string().min(1),
  expirationDate: z.string().optional(),
  issuedPermitUrl: z.string().url().optional(),
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
    `<b>Permit issued</b>`,
    `Issue date: ${p.issueDate}`,
    `Permit #: ${p.permitNumber}`,
    p.expirationDate ? `Expires: ${p.expirationDate}` : null,
    p.issuedPermitUrl ? `Permit PDF: ${p.issuedPermitUrl}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const fallbackProperties: Record<string, string> = {
    permit_issued: p.issueDate,
    permitting_status: "Permit Issued",
  };
  if (p.permitNumber) {
    fallbackProperties.permit_number = p.permitNumber;
  }

  const result = await completePermitTask({
    dealId: p.dealId,
    actionKind: "MARK_PERMIT_ISSUED",
    noteBody,
    fallbackProperties,
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordPermitActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "PERMIT_ISSUED",
    dealId: p.dealId,
    description: `Permit issued (${p.permitNumber})`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deletePermitDraft({ userId, dealId: p.dealId, actionKind: "MARK_PERMIT_ISSUED" });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
