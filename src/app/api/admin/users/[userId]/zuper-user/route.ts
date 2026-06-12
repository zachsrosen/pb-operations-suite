/**
 * PATCH /api/admin/users/[userId]/zuper-user
 *
 * Admin-only. Sets or clears User.zuperUserUid to explicitly link a PB
 * user to a Zuper user record. Body: { zuperUserUid: string | null }.
 * Mirrors the hubspot-owner PATCH route.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { zuper } from "@/lib/zuper";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = await getUserByEmail(session.user.email);
  if (!me?.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const { userId } = await params;
  let body: { zuperUserUid?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.zuperUserUid;
  let zuperUserUid: string | null;
  if (raw === null || raw === "" || raw === undefined) {
    zuperUserUid = null;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    zuperUserUid = raw.trim();
  } else {
    return NextResponse.json(
      { error: "zuperUserUid must be a non-empty string or null" },
      { status: 400 },
    );
  }

  // On set, validate the uid actually exists in Zuper.
  if (zuperUserUid) {
    const result = await zuper.getUsers("admin:zuper-user-link");
    if (result.type !== "success" || !result.data) {
      return NextResponse.json(
        { error: result.error || result.message || "Failed to fetch Zuper users for validation" },
        { status: 502 },
      );
    }
    const exists = result.data.some((u) => u.user_uid === zuperUserUid);
    if (!exists) {
      return NextResponse.json(
        { error: "zuperUserUid does not match any Zuper user" },
        { status: 400 },
      );
    }
  }

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { zuperUserUid },
      select: { id: true, email: true, zuperUserUid: true },
    });

    const headersList = await headers();
    const reqCtx = extractRequestContext(headersList);
    await logAdminActivity({
      type: "USER_UPDATED",
      description: zuperUserUid
        ? `Linked user ${updated.email} to Zuper user ${zuperUserUid}`
        : `Unlinked Zuper user from ${updated.email}`,
      userId: me.id,
      userEmail: me.email,
      userName: me.name || undefined,
      entityType: "user",
      entityId: updated.id,
      entityName: updated.email,
      metadata: { zuperUserUid },
      requestPath: `/api/admin/users/${userId}/zuper-user`,
      requestMethod: "PATCH",
      ...reqCtx,
    });

    return NextResponse.json({ user: updated });
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}
