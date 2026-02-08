import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";

/**
 * POST /api/admin/impersonate
 * Start impersonating another user (admin only)
 * DISABLED: Requires database migration - run `npx prisma db push` first
 */
export async function POST(request: NextRequest) {
  return NextResponse.json({
    error: "Impersonation disabled - database migration required. Run: npx prisma db push"
  }, { status: 503 });

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

    return NextResponse.json({
      success: true,
      impersonating: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: targetUser.role,
      },
      admin: {
        id: adminUser.id,
        email: adminUser.email,
      },
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error starting impersonation:", error);
    return NextResponse.json({ error: "Failed to start impersonation" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/impersonate
 * Stop impersonating (return to admin view)
 * DISABLED: Requires database migration - run `npx prisma db push` first
 */
export async function DELETE() {
  return NextResponse.json({ success: true, message: "Impersonation disabled" });

  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Get the actual logged-in user (the admin who is impersonating)
  const user = await getUserByEmail(session.user.email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Allow any user with impersonatingUserId set to clear it (they're an admin who started impersonating)
  // Also allow admins to call this endpoint even if not impersonating
  const isCurrentlyImpersonating = !!user.impersonatingUserId;

  if (!isCurrentlyImpersonating && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // If user is not impersonating and is admin, nothing to do
  if (!isCurrentlyImpersonating) {
    return NextResponse.json({ success: true, message: "Not currently impersonating" });
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

    return NextResponse.json({
      success: true,
      message: "Impersonation ended",
      endedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error ending impersonation:", error);
    return NextResponse.json({ error: "Failed to end impersonation" }, { status: 500 });
  }
}

/**
 * GET /api/admin/impersonate
 * Get current impersonation status
 * DISABLED: Requires database migration - run `npx prisma db push` first
 */
export async function GET() {
  return NextResponse.json({ isImpersonating: false });

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

  if (!user.impersonatingUserId) {
    return NextResponse.json({ isImpersonating: false });
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
    return NextResponse.json({ isImpersonating: false });
  }

  return NextResponse.json({
    isImpersonating: true,
    impersonating: {
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: targetUser.role,
    },
    admin: {
      id: user.id,
      email: user.email,
      name: user.name,
    },
  });
}
