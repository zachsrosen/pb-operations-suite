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
  approvalDate: z.string(),
  icaNumber: z.string().optional(),
  expirationDate: z.string().optional(),
  icaDocUrl: z.string().url().optional(),
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
    `<b>IC approved</b>`,
    `Approval date: ${p.approvalDate}`,
    p.icaNumber ? `ICA #: ${p.icaNumber}` : null,
    p.expirationDate ? `Expires: ${p.expirationDate}` : null,
    p.icaDocUrl ? `ICA doc: ${p.icaDocUrl}` : null,
    p.notes ? `Notes: ${p.notes}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const fallbackProperties: Record<string, string> = {
    interconnection_status: "Approved",
  };

  const result = await completeIcTask({
    dealId: p.dealId,
    actionKind: "MARK_IC_APPROVED",
    noteBody,
    fallbackProperties,
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordIcActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "IC_APPROVED",
    dealId: p.dealId,
    description: `IC approved${p.icaNumber ? ` (ICA ${p.icaNumber})` : ""}`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  if (userId) {
    await deleteIcDraft({
      userId,
      dealId: p.dealId,
      actionKind: "MARK_IC_APPROVED",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
