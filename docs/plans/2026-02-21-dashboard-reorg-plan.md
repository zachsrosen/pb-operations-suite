# Dashboard Reorganization Implementation Plan (v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize 43 dashboards from 7 suites into 6 purpose-driven suites, add role-based landing pages, extend AI bot access, and update the app icon.

**Architecture:** Config-driven approach — a single role-to-landing config object drives the home page, while suite pages and permissions are updated to match the new structure. No new components needed; existing `SuitePageShell`, `DashboardShell`, and home page are modified in place.

**Tech Stack:** Next.js, React, Prisma, TypeScript, Tailwind CSS

**Design doc:** `docs/plans/2026-02-21-dashboard-reorg-design.md`

---

### Task 1: Update Suite Navigation Config

**Files:**
- Modify: `src/lib/suite-nav.ts` (entire file — 90 lines)

**Step 1: Replace SUITE_NAV_ENTRIES with new suite list**

Replace the `SUITE_NAV_ENTRIES` array (lines 10-53) with:

```typescript
export const SUITE_NAV_ENTRIES: SuiteNavEntry[] = [
  {
    href: "/suites/operations",
    title: "Operations Suite",
    shortLabel: "Operations",
    description: "Scheduling, timeline, inventory, and equipment operations.",
  },
  {
    href: "/suites/department",
    title: "Department Suite",
    shortLabel: "Departments",
    description: "Team-level execution dashboards by functional area.",
  },
  {
    href: "/suites/intelligence",
    title: "Intelligence Suite",
    shortLabel: "Intelligence",
    description: "Risk analysis, QC, capacity planning, and pipeline analytics.",
  },
  {
    href: "/suites/service",
    title: "Service + D&R Suite",
    shortLabel: "Service + D&R",
    description: "Service and detach & reset scheduling, equipment, and pipelines.",
  },
  {
    href: "/suites/executive",
    title: "Executive Suite",
    shortLabel: "Executive",
    description: "Leadership metrics, revenue, and cross-location analysis.",
  },
  {
    href: "/suites/admin",
    title: "Admin Suite",
    shortLabel: "Admin",
    description: "Administrative controls, security, compliance, and documentation.",
  },
];
```

**Step 2: Replace SUITE_SWITCHER_ALLOWLIST with new role mappings**

Replace lines 55-81 with:

```typescript
const SUITE_SWITCHER_ALLOWLIST: Record<UserRole, string[]> = {
  ADMIN: [
    "/suites/operations",
    "/suites/department",
    "/suites/intelligence",
    "/suites/service",
    "/suites/executive",
    "/suites/admin",
  ],
  OWNER: [
    "/suites/operations",
    "/suites/department",
    "/suites/intelligence",
    "/suites/service",
    "/suites/executive",
  ],
  MANAGER: ["/suites/operations", "/suites/department", "/suites/intelligence", "/suites/service"],
  PROJECT_MANAGER: ["/suites/operations", "/suites/department", "/suites/intelligence", "/suites/service"],
  OPERATIONS: ["/suites/operations", "/suites/service"],
  OPERATIONS_MANAGER: ["/suites/operations", "/suites/intelligence", "/suites/service"],
  TECH_OPS: ["/suites/department"],
  DESIGNER: ["/suites/department"],
  PERMITTING: ["/suites/department"],
  SALES: [],
  VIEWER: [],
};
```

Note: MANAGER, DESIGNER, PERMITTING kept for backwards compatibility — legacy role removal is deferred to a follow-up PR.

**Step 3: Commit**

```bash
git add src/lib/suite-nav.ts
git commit -m "refactor: update suite-nav config for new 6-suite structure"
```

---

### Task 2: Update DashboardShell SUITE_MAP

**Files:**
- Modify: `src/components/DashboardShell.tsx` (lines 10-56, the `SUITE_MAP` object)

**Step 1: Replace the entire SUITE_MAP object**

Replace lines 10-56 with:

```typescript
const SUITE_MAP: Record<string, { href: string; label: string }> = {
  // Operations Suite
  "/dashboards/scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/site-survey-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/construction-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inspection-scheduler": { href: "/suites/operations", label: "Operations" },
  "/dashboards/timeline": { href: "/suites/operations", label: "Operations" },
  "/dashboards/equipment-backlog": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inventory": { href: "/suites/operations", label: "Operations" },
  "/dashboards/bom": { href: "/suites/operations", label: "Operations" },
  "/dashboards/bom/history": { href: "/suites/operations", label: "Operations" },
  // Department Suite
  "/dashboards/site-survey": { href: "/suites/department", label: "Departments" },
  "/dashboards/design": { href: "/suites/department", label: "Departments" },
  "/dashboards/permitting": { href: "/suites/department", label: "Departments" },
  "/dashboards/inspections": { href: "/suites/department", label: "Departments" },
  "/dashboards/interconnection": { href: "/suites/department", label: "Departments" },
  "/dashboards/construction": { href: "/suites/department", label: "Departments" },
  "/dashboards/incentives": { href: "/suites/department", label: "Departments" },
  // Intelligence Suite
  "/dashboards/at-risk": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/qc": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/alerts": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/pipeline": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/optimizer": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/capacity": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/pe": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/sales": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/project-management": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/design-engineering": { href: "/suites/intelligence", label: "Intelligence" },
  "/dashboards/permitting-interconnection": { href: "/suites/intelligence", label: "Intelligence" },
  // Executive Suite
  "/dashboards/command-center": { href: "/suites/executive", label: "Executive" },
  "/dashboards/revenue": { href: "/suites/executive", label: "Executive" },
  "/dashboards/executive": { href: "/suites/executive", label: "Executive" },
  "/dashboards/locations": { href: "/suites/executive", label: "Executive" },
  "/dashboards/executive-calendar": { href: "/suites/executive", label: "Executive" },
  // Service + D&R Suite
  "/dashboards/service-scheduler": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/service-backlog": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/service": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/dnr-scheduler": { href: "/suites/service", label: "Service + D&R" },
  "/dashboards/dnr": { href: "/suites/service", label: "Service + D&R" },
  // Admin Suite
  "/dashboards/zuper-status-comparison": { href: "/suites/admin", label: "Admin" },
  "/dashboards/zuper-compliance": { href: "/suites/admin", label: "Admin" },
  "/dashboards/product-comparison": { href: "/suites/admin", label: "Admin" },
  "/dashboards/mobile": { href: "/suites/admin", label: "Admin" },
};
```

**Step 2: Commit**

```bash
git add src/components/DashboardShell.tsx
git commit -m "refactor: update DashboardShell SUITE_MAP for new suite structure"
```

---

### Task 3: Update Role Permissions

**Files:**
- Modify: `src/lib/role-permissions.ts` (lines 45-329, 354-359)

**Step 1: Update OPERATIONS allowedRoutes (lines 112-143)**

Add `"/"`, `"/dashboards/bom"`, `"/dashboards/bom/history"`, `"/dashboards/dnr"`:

```typescript
OPERATIONS: {
  allowedRoutes: [
    "/",
    "/suites/operations",
    "/suites/service",
    "/dashboards/scheduler",
    "/dashboards/site-survey-scheduler",
    "/dashboards/construction-scheduler",
    "/dashboards/inspection-scheduler",
    "/dashboards/service-scheduler",
    "/dashboards/dnr-scheduler",
    "/dashboards/equipment-backlog",
    "/dashboards/service-backlog",
    "/dashboards/service",
    "/dashboards/inventory",
    "/dashboards/timeline",
    "/dashboards/bom",
    "/dashboards/bom/history",
    "/dashboards/dnr",
    "/api/projects",
    "/api/service",
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
```

**Step 2: Update OPERATIONS_MANAGER allowedRoutes (lines 144-175)**

Add `"/"`, `/suites/intelligence`, all Intelligence dashboard routes, `"/dashboards/bom"`, `"/dashboards/bom/history"`, `"/dashboards/dnr"`:

```typescript
OPERATIONS_MANAGER: {
  allowedRoutes: [
    "/",
    "/suites/operations",
    "/suites/service",
    "/suites/intelligence",
    "/dashboards/scheduler",
    "/dashboards/site-survey-scheduler",
    "/dashboards/construction-scheduler",
    "/dashboards/inspection-scheduler",
    "/dashboards/service-scheduler",
    "/dashboards/dnr-scheduler",
    "/dashboards/equipment-backlog",
    "/dashboards/service-backlog",
    "/dashboards/service",
    "/dashboards/inventory",
    "/dashboards/timeline",
    "/dashboards/bom",
    "/dashboards/bom/history",
    "/dashboards/dnr",
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
    "/api/projects",
    "/api/service",
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
```

**Step 3: Update PROJECT_MANAGER allowedRoutes (lines 176-216)**

Add `/suites/intelligence`, all Intelligence routes, `"/dashboards/bom"`, `"/dashboards/bom/history"`, `"/dashboards/dnr"`:

```typescript
PROJECT_MANAGER: {
  allowedRoutes: [
    "/",
    "/suites/operations",
    "/suites/department",
    "/suites/service",
    "/suites/intelligence",
    "/dashboards/scheduler",
    "/dashboards/site-survey-scheduler",
    "/dashboards/construction-scheduler",
    "/dashboards/inspection-scheduler",
    "/dashboards/service-scheduler",
    "/dashboards/dnr-scheduler",
    "/dashboards/equipment-backlog",
    "/dashboards/service-backlog",
    "/dashboards/service",
    "/dashboards/inventory",
    "/dashboards/timeline",
    "/dashboards/bom",
    "/dashboards/bom/history",
    "/dashboards/dnr",
    "/dashboards/site-survey",
    "/dashboards/design",
    "/dashboards/permitting",
    "/dashboards/inspections",
    "/dashboards/interconnection",
    "/dashboards/construction",
    "/dashboards/incentives",
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
    "/api/projects",
    "/api/service",
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
```

**Step 4: Update TECH_OPS — add "/" for home access (lines 217-240)**

```typescript
TECH_OPS: {
  allowedRoutes: [
    "/",
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
  // ... rest unchanged
},
```

**Step 5: Update SALES — add "/" and "/dashboards/sales" (lines 308-328)**

```typescript
SALES: {
  allowedRoutes: [
    "/",
    "/dashboards/site-survey-scheduler",
    "/dashboards/sales",
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
  canViewAllLocations: false,
},
```

**Step 6: Update ADMIN_ONLY_ROUTES (lines 354-359)**

```typescript
export const ADMIN_ONLY_ROUTES: string[] = [
  "/admin",
  "/api/admin",
  "/suites/admin",
  "/dashboards/zuper-status-comparison",
  "/dashboards/zuper-compliance",
  "/dashboards/product-comparison",
  "/dashboards/mobile",
];
```

**Step 7: Verify middleware allows "/" for all authenticated roles**

Check `src/middleware.ts` — the home route `/` should be allowed through for all authenticated roles. The middleware should defer to `canAccessRoute()` which now returns true for all roles with `"/"` in their allowedRoutes.

**Step 8: Commit**

```bash
git add src/lib/role-permissions.ts src/middleware.ts
git commit -m "feat: update role permissions for new suite structure, Intelligence access, and home access for all roles"
```

---

### Task 4: Create Intelligence Suite Page

**Files:**
- Create: `src/app/suites/intelligence/page.tsx`

**Step 1: Create the Intelligence suite page**

```typescript
import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/at-risk",
    title: "At-Risk Projects",
    description: "Projects with overdue milestones, stalled stages, and severity scoring.",
    tag: "AT-RISK",
    tagColor: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/qc",
    title: "QC Metrics",
    description: "Time-between-stages analytics by office and utility.",
    tag: "QC",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/alerts",
    title: "Alerts",
    description: "Overdue installs, PE PTO risks, and capacity overload warnings.",
    tag: "ALERTS",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Risk & Quality",
  },
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full project pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/optimizer",
    title: "Pipeline Optimizer",
    description: "Identify scheduling opportunities and optimize project throughput.",
    tag: "OPTIMIZER",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/capacity",
    title: "Capacity Planning",
    description: "Crew capacity vs. forecasted installs across all locations.",
    tag: "CAPACITY",
    tagColor: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/pe",
    title: "PE Dashboard",
    description: "Participate Energy milestone tracking and compliance monitoring.",
    tag: "PE",
    tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Pipeline & Capacity",
  },
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Department Analytics",
  },
  {
    href: "/dashboards/design-engineering",
    title: "Design & Engineering",
    description: "Cross-state design analytics, status breakdowns, and ops clarification queue.",
    tag: "D&E",
    tagColor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    section: "Department Analytics",
  },
  {
    href: "/dashboards/permitting-interconnection",
    title: "Permitting & Interconnection",
    description: "Combined P&I analytics, turnaround times, and action-needed views.",
    tag: "P&I",
    tagColor: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    section: "Department Analytics",
  },
];

export default async function IntelligenceSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/intelligence");

  const allowed = ["ADMIN", "OWNER", "OPERATIONS_MANAGER", "PROJECT_MANAGER"];
  if (!allowed.includes(user.role)) redirect("/");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/intelligence"
      title="Intelligence Suite"
      subtitle="Risk analysis, QC metrics, capacity planning, and pipeline analytics."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-cyan-500/50"
      columnsClassName="grid grid-cols-1 md:grid-cols-3 gap-4"
    />
  );
}
```

**Step 2: Commit**

```bash
git add src/app/suites/intelligence/page.tsx
git commit -m "feat: create Intelligence Suite page with 11 graduated dashboards"
```

---

### Task 5: Update Existing Suite Pages + Fix Stale Links

**Files:**
- Modify: `src/app/suites/operations/page.tsx`
- Modify: `src/app/suites/service/page.tsx`
- Modify: `src/app/suites/admin/page.tsx`
- Delete: `src/app/suites/testing/page.tsx`
- Delete: `src/app/suites/additional-pipeline/page.tsx`
- Modify: `src/lib/page-directory.ts` (stale suite links)
- Modify: `src/app/prototypes/solar-checkout/page.tsx` (stale back-link)
- Modify: `src/app/prototypes/solar-surveyor/page.tsx` (stale back-link)
- Modify: `src/app/prototypes/home-refresh/catalog.ts` (stale reference)
- Modify: `src/app/dashboards/product-comparison/page.tsx` (stale back-link)

**Step 1: Update Operations Suite — remove D&R Sched, add BOM**

In `src/app/suites/operations/page.tsx`, replace the `LINKS` array (lines 5-62) with:

```typescript
const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/scheduler",
    title: "Master Schedule",
    description: "Drag-and-drop scheduling calendar with crew management.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/site-survey-scheduler",
    title: "Site Survey Schedule",
    description: "Dedicated calendar for scheduling site surveys with Zuper integration.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/construction-scheduler",
    title: "Construction Schedule",
    description: "Dedicated calendar for scheduling construction installs with Zuper integration.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/inspection-scheduler",
    title: "Inspection Schedule",
    description: "Dedicated calendar for scheduling inspections with Zuper integration.",
    tag: "SCHEDULING",
    section: "Scheduling",
  },
  {
    href: "/dashboards/timeline",
    title: "Timeline View",
    description: "Gantt-style timeline showing project progression and milestones.",
    tag: "PLANNING",
    section: "Planning",
  },
  {
    href: "/dashboards/equipment-backlog",
    title: "Equipment Backlog",
    description: "Equipment forecasting by brand, model, and stage with location filtering.",
    tag: "EQUIPMENT",
    section: "Inventory & Equipment",
  },
  {
    href: "/dashboards/inventory",
    title: "Inventory Hub",
    description: "Warehouse stock levels, receiving, and demand vs. supply gap analysis.",
    tag: "INVENTORY",
    section: "Inventory & Equipment",
  },
  {
    href: "/dashboards/bom",
    title: "Planset BOM",
    description: "Import a planset bill of materials, edit inline, and cross-reference against catalogs.",
    tag: "BOM",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Inventory & Equipment",
  },
  {
    href: "/dashboards/bom/history",
    title: "BOM History",
    description: "All saved BOM snapshots across every project — search by customer, address, or deal.",
    tag: "BOM",
    tagColor: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    section: "Inventory & Equipment",
  },
];
```

**Step 2: Update Service Suite — rename to Service + D&R, add D&R dashboards**

Replace the entire `src/app/suites/service/page.tsx`:

```typescript
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/service-scheduler",
    title: "Service Schedule",
    description: "Calendar view of Zuper service visit and service revisit jobs.",
    tag: "SCHEDULING",
    section: "Service",
  },
  {
    href: "/dashboards/service-backlog",
    title: "Service Equipment Backlog",
    description: "Service pipeline equipment forecasting by brand, model, and stage.",
    tag: "EQUIPMENT",
    section: "Service",
  },
  {
    href: "/dashboards/service",
    title: "Service Pipeline",
    description: "Service deal tracking with stage progression and metrics.",
    tag: "PIPELINE",
    section: "Service",
  },
  {
    href: "/dashboards/dnr-scheduler",
    title: "D&R Schedule",
    description: "Calendar view of Zuper detach, reset, and D&R inspection jobs.",
    tag: "SCHEDULING",
    section: "D&R",
  },
  {
    href: "/dashboards/dnr",
    title: "D&R Pipeline",
    description: "Detach & Reset projects with phase tracking.",
    tag: "D&R",
    section: "D&R",
  },
];

export default async function ServiceDRSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/suites/service");

  return (
    <SuitePageShell
      currentSuiteHref="/suites/service"
      title="Service + D&R Suite"
      subtitle="Service and detach & reset scheduling, equipment tracking, and pipelines."
      cards={LINKS}
      role={user.role}
      hoverBorderClass="hover:border-purple-500/50"
      tagColorClass="bg-purple-500/20 text-purple-400 border-purple-500/30"
    />
  );
}
```

**Step 3: Update Admin Suite — add graduated dashboards + prototypes**

In `src/app/suites/admin/page.tsx`, add to the end of the `ADMIN_TOOLS` array (before `];`):

```typescript
  {
    href: "/dashboards/zuper-compliance",
    title: "Zuper Compliance",
    description: "Per-user compliance scorecards and crew-composition comparisons.",
    tag: "COMPLIANCE",
    tagColor: "bg-red-500/20 text-red-400 border-red-500/30",
    section: "Admin Tools",
  },
  {
    href: "/dashboards/product-comparison",
    title: "Product Catalog Comparison",
    description: "Compare HubSpot, Zuper, and Zoho product records to catch mismatches.",
    tag: "CATALOG",
    tagColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    section: "Admin Tools",
  },
  {
    href: "/dashboards/mobile",
    title: "Mobile Dashboard",
    description: "Touch-optimized view for field teams and fast project lookup.",
    tag: "MOBILE",
    tagColor: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    section: "Admin Tools",
  },
```

Add a PROTOTYPES array and include it in the render:

```typescript
const PROTOTYPES: SuitePageCard[] = [
  {
    href: "/prototypes/home-refresh",
    title: "Home Refresh Prototypes",
    description: "13 homepage replacement concepts, including focused teal/steel refinements.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Prototypes",
  },
  {
    href: "/prototypes/layout-refresh",
    title: "Layout Refresh Prototypes",
    description: "Replacement suite layouts for operations, department, and executive views.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Prototypes",
  },
  {
    href: "/prototypes/solar-checkout",
    title: "Solar Checkout Experience",
    description: "Customer-facing solar checkout flow prototype.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Prototypes",
  },
  {
    href: "/prototypes/solar-surveyor",
    title: "Solar Surveyor v11",
    description: "Next-generation solar site surveyor tool prototype.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Prototypes",
  },
];
```

Update render: `cards={[...ADMIN_TOOLS, ...DOCUMENTATION, ...API_SHORTCUTS, ...PROTOTYPES]}`

**Step 4: Delete Testing and Additional Pipeline suite pages**

```bash
rm src/app/suites/testing/page.tsx
rm src/app/suites/additional-pipeline/page.tsx
rmdir src/app/suites/testing 2>/dev/null || true
rmdir src/app/suites/additional-pipeline 2>/dev/null || true
```

**Step 5: Fix stale links to deleted suites**

Run grep to find all references:
```bash
grep -rn "/suites/testing\|/suites/additional-pipeline" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

Update each match:
1. `src/lib/page-directory.ts` — change `/suites/additional-pipeline` to `/suites/service`, change `/suites/testing` to `/suites/admin`
2. `src/app/prototypes/solar-checkout/page.tsx` — update any back-link from `/suites/testing` to `/suites/admin`
3. `src/app/prototypes/solar-surveyor/page.tsx` — update any back-link from `/suites/testing` to `/suites/admin`
4. `src/app/prototypes/home-refresh/catalog.ts` — update reference from `/suites/testing` to `/suites/admin`
5. `src/app/dashboards/product-comparison/page.tsx` — update back-link from `/suites/testing` to `/suites/admin`

**Step 6: Commit**

```bash
git add -A src/app/suites/ src/lib/page-directory.ts src/app/prototypes/ src/app/dashboards/product-comparison/
git commit -m "feat: update suite pages — add Intelligence, rename Service+D&R, dissolve Testing/Additional Pipeline, fix stale links"
```

---

### Task 6: Update Home Page — Role-Based Landing + AI Bot Access

**Files:**
- Modify: `src/app/page.tsx`

This is the largest change. The home page needs:
1. New SUITE_LINKS reflecting the 6 suites
2. Role-based curated dashboard cards
3. Extended AI bot access
4. Remove redirects for roles that now get landing pages
5. Browse All filtered by `canAccessRoute()`

**Step 1: Add import for canAccessRoute**

Add to existing imports at top of file:

```typescript
import { canAccessRoute, type UserRole } from "@/lib/role-permissions";
```

**Step 2: Replace SUITE_LINKS (lines 53-110)**

```typescript
const SUITE_LINKS: SuiteLinkData[] = [
  {
    href: "/suites/operations",
    title: "Operations Suite",
    description: "Scheduling, timeline, inventory, and equipment operations.",
    tag: "OPERATIONS",
    tagColor: "blue",
    visibility: "all",
  },
  {
    href: "/suites/department",
    title: "Department Suite",
    description: "Department-level dashboards for downstream execution teams.",
    tag: "DEPARTMENTS",
    tagColor: "green",
    visibility: "all",
  },
  {
    href: "/suites/intelligence",
    title: "Intelligence Suite",
    description: "Risk analysis, QC, capacity planning, and pipeline analytics.",
    tag: "INTELLIGENCE",
    tagColor: "cyan",
    visibility: "owner_admin",
  },
  {
    href: "/suites/executive",
    title: "Executive Suite",
    description: "Leadership and executive views grouped in one place.",
    tag: "EXECUTIVE",
    tagColor: "amber",
    visibility: "owner_admin",
  },
  {
    href: "/suites/service",
    title: "Service + D&R Suite",
    description: "Service and D&R scheduling, equipment tracking, and deal management.",
    tag: "SERVICE + D&R",
    tagColor: "purple",
    visibility: "all",
  },
  {
    href: "/suites/admin",
    title: "Admin Suite",
    description: "Admin tools, compliance, documentation, and prototypes.",
    tag: "ADMIN",
    tagColor: "red",
    visibility: "admin",
  },
];
```

**Step 3: Add role-based curated dashboard config**

Add after SUITE_LINKS:

```typescript
interface RoleLandingCard {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor: string;
}

const ROLE_LANDING_CARDS: Record<string, RoleLandingCard[]> = {
  OPERATIONS_MANAGER: [
    { href: "/dashboards/scheduler", title: "Master Schedule", description: "Drag-and-drop scheduling calendar with crew management.", tag: "SCHEDULING", tagColor: "blue" },
    { href: "/dashboards/construction-scheduler", title: "Construction Schedule", description: "Construction installs with Zuper integration.", tag: "SCHEDULING", tagColor: "blue" },
    { href: "/dashboards/equipment-backlog", title: "Equipment Backlog", description: "Equipment forecasting by brand, model, and stage.", tag: "EQUIPMENT", tagColor: "blue" },
    { href: "/dashboards/timeline", title: "Timeline View", description: "Gantt-style project progression and milestones.", tag: "PLANNING", tagColor: "blue" },
    { href: "/dashboards/at-risk", title: "At-Risk Projects", description: "Overdue milestones, stalled stages, severity scoring.", tag: "AT-RISK", tagColor: "orange" },
    { href: "/dashboards/capacity", title: "Capacity Planning", description: "Crew capacity vs. forecasted installs.", tag: "CAPACITY", tagColor: "cyan" },
    { href: "/dashboards/qc", title: "QC Metrics", description: "Time-between-stages analytics.", tag: "QC", tagColor: "cyan" },
  ],
  PROJECT_MANAGER: [
    { href: "/dashboards/pipeline", title: "Pipeline Overview", description: "Full pipeline with filters and milestone tracking.", tag: "PIPELINE", tagColor: "green" },
    { href: "/dashboards/at-risk", title: "At-Risk Projects", description: "Overdue milestones, stalled stages, severity scoring.", tag: "AT-RISK", tagColor: "orange" },
    { href: "/dashboards/project-management", title: "Project Management", description: "PM workload, DA backlog, stuck deals.", tag: "PM", tagColor: "green" },
    { href: "/dashboards/timeline", title: "Timeline View", description: "Gantt-style project progression and milestones.", tag: "PLANNING", tagColor: "blue" },
    { href: "/dashboards/equipment-backlog", title: "Equipment Backlog", description: "Equipment forecasting by brand, model, and stage.", tag: "EQUIPMENT", tagColor: "blue" },
  ],
  OPERATIONS: [
    { href: "/dashboards/scheduler", title: "Master Schedule", description: "Drag-and-drop scheduling calendar with crew management.", tag: "SCHEDULING", tagColor: "blue" },
    { href: "/dashboards/site-survey-scheduler", title: "Site Survey Schedule", description: "Site survey scheduling with Zuper integration.", tag: "SCHEDULING", tagColor: "blue" },
    { href: "/dashboards/construction-scheduler", title: "Construction Schedule", description: "Construction installs with Zuper integration.", tag: "SCHEDULING", tagColor: "blue" },
    { href: "/dashboards/inspection-scheduler", title: "Inspection Schedule", description: "Inspections with Zuper integration.", tag: "SCHEDULING", tagColor: "blue" },
    { href: "/dashboards/equipment-backlog", title: "Equipment Backlog", description: "Equipment forecasting by brand, model, and stage.", tag: "EQUIPMENT", tagColor: "blue" },
    { href: "/dashboards/timeline", title: "Timeline View", description: "Gantt-style project progression and milestones.", tag: "PLANNING", tagColor: "blue" },
  ],
  TECH_OPS: [
    { href: "/dashboards/site-survey", title: "Site Survey", description: "Site survey scheduling and status tracking.", tag: "SURVEY", tagColor: "green" },
    { href: "/dashboards/design", title: "Design & Engineering", description: "Design progress, engineering approvals, and plan sets.", tag: "DESIGN", tagColor: "green" },
    { href: "/dashboards/construction", title: "Construction", description: "Construction status, scheduling, and progress.", tag: "CONSTRUCTION", tagColor: "green" },
    { href: "/dashboards/inspections", title: "Inspections", description: "Inspection scheduling, pass rates, and AHJ analysis.", tag: "INSPECTIONS", tagColor: "green" },
  ],
  SALES: [
    { href: "/dashboards/sales", title: "Sales Pipeline", description: "Active deals, funnel visualization, and proposal tracking.", tag: "SALES", tagColor: "cyan" },
    { href: "/dashboards/site-survey-scheduler", title: "Site Survey Schedule", description: "Schedule site surveys with Zuper integration.", tag: "SCHEDULING", tagColor: "blue" },
  ],
};
```

**Step 4: Update canUseAI (line 415)**

```typescript
const canUseAI = userRole === "ADMIN" || userRole === "OWNER" || userRole === "OPERATIONS_MANAGER" || userRole === "PROJECT_MANAGER";
```

**Step 5: Update redirectTarget — only VIEWER redirects (lines 272-279)**

```typescript
const redirectTarget = useMemo(() => {
  if (!userRole) return null;
  if (userRole === "VIEWER") return "/unassigned";
  return null;
}, [userRole]);
```

**Step 6: Update visibleSuites — roles with landing cards don't show suites (lines 395-413)**

```typescript
const visibleSuites = useMemo(() => {
  if (!userRole) return [];
  if (userRole === "VIEWER") return [];
  if (ROLE_LANDING_CARDS[userRole]) return [];
  const isAdmin = userRole === "ADMIN";
  const isOwnerOrAdmin = isAdmin || userRole === "OWNER";
  return SUITE_LINKS.filter((suite) => {
    if (suite.visibility === "all") return true;
    if (suite.visibility === "owner_admin") return isOwnerOrAdmin;
    return isAdmin;
  });
}, [userRole]);
```

**Step 7: Add roleLandingCards computed value**

After visibleSuites:

```typescript
const roleLandingCards = useMemo(() => {
  if (!userRole) return null;
  return ROLE_LANDING_CARDS[userRole] || null;
}, [userRole]);
```

**Step 8: Update JSX — add role-based cards and Browse All with canAccessRoute**

Wrap the stats grid so it only shows for canUseAI roles:

```tsx
{canUseAI && (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
    {/* ... existing StatCards ... */}
  </div>
)}
```

Before the existing Suites section, add role-based curated cards:

```tsx
{/* Role-Based Curated Cards */}
{roleLandingCards && (
  <div>
    <h2 className="text-lg font-semibold text-foreground/80 mb-4">Your Dashboards</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 stagger-grid">
      {roleLandingCards.map((card) => (
        <DashboardLink
          key={card.href}
          href={card.href}
          title={card.title}
          description={card.description}
          tag={card.tag}
          tagColor={card.tagColor}
        />
      ))}
    </div>
    <div className="text-center mb-8">
      <button
        onClick={() => {
          const el = document.getElementById("all-suites");
          if (el) el.classList.toggle("hidden");
        }}
        className="text-sm text-muted hover:text-foreground underline transition-colors"
      >
        Browse All Suites
      </button>
    </div>
  </div>
)}

{/* Suites (for ADMIN/OWNER) */}
{visibleSuites.length > 0 && (
  <div>
    <h2 className="text-lg font-semibold text-foreground/80 mb-4 mt-8">Suites</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 stagger-grid">
      {visibleSuites.map((suite) => (
        <DashboardLink key={suite.href} {...suite} />
      ))}
    </div>
  </div>
)}

{/* Browse All — uses canAccessRoute to prevent dead-end links */}
{roleLandingCards && (
  <div id="all-suites" className="hidden">
    <h2 className="text-lg font-semibold text-foreground/80 mb-4 mt-8">All Suites</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 stagger-grid">
      {SUITE_LINKS
        .filter((suite) => canAccessRoute(userRole as UserRole, suite.href))
        .map((suite) => (
          <DashboardLink key={suite.href} {...suite} />
        ))}
    </div>
  </div>
)}
```

**Step 9: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: role-based landing pages with curated cards, extended AI bot, canAccessRoute Browse All"
```

---

### Task 7: Verify Executive Suite Page

**Files:**
- Check: `src/app/suites/executive/page.tsx`

**Step 1: Verify Revenue Calendar is present**

The executive suite should have 4 dashboards: Revenue, Executive Summary, Location Comparison, Revenue Calendar. Check the file and add Revenue Calendar if missing.

**Step 2: Commit (if changes needed)**

```bash
git add src/app/suites/executive/page.tsx
git commit -m "fix: ensure Revenue Calendar in Executive Suite"
```

---

### Task 8: App Icon Update

**Files:**
- Replace: `src/app/favicon.ico`
- Replace: `public/icons/icon-192.png`
- Replace: `public/icons/icon-512.png`
- Create: `public/icons/apple-touch-icon.png`
- Modify: `public/manifest.json` (if needed)

**Step 1: Extract the orange "O" mark from the Photon Brothers logo**

The "O" mark is in `public/branding/photon-brothers-logo-mixed-white.svg` line 17. The relevant path has fill `#F49B04` and draws the stylized "O" with vertical bar.

Create a standalone SVG icon from this path, centered on `#0a0a0f` dark background with rounded corners, 512x512.

**Step 2: Generate PNG icons from the SVG**

Use `sharp` or equivalent to generate:
- `icon-512.png` (512x512)
- `icon-192.png` (192x192)
- `apple-touch-icon.png` (180x180)

For favicon.ico, use a multi-size .ico generator (16x16 + 32x32).

**Step 3: Update manifest.json if needed**

Add apple-touch-icon entry if not present.

**Step 4: Commit**

```bash
git add src/app/favicon.ico public/icons/ public/manifest.json
git commit -m "chore: update app icon to Photon Brothers O mark"
```

---

### Task 9: Add Routing Tests

**Files:**
- Create: `src/__tests__/lib/role-permissions.test.ts`

**Step 1: Write tests for new routing rules**

```typescript
import { canAccessRoute } from "@/lib/role-permissions";

describe("canAccessRoute - new suite structure", () => {
  // Intelligence suite access
  it("allows OPERATIONS_MANAGER to access Intelligence dashboards", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/at-risk")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/capacity")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/suites/intelligence")).toBe(true);
  });

  it("allows PROJECT_MANAGER to access Intelligence dashboards", () => {
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/pipeline")).toBe(true);
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/project-management")).toBe(true);
  });

  it("blocks OPERATIONS from Intelligence dashboards", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/at-risk")).toBe(false);
    expect(canAccessRoute("OPERATIONS", "/suites/intelligence")).toBe(false);
  });

  it("blocks SALES from suite browsing", () => {
    expect(canAccessRoute("SALES", "/suites/operations")).toBe(false);
    expect(canAccessRoute("SALES", "/suites/intelligence")).toBe(false);
  });

  // Home access for role-based landing
  it("allows all non-VIEWER roles to access home", () => {
    expect(canAccessRoute("OPERATIONS", "/")).toBe(true);
    expect(canAccessRoute("TECH_OPS", "/")).toBe(true);
    expect(canAccessRoute("SALES", "/")).toBe(true);
    expect(canAccessRoute("OPERATIONS_MANAGER", "/")).toBe(true);
    expect(canAccessRoute("PROJECT_MANAGER", "/")).toBe(true);
  });

  it("blocks VIEWER from home", () => {
    expect(canAccessRoute("VIEWER", "/")).toBe(false);
  });

  // BOM History access
  it("allows OPERATIONS to access BOM and BOM History", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/bom")).toBe(true);
    expect(canAccessRoute("OPERATIONS", "/dashboards/bom/history")).toBe(true);
  });

  // Admin-only dashboards
  it("blocks non-admin from Zuper Compliance", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/zuper-compliance")).toBe(false);
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/mobile")).toBe(false);
  });

  it("allows ADMIN to access admin-only dashboards", () => {
    expect(canAccessRoute("ADMIN", "/dashboards/zuper-compliance")).toBe(true);
    expect(canAccessRoute("ADMIN", "/dashboards/mobile")).toBe(true);
  });

  // Legacy role normalization still works
  it("normalizes MANAGER to PROJECT_MANAGER access", () => {
    expect(canAccessRoute("MANAGER", "/")).toBe(true);
    expect(canAccessRoute("MANAGER", "/suites/intelligence")).toBe(true);
  });

  it("normalizes DESIGNER to TECH_OPS access", () => {
    expect(canAccessRoute("DESIGNER", "/")).toBe(true);
    expect(canAccessRoute("DESIGNER", "/suites/department")).toBe(true);
  });
});
```

**Step 2: Run tests**

```bash
npm run test -- --testPathPattern=role-permissions
```

Expected: All pass.

**Step 3: Commit**

```bash
git add src/__tests__/lib/role-permissions.test.ts
git commit -m "test: add routing tests for new suite structure and role-based access"
```

---

### Task 10: Build Verification

**Step 1: Run lint**

```bash
npm run lint
```

Expected: No errors. Fix any that appear.

**Step 2: Run build**

```bash
npm run build
```

Expected: Successful build.

**Step 3: Run all tests**

```bash
npm run test
```

Expected: All tests pass, including new role-permissions tests from Task 9.

**Step 4: Manual smoke test**

Verify in browser:
- Home page renders correctly for each role (curated cards for OPS_MANAGER, PM, OPERATIONS, TECH_OPS, SALES)
- ADMIN/OWNER see full stats + AI bot + suite cards
- OPS_MANAGER and PM see compact stats + AI bot + curated cards
- Browse All only shows suites the user can access (no dead-end links)
- Suite switcher shows correct suites
- Breadcrumbs navigate to correct parent suites
- Intelligence suite page loads with all 11 dashboards
- Service + D&R suite shows both sections
- Old URLs (/suites/testing, /suites/additional-pipeline) return 404
- No stale links to deleted suites anywhere

**Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "chore: fix lint/build issues from dashboard reorg"
```

---

## Deferred Work (follow-up PR)

### Legacy Role Schema Removal

Do NOT remove MANAGER, DESIGNER, PERMITTING from Prisma schema in this PR. These roles are referenced in 12+ files and `normalizeRole()` provides runtime safety.

**Prerequisites before removal:**
1. Zero users with legacy roles in prod database
2. All JWT tokens have cycled (force sign-out or wait TTL)
3. No API consumers sending legacy role strings

**Files that will need updating when removing:**
- `prisma/schema.prisma` (enum)
- `src/lib/role-permissions.ts` (normalizeRole, ROLE_PERMISSIONS entries)
- `src/lib/suite-nav.ts` (SUITE_SWITCHER_ALLOWLIST entries)
- `src/app/api/bom/upload/route.ts`
- `src/app/api/bom/extract/route.ts`
- `src/app/api/bom/history/route.ts`
- `src/app/api/bom/chunk/route.ts`
- `src/app/api/bom/upload-token/route.ts`
- `src/app/api/zuper/jobs/schedule/route.ts`
- `src/app/api/admin/activity/route.ts`
- `src/app/api/admin/migrate/route.ts`
- `src/app/admin/users/page.tsx`
- `src/app/admin/directory/page.tsx`
- `src/app/admin/activity/page.tsx`
- `src/app/dashboards/site-survey-scheduler/page.tsx`

---

## Task Dependency Order

```
Task 1 (suite-nav) ──────┐
Task 2 (SUITE_MAP+bom) ──┼── Task 5 (suite pages + stale links) ─── Task 6 (home page) ─── Task 9 (tests) ─── Task 10 (verify)
Task 3 (permissions+home)┘         │
                         Task 4 (intelligence) ┘

Task 7 (executive) ── standalone, any time
Task 8 (app icon) ── standalone, any time
```

Tasks 1-3 can run in parallel. Task 4 depends on Task 1. Tasks 5-6 depend on 1-3. Task 9 depends on 3. Task 10 runs last. Tasks 7 and 8 are independent.
