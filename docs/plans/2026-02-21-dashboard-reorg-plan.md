# Dashboard Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize 43 dashboards from 7 suites into 6 purpose-driven suites, add role-based landing pages, extend AI bot access, clean up unused roles, and update the app icon.

**Architecture:** Config-driven approach — a single role-to-landing config object drives the home page, while suite pages and permissions are updated to match the new structure. No new components needed; existing `SuitePageShell`, `DashboardShell`, and home page are modified in place.

**Tech Stack:** Next.js, React, Prisma, TypeScript, Tailwind CSS

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

Note: MANAGER, DESIGNER, PERMITTING kept temporarily for backwards compatibility — they'll be removed in Task 8 after migration.

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

Replace lines 10-56 with the new suite assignments:

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
- Modify: `src/lib/role-permissions.ts` (lines 45-329 for ROLE_PERMISSIONS, lines 354-359 for ADMIN_ONLY_ROUTES)

**Step 1: Add new Intelligence and Service + D&R routes to OPERATIONS_MANAGER**

Update the `OPERATIONS_MANAGER` allowedRoutes (lines 145-164) to add Intelligence dashboards:

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

**Step 2: Update PROJECT_MANAGER with Intelligence routes + home access**

Update `PROJECT_MANAGER` allowedRoutes (lines 176-216):

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

**Step 3: Add "/" and BOM to OPERATIONS allowedRoutes**

Update `OPERATIONS` (lines 112-143) — add `"/"`, `"/dashboards/bom"`, and `"/dashboards/dnr"`:

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
    "/dashboards/dnr",
    "/api/projects",
    "/api/service",
    "/api/zuper",
    "/api/activity/log",
    "/api/inventory",
    "/api/bugs",
  ],
  // ... rest unchanged
},
```

**Step 4: Add Zuper Compliance, Product Comparison, Mobile to ADMIN_ONLY_ROUTES**

Update `ADMIN_ONLY_ROUTES` (lines 354-359):

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

**Step 5: Commit**

```bash
git add src/lib/role-permissions.ts
git commit -m "feat: update role permissions for new suite structure and Intelligence access"
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

### Task 5: Update Existing Suite Pages

**Files:**
- Modify: `src/app/suites/operations/page.tsx`
- Modify: `src/app/suites/service/page.tsx`
- Modify: `src/app/suites/admin/page.tsx`
- Delete: `src/app/suites/testing/page.tsx`
- Delete: `src/app/suites/additional-pipeline/page.tsx`

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

**Step 2: Update Service Suite — rename, add D&R Schedule + D&R Pipeline**

Replace the entire `src/app/suites/service/page.tsx` content:

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

Replace the `ADMIN_TOOLS` array in `src/app/suites/admin/page.tsx` (lines 5-69). Add Zuper Compliance, Product Comparison, Mobile Dashboard. Move the prototypes from Testing. Keep existing Documentation and API sections.

Add to ADMIN_TOOLS (before the closing `];`):

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

Add a PROTOTYPES array (copy from the old testing page):

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

Update the render to include PROTOTYPES:

```typescript
cards={[...ADMIN_TOOLS, ...DOCUMENTATION, ...API_SHORTCUTS, ...PROTOTYPES]}
```

**Step 4: Delete Testing and Additional Pipeline suite pages**

```bash
rm src/app/suites/testing/page.tsx
rm src/app/suites/additional-pipeline/page.tsx
rmdir src/app/suites/testing 2>/dev/null || true
rmdir src/app/suites/additional-pipeline 2>/dev/null || true
```

**Step 5: Commit**

```bash
git add -A src/app/suites/
git commit -m "feat: update suite pages — add Intelligence, rename Service+D&R, dissolve Testing/Additional Pipeline"
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

**Step 1: Replace SUITE_LINKS (lines 53-110)**

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

**Step 2: Add role-based curated dashboard config**

Add this config after the SUITE_LINKS definition:

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

**Step 3: Update canUseAI (line 415)**

```typescript
const canUseAI = userRole === "ADMIN" || userRole === "OWNER" || userRole === "OPERATIONS_MANAGER" || userRole === "PROJECT_MANAGER";
```

**Step 4: Update redirectTarget and visibleSuites logic**

Replace the `redirectTarget` useMemo (lines 272-279) — only VIEWER redirects now:

```typescript
const redirectTarget = useMemo(() => {
  if (!userRole) return null;
  if (userRole === "VIEWER") return "/unassigned";
  return null;
}, [userRole]);
```

Replace the `visibleSuites` useMemo (lines 395-413):

```typescript
const visibleSuites = useMemo(() => {
  if (!userRole) return [];
  if (userRole === "VIEWER") return [];
  // Roles with curated landing cards don't show suites directly (they use Browse All)
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

**Step 5: Add role-based landing card rendering**

Add a `roleLandingCards` computed value after `visibleSuites`:

```typescript
const roleLandingCards = useMemo(() => {
  if (!userRole) return null;
  return ROLE_LANDING_CARDS[userRole] || null;
}, [userRole]);
```

In the JSX, before the Suites section (around line 751), add the curated cards rendering:

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
          // Show the full suites section
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

{/* All Suites (hidden for role-based landing, visible for admin/owner) */}
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

{/* Browse All (hidden by default for role-landing users) */}
{roleLandingCards && (
  <div id="all-suites" className="hidden">
    <h2 className="text-lg font-semibold text-foreground/80 mb-4 mt-8">All Suites</h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 stagger-grid">
      {SUITE_LINKS
        .filter((suite) => {
          if (suite.visibility === "admin") return userRole === "ADMIN";
          if (suite.visibility === "owner_admin") return userRole === "ADMIN" || userRole === "OWNER" || userRole === "OPERATIONS_MANAGER" || userRole === "PROJECT_MANAGER";
          return true;
        })
        .map((suite) => (
          <DashboardLink key={suite.href} {...suite} />
        ))}
    </div>
  </div>
)}
```

**Step 6: Hide stats/AI sections for roles that don't get them**

The stats grid, location filter, and stage bars should only show for roles with `canUseAI` or ADMIN/OWNER. Wrap those sections:

For the stats grid (around line 532):
```tsx
{(canUseAI) && (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 stagger-grid">
    {/* ... existing StatCards */}
  </div>
)}
```

The Zach's Bot section already checks `canUseAI` — it will now correctly show for OPS_MANAGER and PM too.

**Step 7: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: role-based landing pages with curated dashboard cards and extended AI bot access"
```

---

### Task 7: Update Executive Suite Page

**Files:**
- Modify: `src/app/suites/executive/page.tsx`

**Step 1: Add Revenue Calendar to the executive suite cards**

The current file (lines 5-38) has Revenue, Executive Summary, Location Comparison but is missing Revenue Calendar. Verify it's present (it may have been added already based on the read — line 31-37 shows it). If already there, no changes needed.

**Step 2: Commit (if changes needed)**

```bash
git add src/app/suites/executive/page.tsx
git commit -m "fix: ensure Revenue Calendar in Executive Suite"
```

---

### Task 8: Schema Cleanup — Remove Unused Roles

**Files:**
- Modify: `prisma/schema.prisma` (lines 17-29)
- Modify: `src/lib/role-permissions.ts` (remove MANAGER, DESIGNER, PERMITTING entries)
- Modify: `src/lib/suite-nav.ts` (remove MANAGER, DESIGNER, PERMITTING entries)

**Step 1: Check for users with these roles**

```bash
npx prisma db execute --stdin <<< "SELECT role, COUNT(*) FROM \"User\" WHERE role IN ('MANAGER', 'DESIGNER', 'PERMITTING') GROUP BY role;"
```

If any users have these roles, they must be migrated first:
```sql
UPDATE "User" SET role = 'PROJECT_MANAGER' WHERE role = 'MANAGER';
UPDATE "User" SET role = 'TECH_OPS' WHERE role = 'DESIGNER';
UPDATE "User" SET role = 'TECH_OPS' WHERE role = 'PERMITTING';
```

**Step 2: Remove roles from Prisma schema**

Update `prisma/schema.prisma` lines 17-29:

```prisma
enum UserRole {
  ADMIN               // Full access, user management, all dashboards
  OWNER               // Like ADMIN but without user management (for Matt & David)
  OPERATIONS          // Can schedule installs/inspections, manage construction flow
  OPERATIONS_MANAGER  // Operations managers — crew oversight, scheduling, availability
  PROJECT_MANAGER     // Project managers — project tracking, scheduling, reporting
  TECH_OPS            // Field technicians — view schedules, self-service availability
  VIEWER              // Read-only access to all dashboards
  SALES               // Only survey scheduler access (for sales team)
}
```

**Step 3: Remove from role-permissions.ts**

Delete the `MANAGER` block (lines 70-111), `DESIGNER` block (lines 241-265), and `PERMITTING` block (lines 266-290) from `ROLE_PERMISSIONS`.

Update `normalizeRole()` (lines 36-40) — remove the normalization since these roles no longer exist:

```typescript
export function normalizeRole(role: UserRole): UserRole {
  return role;
}
```

**Step 4: Remove from suite-nav.ts**

Remove `MANAGER`, `DESIGNER`, `PERMITTING` from `SUITE_SWITCHER_ALLOWLIST`.

**Step 5: Generate and run migration**

```bash
npx prisma migrate dev --name remove-legacy-roles
```

**Step 6: Commit**

```bash
git add prisma/ src/lib/role-permissions.ts src/lib/suite-nav.ts
git commit -m "chore: remove unused MANAGER, DESIGNER, PERMITTING roles from schema and permissions"
```

---

### Task 9: App Icon Update

**Files:**
- Replace: `src/app/favicon.ico`
- Replace: `public/icons/icon-192.png`
- Replace: `public/icons/icon-512.png`
- Create: `public/icons/apple-touch-icon.png`
- Modify: `public/manifest.json` (if needed)

**Step 1: Extract the orange "O" mark from the Photon Brothers logo**

The "O" mark is defined in the SVG at `public/branding/photon-brothers-logo-mixed-white.svg`. The relevant path data is on line 17 — the orange fill (`#F49B04`) path that draws the stylized "O" with the vertical bar.

Create a standalone SVG icon from this path element, centered on a `#0a0a0f` dark background with rounded corners. The SVG source icon should be 512x512.

**Step 2: Generate PNG icons from the SVG**

Use a tool like `sharp` or `svgexport` to generate:
- `icon-512.png` (512x512)
- `icon-192.png` (192x192)
- `apple-touch-icon.png` (180x180)

For favicon.ico, use a multi-size .ico generator (16x16 + 32x32).

**Step 3: Update manifest.json if needed**

Add apple-touch-icon entry if not present. The current manifest already has 192 and 512 entries which will use the new PNGs automatically.

**Step 4: Commit**

```bash
git add src/app/favicon.ico public/icons/ public/manifest.json
git commit -m "chore: update app icon to Photon Brothers O mark"
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

Expected: Successful build. The dissolved suite pages (testing, additional-pipeline) should not cause issues since they're deleted.

**Step 3: Run tests**

```bash
npm run test
```

Expected: All existing tests pass. No new tests needed for this refactor since it's config/data changes.

**Step 4: Manual smoke test**

Verify in browser:
- Home page renders correctly for each role
- Suite switcher shows correct suites
- Breadcrumbs navigate to correct parent suites
- Intelligence suite page loads with all 11 dashboards
- Service + D&R suite shows both sections
- Old URLs (/suites/testing, /suites/additional-pipeline) return 404

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: fix lint/build issues from dashboard reorg"
```

---

## Task Dependency Order

```
Task 1 (suite-nav) ─┐
Task 2 (SUITE_MAP) ──┼── Task 5 (suite pages) ─── Task 6 (home page) ─── Task 10 (verify)
Task 3 (permissions) ┘         │
                     Task 4 (intelligence) ┘

Task 7 (executive) ── standalone, any time
Task 8 (schema cleanup) ── after Task 3, before final deploy
Task 9 (app icon) ── standalone, any time
```

Tasks 1-3 can be done in parallel. Task 4 depends on Task 1. Tasks 5-6 depend on 1-3. Task 8 should be done last before deploy. Tasks 7 and 9 are independent.

---

## REVISION: Code Review Fixes (P1-P3)

The following amendments address issues found during code review.

### Task 3 Amendment: Add "/" and missing routes to SALES, TECH_OPS, OPERATIONS permissions

**P1 Fix: SALES/TECH_OPS need home access for role-based landing pages**

Add `"/"` to SALES allowedRoutes and `/dashboards/sales` for the Sales Pipeline card:

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
  // ... rest unchanged
},
```

Add `"/"` to TECH_OPS allowedRoutes:

```typescript
TECH_OPS: {
  allowedRoutes: [
    "/",
    "/suites/department",
    // ... rest unchanged
  ],
},
```

Add `"/"` to OPERATIONS allowedRoutes (if not already added in Task 3 Step 3).

**Also update middleware** at `src/middleware.ts` — verify that the home route `/` is allowed through for all authenticated roles (not just ADMIN/OWNER). The middleware should defer to `canAccessRoute()` which will now return true for all roles with `"/"` in their allowedRoutes.

### Task 2 Amendment: Add BOM History to SUITE_MAP

**P2 Fix: BOM History missing from SUITE_MAP**

Add to the SUITE_MAP in DashboardShell.tsx:

```typescript
"/dashboards/bom/history": { href: "/suites/operations", label: "Operations" },
```

### Task 3 Amendment: Add BOM History to role permissions

Add `/dashboards/bom/history` to every role that has `/dashboards/bom`:
- OPERATIONS_MANAGER
- PROJECT_MANAGER
- OPERATIONS

### Task 6 Amendment: Fix Browse All Suites filtering

**P1 Fix: Browse All shows dead-end links**

Replace the naive visibility filter in the "Browse All" section with `canAccessRoute()`:

```tsx
{/* Browse All (hidden by default for role-landing users) */}
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

This requires importing `canAccessRoute` and `UserRole` from `@/lib/role-permissions` into `page.tsx`.

### Task 5 Amendment: Update hardcoded references to deleted suites

**P2 Fix: Stale links to /suites/testing and /suites/additional-pipeline**

Update these files to point to new locations:

1. `src/lib/page-directory.ts` line 63 — change `/suites/additional-pipeline` to `/suites/service` (or remove)
2. `src/lib/page-directory.ts` line 69 — change `/suites/testing` to `/suites/admin` (testing content moved to admin)
3. `src/app/prototypes/solar-checkout/page.tsx` line 17 — update any back-link to `/suites/admin`
4. `src/app/prototypes/solar-surveyor/page.tsx` line 17 — update any back-link to `/suites/admin`
5. `src/app/prototypes/home-refresh/catalog.ts` line 42 — update reference
6. `src/app/dashboards/product-comparison/page.tsx` line 365 — update back-link to `/suites/admin`

Run a full grep for `/suites/testing` and `/suites/additional-pipeline` to catch any others.

### Task 8 Amendment: Defer role removal, keep normalizeRole

**P1 Fix: Don't remove normalizeRole — keep it for rollout safety**

Task 8 should NOT remove the legacy roles from the Prisma schema in this PR. Instead:

1. **Keep** `normalizeRole()` function as-is (MANAGER→PROJECT_MANAGER, DESIGNER/PERMITTING→TECH_OPS)
2. **Keep** legacy role entries in `ROLE_PERMISSIONS` and `SUITE_SWITCHER_ALLOWLIST` (they serve as fallbacks)
3. **Keep** legacy role references in API allowlists (BOM routes, schedule routes, admin routes)
4. **Only** migrate users in the database and mark the schema enum values with deprecation comments
5. **Defer** actual enum removal to a follow-up PR after confirming:
   - Zero users with legacy roles in prod
   - All JWT tokens have cycled (force sign-out or wait TTL)
   - No API consumers sending legacy role strings

Full list of files with legacy role references that would break on removal:
- `src/app/api/bom/upload/route.ts` (lines 25-30)
- `src/app/api/bom/extract/route.ts` (lines 33-38)
- `src/app/api/bom/history/route.ts` (lines 20-22)
- `src/app/api/bom/chunk/route.ts` (lines 26-27)
- `src/app/api/bom/upload-token/route.ts` (lines 27-32)
- `src/app/api/zuper/jobs/schedule/route.ts` (line 14)
- `src/app/api/admin/activity/route.ts` (lines 15-18)
- `src/app/api/admin/migrate/route.ts` (lines 34-38)
- `src/app/admin/users/page.tsx` (lines 41-48)
- `src/app/admin/directory/page.tsx` (lines 28-44)
- `src/app/admin/activity/page.tsx` (lines 43-45)
- `src/app/dashboards/site-survey-scheduler/page.tsx` (line 159)

### Task 10 Amendment: Add tests for routing changes

**P3 Fix: Add tests for auth/routing changes**

Create `src/__tests__/lib/role-permissions.test.ts`:

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
  });

  it("blocks VIEWER from home", () => {
    expect(canAccessRoute("VIEWER", "/")).toBe(false);
  });

  // BOM History access
  it("allows OPERATIONS to access BOM History", () => {
    expect(canAccessRoute("OPERATIONS", "/dashboards/bom/history")).toBe(true);
  });

  // Admin-only dashboards
  it("blocks non-admin from Zuper Compliance", () => {
    expect(canAccessRoute("OPERATIONS_MANAGER", "/dashboards/zuper-compliance")).toBe(false);
    expect(canAccessRoute("PROJECT_MANAGER", "/dashboards/mobile")).toBe(false);
  });
});
```

Run: `npm run test -- --testPathPattern=role-permissions`

### Updated Dependency Order

```
Task 1 (suite-nav) ──────┐
Task 2 (SUITE_MAP+bom) ──┼── Task 5 (suite pages + stale links) ─── Task 6 (home+browse fix) ─── Task 10 (verify+tests)
Task 3 (permissions+home)┘         │
                         Task 4 (intelligence) ┘

Task 7 (executive) ── standalone
Task 8 (schema) ── DEFERRED to follow-up PR
Task 9 (app icon) ── standalone
```
