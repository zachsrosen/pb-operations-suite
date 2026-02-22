# Dashboard Reorganization & Role-Based Navigation

**Date:** 2026-02-21
**Status:** Approved

## Problem

The current dashboard structure doesn't scale. 43 dashboards across 7 suites with flat navigation, a "Testing" suite acting as a dumping ground for production-ready dashboards, duplicate entries, and no personalization beyond coarse role-gating. Every user sees the same overwhelming list regardless of their job function.

## Solution

1. Reorganize suites (7 → 6), graduating stable dashboards and dissolving catch-all suites
2. Role-based landing pages so each user sees only their relevant dashboards
3. Extend AI bot access to OPERATIONS_MANAGER and PROJECT_MANAGER roles
4. Remove unused roles from Prisma schema
5. Update app icon to use the Photon Brothers brand mark

---

## 1. Suite Reorganization

### Operations Suite (9 dashboards)
**Section: Scheduling**
- Master Schedule (`/dashboards/scheduler`)
- Site Survey Schedule (`/dashboards/site-survey-scheduler`)
- Construction Schedule (`/dashboards/construction-scheduler`)
- Inspection Schedule (`/dashboards/inspection-scheduler`)

**Section: Planning**
- Timeline View (`/dashboards/timeline`)

**Section: Inventory & Equipment**
- Equipment Backlog (`/dashboards/equipment-backlog`)
- Inventory Hub (`/dashboards/inventory`)
- Planset BOM (`/dashboards/bom`)
- BOM History (`/dashboards/bom/history`)

**Access:** ADMIN, OWNER, OPERATIONS_MANAGER, OPERATIONS, PROJECT_MANAGER

### Departments Suite (7 dashboards)
**Section: Execution**
- Site Survey (`/dashboards/site-survey`)
- Design & Engineering (`/dashboards/design`)
- Permitting (`/dashboards/permitting`)
- Inspections (`/dashboards/inspections`)
- Interconnection (`/dashboards/interconnection`)
- Construction (`/dashboards/construction`)
- Incentives (`/dashboards/incentives`)

**Access:** ADMIN, OWNER, OPERATIONS_MANAGER, PROJECT_MANAGER, TECH_OPS

### Intelligence Suite (11 dashboards) — NEW
**Section: Risk & Quality**
- At-Risk Projects (`/dashboards/at-risk`)
- QC Metrics (`/dashboards/qc`)
- Alerts (`/dashboards/alerts`)

**Section: Pipeline & Capacity**
- Pipeline Overview (`/dashboards/pipeline`)
- Pipeline Optimizer (`/dashboards/optimizer`)
- Capacity Planning (`/dashboards/capacity`)
- PE Dashboard (`/dashboards/pe`)
- Sales Pipeline (`/dashboards/sales`)

**Section: Department Analytics**
- Project Management (`/dashboards/project-management`)
- Design & Engineering Analytics (`/dashboards/design-engineering`)
- Permitting & Interconnection Analytics (`/dashboards/permitting-interconnection`)

**Access:** ADMIN, OWNER, OPERATIONS_MANAGER, PROJECT_MANAGER

### Executive Suite (4 dashboards)
**Section: Executive Views**
- Revenue (`/dashboards/revenue`)
- Executive Summary (`/dashboards/executive`)
- Location Comparison (`/dashboards/locations`)
- Revenue Calendar (`/dashboards/executive-calendar`)

**Access:** ADMIN, OWNER

### Service + D&R Suite (6 dashboards)
**Section: Service**
- Service Schedule (`/dashboards/service-scheduler`)
- Service Equipment Backlog (`/dashboards/service-backlog`)
- Service Pipeline (`/dashboards/service`)

**Section: D&R**
- D&R Schedule (`/dashboards/dnr-scheduler`)
- D&R Pipeline (`/dashboards/dnr`)

**Access:** ADMIN, OWNER, OPERATIONS_MANAGER, OPERATIONS, PROJECT_MANAGER

### Admin Suite (admin-only)
**Section: Admin Tools**
- Users (`/admin/users`)
- Activity Log (`/admin/activity`)
- Security (`/admin/security`)
- Bug Reports (`/admin/tickets`)
- Page Directory (`/admin/directory`)
- Zuper Compliance (`/dashboards/zuper-compliance`)
- Zuper Status Comparison (`/dashboards/zuper-status-comparison`)
- Product Comparison (`/dashboards/product-comparison`)
- Mobile Dashboard (`/dashboards/mobile`)

**Section: Documentation**
- Updates, Guide, Roadmap, Handbook, SOPs

**Section: API Shortcuts**
- Projects + Stats API, PE Projects API, Scheduling Projects API

**Section: Prototypes**
- Home Refresh, Layout Refresh, Solar Checkout, Solar Surveyor

**Access:** ADMIN only

### Dissolved
- **Testing Suite** — all dashboards graduated to Intelligence, Admin, or Operations
- **Additional Pipeline Suite** — Sales moved to Intelligence, D&R moved to Service + D&R, Service Pipeline already in Service + D&R

### Duplicates Resolved
- Service Pipeline: removed from Additional Pipeline (lives in Service + D&R only)
- Inventory Hub: removed from Testing (lives in Operations only)

---

## 2. Role-Based Landing Pages

The home page (`/`) renders a role-specific experience:

| Role | Landing Page Content | AI Bot (Zach's Bot) |
|---|---|---|
| ADMIN / OWNER | Full home: stats grid, Zach's Bot, location filter, stage bars, suite cards | Yes |
| OPERATIONS_MANAGER | Operations dashboards + Intelligence highlights (At-Risk, Capacity, QC) + Browse All | Yes |
| PROJECT_MANAGER | Pipeline Overview, At-Risk, Project Management, Timeline, Equipment Backlog + Browse All | Yes |
| OPERATIONS | Operations suite dashboards (schedulers, timeline, equipment) + Browse All | No |
| TECH_OPS | Department suite dashboards + Browse All | No |
| SALES | Sales Pipeline + Site Survey Scheduler (no suite browsing) | No |
| VIEWER | Redirect to `/unassigned` | No |

### Landing Page Structure
- **4-8 curated dashboard cards** rendered directly on `/` based on role
- **"Browse All Suites"** link at bottom expands to full suite grid (filtered by role permissions)
- ADMIN/OWNER retains the existing rich home page (stats, AI, filters, suites)
- OPS_MANAGER and PROJECT_MANAGER get a compact stats row + Zach's Bot + curated cards
- Other roles get curated cards only + Browse All

### Implementation
- Single config object mapping role → dashboard cards + browsable suites
- Home page reads user role and renders appropriate layout
- `SUITE_MAP` in DashboardShell.tsx updated to reflect new suite structure
- `SUITE_LINKS` on home page updated to reflect new suites + access rules

---

## 3. Schema Cleanup

Remove unused roles from Prisma `UserRole` enum:
- `MANAGER`
- `DESIGNER`
- `PERMITTING`

Requires migration. Verify no users assigned these roles before removing.

---

## 4. Navigation Changes

### Suite Pages
Add named section headers within each suite page:
- Operations: "Scheduling" | "Planning" | "Inventory & Equipment"
- Intelligence: "Risk & Quality" | "Pipeline & Capacity" | "Department Analytics"
- Service + D&R: "Service" | "D&R"
- Admin: "Admin Tools" | "Documentation" | "API Shortcuts" | "Prototypes"

Sections are visual groupings with a label — not collapsible.

### Breadcrumbs
Update `SUITE_MAP` in `DashboardShell.tsx` to reflect new suite assignments. All dashboards get correct back-navigation to their new parent suite.

### What We're NOT Doing
- No sidebar navigation
- No favorites/pinning system
- No changes to Cmd+K global search

---

## 5. App Icon Update

Replace the generic "PB" lettermark with the Photon Brothers brand mark.

**Design:** Extract the distinctive orange "O" mark (`#F49B04`) from the Photon Brothers logo SVG. Place on dark background (`#0a0a0f`) matching the app theme.

**Assets to generate:**
- `src/app/favicon.ico` (16x16, 32x32 multi-size)
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/apple-touch-icon.png` (180x180)

**Update:** `public/manifest.json` to include apple-touch-icon if not already referenced.

---

## Files to Modify

### Config & Data
- `src/components/DashboardShell.tsx` — update `SUITE_MAP` for new suite assignments
- `src/app/page.tsx` — update `SUITE_LINKS`, role-based landing logic, AI bot access
- `prisma/schema.prisma` — remove MANAGER, DESIGNER, PERMITTING roles

### Suite Pages
- `src/app/suites/operations/page.tsx` — update dashboard list (remove D&R Sched, add BOM)
- `src/app/suites/department/page.tsx` — unchanged
- `src/app/suites/executive/page.tsx` — unchanged
- `src/app/suites/service/page.tsx` — rename to Service + D&R, add D&R Schedule + D&R Pipeline
- `src/app/suites/admin/page.tsx` — add Zuper Compliance, Product Comparison, Mobile, Prototypes
- **NEW:** `src/app/suites/intelligence/page.tsx` — new Intelligence Suite page
- **DELETE:** `src/app/suites/testing/page.tsx`
- **DELETE:** `src/app/suites/additional-pipeline/page.tsx`

### Assets
- `src/app/favicon.ico` — replace
- `public/icons/icon-192.png` — replace
- `public/icons/icon-512.png` — replace
- `public/icons/apple-touch-icon.png` — new
- `public/manifest.json` — update if needed

### Auth & Permissions
- `src/lib/role-permissions.ts` — update role-based access rules
- Prisma migration for role removal
