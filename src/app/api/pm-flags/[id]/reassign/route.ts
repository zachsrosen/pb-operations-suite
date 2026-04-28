import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/api-auth";
import { reassignFlag, FlagTransitionError } from "@/lib/pm-flags";
import { prisma } from "@/lib/db";

const ADMIN_LIKE_ROLES = new Set(["ADMIN", "OWNER", "EXECUTIVE", "OPERATIONS_MANAGER"]);

const schema = z.object({ newAssigneeId: z.string().min(1) });

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "newAssigneeId is required" }, { status: 400 });
  }

  const me = await prisma.user.findUnique({
    where: { email: auth.email },
    select: { id: true },
  });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 });

  try {
    const flag = await reassignFlag(id, parsed.data.newAssigneeId, {
      userId: me.id,
      userEmail: auth.email,
      isAdmin: auth.roles.some(r => ADMIN_LIKE_ROLES.has(r)),
    });

    // Send notification email to the new assignee.
    void import("@/lib/pm-flag-email").then(m =>
      m.sendFlagAssignedEmail(flag).catch(err => {
        console.error("PM flag reassign email failed", err);
      })
    );

    return NextResponse.json({ flag });
  } catch (err) {
    if (err instanceof FlagTransitionError) {
      const code = err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : 409;
      return NextResponse.json({ error: err.message, code: err.code }, { status: code });
    }
    throw err;
  }
}
