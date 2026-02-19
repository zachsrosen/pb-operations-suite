import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";
import { normalizeRole, type UserRole } from "@/lib/role-permissions";

function withEffectiveRoleCookie(response: NextResponse, role: string): NextResponse {
  response.cookies.set("pb_effective_role", role, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

/**
 * POST /api/admin/impersonate
 * Start impersonating another user (admin only)
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Get the actual admin user from database
  const adminUser = await getUserByEmail(session.user.email);
  if (!adminUser || adminUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { targetUserId, reason } = body;

    if (!targetUserId) {
      return NextResponse.json({ error: "targetUserId is required" }, { status: 400 });
    }

    // Can't impersonate yourself
    if (targetUserId === adminUser.id) {
      return NextResponse.json({ error: "Cannot impersonate yourself" }, { status: 400 });
    }

    // Find the target user
    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Set the impersonation
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { impersonatingUserId: targetUserId },
    });

    // Log the impersonation start
    await logActivity({
      type: "FEATURE_USED",
      description: `Admin started impersonating ${targetUser.email}`,
      userId: adminUser.id,
      userEmail: adminUser.email,
      entityType: "user",
      entityId: targetUser.id,
      entityName: targetUser.email,
      metadata: {
        action: "IMPERSONATION_START",
        targetUserId: targetUser.id,
        targetUserEmail: targetUser.email,
        targetUserRole: targetUser.role,
        reason: reason || "Not specified",
      },
    });

    const normalizedTargetRole = normalizeRole(targetUser.role as UserRole);
    return withEffectiveRoleCookie(NextResponse.json({
      success: true,
      impersonating: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: normalizedTargetRole,
      },
      admin: {
        id: adminUser.id,
        email: adminUser.email,
      },
      startedAt: new Date().toISOString(),
    }), normalizedTargetRole);
  } catch (error) {
    console.error("Error starting impersonation:", error);
    return NextResponse.json({ error: "Failed to start impersonation" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/impersonate
 * Stop impersonating (return to admin view)
 */
export async function DELETE() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Get the actual logged-in user
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const normalizedRole = normalizeRole(user.role as UserRole);

  // Allow any user with impersonatingUserId set to clear it
  const isCurrentlyImpersonating = !!user.impersonatingUserId;

  if (!isCurrentlyImpersonating && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!isCurrentlyImpersonating) {
    return withEffectiveRoleCookie(
      NextResponse.json({ success: true, message: "Not currently impersonating" }),
      normalizedRole
    );
  }

  try {
    const wasImpersonating = user.impersonatingUserId;

    // Clear the impersonation
    await prisma.user.update({
      where: { id: user.id },
      data: { impersonatingUserId: null },
    });

    // Log the impersonation end
    if (wasImpersonating) {
      const targetUser = await prisma.user.findUnique({
        where: { id: wasImpersonating },
      });

      await logActivity({
        type: "FEATURE_USED",
        description: `Admin stopped impersonating ${targetUser?.email || wasImpersonating}`,
        userId: user.id,
        userEmail: user.email,
        entityType: "user",
        entityId: wasImpersonating,
        entityName: targetUser?.email || wasImpersonating,
        metadata: {
          action: "IMPERSONATION_END",
          targetUserId: wasImpersonating,
          targetUserEmail: targetUser?.email,
        },
      });
    }

    return withEffectiveRoleCookie(NextResponse.json({
      success: true,
      message: "Impersonation ended",
      endedAt: new Date().toISOString(),
    }), normalizedRole);
  } catch (error) {
    console.error("Error ending impersonation:", error);
    return NextResponse.json({ error: "Failed to end impersonation" }, { status: 500 });
  }
}

/**
 * GET /api/admin/impersonate
 * Get current impersonation status
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ isImpersonating: false });
  }

  // Only admins should be able to query impersonation status
  if (user.role !== "ADMIN") {
    return NextResponse.json({ isImpersonating: false });
  }
  const normalizedAdminRole = normalizeRole(user.role as UserRole);

  if (!user.impersonatingUserId) {
    return withEffectiveRoleCookie(
      NextResponse.json({ isImpersonating: false }),
      normalizedAdminRole
    );
  }

  // Get the impersonated user
  const targetUser = await prisma.user.findUnique({
    where: { id: user.impersonatingUserId },
  });

  if (!targetUser) {
    // Clear invalid impersonation state
    await prisma.user.update({
      where: { id: user.id },
      data: { impersonatingUserId: null },
    });
    return withEffectiveRoleCookie(
      NextResponse.json({ isImpersonating: false }),
      normalizedAdminRole
    );
  }

  const normalizedTargetRole = normalizeRole(targetUser.role as UserRole);
  return withEffectiveRoleCookie(NextResponse.json({
    isImpersonating: true,
    impersonating: {
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: normalizedTargetRole,
    },
    admin: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  }), normalizedTargetRole);
}
