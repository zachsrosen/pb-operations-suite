import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";

/**
 * PUT /api/admin/users/permissions
 * Update a user's granular permissions (admin only)
 */
export async function PUT(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Check if user is admin - fetch from DB since JWT may be stale
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { userId, permissions } = body;

    if (!userId || !permissions) {
      return NextResponse.json({ error: "userId and permissions are required" }, { status: 400 });
    }

    // Validate permissions object
    const validPermissionKeys = ["canScheduleSurveys", "canScheduleInstalls", "canSyncToZuper", "canManageUsers", "allowedLocations"];
    const invalidKeys = Object.keys(permissions).filter(key => !validPermissionKeys.includes(key));
    if (invalidKeys.length > 0) {
      return NextResponse.json({ error: `Invalid permission keys: ${invalidKeys.join(", ")}` }, { status: 400 });
    }

    // Validate allowedLocations is an array if provided
    if (permissions.allowedLocations !== undefined && !Array.isArray(permissions.allowedLocations)) {
      return NextResponse.json({ error: "allowedLocations must be an array" }, { status: 400 });
    }

    // Get the target user to log the change
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const oldPermissions = {
      canScheduleSurveys: targetUser.canScheduleSurveys,
      canScheduleInstalls: targetUser.canScheduleInstalls,
      canSyncToZuper: targetUser.canSyncToZuper,
      canManageUsers: targetUser.canManageUsers,
      allowedLocations: targetUser.allowedLocations,
    };

    // Update the user with new permissions
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        canScheduleSurveys: permissions.canScheduleSurveys ?? targetUser.canScheduleSurveys,
        canScheduleInstalls: permissions.canScheduleInstalls ?? targetUser.canScheduleInstalls,
        canSyncToZuper: permissions.canSyncToZuper ?? targetUser.canSyncToZuper,
        canManageUsers: permissions.canManageUsers ?? targetUser.canManageUsers,
        allowedLocations: permissions.allowedLocations ?? targetUser.allowedLocations,
      },
    });

    // Log the permission change
    await logActivity({
      type: "USER_PERMISSIONS_CHANGED",
      description: `Updated permissions for ${updatedUser.email}`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      entityType: "user",
      entityId: updatedUser.id,
      entityName: updatedUser.email,
      metadata: {
        targetUserId: updatedUser.id,
        targetUserEmail: updatedUser.email,
        oldPermissions,
        newPermissions: {
          canScheduleSurveys: updatedUser.canScheduleSurveys,
          canScheduleInstalls: updatedUser.canScheduleInstalls,
          canSyncToZuper: updatedUser.canSyncToZuper,
          canManageUsers: updatedUser.canManageUsers,
          allowedLocations: updatedUser.allowedLocations,
        },
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        canScheduleSurveys: updatedUser.canScheduleSurveys,
        canScheduleInstalls: updatedUser.canScheduleInstalls,
        canSyncToZuper: updatedUser.canSyncToZuper,
        canManageUsers: updatedUser.canManageUsers,
        allowedLocations: updatedUser.allowedLocations,
      },
    });
  } catch (error) {
    console.error("Error updating user permissions:", error);
    return NextResponse.json({ error: "Failed to update permissions" }, { status: 500 });
  }
}
