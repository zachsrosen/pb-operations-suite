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
  rejectionDate: z.string(),
  category: z.enum(["design", "non_design", "paperwork"]),
  reason: z.string().min(1),
  route: z.enum(["design_revision", "non_design_fix", "paperwork_fix"]),
  notes: z.string().optional(),
  forceFallback: z.boolean().optional(),
});

const ROUTE_TO_STATUS: Record<string, string> = {
  design_revision: "In Design For Revisions",
  non_design_fix: "Non-Design Related Rejection",
  paperwork_fix: "Rejected",
};

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
    `<b>Utility rejection reviewed</b>`,
    `Rejection date: ${p.rejectionDate}`,
    `Category: ${p.category}`,
    `Reason: ${p.reason}`,
    `Routed to: ${p.route}`,
    p.notes ? `Notes: ${p.notes}` : null,
    `By: ${auth.email}`,
  ]
    .filter(Boolean)
    .join("<br>");

  const result = await completeIcTask({
    dealId: p.dealId,
    actionKind: "REVIEW_IC_REJECTION",
    noteBody,
    fallbackProperties: {
      interconnection_status: ROUTE_TO_STATUS[p.route] ?? "Rejected",
    },
    forceFallback: p.forceFallback,
  });

  const userId = await resolveUserIdByEmail(auth.email);

  await recordIcActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "IC_REJECTION_LOGGED",
    dealId: p.dealId,
    description: `Logged IC rejection (${p.category}): ${p.reason.slice(0, 80)}`,
    metadata: { ...p, taskCompleted: result.taskCompleted },
  });

  await recordIcActivity({
    userId,
    userEmail: auth.email,
    userName: auth.name,
    type: "IC_REVISION_ROUTED",
    dealId: p.dealId,
    description: `Routed to ${p.route}`,
    metadata: { route: p.route, category: p.category },
  });

  if (userId) {
    await deleteIcDraft({
      userId,
      dealId: p.dealId,
      actionKind: "REVIEW_IC_REJECTION",
    });
  }

  return NextResponse.json({
    ok: true,
    taskCompleted: result.taskCompleted,
    taskNotFound: result.taskNotFound,
  });
}
