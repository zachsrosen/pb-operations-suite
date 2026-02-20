import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail, getRecentActivities, getActivityTypes, ActivityType, UserRole, normalizeRole } from "@/lib/db";

const ROLE_INPUT_ALIASES: Record<string, UserRole> = {
  EXECUTIVE: "OWNER",
  UNASSIGNED: "VIEWER",
};

function expandRolesForFilter(roles: UserRole[]): UserRole[] {
  const expanded = new Set<UserRole>();
  for (const role of roles) {
    const normalized = normalizeRole(role);
    expanded.add(normalized);
    if (normalized === "PROJECT_MANAGER") expanded.add("MANAGER");
    if (normalized === "TECH_OPS") {
      expanded.add("DESIGNER");
      expanded.add("PERMITTING");
    }
  }
  return Array.from(expanded);
}

/**
 * GET /api/admin/activity
 * Get activity logs (admin only)
 *
 * Query params:
 * - limit: number of records per page (default 100, max 500)
 * - offset: number of records to skip for pagination (default 0)
 * - type: filter by one or more activity types (repeat query param)
 * - types: comma-separated activity types (legacy/alternate format)
 * - role: filter by one or more user roles (repeat query param)
 * - roles: comma-separated user roles (legacy/alternate format)
 * - userId: filter by user ID
 * - entityType: filter by entity type
 * - since: ISO date string — only return activities after this date
 * - email: filter by user email (partial match)
 * - meta: if "types", returns distinct activity types instead of logs
 */
export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);

    // Meta endpoint: return distinct activity types
    const meta = searchParams.get("meta");
    if (meta === "types") {
      const types = await getActivityTypes();
      return NextResponse.json({ types });
    }

    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0"), 0);
    const validActivityTypes = new Set(Object.keys(ActivityType));
    const repeatedTypeParams = searchParams.getAll("type");
    const csvTypesParam = searchParams.get("types");
    const csvTypes = csvTypesParam ? csvTypesParam.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const selectedTypes = Array.from(new Set([...repeatedTypeParams, ...csvTypes])).filter(
      (type): type is ActivityType => validActivityTypes.has(type)
    );
    const validUserRoles = new Set(Object.keys(UserRole));
    const repeatedRoleParams = searchParams.getAll("role");
    const csvRolesParam = searchParams.get("roles");
    const csvRoles = csvRolesParam ? csvRolesParam.split(",").map((r) => r.trim()).filter(Boolean) : [];
    const selectedRoles = Array.from(new Set([...repeatedRoleParams, ...csvRoles]))
      .map((role) => ROLE_INPUT_ALIASES[role] || role)
      .filter(
        (role): role is UserRole => validUserRoles.has(role)
      );
    const expandedSelectedRoles = expandRolesForFilter(selectedRoles);
    const userId = searchParams.get("userId");
    const entityType = searchParams.get("entityType");
    const sinceParam = searchParams.get("since");
    const emailParam = searchParams.get("email");

    let since: Date | undefined;
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (!isNaN(parsed.getTime())) since = parsed;
    }

    const { activities, total } = await getRecentActivities({
      limit,
      offset,
      types: selectedTypes.length > 0 ? selectedTypes : undefined,
      userId: userId || undefined,
      entityType: entityType || undefined,
      since,
      userEmail: emailParam || undefined,
      userRoles: expandedSelectedRoles.length > 0 ? expandedSelectedRoles : undefined,
    });

    const normalizedActivities = activities.map((activity) => ({
      ...activity,
      user: activity.user
        ? {
            ...activity.user,
            role: normalizeRole(activity.user.role as UserRole),
          }
        : null,
    }));

    return NextResponse.json({ activities: normalizedActivities, total, limit, offset });
  } catch (error) {
    console.error("Error fetching activities:", error);
    return NextResponse.json({ error: "Failed to fetch activities" }, { status: 500 });
  }
}
