/**
 * GET /api/pm-flags/[id] — fetch a single flag with full event timeline.
 * Visibility: assignee, raiser, or admin-like roles.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireApiAuth } from "@/lib/api-auth";
import { getFlag } from "@/lib/pm-flags";
import { prisma } from "@/lib/db";

const ADMIN_LIKE_ROLES = new Set(["ADMIN", "OWNER", "EXECUTIVE", "OPERATIONS_MANAGER"]);

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  const { id } = await ctx.params;
  const flag = await getFlag(id);
  if (!flag) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isAdmin = auth.roles.some(r => ADMIN_LIKE_ROLES.has(r));
  if (!isAdmin) {
    const me = await prisma.user.findUnique({
      where: { email: auth.email },
      select: { id: true },
    });
    const myId = me?.id;
    if (myId !== flag.assignedToUserId && myId !== flag.raisedByUserId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ flag });
}
