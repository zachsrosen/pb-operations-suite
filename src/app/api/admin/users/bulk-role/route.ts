import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/auth";
import { prisma, updateUserRoles, UserRole, getUserByEmail } from "@/lib/db";
import { ROLES } from "@/lib/roles";
import { logAdminActivity, extractRequestContext } from "@/lib/audit/admin-activity";

/**
 * PUT /api/admin/users/bulk-role
 *
 * Bulk-assigns a SINGLE role to a set of users. The UI (admin/users) calls this
 * from the bulk-action bar ("Update Roles" with one role in the dropdown) — it
 * overwrites each selected user's `roles` array to `[role]`.
 *
 * Body: { userIds: string[], role: string (canonical, visibleInPicker) }
 *
 * Audit: one `USER_ROLE_CHANGED` activity row per user (risk=HIGH).
 *
 * This route was previously referenced by the client but never shipped — hitting
 * it returned a Next.js 404 HTML page, which the client tried to parse as JSON,
 * producing the infamous "Unexpected token '<'" error.
 */

interface BulkRoleRequest {
  userIds?: unknown;
  role?: unknown;
}

interface ValidatedBulkRole {
  userIds: string[];
  role: UserRole;
}

function validate(data: unknown): ValidatedBulkRole | { error: string } {
  if (!data || typeof data !== "object") {
    return { error: "Body must be a JSON object" };
  }
  const req = data as BulkRoleRequest;

  if (!Array.isArray(req.userIds) || req.userIds.length === 0) {
    return { error: "userIds must be a non-empty array of user id strings" };
  }
  if (!req.userIds.every((id) => typeof id === "string" && id.length > 0)) {
    return { error: "userIds must contain only non-empty strings" };
  }
  // Dedup so we don't double-log or redundantly write.
  const userIds = Array.from(new Set(req.userIds as string[]));

  if (typeof req.role !== "string" || req.role.length === 0) {
    return { error: "role must be a non-empty string" };
  }
  const def = ROLES[req.role as UserRole];
  if (!def || !def.visibleInPicker) {
    return { error: `role must be a canonical, assignable role (got ${req.role})` };
  }

  return { userIds, role: req.role as UserRole };
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 500 });
  }

  // Fresh DB read — JWT role may be stale.
  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
  }

  const parsed = validate(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { userIds, role } = parsed;

  const headersList = await headers();
  const reqCtx = extractRequestContext(headersList);

  // Fetch all target users up front so the audit log can record old → new roles
  // without a round-trip per user after the update has already run.
  const targets = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, roles: true, role: true },
  });
  const byId = new Map(targets.map((t) => [t.id, t] as const));

  const results: Array<{
    userId: string;
    status: "updated" | "not_found" | "error";
    oldRoles?: UserRole[];
    error?: string;
  }> = [];

  for (const userId of userIds) {
    const target = byId.get(userId);
    if (!target) {
      results.push({ userId, status: "not_found" });
      continue;
    }

    const oldRoles: UserRole[] =
      Array.isArray(target.roles) && target.roles.length > 0
        ? (target.roles as UserRole[])
        : [target.role as UserRole];

    try {
      await updateUserRoles(userId, [role]);
      results.push({ userId, status: "updated", oldRoles });

      // One audit row per user — matches the per-user USER_ROLE_CHANGED pattern.
      await logAdminActivity({
        type: "USER_ROLE_CHANGED",
        description: `Bulk-changed ${target.email} roles from [${oldRoles.join(", ")}] to [${role}]`,
        userId: currentUser.id,
        userEmail: currentUser.email,
        userName: currentUser.name || undefined,
        entityType: "user",
        entityId: target.id,
        entityName: target.email,
        metadata: {
          targetUserId: target.id,
          targetUserEmail: target.email,
          oldRoles,
          newRoles: [role],
          bulk: true,
          bulkSize: userIds.length,
        },
        ...reqCtx,
      });
    } catch (err) {
      console.error(`[bulk-role] Failed to update user ${userId}:`, err);
      results.push({
        userId,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const updated = results.filter((r) => r.status === "updated").length;
  const notFound = results.filter((r) => r.status === "not_found").length;
  const errored = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    success: errored === 0,
    updated,
    notFound,
    errored,
    results,
  });
}
