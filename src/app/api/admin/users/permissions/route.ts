import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, logActivity } from "@/lib/db";

// Inline validation for permission update request
interface UpdatePermissionsRequest {
  userId?: unknown;
  permissions?: unknown;
}

interface PermissionsPayload {
  canScheduleSurveys?: boolean;
  canScheduleInstalls?: boolean;
  canSyncToZuper?: boolean;
  canManageUsers?: boolean;
  allowedLocations?: unknown;
}

function validatePermissionsUpdate(data: unknown): data is { userId: string; permissions: PermissionsPayload } {
  if (!data || typeof data !== "object") return false;
  const req = data as UpdatePermissionsRequest;

  // Validate userId
  if (typeof req.userId !== "string" || req.userId.length === 0) {
    return false;
  }

  // Validate permissions object
  if (!req.permissions || typeof req.permissions !== "object") {
    return false;
  }

  const permissions = req.permissions as Record<string, unknown>;
  const validPermissionKeys = ["canScheduleSurveys", "canScheduleInstalls", "canSyncToZuper", "canManageUsers", "allowedLocations"];

  // Check that all keys are valid
  for (const key of Object.keys(permissions)) {
    if (!validPermissionKeys.includes(key)) {
      return false;
    }
  }

  // Validate each permission field type
  if (permissions.canScheduleSurveys !== undefined && typeof permissions.canScheduleSurveys !== "boolean") {
    return false;
  }
  if (permissions.canScheduleInstalls !== undefined && typeof permissions.canScheduleInstalls !== "boolean") {
    return false;
  }
  if (permissions.canSyncToZuper !== undefined && typeof permissions.canSyncToZuper !== "boolean") {
    return false;
  }
  if (permissions.canManageUsers !== undefined && typeof permissions.canManageUsers !== "boolean") {
    return false;
  }

  // Validate allowedLocations is array if provided
  if (permissions.allowedLocations !== undefined && !Array.isArray(permissions.allowedLocations)) {
    return false;
  }

  return true;
}

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
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }

    // Validate request body
    if (!validatePermissionsUpdate(body)) {
      return NextResponse.json({
        error: "Invalid request: userId (string) and permissions (object with boolean flags and optional allowedLocations array) are required",
      }, { status: 400 });
    }

    const { userId, permissions } = body;

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
