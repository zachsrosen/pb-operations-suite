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
  if ((role as string) === "OWNER") return "EXECUTIVE";
  if (role === "MANAGER") return "PROJECT_MANAGER";
  if (role === "DESIGNER" || role === "PERMITTING") return "TECH_OPS";
  return role;
}

/**
 * Define which routes and actions each role can access
 */
export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  ADMIN: {
    allowedRoutes: ["*", "/dashboards/ai"], // All routes
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
  EXECUTIVE: {
    allowedRoutes: ["*", "/dashboards/ai"], // All routes — like ADMIN but no user management
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
  OWNER: {
    // Legacy role: normalized to EXECUTIVE at runtime
    allowedRoutes: ["*", "/dashboards/ai"],
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
      "/suites/design-engineering",
      "/suites/permitting-interconnection",
      "/suites/service",
      "/suites/dnr-roofing",
      "/suites/intelligence",
      "/suites/accounting",
      "/dashboards/scheduler",
      "/dashboards/forecast-schedule",
      "/dashboards/site-survey-scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/service-scheduler",
      "/dashboards/dnr-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/service-backlog",
      "/dashboards/service",
      "/dashboards/service-overview",
      "/dashboards/service-tickets",
      "/dashboards/service-catalog",
      "/dashboards/service-customers",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/dashboards/bom",
      "/dashboards/bom/history",
      "/dashboards/pricing-calculator",
      "/dashboards/pe-deals",
      "/api/accounting",
      "/dashboards/ai",
      "/dashboards/dnr",
      "/dashboards/roofing",
      "/dashboards/roofing-scheduler",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
      "/dashboards/survey-metrics",
      "/dashboards/preconstruction-metrics",
      "/dashboards/incentives",
      "/api/hubspot/qc-metrics",
      // Intelligence dashboards
      "/dashboards/at-risk",
      "/dashboards/qc",
      "/dashboards/alerts",
      "/dashboards/pipeline",
      "/dashboards/optimizer",
      "/dashboards/capacity",
      "/dashboards/pe",
      "/dashboards/sales",
      "/dashboards/project-management",
      "/dashboards/design-engineering",
      "/dashboards/permitting-interconnection",
      // D&E Suite dashboards
      "/dashboards/de-overview",
      "/dashboards/plan-review",
      "/dashboards/pending-approval",
      "/dashboards/design-revisions",
      "/dashboards/de-metrics",
      "/dashboards/clipping-analytics",
      "/dashboards/ahj-requirements",
      "/dashboards/utility-design-requirements",
      "/dashboards/solar-surveyor",
      // P&I Suite dashboards
      "/dashboards/pi-overview",
      "/dashboards/pi-metrics",
      "/dashboards/pi-action-queue",
      "/dashboards/pi-revisions",
      "/dashboards/pi-permit-action-queue",
      "/dashboards/pi-ic-action-queue",
      "/dashboards/pi-permit-revisions",
      "/dashboards/pi-ic-revisions",
      "/dashboards/ahj-tracker",
      "/dashboards/utility-tracker",
      "/dashboards/pi-timeline",
      // Equipment catalog
      "/dashboards/catalog",
      "/dashboards/submit-product",
      "/api/projects",
      "/api/bom",
      "/api/catalog",
      "/api/products",
      "/api/service",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
      "/api/ahj",
      "/api/utility",
      // Deals
      "/dashboards/deals",
      "/api/deals",
      // Design review
      "/dashboards/reviews",
      "/api/reviews",
      // Install photo review
      "/dashboards/inspections",
      "/api/install-review",
      // Solar Surveyor
      "/api/solar",
      // SOP Guide (read-only; writes gated by /api/admin/sop)
      "/sop",
      "/api/sop",
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
      "/",
      "/suites/operations",
      "/suites/service",
      "/suites/dnr-roofing",
      "/suites/accounting",
      "/dashboards/scheduler",
      "/dashboards/forecast-schedule",
      "/dashboards/site-survey-scheduler",
      "/dashboards/site-survey",
      "/dashboards/construction-scheduler",
      "/dashboards/construction",
      "/dashboards/inspection-scheduler",
      "/dashboards/service-scheduler",
      "/dashboards/dnr-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/service-backlog",
      "/dashboards/service",
      "/dashboards/service-overview",
      "/dashboards/service-tickets",
      "/dashboards/service-catalog",
      "/dashboards/service-customers",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/dashboards/bom",
      "/dashboards/bom/history",
      "/dashboards/pricing-calculator",
      "/dashboards/pe-deals",
      "/api/accounting",
      "/dashboards/dnr",
      "/dashboards/roofing",
      "/dashboards/roofing-scheduler",
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
      "/dashboards/survey-metrics",
      "/api/hubspot/qc-metrics",
      // Equipment catalog
      "/dashboards/catalog",
      "/dashboards/submit-product",
      "/dashboards/product-comparison",
      "/api/projects",
      "/api/bom",
      "/api/catalog",
      "/api/products",
      "/api/service",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
      // Deals
      "/dashboards/deals",
      "/api/deals",
      // Install photo review
      "/dashboards/inspections",
      "/api/install-review",
      // Solar Surveyor
      "/api/solar",
      // SOP Guide
      "/sop",
      "/api/sop",
      // Forecasting API (read-only, needed for scheduler ghost events)
      "/api/forecasting",
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
      "/",
      "/suites/operations",
      "/suites/service",
      "/suites/dnr-roofing",
      "/suites/intelligence",
      "/suites/accounting",
      "/dashboards/scheduler",
      "/dashboards/forecast-schedule",
      "/dashboards/site-survey-scheduler",
      "/dashboards/site-survey",
      "/dashboards/construction-scheduler",
      "/dashboards/construction",
      "/dashboards/inspection-scheduler",
      "/dashboards/service-scheduler",
      "/dashboards/dnr-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/service-backlog",
      "/dashboards/service",
      "/dashboards/service-overview",
      "/dashboards/service-tickets",
      "/dashboards/service-catalog",
      "/dashboards/service-customers",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/dashboards/bom",
      "/dashboards/bom/history",
      "/dashboards/pricing-calculator",
      "/dashboards/pe-deals",
      "/api/accounting",
      "/dashboards/ai",
      "/dashboards/dnr",
      "/dashboards/roofing",
      "/dashboards/roofing-scheduler",
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
      "/dashboards/survey-metrics",
      "/api/hubspot/qc-metrics",
      // Intelligence dashboards
      "/dashboards/at-risk",
      "/dashboards/qc",
      "/dashboards/alerts",
      "/dashboards/pipeline",
      "/dashboards/optimizer",
      "/dashboards/capacity",
      "/dashboards/pe",
      "/dashboards/sales",
      "/dashboards/project-management",
      "/dashboards/design-engineering",
      "/dashboards/permitting-interconnection",
      // Executive dashboards (read-only visibility)
      "/suites/executive",
      "/dashboards/executive",
      "/dashboards/executive-calendar",
      "/dashboards/revenue",
      "/dashboards/locations",
      "/dashboards/command-center",
      "/dashboards/capacity",
      "/dashboards/forecast-accuracy",
      "/dashboards/forecast-timeline",
      "/dashboards/preconstruction-metrics",
      "/api/forecasting",
      // Equipment catalog
      "/dashboards/catalog",
      "/dashboards/submit-product",
      "/dashboards/product-comparison",
      "/api/projects",
      "/api/bom",
      "/api/catalog",
      "/api/products",
      "/api/service",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
      // Deals
      "/dashboards/deals",
      "/api/deals",
      // Design review
      "/dashboards/reviews",
      "/api/reviews",
      // Install photo review
      "/dashboards/inspections",
      "/api/install-review",
      // Solar Surveyor
      "/api/solar",
      // SOP Guide
      "/sop",
      "/api/sop",
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
      "/suites/design-engineering",
      "/suites/permitting-interconnection",
      "/suites/service",
      "/suites/dnr-roofing",
      "/suites/intelligence",
      "/suites/executive",
      "/suites/accounting",
      "/dashboards/scheduler",
      "/dashboards/forecast-schedule",
      "/dashboards/site-survey-scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/service-scheduler",
      "/dashboards/dnr-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/service-backlog",
      "/dashboards/service",
      "/dashboards/service-overview",
      "/dashboards/service-tickets",
      "/dashboards/service-catalog",
      "/dashboards/service-customers",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/dashboards/bom",
      "/dashboards/bom/history",
      "/dashboards/pricing-calculator",
      "/dashboards/pe-deals",
      "/api/accounting",
      "/dashboards/ai",
      "/dashboards/dnr",
      "/dashboards/roofing",
      "/dashboards/roofing-scheduler",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
      "/dashboards/survey-metrics",
      "/dashboards/incentives",
      "/api/hubspot/qc-metrics",
      // Intelligence dashboards
      "/dashboards/at-risk",
      "/dashboards/qc",
      "/dashboards/alerts",
      "/dashboards/pipeline",
      "/dashboards/optimizer",
      "/dashboards/capacity",
      "/dashboards/pe",
      "/dashboards/sales",
      "/dashboards/project-management",
      "/dashboards/design-engineering",
      "/dashboards/permitting-interconnection",
      // Executive dashboards (read-only visibility)
      "/dashboards/executive",
      "/dashboards/executive-calendar",
      "/dashboards/revenue",
      "/dashboards/locations",
      "/dashboards/command-center",
      "/dashboards/forecast-accuracy",
      "/dashboards/forecast-timeline",
      "/dashboards/preconstruction-metrics",
      "/api/forecasting",
      // D&E Suite dashboards
      "/dashboards/de-overview",
      "/dashboards/plan-review",
      "/dashboards/pending-approval",
      "/dashboards/design-revisions",
      "/dashboards/de-metrics",
      "/dashboards/clipping-analytics",
      "/dashboards/ahj-requirements",
      "/dashboards/utility-design-requirements",
      "/dashboards/solar-surveyor",
      // P&I Suite dashboards
      "/dashboards/pi-overview",
      "/dashboards/pi-metrics",
      "/dashboards/pi-action-queue",
      "/dashboards/pi-revisions",
      "/dashboards/pi-permit-action-queue",
      "/dashboards/pi-ic-action-queue",
      "/dashboards/pi-permit-revisions",
      "/dashboards/pi-ic-revisions",
      "/dashboards/ahj-tracker",
      "/dashboards/utility-tracker",
      "/dashboards/pi-timeline",
      // Equipment catalog
      "/dashboards/catalog",
      "/dashboards/submit-product",
      "/api/projects",
      "/api/bom",
      "/api/catalog",
      "/api/products",
      "/api/service",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
      "/api/ahj",
      "/api/utility",
      // Deals
      "/dashboards/deals",
      "/api/deals",
      // Design review
      "/dashboards/reviews",
      "/api/reviews",
      // Install photo review
      "/dashboards/inspections",
      "/api/install-review",
      // Solar Surveyor
      "/api/solar",
      // SOP Guide
      "/sop",
      "/api/sop",
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
      "/",
      "/suites/design-engineering",
      "/suites/permitting-interconnection",
      "/suites/operations",
      "/suites/accounting",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
      "/dashboards/survey-metrics",
      "/dashboards/incentives",
      "/api/hubspot/qc-metrics",
      "/dashboards/scheduler",
      "/dashboards/forecast-schedule",
      "/dashboards/site-survey-scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/service-scheduler",
      "/dashboards/dnr-scheduler",
      "/dashboards/equipment-backlog",
      "/dashboards/service-backlog",
      "/dashboards/service",
      "/dashboards/service-tickets",
      "/dashboards/service-catalog",
      "/dashboards/service-customers",
      "/dashboards/inventory",
      "/dashboards/timeline",
      "/dashboards/bom",
      "/dashboards/bom/history",
      "/dashboards/pricing-calculator",
      "/dashboards/pe-deals",
      "/api/accounting",
      "/dashboards/dnr",
      "/dashboards/roofing",
      "/dashboards/roofing-scheduler",
      // D&E Suite dashboards
      "/dashboards/de-overview",
      "/dashboards/plan-review",
      "/dashboards/pending-approval",
      "/dashboards/design-revisions",
      "/dashboards/de-metrics",
      "/dashboards/clipping-analytics",
      "/dashboards/ahj-requirements",
      "/dashboards/utility-design-requirements",
      "/dashboards/solar-surveyor",
      // P&I Suite dashboards
      "/dashboards/pi-overview",
      "/dashboards/pi-metrics",
      "/dashboards/pi-action-queue",
      "/dashboards/pi-revisions",
      "/dashboards/pi-permit-action-queue",
      "/dashboards/pi-ic-action-queue",
      "/dashboards/pi-permit-revisions",
      "/dashboards/pi-ic-revisions",
      "/dashboards/ahj-tracker",
      "/dashboards/utility-tracker",
      "/dashboards/pi-timeline",
      // Equipment catalog
      "/dashboards/catalog",
      "/dashboards/submit-product",
      "/api/projects",
      "/api/bom",
      "/api/catalog",
      "/api/products",
      "/api/service",
      "/api/zuper",
      "/api/activity/log",
      "/api/inventory",
      "/api/bugs",
      "/api/ahj",
      "/api/utility",
      // Deals
      "/dashboards/deals",
      "/api/deals",
      // Design review
      "/dashboards/reviews",
      "/api/reviews",
      // Install photo review
      "/dashboards/inspections",
      "/api/install-review",
      // Solar Surveyor
      "/api/solar",
      // AI hub
      "/dashboards/ai",
      // SOP Guide
      "/sop",
      "/api/sop",
      // Forecasting API (read-only, needed for scheduler ghost events)
      "/api/forecasting",
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
      "/",
      "/suites/operations",
      "/suites/design-engineering",
      "/suites/permitting-interconnection",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
      "/dashboards/survey-metrics",
      "/dashboards/incentives",
      "/api/hubspot/qc-metrics",
      // D&E Suite dashboards
      "/dashboards/de-overview",
      "/dashboards/plan-review",
      "/dashboards/pending-approval",
      "/dashboards/design-revisions",
      "/dashboards/de-metrics",
      "/dashboards/clipping-analytics",
      "/dashboards/ahj-requirements",
      "/dashboards/utility-design-requirements",
      "/dashboards/solar-surveyor",
      // P&I Suite dashboards
      "/dashboards/pi-overview",
      "/dashboards/pi-metrics",
      "/dashboards/pi-action-queue",
      "/dashboards/pi-revisions",
      "/dashboards/pi-permit-action-queue",
      "/dashboards/pi-ic-action-queue",
      "/dashboards/pi-permit-revisions",
      "/dashboards/pi-ic-revisions",
      "/dashboards/ahj-tracker",
      "/dashboards/utility-tracker",
      "/dashboards/pi-timeline",
      "/api/projects",
      "/api/activity/log",
      "/api/bugs",
      "/api/ahj",
      "/api/utility",
      // Deals
      "/dashboards/deals",
      "/api/deals",
      // Design review
      "/dashboards/reviews",
      "/api/reviews",
      // Solar Surveyor
      "/api/solar",
      // SOP Guide
      "/sop",
      "/api/sop",
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
      "/",
      "/suites/operations",
      "/suites/design-engineering",
      "/suites/permitting-interconnection",
      "/dashboards/site-survey",
      "/dashboards/design",
      "/dashboards/permitting",
      "/dashboards/inspections",
      "/dashboards/interconnection",
      "/dashboards/construction",
      "/dashboards/construction-metrics",
      "/dashboards/inspection-metrics",
      "/dashboards/survey-metrics",
      "/dashboards/incentives",
      "/api/hubspot/qc-metrics",
      // D&E Suite dashboards
      "/dashboards/de-overview",
      "/dashboards/plan-review",
      "/dashboards/pending-approval",
      "/dashboards/design-revisions",
      "/dashboards/de-metrics",
      "/dashboards/clipping-analytics",
      "/dashboards/ahj-requirements",
      "/dashboards/utility-design-requirements",
      "/dashboards/solar-surveyor",
      // P&I Suite dashboards
      "/dashboards/pi-overview",
      "/dashboards/pi-metrics",
      "/dashboards/pi-action-queue",
      "/dashboards/pi-revisions",
      "/dashboards/pi-permit-action-queue",
      "/dashboards/pi-ic-action-queue",
      "/dashboards/pi-permit-revisions",
      "/dashboards/pi-ic-revisions",
      "/dashboards/ahj-tracker",
      "/dashboards/utility-tracker",
      "/dashboards/pi-timeline",
      "/api/projects",
      "/api/activity/log",
      "/api/bugs",
      "/api/ahj",
      "/api/utility",
      // Deals
      "/dashboards/deals",
      "/api/deals",
      // Solar Surveyor
      "/api/solar",
      // SOP Guide
      "/sop",
      "/api/sop",
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
      "/",
      "/unassigned",
      "/dashboards/deals",
      "/api/deals",
      "/api/projects",
      "/api/activity/log",
      "/api/user/me",
      "/api/solar",
      // SOP Guide
      "/sop",
      "/api/sop",
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
  SALES_MANAGER: {
    allowedRoutes: [
      "/",
      "/suites/operations",
      "/suites/intelligence",
      "/suites/executive",
      "/suites/accounting",
      // Sales & deals dashboards
      "/dashboards/sales",
      "/dashboards/deals",
      "/dashboards/pipeline",
      "/dashboards/site-survey-scheduler",
      "/dashboards/forecast-schedule",
      "/dashboards/forecast-timeline",
      "/dashboards/forecast-accuracy",
      // Operations visibility
      "/dashboards/scheduler",
      "/dashboards/construction-scheduler",
      "/dashboards/inspection-scheduler",
      "/dashboards/timeline",
      "/dashboards/construction",
      "/dashboards/survey-metrics",
      // Intelligence dashboards
      "/dashboards/at-risk",
      "/dashboards/qc",
      "/dashboards/alerts",
      "/dashboards/optimizer",
      "/dashboards/capacity",
      "/dashboards/pe",
      "/dashboards/pe-deals",
      "/api/accounting",
      "/dashboards/pricing-calculator",
      "/dashboards/project-management",
      // Executive dashboards
      "/dashboards/executive",
      "/dashboards/executive-calendar",
      "/dashboards/revenue",
      "/dashboards/locations",
      "/dashboards/command-center",
      // API access
      "/api/projects",
      "/api/deals",
      "/api/forecasting",
      "/api/revenue-goals",
      "/api/zuper/availability",
      "/api/zuper/status",
      "/api/zuper/jobs/lookup",
      "/api/zuper/jobs/schedule",
      "/api/activity/log",
      "/api/bugs",
      // SOP Guide
      "/sop",
      "/api/sop",
    ],
    canScheduleSurveys: true,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
  SALES: {
    allowedRoutes: [
      "/",
      "/dashboards/site-survey-scheduler",
      "/dashboards/sales",
      "/dashboards/deals",
      "/api/deals",
      "/api/projects",
      "/api/zuper/availability",
      "/api/zuper/status",
      "/api/zuper/jobs/lookup",
      "/api/zuper/jobs/schedule",
      "/api/zuper/my-availability",
      "/api/bugs",
      // SOP Guide
      "/sop",
      "/api/sop",
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
 * Get the default landing route for a role.
 * Prefers suite pages, then dashboard pages, then first explicit route.
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
 * Routes restricted to ADMIN role only.
 * Policy: new pages/features should be added here first (admin-only) until
 * explicitly approved for broader roles.
 */
export const ADMIN_ONLY_ROUTES: string[] = [
  "/admin",
  "/api/admin",
  "/suites/admin",
  "/dashboards/zuper-status-comparison",
  "/dashboards/zuper-compliance",
  "/dashboards/product-comparison",
  "/dashboards/mobile",
  "/dashboards/inventory",
  "/dashboards/catalog",
  "/dashboards/command-center",
  "/dashboards/capacity",
  "/dashboards/locations",
  // AI assistant chat — admin-only until per-deal access boundaries confirmed
  "/api/chat",
];

/**
 * Sub-routes exempt from the admin-only restriction above.
 * These are accessible to any role that has the parent route in their allowedRoutes.
 */
export const ADMIN_ONLY_EXCEPTIONS: string[] = [
  "/dashboards/catalog/new",
  "/api/catalog/push-requests",
  "/api/catalog/extract-from-datasheet",
  "/api/catalog/upload-photo",
];


/**
 * Check if a user role can access a specific route
 */
export function canAccessRoute(role: UserRole, route: string): boolean {
  const effectiveRole = normalizeRole(role);
  const permissions = ROLE_PERMISSIONS[effectiveRole];
  if (!permissions) return false;

  // Check admin-only routes first — only ADMIN can access these
  // But allow specific sub-routes that are exempted (e.g. /dashboards/catalog/new)
  const isAdminOnly = ADMIN_ONLY_ROUTES.some((restricted) => route === restricted || route.startsWith(`${restricted}/`));
  if (isAdminOnly) {
    const isExempted = ADMIN_ONLY_EXCEPTIONS.some((exempted) => route === exempted || route.startsWith(`${exempted}/`));
    if (!isExempted) {
      return effectiveRole === "ADMIN";
    }
  }

  // Roles with "*" can access all routes
  if (permissions.allowedRoutes.includes("*")) return true;

  // Check specific routes (segment-boundary matching to prevent /api/catalog matching /api/catalogue)
  return permissions.allowedRoutes.some(allowed =>
    allowed === "/" ? route === "/" : (route === allowed || route.startsWith(`${allowed}/`))
  );
}

/**
 * Check if user can schedule a specific type
 */
export function canScheduleType(role: UserRole, scheduleType: "survey" | "pre-sale-survey" | "installation" | "inspection"): boolean {
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
