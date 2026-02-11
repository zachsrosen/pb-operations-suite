import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getAllUsers, updateUserRole, UserRole, getUserByEmail, logActivity } from "@/lib/db";

// Inline validation for role update request
interface UpdateUserRoleRequest {
  userId?: unknown;
  role?: unknown;
}

function validateRoleUpdate(data: unknown): data is { userId: string; role: UserRole } {
  if (!data || typeof data !== "object") return false;
  const req = data as UpdateUserRoleRequest;

  const validRoles: UserRole[] = ["ADMIN", "OWNER", "MANAGER", "OPERATIONS_MANAGER", "PROJECT_MANAGER", "OPERATIONS", "TECH_OPS", "DESIGNER", "PERMITTING", "VIEWER", "SALES"];

  return (
    typeof req.userId === "string" &&
    req.userId.length > 0 &&
    typeof req.role === "string" &&
    validRoles.includes(req.role as UserRole)
  );
}

/**
 * GET /api/admin/users
 * Get all users (admin only)
 */
export async function GET() {
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
    const users = await getAllUsers();
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/users
 * Update a user's role (admin only)
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
    if (!validateRoleUpdate(body)) {
      return NextResponse.json({
        error: "Invalid request: userId (string) and role (valid role string) are required",
      }, { status: 400 });
    }

    const { userId, role } = body;

    // Get the target user to log the change
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    const oldRole = targetUser?.role;

    const updatedUser = await updateUserRole(userId, role);

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Log the role change
    await logActivity({
      type: "USER_ROLE_CHANGED",
      description: `Changed ${updatedUser.email} role from ${oldRole} to ${role}`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      entityType: "user",
      entityId: updatedUser.id,
      entityName: updatedUser.email,
      metadata: {
        targetUserId: updatedUser.id,
        targetUserEmail: updatedUser.email,
        oldRole,
        newRole: role,
      },
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
