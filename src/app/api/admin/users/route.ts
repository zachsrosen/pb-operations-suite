import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, getAllUsers, updateUserRoles, UserRole, getUserByEmail } from "@/lib/db";
import { normalizeRole } from "@/lib/role-permissions";
import { ROLES } from "@/lib/roles";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

// Inline validation for role update request
interface UpdateUserRoleRequest {
  userId?: unknown;
  role?: unknown;
  roles?: unknown;
}

interface ValidatedRoleUpdate {
  userId: string;
  roles: UserRole[];
}

function validateRoleUpdate(data: unknown): ValidatedRoleUpdate | null {
  if (!data || typeof data !== "object") return null;
  const req = data as UpdateUserRoleRequest;

  if (typeof req.userId !== "string" || req.userId.length === 0) return null;

  // Accept both `roles: string[]` (new) and `role: string` (legacy back-compat).
  let rawRoles: unknown;
  if (Array.isArray(req.roles)) {
    rawRoles = req.roles;
  } else if (typeof req.role === "string") {
    rawRoles = [req.role];
  } else {
    return null;
  }

  if (!Array.isArray(rawRoles) || rawRoles.length === 0) return null;
  if (!rawRoles.every((r) => typeof r === "string")) return null;

  // Every role must be a canonical (visibleInPicker) role — no legacy strings.
  for (const r of rawRoles) {
    const def = ROLES[r as UserRole];
    if (!def || !def.visibleInPicker) return null;
  }

  // Dedup while preserving order.
  const seen = new Set<string>();
  const roles: UserRole[] = [];
  for (const r of rawRoles as string[]) {
    if (seen.has(r)) continue;
    seen.add(r);
    roles.push(r as UserRole);
  }

  return { userId: req.userId, roles };
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
    const users = (await getAllUsers()).map((u) => ({
      ...u,
      role: normalizeRole(u.role as UserRole),
    }));
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/users
 * Update a user's roles (admin only). Accepts `{ userId, roles: string[] }` (new)
 * or `{ userId, role: string }` (legacy single-role, wrapped to [role]).
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

    const validated = validateRoleUpdate(body);
    if (!validated) {
      return NextResponse.json({
        error: "Invalid request: userId (string) and roles (non-empty array of canonical role strings) are required",
      }, { status: 400 });
    }

    const { userId, roles: newRoles } = validated;

    // Get the target user to log the change and to enforce location requirements
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const oldRoles: UserRole[] =
      Array.isArray((targetUser as { roles?: UserRole[] | null }).roles) &&
      ((targetUser as { roles?: UserRole[] | null }).roles?.length ?? 0) > 0
        ? ((targetUser as { roles: UserRole[] }).roles)
        : [targetUser.role as UserRole];

    // Location-scope gate: if ANY assigned role is location-scoped and the user
    // has no allowedLocations, block the update so the admin assigns locations
    // first. `resolveEffectiveRole` returns the *max* scope (global > location),
    // so we check each role individually — a user with OPERATIONS still needs
    // a location even if another role grants global access.
    const hasLocationScopedRole = newRoles.some(
      (r) => ROLES[r]?.scope === "location",
    );
    const targetLocations = (targetUser as { allowedLocations?: string[] | null }).allowedLocations ?? [];
    if (hasLocationScopedRole && targetLocations.length === 0) {
      return NextResponse.json(
        {
          error: "This role requires at least one allowed location. Assign locations before changing the role.",
          requiresLocations: true,
        },
        { status: 400 }
      );
    }

    const updatedUser = await updateUserRoles(userId, newRoles);

    if (!updatedUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Log the role change through audit pipeline (session + anomaly detection)
    const headersList = await headers();
    const reqCtx = extractRequestContext(headersList);
    await logAdminActivity({
      type: "USER_ROLE_CHANGED",
      description: `Changed ${updatedUser.email} roles from [${oldRoles.join(", ")}] to [${newRoles.join(", ")}]`,
      userId: currentUser.id,
      userEmail: currentUser.email,
      userName: currentUser.name || undefined,
      entityType: "user",
      entityId: updatedUser.id,
      entityName: updatedUser.email,
      metadata: {
        targetUserId: updatedUser.id,
        targetUserEmail: updatedUser.email,
        oldRoles,
        newRoles,
      },
      ...reqCtx,
    });

    return NextResponse.json({ user: updatedUser });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
