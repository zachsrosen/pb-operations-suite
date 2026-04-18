/**
 * @deprecated Phase 1 back-compat shim.
 *
 * All role data now lives in `@/lib/roles`. All access derivation lives in
 * `@/lib/user-access`. This file re-exports a compatibility surface so existing
 * call sites continue to compile during Phase 1. Phase 2 (spec:
 * docs/superpowers/specs/2026-04-16-multi-role-access-and-home-redesign-design.md)
 * deletes this file and migrates imports.
 *
 * Prefer: import { ROLES } from "@/lib/roles"
 * Prefer: import { resolveUserAccess, isPathAllowedByAccess } from "@/lib/user-access"
 */

import { UserRole } from "@/generated/prisma/enums";
import { ROLES } from "@/lib/roles";
import { isPathAllowedByAccess, resolveUserAccess } from "@/lib/user-access";

// Re-export UserRole for convenience
export { UserRole };

/**
 * Permission structure for roles.
 *
 * @deprecated Prefer `ROLES[role].allowedRoutes` + `ROLES[role].defaultCapabilities`
 * from `@/lib/roles`, or `resolveUserAccess(user).capabilities` from
 * `@/lib/user-access` for merged per-user access.
 */
export interface RolePermissions {
  allowedRoutes: string[];
  canScheduleSurveys: boolean;
  canScheduleInstalls: boolean;
  canScheduleInspections: boolean;
  canSyncZuper: boolean;
  canManageUsers: boolean;
  canManageAvailability: boolean;
  canEditDesign: boolean;
  canEditPermitting: boolean;
  canViewAllLocations: boolean;
}

/**
 * Normalize legacy roles to the current role model.
 *
 * @deprecated Prefer `ROLES[role].normalizesTo` from `@/lib/roles`.
 */
export function normalizeRole(role: UserRole): UserRole {
  return ROLES[role]?.normalizesTo ?? role;
}

/**
 * Derived from `ROLES` for shape-compatibility with legacy readers that access
 * `ROLE_PERMISSIONS[role].allowedRoutes` or capability booleans directly.
 *
 * @deprecated Read from `ROLES[role]` in `@/lib/roles` instead.
 */
export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = Object.fromEntries(
  (Object.keys(ROLES) as UserRole[]).map((role) => {
    const def = ROLES[role];
    const caps = def.defaultCapabilities;
    return [
      role,
      {
        allowedRoutes: def.allowedRoutes,
        canScheduleSurveys: caps.canScheduleSurveys,
        canScheduleInstalls: caps.canScheduleInstalls,
        canScheduleInspections: caps.canScheduleInspections,
        canSyncZuper: caps.canSyncZuper,
        canManageUsers: caps.canManageUsers,
        canManageAvailability: caps.canManageAvailability,
        canEditDesign: caps.canEditDesign,
        canEditPermitting: caps.canEditPermitting,
        canViewAllLocations: caps.canViewAllLocations,
      },
    ];
  })
) as Record<UserRole, RolePermissions>;

/**
 * Get the default landing route for a role.
 * Prefers suite pages, then dashboard pages, then first explicit route.
 *
 * @deprecated Prefer `ROLES[role].allowedRoutes` and derive landing as needed.
 */
export function getDefaultRouteForRole(role: UserRole): string {
  const effectiveRole = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[effectiveRole];
  if (!permissions || permissions.allowedRoutes.includes("*")) return "/";

  const suiteRoute = permissions.allowedRoutes.find((r) => r.startsWith("/suites/"));
  if (suiteRoute) return suiteRoute;

  const dashboardRoute = permissions.allowedRoutes.find((r) => r.startsWith("/dashboards/"));
  if (dashboardRoute) return dashboardRoute;

  return permissions.allowedRoutes[0] || "/";
}

/**
 * Check if a user role can access a specific route.
 *
 * Delegates to `isPathAllowedByAccess` in `@/lib/user-access` so the single-role
 * legacy API matches the multi-role semantics exactly.
 *
 * @deprecated Prefer `isPathAllowedByAccess(resolveUserAccess(user), path)`.
 */
export function canAccessRoute(role: UserRole, route: string): boolean {
  if (!ROLES[role]) return false;
  const access = resolveUserAccess({ roles: [role], role });
  return isPathAllowedByAccess(access, route);
}

/**
 * Check if user can schedule a specific type.
 *
 * @deprecated Prefer `resolveUserAccess(user).capabilities.canScheduleSurveys`
 * etc. from `@/lib/user-access`.
 */
export function canScheduleType(
  role: UserRole,
  scheduleType: "survey" | "pre-sale-survey" | "installation" | "inspection"
): boolean {
  const permissions = ROLE_PERMISSIONS[normalizeRole(role)];
  if (!permissions) return false;

  switch (scheduleType) {
    case "survey":
    case "pre-sale-survey":
      return permissions.canScheduleSurveys;
    case "installation":
      return permissions.canScheduleInstalls;
    case "inspection":
      return permissions.canScheduleInspections;
    default:
      return false;
  }
}

/**
 * Check if user can perform any scheduling actions (legacy support).
 *
 * @deprecated Prefer `resolveUserAccess(user).capabilities` from `@/lib/user-access`.
 */
export function canSchedule(role: UserRole): boolean {
  const permissions = ROLE_PERMISSIONS[normalizeRole(role)];
  if (!permissions) return false;
  return (
    permissions.canScheduleSurveys ||
    permissions.canScheduleInstalls ||
    permissions.canScheduleInspections
  );
}

/**
 * Check if user can sync to Zuper.
 *
 * @deprecated Prefer `resolveUserAccess(user).capabilities.canSyncZuper`.
 */
export function canSyncZuper(role: UserRole): boolean {
  return ROLE_PERMISSIONS[normalizeRole(role)]?.canSyncZuper ?? false;
}
