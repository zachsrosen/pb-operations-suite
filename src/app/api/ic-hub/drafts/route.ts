import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isIcHubAllowedRole,
  isIcHubEnabled,
  resolveUserIdByEmail,
} from "@/lib/ic-hub";
import { IC_ACTION_KINDS } from "@/lib/pi-statuses";

const DraftSchema = z.object({
  dealId: z.string().min(1),
  actionKind: z.enum(IC_ACTION_KINDS),
  payload: z.record(z.string(), z.unknown()),
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

  const userId = await resolveUserIdByEmail(auth.email);
  if (!userId) {
    return NextResponse.json({ error: "User record not found" }, { status: 500 });
  }

  const parsed = DraftSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { dealId, actionKind, payload } = parsed.data;
  // actionKind is IC_* so it never collides with Permit Hub drafts in
  // the shared permitHubDraft table.
  const draft = await prisma.permitHubDraft.upsert({
    where: {
      userId_dealId_actionKind: { userId, dealId, actionKind },
    },
    create: { userId, dealId, actionKind, payload: payload as never },
    update: { payload: payload as never },
  });

  return NextResponse.json({ draft });
}
