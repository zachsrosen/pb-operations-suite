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
    allowedRoutes: ["*"], // All routes
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
      "/dashboards/construction",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/scheduler",
      "/dashboards/at-risk",
      "/dashboards/timeline",
      "/handbook",
      "/api/projects",
      "/api/zuper",
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
    allowedRoutes: ["*"], // All routes — full operational oversight
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
    allowedRoutes: ["*"], // All routes — project tracking & scheduling
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
      "/dashboards/construction",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/scheduler",
      "/dashboards/site-survey-scheduler",
      "/dashboards/timeline",
      "/handbook",
      "/api/projects",
      "/api/zuper",
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
    allowedRoutes: [
      "/dashboards/design",
      "/dashboards/pe",
      "/dashboards/timeline",
      "/handbook",
      "/api/projects",
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
    allowedRoutes: [
      "/dashboards/permitting",
      "/dashboards/interconnection",
      "/dashboards/timeline",
      "/handbook",
      "/api/projects",
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
    allowedRoutes: ["*"], // All routes, read-only
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
      "/dashboards/sales",
      "/handbook",
      "/api/projects",
      "/api/zuper/availability",
      "/api/zuper/status",
      "/api/zuper/jobs/lookup",
      "/api/zuper/jobs/schedule",
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
 * Check if a user role can access a specific route
 */
export function canAccessRoute(role: UserRole, route: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;

  // Roles with "*" can access all routes
  if (permissions.allowedRoutes.includes("*")) return true;

  // Check specific routes
  return permissions.allowedRoutes.some(allowed =>
    route.startsWith(allowed)
  );
}

/**
 * Check if user can schedule a specific type
 */
export function canScheduleType(role: UserRole, scheduleType: "survey" | "installation" | "inspection"): boolean {
  const permissions = ROLE_PERMISSIONS[role];
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
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  return permissions.canScheduleSurveys || permissions.canScheduleInstalls || permissions.canScheduleInspections;
}

/**
 * Check if user can sync to Zuper
 */
export function canSyncZuper(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role]?.canSyncZuper ?? false;
}
