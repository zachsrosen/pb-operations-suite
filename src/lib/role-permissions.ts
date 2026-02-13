/**
 * Role-Based Permissions (Edge-Compatible)
 *
 * This file is importable in Next.js Edge Runtime (middleware)
 * because it has ZERO Node.js or Prisma dependencies.
 *
 * All permission checks and role constants live here.
 * db.ts re-exports these for backward compatibility.
 */

import { UserRole } from "@/generated/prisma/enums";

// Re-export UserRole for convenience
export { UserRole };

/**
 * Permission structure for roles
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
 * This keeps old DB enum values working without granting unintended access.
 */
export function normalizeRole(role: UserRole): UserRole {
  if (role === "MANAGER") return "PROJECT_MANAGER";
  if (role === "DESIGNER" || role === "PERMITTING") return "TECH_OPS";
  return role;
}

/**
 * Define which routes and actions each role can access
 */
export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  ADMIN: {
    allowedRoutes: ["*"], // All routes
    canScheduleSurveys: true,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: true,
    canManageAvailability: true,
    canEditDesign: true,
    canEditPermitting: true,
    canViewAllLocations: true,
  },
  OWNER: {
    allowedRoutes: ["*"], // All routes — like ADMIN but no user management
    canScheduleSurveys: true,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: true,
    canEditDesign: true,
    canEditPermitting: true,
    canViewAllLocations: true,
  },
  MANAGER: {
    // Legacy role: normalized to PROJECT_MANAGER at runtime
    allowedRoutes: [
      "/",
      "/suites/operations",
      "/suites/department",
      "/dashboards/scheduler",
      "/dashboards/site-survey-scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/incentives",
      "/api/projects",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
    ],
    canScheduleSurveys: true,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: true,
    canEditDesign: true,
    canEditPermitting: true,
    canViewAllLocations: true,
  },
  OPERATIONS: {
    allowedRoutes: [
      "/suites/operations",
      "/dashboards/scheduler",
      "/dashboards/site-survey-scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/api/projects",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: true,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  OPERATIONS_MANAGER: {
    allowedRoutes: [
      "/suites/operations",
      "/dashboards/scheduler",
      "/dashboards/site-survey-scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/api/projects",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
    ],
    canScheduleSurveys: true,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: true,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  PROJECT_MANAGER: {
    allowedRoutes: [
      "/",
      "/suites/operations",
      "/suites/department",
      "/dashboards/scheduler",
      "/dashboards/site-survey-scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/incentives",
      "/api/projects",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
    ],
    canScheduleSurveys: true,
    canScheduleInstalls: true,
    canScheduleInspections: true,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  TECH_OPS: {
    allowedRoutes: [
      "/suites/department",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/incentives",
      "/api/projects",
      "/api/activity/log",
      "/api/bugs",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: true, // Can manage their own availability
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: false, // Only their location
  },
  DESIGNER: {
    // Legacy role: normalized to TECH_OPS at runtime
    allowedRoutes: [
      "/suites/department",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/incentives",
      "/api/projects",
      "/api/activity/log",
      "/api/bugs",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: true,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  PERMITTING: {
    // Legacy role: normalized to TECH_OPS at runtime
    allowedRoutes: [
      "/suites/department",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/incentives",
      "/api/projects",
      "/api/activity/log",
      "/api/bugs",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: true,
    canViewAllLocations: true,
  },
  VIEWER: {
    // Unassigned role (new users default here until explicitly assigned)
    allowedRoutes: [
      "/unassigned",
      "/api/activity/log",
      "/api/user/me",
    ],
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  SALES: {
    allowedRoutes: [
      "/dashboards/site-survey-scheduler",
      "/api/projects",
      "/api/zuper/availability",
      "/api/zuper/status",
      "/api/zuper/jobs/lookup",
      "/api/zuper/jobs/schedule",
      "/api/zuper/my-availability",
      "/api/bugs",
    ],
    canScheduleSurveys: true,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: false, // SALES sees only their location
  },
};

/**
 * Routes restricted to ADMIN role only.
 * New dashboards/features go here until confirmed ready for wider access.
 */
export const ADMIN_ONLY_ROUTES: string[] = [
  // Note: Don't add dashboard/API routes here — JWT role in middleware defaults
  // to TECH_OPS (not synced from DB), so admin-only gating must happen client-side
  // (for pages) or server-side in the route handler (for APIs).
];

/**
 * Check if a user role can access a specific route
 */
export function canAccessRoute(role: UserRole, route: string): boolean {
  const effectiveRole = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[effectiveRole];
  if (!permissions) return false;

  // Check admin-only routes first — only ADMIN can access these
  if (ADMIN_ONLY_ROUTES.some(restricted => route.startsWith(restricted))) {
    return effectiveRole === "ADMIN";
  }

  // Roles with "*" can access all routes
  if (permissions.allowedRoutes.includes("*")) return true;

  // Check specific routes
  return permissions.allowedRoutes.some(allowed =>
    allowed === "/" ? route === "/" : route.startsWith(allowed)
  );
}

/**
 * Check if user can schedule a specific type
 */
export function canScheduleType(role: UserRole, scheduleType: "survey" | "installation" | "inspection"): boolean {
  const permissions = ROLE_PERMISSIONS[normalizeRole(role)];
  if (!permissions) return false;

  switch (scheduleType) {
    case "survey":
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
 * Check if user can perform any scheduling actions (legacy support)
 */
export function canSchedule(role: UserRole): boolean {
  const permissions = ROLE_PERMISSIONS[normalizeRole(role)];
  if (!permissions) return false;
  return permissions.canScheduleSurveys || permissions.canScheduleInstalls || permissions.canScheduleInspections;
}

/**
 * Check if user can sync to Zuper
 */
export function canSyncZuper(role: UserRole): boolean {
  return ROLE_PERMISSIONS[normalizeRole(role)]?.canSyncZuper ?? false;
}
