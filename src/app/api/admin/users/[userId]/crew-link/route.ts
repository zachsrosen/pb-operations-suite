/**
 * PATCH /api/admin/users/[userId]/crew-link
 *
 * Admin-only. Sets or clears the CrewMember link for a user.
 * Body: { crewMemberId: string | null }.
 *
 * - null clears: any CrewMember currently linked to this user gets
 *   userId = null.
 * - set: validates the CrewMember exists; if it is already linked to a
 *   DIFFERENT user, returns 409 naming the conflicting user (links are
 *   rejected, not stolen — the admin must unlink there first). Otherwise
 *   moves the link: clears this user's previous crew link (CrewMember.userId
 *   is @unique) and writes CrewMember.userId = userId.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
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
  let body: { crewMemberId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.crewMemberId;
  let crewMemberId: string | null;
  if (raw === null || raw === "" || raw === undefined) {
    crewMemberId = null;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    crewMemberId = raw.trim();
  } else {
    return NextResponse.json(
      { error: "crewMemberId must be a non-empty string or null" },
      { status: 400 },
    );
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);

  if (crewMemberId === null) {
    // Clear: unlink whichever crew member currently points at this user.
    await prisma.crewMember.updateMany({
      where: { userId },
      data: { userId: null },
    });

    await logAdminActivity({
      type: "USER_UPDATED",
      description: `Unlinked crew member from ${targetUser.email}`,
      userId: me.id,
      userEmail: me.email,
      userName: me.name || undefined,
      entityType: "user",
      entityId: targetUser.id,
      entityName: targetUser.email,
      metadata: { crewMemberId: null },
      requestPath: `/api/admin/users/${userId}/crew-link`,
      requestMethod: "PATCH",
      ...reqCtx,
    });

    return NextResponse.json({ user: { id: targetUser.id, email: targetUser.email, crewMemberId: null } });
  }

  const crew = await prisma.crewMember.findUnique({
    where: { id: crewMemberId },
    select: { id: true, name: true, userId: true },
  });
  if (!crew) {
    return NextResponse.json({ error: "Crew member not found" }, { status: 404 });
  }

  if (crew.userId && crew.userId !== userId) {
    const conflicting = await prisma.user.findUnique({
      where: { id: crew.userId },
      select: { id: true, email: true, name: true },
    });
    const who = conflicting?.name || conflicting?.email || crew.userId;
    return NextResponse.json(
      {
        error: `Crew member ${crew.name} is already linked to ${who}. Unlink it there first.`,
        conflictingUserId: crew.userId,
      },
      { status: 409 },
    );
  }

  // CrewMember.userId is @unique per user — clear any other crew record
  // currently linked to this user before claiming the new one.
  await prisma.crewMember.updateMany({
    where: { userId, id: { not: crew.id } },
    data: { userId: null },
  });
  await prisma.crewMember.update({
    where: { id: crew.id },
    data: { userId },
  });

  await logAdminActivity({
    type: "USER_UPDATED",
    description: `Linked user ${targetUser.email} to crew member ${crew.name}`,
    userId: me.id,
    userEmail: me.email,
    userName: me.name || undefined,
    entityType: "user",
    entityId: targetUser.id,
    entityName: targetUser.email,
    metadata: { crewMemberId: crew.id, crewName: crew.name },
    requestPath: `/api/admin/users/${userId}/crew-link`,
    requestMethod: "PATCH",
    ...reqCtx,
  });

  return NextResponse.json({
    user: { id: targetUser.id, email: targetUser.email, crewMemberId: crew.id },
  });
}
