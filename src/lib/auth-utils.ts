/**
 * Authentication & Authorization Utilities
 *
 * Helper functions for role-based access control
 */

import { auth } from "@/auth";
import { getUserByEmail, prisma } from "./db";
import type { UserRole } from "@/generated/prisma/enums";
import {
  normalizeRole,
  canAccessRoute,
  ROLE_PERMISSIONS,
} from "@/lib/user-access";

export interface SessionUser {
  id?: string;
  email: string;
  name?: string;
  image?: string;
  role: UserRole;
  roles: UserRole[];
}

/**
 * Get the current user with their role from the database
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();

  if (!session?.user?.email) {
    return null;
  }

  // Try to get user from database
  const dbUser = await getUserByEmail(session.user.email);

  if (dbUser) {
    if (dbUser.roles.includes("ADMIN") && dbUser.impersonatingUserId && prisma) {
      const impersonatedUser = await prisma.user.findUnique({
        where: { id: dbUser.impersonatingUserId },
      });

      if (impersonatedUser) {
        const impRoles: UserRole[] =
          impersonatedUser.roles.length > 0
            ? (impersonatedUser.roles as UserRole[]).map(normalizeRole)
            : [normalizeRole("VIEWER" as UserRole)];
        return {
          id: impersonatedUser.id,
          email: impersonatedUser.email,
          name: impersonatedUser.name ?? undefined,
          image: impersonatedUser.image ?? undefined,
          role: impRoles[0] ?? "VIEWER",
          roles: impRoles,
        };
      }
    }

    const dbRoles: UserRole[] =
      dbUser.roles.length > 0
        ? (dbUser.roles as UserRole[]).map(normalizeRole)
        : ["VIEWER"];
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name ?? undefined,
      image: dbUser.image ?? undefined,
      role: dbRoles[0] ?? "VIEWER",
      roles: dbRoles,
    };
  }

  // User not in database yet - return with default role
  return {
    email: session.user.email,
    name: session.user.name ?? undefined,
    image: session.user.image ?? undefined,
    role: "VIEWER",
    roles: ["VIEWER"],
  };
}

/**
 * Check if current user can access a route
 */
export async function checkRouteAccess(route: string): Promise<{
  allowed: boolean;
  user: SessionUser | null;
  reason?: string;
}> {
  const user = await getCurrentUser();

  if (!user) {
    return { allowed: false, user: null, reason: "Not authenticated" };
  }

  const allowed = user.roles.some((r) => canAccessRoute(r, route));

  if (!allowed) {
    return {
      allowed: false,
      user,
      reason: `Roles "${user.roles.join(", ")}" cannot access ${route}`,
    };
  }

  return { allowed: true, user };
}

/**
 * Get permissions for current user
 */
export async function getCurrentUserPermissions() {
  const user = await getCurrentUser();
  if (!user) return null;
  return { user, permissions: ROLE_PERMISSIONS[user.roles[0] ?? "VIEWER"] };
}

/**
 * Require specific role(s) - throws if not authorized
 */
export async function requireRole(...allowedRoles: UserRole[]): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  if (!user.roles.some((r) => allowedRoles.includes(r))) {
    throw new Error(`Required role: ${allowedRoles.join(" or ")}. Current roles: ${user.roles.join(", ")}`);
  }

  return user;
}
