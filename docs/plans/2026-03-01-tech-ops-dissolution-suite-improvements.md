# Tech Ops Dissolution + Suite Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Dissolve the Tech Ops Suite by redistributing its dashboards to Operations, Intelligence, D&E, and P&I suites, then fix data quality issues (lead fields, type gaps, filters) across D&E and P&I dashboards.

**Architecture:** Tech Ops dashboards move to existing suites (no new pages). RawProject gets expanded with all fields from all 21 `ExtendedProject` definitions across the codebase — including site survey, construction, incentive, design support, tags, and system performance review fields — eliminating all `ExtendedProject` hacks. Lead fields get wired up from actual HubSpot deal properties (`design`, `permit_tech`, `interconnections_tech`) — these are enumeration properties requiring the same owner-map resolution pattern as `site_surveyor`, with both active and archived property definition fetches.

**Tech Stack:** Next.js 16.1, React 19.2, TypeScript 5, Tailwind v4

---

## Phase 1: Dissolve Tech Ops Suite

### Task 1: Add Field Execution cards to Operations Suite

**Files:**
- Modify: `src/app/suites/operations/page.tsx`

**Step 1: Add three new cards to the LINKS array**

After the existing Scheduling section cards (line 33) and before the Inventory & Equipment section (line 34), add a new "Field Execution" section:

```tsx
  {
    href: "/dashboards/site-survey",
    title: "Site Survey",
    description: "Site survey scheduling, status tracking, and completion monitoring.",
    tag: "SURVEY",
    section: "Field Execution",
  },
  {
    href: "/dashboards/construction",
    title: "Construction",
    description: "Construction status, scheduling, and progress tracking.",
    tag: "CONSTRUCTION",
    section: "Field Execution",
  },
  {
    href: "/dashboards/inspections",
    title: "Inspections",
    description: "Inspection scheduling, status tracking, pass rates, and AHJ analysis.",
    tag: "INSPECTIONS",
    section: "Field Execution",
  },
```

Insert these 3 cards between line 33 (end of Scheduling section) and line 34 (start of Inventory & Equipment section).

**Step 2: Verify the page renders**

Run: `npx next build 2>&1 | head -40`
Expected: Build succeeds (or at least no TypeScript errors in this file)

**Step 3: Commit**

```bash
git add src/app/suites/operations/page.tsx
git commit -m "feat: add Field Execution cards (site-survey, construction, inspections) to Operations Suite"
```

---

### Task 2: Add Incentives card to Intelligence Suite + standalone dashboard cards

**Files:**
- Modify: `src/app/suites/intelligence/page.tsx`
- Modify: `src/app/suites/design-engineering/page.tsx`
- Modify: `src/app/suites/permitting-interconnection/page.tsx`

**Step 1: Add Incentives card to Intelligence Suite**

Add this card at the end of the LINKS array in `intelligence/page.tsx` (before the closing `];` on line 102), in the "Department Analytics" section:

```tsx
  {
    href: "/dashboards/incentives",
    title: "Incentives",
    description: "Rebate and incentive program tracking and application status.",
    tag: "INCENTIVES",
    tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    section: "Department Analytics",
  },
```

**Step 2: Add standalone Design dashboard card to D&E Suite**

In `src/app/suites/design-engineering/page.tsx`, add this card to the LINKS array (in a "Legacy Dashboards" section or at the end of the most relevant existing section):

```tsx
  {
    href: "/dashboards/design",
    title: "Design & Engineering (Legacy)",
    description: "Original design progress tracking, engineering approvals, and plan sets.",
    tag: "LEGACY",
    section: "Legacy Dashboards",
  },
```

**Step 3: Add standalone Permitting + Interconnection dashboard cards to P&I Suite**

In `src/app/suites/permitting-interconnection/page.tsx`, add these cards to the LINKS array:

```tsx
  {
    href: "/dashboards/permitting",
    title: "Permitting (Legacy)",
    description: "Original permit status tracking, submission dates, and approval monitoring.",
    tag: "LEGACY",
    section: "Legacy Dashboards",
  },
  {
    href: "/dashboards/interconnection",
    title: "Interconnection (Legacy)",
    description: "Original utility interconnection applications, approvals, and meter installations.",
    tag: "LEGACY",
    section: "Legacy Dashboards",
  },
```

**Step 4: Commit**

```bash
git add src/app/suites/intelligence/page.tsx src/app/suites/design-engineering/page.tsx src/app/suites/permitting-interconnection/page.tsx
git commit -m "feat: add Incentives to Intelligence, standalone dashboards to D&E and P&I suites"
```

---

### Task 3: Remap SUITE_MAP breadcrumbs in DashboardShell + add missing entries

**Files:**
- Modify: `src/components/DashboardShell.tsx:21-28`

**Step 1: Replace the Tech Ops SUITE_MAP entries**

Replace lines 21-28 (the old Tech Ops block):

```tsx
  // Tech Ops Suite (formerly Department Suite)
  "/dashboards/site-survey": { href: "/suites/department", label: "Tech Ops" },
  "/dashboards/design": { href: "/suites/department", label: "Tech Ops" },
  "/dashboards/permitting": { href: "/suites/department", label: "Tech Ops" },
  "/dashboards/inspections": { href: "/suites/department", label: "Tech Ops" },
  "/dashboards/interconnection": { href: "/suites/department", label: "Tech Ops" },
  "/dashboards/construction": { href: "/suites/department", label: "Tech Ops" },
  "/dashboards/incentives": { href: "/suites/department", label: "Tech Ops" },
```

With:

```tsx
  // Field Execution (Operations Suite)
  "/dashboards/site-survey": { href: "/suites/operations", label: "Operations" },
  "/dashboards/construction": { href: "/suites/operations", label: "Operations" },
  "/dashboards/inspections": { href: "/suites/operations", label: "Operations" },
  // Legacy standalone dashboards → their new suite homes
  "/dashboards/design": { href: "/suites/design-engineering", label: "D&E" },
  "/dashboards/permitting": { href: "/suites/permitting-interconnection", label: "P&I" },
  "/dashboards/interconnection": { href: "/suites/permitting-interconnection", label: "P&I" },
  // Incentives (Intelligence Suite)
  "/dashboards/incentives": { href: "/suites/intelligence", label: "Intelligence" },
```

**Step 2: Add missing catalog dashboard entries + prefix-based fallback**

After the existing Operations Suite block (after `/dashboards/bom/history` on line 20), add:

```tsx
  "/dashboards/catalog": { href: "/suites/operations", label: "Operations" },
  "/dashboards/catalog/new": { href: "/suites/operations", label: "Operations" },
```

**Step 3: Add prefix-based SUITE_MAP fallback for dynamic sub-routes**

The current lookup is exact match: `SUITE_MAP[pathname]`. This won't match `/dashboards/catalog/edit/123` (dynamic `[id]` route). Change the lookup on line 109 from:

```tsx
const parentSuite = SUITE_MAP[pathname] || null;
```

To:

```tsx
const parentSuite = SUITE_MAP[pathname]
  || Object.entries(SUITE_MAP).find(([key]) => pathname.startsWith(key + "/"))?.[1]
  || null;
```

This first tries exact match (fast path for all existing routes), then falls back to longest-prefix match. This handles `/dashboards/catalog/edit/123` → matches `/dashboards/catalog` → Operations. It also future-proofs any other nested routes (e.g. `/dashboards/bom/history` already has an explicit entry so exact match wins first).

**Step 4: Commit**

```bash
git add src/components/DashboardShell.tsx
git commit -m "feat: remap Tech Ops breadcrumbs, add catalog entries + prefix fallback to SUITE_MAP"
```

---

### Task 4: Remove Tech Ops from suite-nav.ts + fix role access gaps

**Files:**
- Modify: `src/lib/suite-nav.ts`

**Step 1: Remove Tech Ops from SUITE_NAV_ENTRIES**

Delete lines 17-22 (the Tech Ops entry):

```tsx
  {
    href: "/suites/department",
    title: "Tech Ops Suite",
    shortLabel: "Tech Ops",
    description: "Execution dashboards for field operations teams.",
  },
```

**Step 2: Remove `/suites/department` from SUITE_SWITCHER_ALLOWLIST and fix access gaps**

Remove `"/suites/department"` from every role array. **Additionally**, since dashboards are moving to Operations and Intelligence, add those suites to roles that previously only had Tech Ops access:

- **ADMIN** (line 64): Remove `/suites/department` (already has all suites)
- **OWNER** (line 74): Remove `/suites/department` (already has all suites)
- **MANAGER** (line 81): Remove `/suites/department` (already has Operations and Intelligence)
- **PROJECT_MANAGER** (line 82): Remove `/suites/department` (already has Operations and Intelligence)
- **TECH_OPS** (line 85): Remove `/suites/department`, add `/suites/operations` → final: `["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection"]`
- **DESIGNER** (line 86): Remove `/suites/department`, add `/suites/operations` → final: `["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection"]`
- **PERMITTING** (line 87): Remove `/suites/department`, add `/suites/operations` → final: `["/suites/operations", "/suites/design-engineering", "/suites/permitting-interconnection"]`

**Why:** TECH_OPS, DESIGNER, and PERMITTING roles need access to the Operations Suite now because site-survey, construction, and inspections dashboards live there. They already have route-level access to these dashboards in `role-permissions.ts`, but without the suite-switcher entry they can't navigate to the suite landing page.

**Step 3: Commit**

```bash
git add src/lib/suite-nav.ts
git commit -m "feat: remove Tech Ops Suite from navigation, add Operations to TECH_OPS/DESIGNER/PERMITTING allowlists"
```

---

### Task 5: Remove Tech Ops from main page (page.tsx)

**Files:**
- Modify: `src/app/page.tsx:63-70`

**Step 1: Remove Tech Ops from SUITE_LINKS**

Delete lines 63-70 from the `SUITE_LINKS` array:

```tsx
  {
    href: "/suites/department",
    title: "Tech Ops Suite",
    description: "Execution dashboards for field operations teams.",
    tag: "TECH OPS",
    tagColor: "green",
    visibility: "all",
  },
```

**Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: remove Tech Ops Suite from main landing page"
```

---

### Task 6: Remove Tech Ops from role-permissions.ts + add suite access

**Files:**
- Modify: `src/lib/role-permissions.ts`

**Step 1: Remove all `/suites/department` references**

Search for `"/suites/department"` and remove it from every role's route array. There are 5 occurrences at approximately lines 75, 247, 327, 395, 442.

Each one is a string in a route array — just remove the string and its trailing comma.

**Step 2: Add `/suites/operations` to DESIGNER and PERMITTING roles**

The TECH_OPS role already has `/suites/operations` (line 330), but DESIGNER (line 391) and PERMITTING (line 438) do not. Add it to both:

In DESIGNER's `allowedRoutes` (after removing `/suites/department`), add:
```tsx
"/suites/operations",
```

In PERMITTING's `allowedRoutes` (after removing `/suites/department`), add:
```tsx
"/suites/operations",
```

**Step 3: Update role descriptions in normalizeRole comment / any inline docs**

The `normalizeRole` function on line 38 normalizes DESIGNER and PERMITTING to TECH_OPS — this is still correct behavior (they share route access). No change needed to the function itself.

**Step 4: Verify no references remain**

Run: `grep -r "suites/department" src/lib/role-permissions.ts`
Expected: No output

**Step 5: Commit**

```bash
git add src/lib/role-permissions.ts
git commit -m "feat: remove /suites/department, add /suites/operations to DESIGNER and PERMITTING roles"
```

---

### Task 7: Delete Tech Ops Suite page + clean up all remaining references

**Files:**
- Delete: `src/app/suites/department/page.tsx`
- Modify: `src/lib/page-directory.ts`
- Modify: `src/__tests__/lib/role-permissions.test.ts`
- Modify: `src/app/admin/users/page.tsx`
- Modify: `src/components/GlobalSearch.tsx`
- Modify: `src/app/handbook/page.tsx`

**Step 1: Delete the Tech Ops Suite page**

```bash
rm src/app/suites/department/page.tsx
rmdir src/app/suites/department
```

**Step 2: Clean up page-directory.ts**

In `src/lib/page-directory.ts`, remove these two entries from the `APP_PAGE_ROUTES` array:
- Line 54: `"/prototypes/layout-refresh/department",`
- Line 64: `"/suites/department",`

**Step 3: Fix role-permissions.test.ts**

In `src/__tests__/lib/role-permissions.test.ts`, line 65:

Replace:
```tsx
expect(canAccessRoute("DESIGNER", "/suites/department")).toBe(true);
```

With:
```tsx
expect(canAccessRoute("DESIGNER", "/suites/operations")).toBe(true);
```

This validates that DESIGNER can now access the Operations Suite where the redistributed dashboards live.

**Step 4: Update admin/users/page.tsx role descriptions**

In `src/app/admin/users/page.tsx`:

Line 47-48 — ROLE_LABELS mapping: The `DESIGNER: "TECH_OPS"` and `PERMITTING: "TECH_OPS"` labels are still correct (these roles normalize to TECH_OPS). Keep as-is.

Line 57-59 — ROLE_DESCRIPTIONS: Update the text references:

Replace:
```tsx
PROJECT_MANAGER: "Can access Operations, Tech Ops, D&E, and P&I Suites",
```
With:
```tsx
PROJECT_MANAGER: "Can access Operations, D&E, P&I, and Intelligence Suites",
```

Replace:
```tsx
TECH_OPS: "Access to Tech Ops, D&E, and P&I Suites",
```
With:
```tsx
TECH_OPS: "Access to Operations, D&E, and P&I Suites",
```

**Step 5: Update GlobalSearch.tsx**

In `src/components/GlobalSearch.tsx`, line 38-39:

Replace the comment:
```tsx
// Tech Ops Dashboards
```
With:
```tsx
// Legacy Standalone Dashboards (now in D&E, P&I, and Intelligence suites)
```

**Step 6: Update handbook/page.tsx**

In `src/app/handbook/page.tsx`:

Line 354 — Update the role list text. Replace "Tech Ops" with the new suite context or keep the role name but note it maps to Operations/D&E/P&I access. The role name TECH_OPS still exists in the Prisma schema — just update descriptions that reference the "Tech Ops Suite" to say "Operations, D&E, and P&I Suites".

Line 716 — The role access matrix row for "Tech Ops" — update the `role` label if needed, or keep as "Tech Ops" since that's still the role name. The role itself isn't being renamed, just the suite it pointed to is being dissolved.

**Step 7: Update the department prototype page**

In `src/app/prototypes/layout-refresh/department/page.tsx`:

Line 90: Replace `"/suites/department"` reference text with `"(dissolved)"` or update to reference the new suite locations.

Line 98: Update the "Current View" link — since `/suites/department` won't exist, change to:
```tsx
<Link href="/suites/operations" className="...">
  Operations Suite
</Link>
```

**Step 8: Verify no remaining references**

Run: `grep -r "suites/department" src/ --include="*.tsx" --include="*.ts"`
Expected: No output (only the prototype page description text might remain as informational copy, which is OK)

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: delete Tech Ops Suite page + clean up all department references across codebase"
```

---

### Task 8: Build verification for Phase 1

**Step 1: Run build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds with no errors

**Step 2: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: Tests pass (the role-permissions test was updated in Task 7)

---

## Phase 2: Fix RawProject Type Gap

### Task 9: Expand RawProject with all fields from all 21 ExtendedProject definitions

**Files:**
- Modify: `src/lib/types.ts:4-48`

**Context:** There are 21 `ExtendedProject` definitions across the codebase adding 35 unique fields. The plan expands `RawProject` to include ALL of them so every `ExtendedProject` hack can be removed.

**Step 1: Add missing fields to RawProject interface**

Add these fields to the `RawProject` interface (after `equipment` block, before the closing `}`):

```tsx
  // Design & Engineering
  designStatus?: string;
  layoutStatus?: string;
  designCompletionDate?: string;
  designApprovalDate?: string;
  designSupportUser?: string;
  systemPerformanceReview?: boolean;
  tags?: string[];

  // Permitting
  permittingStatus?: string;

  // Interconnection
  interconnectionStatus?: string;
  interconnectionSubmitDate?: string;
  interconnectionApprovalDate?: string;

  // PTO
  ptoStatus?: string;
  ptoSubmitDate?: string;

  // Site Survey
  siteSurveyStatus?: string;
  siteSurveyCompletionDate?: string;

  // Construction
  constructionStatus?: string;
  readyToBuildDate?: string;

  // Inspection
  finalInspectionStatus?: string;

  // Incentive Programs
  threeceEvStatus?: string;
  threeceBatteryStatus?: string;
  sgipStatus?: string;
  pbsrStatus?: string;
  cpaStatus?: string;

  // Team
  projectManager?: string;
  operationsManager?: string;
  dealOwner?: string;
  siteSurveyor?: string;

  // Department leads (resolved from HubSpot enumeration properties via owner map)
  designLead?: string;
  permitLead?: string;
  interconnectionsLead?: string;
```

**Note:** Fields already on `RawProject` that are NOT duplicated above: `siteSurveyScheduleDate` (line 28), `constructionScheduleDate` (line 18), `constructionCompleteDate` (line 19). The `equipment` field override in some ExtendedProject definitions uses `FullEquipment` — those dashboards should keep a local type assertion or use a union type, NOT change `RawProject`'s equipment type.

**Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "fix: expand RawProject with all 35 fields from 21 ExtendedProject definitions"
```

---

### Task 10: Remove ExtendedProject hacks from P&I dashboards (6 files)

**Files:**
- Modify: `src/app/dashboards/pi-overview/page.tsx`
- Modify: `src/app/dashboards/pi-metrics/page.tsx`
- Modify: `src/app/dashboards/pi-action-queue/page.tsx`
- Modify: `src/app/dashboards/pi-timeline/page.tsx`
- Modify: `src/app/dashboards/ahj-tracker/page.tsx`
- Modify: `src/app/dashboards/utility-tracker/page.tsx`

**Step 1: In each file, remove the `ExtendedProject` interface**

Each of these files defines an `interface ExtendedProject extends RawProject { ... }` that adds fields now on `RawProject`. Remove the interface definition and replace all usages of `ExtendedProject` with `RawProject`.

For each file:
1. Delete the `ExtendedProject` interface block
2. Find/replace `ExtendedProject` → `RawProject` throughout the file
3. Ensure `RawProject` is still imported from `@/lib/types`

**Step 2: Commit**

```bash
git add src/app/dashboards/pi-overview/page.tsx src/app/dashboards/pi-metrics/page.tsx src/app/dashboards/pi-action-queue/page.tsx src/app/dashboards/pi-timeline/page.tsx src/app/dashboards/ahj-tracker/page.tsx src/app/dashboards/utility-tracker/page.tsx
git commit -m "refactor: remove ExtendedProject hacks from P&I dashboards — use RawProject directly"
```

---

### Task 11: Remove ExtendedProject hacks from D&E dashboards (8 files)

**Files:**
- Modify: `src/app/dashboards/de-metrics/page.tsx`
- Modify: `src/app/dashboards/design-revisions/page.tsx`
- Modify: `src/app/dashboards/ahj-requirements/page.tsx`
- Modify: `src/app/dashboards/utility-design-requirements/page.tsx`
- Modify: `src/app/dashboards/de-overview/page.tsx`
- Modify: `src/app/dashboards/plan-review/page.tsx`
- Modify: `src/app/dashboards/pending-approval/page.tsx`
- Modify: `src/app/dashboards/clipping-analytics/page.tsx`

**Step 1: Same process as Task 10**

Remove `ExtendedProject` interfaces and replace with `RawProject`.

**Special case for equipment field:** Files that define `ExtendedProject` with `equipment?: FullEquipment | RawProject["equipment"]` (clipping-analytics, design-revisions, de-overview, plan-review) — since `RawProject.equipment` keeps its existing type, these files may need a local type assertion when accessing the broader `FullEquipment` shape. Check if the server-side `Project` interface returns the full equipment shape and adjust accordingly. If the API already returns the full shape, the `RawProject.equipment` type should be widened to match (do this in Task 9 if needed).

**Step 2: Commit**

```bash
git add src/app/dashboards/de-metrics/page.tsx src/app/dashboards/design-revisions/page.tsx src/app/dashboards/ahj-requirements/page.tsx src/app/dashboards/utility-design-requirements/page.tsx src/app/dashboards/de-overview/page.tsx src/app/dashboards/plan-review/page.tsx src/app/dashboards/pending-approval/page.tsx src/app/dashboards/clipping-analytics/page.tsx
git commit -m "refactor: remove ExtendedProject hacks from D&E dashboards — use RawProject directly"
```

---

### Task 12: Remove ExtendedProject hacks from Tech Ops standalone dashboards (6 files)

**Files:**
- Modify: `src/app/dashboards/site-survey/page.tsx`
- Modify: `src/app/dashboards/construction/page.tsx`
- Modify: `src/app/dashboards/inspections/page.tsx`
- Modify: `src/app/dashboards/permitting/page.tsx`
- Modify: `src/app/dashboards/interconnection/page.tsx`
- Modify: `src/app/dashboards/incentives/page.tsx`

**Step 1: Same process as Task 10**

Remove `ExtendedProject` interfaces and replace with `RawProject`.

**Step 2: Commit**

```bash
git add src/app/dashboards/site-survey/page.tsx src/app/dashboards/construction/page.tsx src/app/dashboards/inspections/page.tsx src/app/dashboards/permitting/page.tsx src/app/dashboards/interconnection/page.tsx src/app/dashboards/incentives/page.tsx
git commit -m "refactor: remove ExtendedProject hacks from standalone dashboards — use RawProject directly"
```

---

### Task 13: Verify no ExtendedProject definitions remain + build check

**Step 1: Verify all ExtendedProject definitions are gone**

Run: `grep -r "ExtendedProject" src/ --include="*.tsx" --include="*.ts"`
Expected: No output — all 21 definitions removed

**Step 2: Run build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: Same pass count

---

## Phase 3: Wire Up Lead Fields from HubSpot

### Task 14: Add lead properties to DEAL_PROPERTIES in hubspot.ts

**Context:** These HubSpot deal properties exist and are enumeration types (ID→name), same pattern as `site_surveyor`:

| Label | HubSpot Internal Name | Type |
|-------|----------------------|------|
| Design Lead | `design` | enumeration |
| Permit Lead | `permit_tech` | enumeration |
| Interconnections Lead | `interconnections_tech` | enumeration |

**Files:**
- Modify: `src/lib/hubspot.ts`

**Step 1: Add lead properties to DEAL_PROPERTIES array**

Find the `// Team` section in `DEAL_PROPERTIES` (around line 562) and add the new properties:

```tsx
  // Team
  "project_manager",
  "operations_manager",
  "hubspot_owner_id",
  "site_surveyor",

  // Department leads
  "design",
  "permit_tech",
  "interconnections_tech",
```

**Step 2: Add lead fields to the Project interface**

Find the team section in `export interface Project` (around line 357) and add:

```tsx
  // Department leads (resolved via owner map)
  designLead: string;
  permitLead: string;
  interconnectionsLead: string;
```

**Step 3: Add lead resolution to transformDealToProject()**

Find where `siteSurveyor` is set (around line 868) and add the lead field mappings after it. These are enumeration properties — resolve them through the owner map (same pattern as `site_surveyor`):

```tsx
    // Department leads — enumeration properties, resolve through owner map
    designLead: (() => {
      const raw = String(deal.design || "");
      if (!raw) return "";
      return ownerMap?.[raw] || surveyorMap?.[raw] || raw;
    })(),
    permitLead: (() => {
      const raw = String(deal.permit_tech || "");
      if (!raw) return "";
      return ownerMap?.[raw] || surveyorMap?.[raw] || raw;
    })(),
    interconnectionsLead: (() => {
      const raw = String(deal.interconnections_tech || "");
      if (!raw) return "";
      return ownerMap?.[raw] || surveyorMap?.[raw] || raw;
    })(),
```

**Step 4: Fetch property definitions for lead fields (active + archived)**

In the `buildOwnerMap()` function, find the `Promise.allSettled` call (around line 1076). Add 6 new calls (3 properties × 2 for active + archived):

Update the destructuring to include 6 new result variables:

```tsx
  const [
    ownerPropResult,
    ownerPropArchivedResult,
    surveyorPropResult,
    surveyorPropArchivedResult,
    ownersApiResult,
    // Lead property definitions (active + archived)
    designPropResult,
    designPropArchivedResult,
    permitPropResult,
    permitPropArchivedResult,
    icPropResult,
    icPropArchivedResult,
  ] = await Promise.allSettled([
    // Source 1: hubspot_owner_id (active + archived)
    getDealPropertyDefinition("hubspot_owner_id"),
    getDealPropertyDefinition("hubspot_owner_id", true),
    // Source 2: site_surveyor (active + archived)
    getDealPropertyDefinition("site_surveyor"),
    getDealPropertyDefinition("site_surveyor", true),
    // Source 3: Owners API
    ownersApiPromise,
    // Source 4: Lead property definitions (active + archived)
    getDealPropertyDefinition("design"),
    getDealPropertyDefinition("design", true),
    getDealPropertyDefinition("permit_tech"),
    getDealPropertyDefinition("permit_tech", true),
    getDealPropertyDefinition("interconnections_tech"),
    getDealPropertyDefinition("interconnections_tech", true),
  ]);
```

Then process the 6 new results after the existing site_surveyor processing block:

```tsx
  // Process Source 4: Lead property definitions (active + archived)
  for (const [label, result, archivedResult] of [
    ["design", designPropResult, designPropArchivedResult],
    ["permit_tech", permitPropResult, permitPropArchivedResult],
    ["interconnections_tech", icPropResult, icPropArchivedResult],
  ] as const) {
    if (result.status === "fulfilled") {
      addPropertyOptionsToOwnerMap(result.value?.options || []);
    } else {
      console.warn(`[HubSpot] Failed to fetch ${label} property:`, result.reason?.message || result.reason);
    }
    if (archivedResult.status === "fulfilled") {
      addPropertyOptionsToOwnerMap(archivedResult.value?.options || []);
    } else {
      console.warn(`[HubSpot] Failed to fetch archived ${label} property:`, archivedResult.reason?.message || archivedResult.reason);
    }
  }
```

**Step 5: Commit**

```bash
git add src/lib/hubspot.ts
git commit -m "feat: wire up design, permit, and interconnections lead fields from HubSpot with active+archived resolution"
```

---

### Task 15: Verify lead data flows to dashboards

**Step 1: Run build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

**Step 2: Verify lead field columns already reference the correct field names**

The P&I dashboards already use `p.permitLead`, `p.interconnectionsLead`, and the D&E dashboards use `p.designLead`. These field names now match what comes from the API (Task 14 wired them up). No dashboard changes needed — the columns will populate automatically.

Verify with grep that dashboard references match the new Project field names:
```bash
grep -r "permitLead\|interconnectionsLead\|designLead" src/app/dashboards/ --include="*.tsx"
```
Expected: All references use the correct field names that now resolve to actual data.

---

## Phase 4: Add Location, Lead, and Stage Filters

**Design decision (from Codex review):** Summary stats (hero metrics at top of dashboards) should show **unfiltered** totals to provide a consistent "big picture" view. Only the table/list below the stats should be filtered. This means:
- `safeProjects` feeds the summary stat cards (unfiltered)
- `filteredProjects` feeds the data table and any drill-down views

### Task 16: Add location, lead, and stage filters to P&I Overview

**Files:**
- Modify: `src/app/dashboards/pi-overview/page.tsx`

**Step 1: Add filter state variables**

Add after the existing state declarations:

```tsx
const [locationFilter, setLocationFilter] = useState<string>("all");
const [leadFilter, setLeadFilter] = useState<string>("all");
const [stageFilter, setStageFilter] = useState<string>("all");

const locations = useMemo(() => {
  const locs = new Set<string>();
  safeProjects.forEach((p) => { if (p.pbLocation) locs.add(p.pbLocation); });
  return Array.from(locs).sort();
}, [safeProjects]);

const leads = useMemo(() => {
  const names = new Set<string>();
  safeProjects.forEach((p) => {
    if (p.permitLead) names.add(p.permitLead);
    if (p.interconnectionsLead) names.add(p.interconnectionsLead);
  });
  return Array.from(names).sort();
}, [safeProjects]);

const stages = useMemo(() => {
  const s = new Set<string>();
  safeProjects.forEach((p) => { if (p.stage) s.add(p.stage); });
  return Array.from(s).sort();
}, [safeProjects]);
```

**Step 2: Add filter bar between the stats grid and the data table**

Place the filter bar AFTER the summary stats section (which stays unfiltered) and BEFORE the data table:

```tsx
<div className="flex gap-2 flex-wrap items-center">
  <select
    value={locationFilter}
    onChange={(e) => setLocationFilter(e.target.value)}
    className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground"
  >
    <option value="all">All Locations</option>
    {locations.map((loc) => (
      <option key={loc} value={loc}>{loc}</option>
    ))}
  </select>
  <select
    value={leadFilter}
    onChange={(e) => setLeadFilter(e.target.value)}
    className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground"
  >
    <option value="all">All Leads</option>
    {leads.map((name) => (
      <option key={name} value={name}>{name}</option>
    ))}
  </select>
  <select
    value={stageFilter}
    onChange={(e) => setStageFilter(e.target.value)}
    className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground"
  >
    <option value="all">All Stages</option>
    {stages.map((s) => (
      <option key={s} value={s}>{s}</option>
    ))}
  </select>
</div>
```

**Step 3: Apply all three filters to create filteredProjects**

```tsx
const filteredProjects = useMemo(() => {
  let result = safeProjects;
  if (locationFilter !== "all") result = result.filter((p) => p.pbLocation === locationFilter);
  if (leadFilter !== "all") result = result.filter((p) => p.permitLead === leadFilter || p.interconnectionsLead === leadFilter);
  if (stageFilter !== "all") result = result.filter((p) => p.stage === stageFilter);
  return result;
}, [safeProjects, locationFilter, leadFilter, stageFilter]);
```

Replace **only table/list** downstream references from `safeProjects` to `filteredProjects`. Keep summary stat computations using `safeProjects`.

**Step 4: Commit**

```bash
git add src/app/dashboards/pi-overview/page.tsx
git commit -m "feat: add location, lead, and stage filters to P&I Overview (stats stay unfiltered)"
```

---

### Task 17: Add location, lead, and stage filters to P&I Action Queue

**Files:**
- Modify: `src/app/dashboards/pi-action-queue/page.tsx`

**Step 1: Same triple-filter pattern as Task 16**

Add `locationFilter`, `leadFilter`, and `stageFilter` state. Compute unique options from `safeProjects`. Add all three select dropdowns to the filter bar (next to the existing type filter tabs). Filter `safeProjects` before building `actionItems`.

For lead filter matching in the Action Queue, match against `permitLead`, `interconnectionsLead`, OR `projectManager` since this dashboard shows all three action types.

Summary stats (total action items, breakdown by type) should show unfiltered totals. The filtered list only affects the table view.

**Step 2: Commit**

```bash
git add src/app/dashboards/pi-action-queue/page.tsx
git commit -m "feat: add location, lead, and stage filters to P&I Action Queue"
```

---

### Task 18: Add location, lead, and stage filters to AHJ Tracker and Utility Tracker

**Files:**
- Modify: `src/app/dashboards/ahj-tracker/page.tsx`
- Modify: `src/app/dashboards/utility-tracker/page.tsx`

**Step 1: Same triple-filter pattern for both files**

- **AHJ Tracker**: Lead filter matches against `p.permitLead` (permit-focused dashboard)
- **Utility Tracker**: Lead filter matches against `p.interconnectionsLead` (IC-focused dashboard)

Both files already have tables with project drill-downs. Add the filter bar before the table. Summary stats stay unfiltered.

**Step 2: Commit**

```bash
git add src/app/dashboards/ahj-tracker/page.tsx src/app/dashboards/utility-tracker/page.tsx
git commit -m "feat: add location, lead, and stage filters to AHJ Tracker and Utility Tracker"
```

---

### Task 19: Add location, lead, and stage filters to P&I Metrics and P&I Timeline

**Files:**
- Modify: `src/app/dashboards/pi-metrics/page.tsx`
- Modify: `src/app/dashboards/pi-timeline/page.tsx`

**Step 1: Same triple-filter pattern for both**

Lead filter matches against `permitLead` or `interconnectionsLead`. Summary stats stay unfiltered.

**Step 2: Commit**

```bash
git add src/app/dashboards/pi-metrics/page.tsx src/app/dashboards/pi-timeline/page.tsx
git commit -m "feat: add location, lead, and stage filters to P&I Metrics and Timeline"
```

---

### Task 20: Build verification for Phase 4

**Step 1: Run build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

---

## Phase 5: Add Text Search to Table Dashboards

### Task 21: Add search input to AHJ Tracker

**Files:**
- Modify: `src/app/dashboards/ahj-tracker/page.tsx`

**Step 1: Add search state and filter**

```tsx
const [searchQuery, setSearchQuery] = useState("");
```

Add a text input above the table (in the same filter bar as the location dropdown):

```tsx
<input
  type="text"
  placeholder="Search AHJ name, project, or status..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  className="bg-surface-2 border border-t-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted w-full max-w-xs"
/>
```

Apply the search filter to the AHJ rows or projects based on the searchQuery — match against AHJ name, project name, status, and location using case-insensitive `includes()`.

**Step 2: Commit**

```bash
git add src/app/dashboards/ahj-tracker/page.tsx
git commit -m "feat: add text search to AHJ Tracker"
```

---

### Task 22: Add search input to Utility Tracker

**Files:**
- Modify: `src/app/dashboards/utility-tracker/page.tsx`

**Step 1: Same pattern as Task 21**

Search matches against utility name, project name, status, and location.

**Step 2: Commit**

```bash
git add src/app/dashboards/utility-tracker/page.tsx
git commit -m "feat: add text search to Utility Tracker"
```

---

### Task 23: Add search input to P&I Action Queue

**Files:**
- Modify: `src/app/dashboards/pi-action-queue/page.tsx`

**Step 1: Add search input**

Search matches against project name, status, action, location, and lead name.

**Step 2: Commit**

```bash
git add src/app/dashboards/pi-action-queue/page.tsx
git commit -m "feat: add text search to P&I Action Queue"
```

---

### Task 24: Build verification for Phase 5

**Step 1: Run build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds

---

## Phase 6: Extract Shared Status Constants

### Task 25: Create shared P&I status constants file

**Files:**
- Create: `src/lib/pi-statuses.ts`

**Step 1: Create the shared constants file**

Extract the repeated permit, IC, and PTO status groupings used across `pi-action-queue`, `pi-overview`, `ahj-tracker`, `utility-tracker`, and other P&I dashboards into a single file:

```tsx
// src/lib/pi-statuses.ts
// Shared permitting, interconnection, and PTO status constants

/** Statuses where the ball is in our court — permitting */
export const PERMIT_ACTION_STATUSES: Record<string, string> = {
  "Ready For Permitting": "Submit to AHJ",
  "Customer Signature Acquired": "Submit to AHJ",
  "Non-Design Related Rejection": "Review rejection",
  "Rejected": "Revise & resubmit",
  "In Design For Revision": "Complete revision",
  "Returned from Design": "Resubmit to AHJ",
  "As-Built Revision Needed": "Start as-built revision",
  "As-Built Revision In Progress": "Complete as-built",
  "As-Built Ready To Resubmit": "Resubmit as-built",
  "Pending SolarApp": "Submit SolarApp",
  "Submit SolarApp to AHJ": "Submit SolarApp to AHJ",
  "Resubmitted to AHJ": "Follow up with AHJ",
};

/** Statuses where the ball is in our court — interconnection */
export const IC_ACTION_STATUSES: Record<string, string> = {
  "Ready for Interconnection": "Submit to utility",
  "Signature Acquired By Customer": "Submit to utility",
  "Non-Design Related Rejection": "Review rejection",
  "Rejected (New)": "Review rejection",
  "Rejected": "Revise & resubmit",
  "In Design For Revisions": "Complete revision",
  "Revision Returned From Design": "Resubmit to utility",
  "Waiting On Information": "Provide information",
  "Resubmitted To Utility": "Follow up with utility",
};

/** PTO action statuses */
export const PTO_ACTION_STATUSES: Record<string, string> = {
  "Inspection Passed - Ready for Utility": "Submit PTO",
  "Inspection Rejected By Utility": "Review rejection",
  "Ops Related PTO Rejection": "Fix ops issue",
  "Resubmitted to Utility": "Follow up",
  "Xcel Photos Ready to Submit": "Submit photos",
  "XCEL Photos Rejected": "Fix & resubmit photos",
  "Xcel Photos Ready to Resubmit": "Resubmit photos",
  "Pending Truck Roll": "Schedule truck roll",
};

/** Days threshold for marking an item as stale */
export const STALE_THRESHOLD_DAYS = 14;
```

**Step 2: Update pi-action-queue/page.tsx to import from shared file**

Remove the inline `PERMIT_ACTION_STATUSES`, `IC_ACTION_STATUSES`, `PTO_ACTION_STATUSES`, and `STALE_THRESHOLD_DAYS` constants. Import them from `@/lib/pi-statuses`.

**Step 3: Update any other P&I dashboards that duplicate these status strings**

Check `pi-overview`, `ahj-tracker`, `utility-tracker` for inline status groupings. If they define their own sets, import from the shared file instead.

**Step 4: Commit**

```bash
git add src/lib/pi-statuses.ts src/app/dashboards/pi-action-queue/page.tsx
git commit -m "refactor: extract shared P&I status constants to lib/pi-statuses.ts"
```

---

### Task 26: Final build + test verification

**Step 1: Run full build**

Run: `npx next build 2>&1 | tail -30`
Expected: Build succeeds with no errors

**Step 2: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: Tests pass

**Step 3: Verify no remaining Tech Ops references**

Run: `grep -r "Tech Ops\|suites/department" src/ --include="*.ts" --include="*.tsx"`
Expected: No output (or only informational text in prototype description copy)

**Step 4: Verify no remaining ExtendedProject references**

Run: `grep -r "ExtendedProject" src/ --include="*.ts" --include="*.tsx"`
Expected: No output

**Step 5: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final cleanup after Tech Ops dissolution + suite improvements"
```

---

## Summary of Changes

| Phase | Tasks | What Changes |
|-------|-------|-------------|
| 1: Dissolve Tech Ops | 1-8 | Redistribute 7 dashboards to Operations/Intelligence/D&E/P&I, delete suite page, update all nav/RBAC/page-directory/tests/admin/search/handbook, fix TECH_OPS/DESIGNER/PERMITTING suite access |
| 2: Fix RawProject | 9-13 | Add all 35 fields to RawProject, remove all 21 ExtendedProject definitions across 20 files |
| 3: Wire Up Leads | 14-15 | Add `design`, `permit_tech`, `interconnections_tech` to DEAL_PROPERTIES, Project interface, transform function with owner-map resolution (active + archived) |
| 4: Location + Lead + Stage Filters | 16-20 | Add location, lead, and stage filter dropdowns to all 6 P&I dashboards (summary stats stay unfiltered) |
| 5: Text Search | 21-24 | Add search to AHJ Tracker, Utility Tracker, Action Queue |
| 6: Shared Constants | 25-26 | Extract duplicate status maps to lib/pi-statuses.ts |

### HubSpot Lead Property Reference

| Dashboard Label | HubSpot Internal Name | Type | Resolution |
|----------------|----------------------|------|------------|
| Design Lead | `design` | enumeration | Owner map (ID→name, active + archived) |
| Permit Lead | `permit_tech` | enumeration | Owner map (ID→name, active + archived) |
| Interconnections Lead | `interconnections_tech` | enumeration | Owner map (ID→name, active + archived) |

### Codex Review Findings Addressed

| Finding | Severity | Resolution |
|---------|----------|------------|
| Plan scope too narrow — 21 ExtendedProject defs, not 10 | P1 | Task 9 expanded to all 35 fields; Tasks 10-12 cover all 20 files |
| Lead wiring needs active + archived fetches | P1 | Task 14 Step 4 fetches both active + archived for all 3 lead properties (6 calls) |
| TECH_OPS/DESIGNER/PERMITTING lose suite access | P1 | Task 4 adds `/suites/operations` to all three roles' suite-switcher; Task 6 adds route-level access for DESIGNER/PERMITTING |
| SUITE_MAP missing catalog entries | P2 | Task 3 adds `/dashboards/catalog`, `/dashboards/catalog/new` entries + prefix-based fallback for dynamic `edit/[id]` route |
| Additional Tech Ops refs in page-directory, tests, admin, search, handbook, prototypes | P2 | Task 7 covers all 6 files (11 references total) |
| Summary stats should show unfiltered totals | P2 | Phase 4 design decision: stats use `safeProjects`, tables use `filteredProjects` |

### Deferred Items (not in this plan)

- **Action Queue daysInStatus accuracy**: Currently uses `daysSinceStageMovement` (stage-level) not status-level days. Fixing this requires HubSpot property history API calls which is a separate performance/architecture decision.
- **Hardcoded SLA targets in pi-timeline**: Currently `{ permit: 30, ic: 45, pto: 21 }` — could be moved to env vars or admin config, but not blocking.
- **RawProject equipment type widening**: Some D&E dashboards use a `FullEquipment` union type on equipment. If needed, widen the `RawProject.equipment` type in a follow-up to avoid local type assertions.
