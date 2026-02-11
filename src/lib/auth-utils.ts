/**
 * Authentication & Authorization Utilities
 *
 * Helper functions for role-based access control
 */

import { auth } from "@/auth";
import { getUserByEmail } from "./db";
import { canAccessRoute, UserRole, ROLE_PERMISSIONS } from "./role-permissions";

export interface SessionUser {
  id?: string;
  email: string;
  name?: string;
  image?: string;
  role: UserRole;
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
    return {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name ?? undefined,
      image: dbUser.image ?? undefined,
      role: dbUser.role as UserRole,
    };
  }

  // User not in database yet - return with default role
  return {
    email: session.user.email,
    name: session.user.name ?? undefined,
    image: session.user.image ?? undefined,
    role: "VIEWER", // Default for users not yet in DB
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

  const allowed = canAccessRoute(user.role, route);

  if (!allowed) {
    return {
      allowed: false,
      user,
      reason: `Role "${user.role}" cannot access ${route}`,
    };
  }

  return { allowed: true, user };
}

/**
 * Get permissions for current user
 */
export async function getCurrentUserPermissions() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  return {
    user,
    permissions: ROLE_PERMISSIONS[user.role],
  };
}

/**
 * Require specific role(s) - throws if not authorized
 */
export async function requireRole(...allowedRoles: UserRole[]): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  if (!allowedRoles.includes(user.role)) {
    throw new Error(`Required role: ${allowedRoles.join(" or ")}. Current role: ${user.role}`);
  }

  return user;
}
