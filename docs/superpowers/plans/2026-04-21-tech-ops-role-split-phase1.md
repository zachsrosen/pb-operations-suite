# TECH_OPS Role Split — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Additively introduce six new scoped roles (`DESIGN`, `PERMIT`, `INTERCONNECT`, `INTELLIGENCE`, `ROOFING`, `MARKETING`) and one new suite (`/suites/sales-marketing`) without changing any existing user's access.

**Architecture:** The role system is declarative — `src/lib/roles.ts` is the single source of truth. Route allowlists, suite visibility, badges, and picker options derive from this one file (middleware, `user-access.ts` resolver, admin UI, and nav all read it). A property-based test at `src/__tests__/lib/roles.test.ts` auto-validates shape for every entry in `ROLES`. Phase 1 is purely additive: add enum values, add `RoleDefinition` entries, create one suite landing page, and extend existing roles' `suites` lists to include the new suite. No user data changes, no middleware changes, no resolver changes.

**Tech Stack:** Prisma 7.3 (migrations), Next.js 16 App Router, TypeScript, Jest for tests.

**Spec:** `docs/superpowers/specs/2026-04-21-tech-ops-role-split-design.md` — read this before starting.

**Branch:** `docs/tech-ops-role-split-spec` (already checked out). Do implementation work on a new branch `feat/role-split-phase1` created from this one so the spec and implementation land as separate PRs.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify (line 17–33) | Add 6 new values to `UserRole` enum |
| `prisma/migrations/<timestamp>_add_scoped_suite_roles/migration.sql` | Create | Postgres `ALTER TYPE ADD VALUE` statements for each new role |
| `src/lib/roles.ts` | Modify | Add 6 new `RoleDefinition` constants (`DESIGN`, `PERMIT`, `INTERCONNECT`, `INTELLIGENCE`, `ROOFING`, `MARKETING`); add each to `ROLES` export; extend `SALES.suites`, `SALES_MANAGER.suites`, `ADMIN.suites`, `EXECUTIVE.suites` to include `/suites/sales-marketing` |
| `src/app/admin/users/page.tsx` | Modify (line 53–65) | Add new badge colors (`fuchsia`, `sky`, `violet`, `rose`, `pink`) to `ROLE_BADGE_BY_COLOR` map |
| `src/app/suites/sales-marketing/page.tsx` | Create | Sales & Marketing suite landing page, mirrors `src/app/suites/intelligence/page.tsx` structure |
| `src/lib/suite-nav.ts` | Modify (line 11–66) | Add Sales & Marketing entry to `SUITE_NAV_ENTRIES` |
| `src/__tests__/lib/roles.test.ts` | Modify | Add explicit suite-scoping assertions for each new role |
| `src/__tests__/lib/role-permissions.test.ts` | Modify (if it exists and contains per-role allowedRoute assertions) | Add tests for each new role's allowedRoutes |
| `CLAUDE.md` | Modify | Update suite-switcher visibility table, role list, and bump suite count 8 → 9 |

---

## Pre-flight

- [ ] **Step 0.1: Create implementation branch from the spec branch**

Run:
```bash
cd "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite"
git checkout docs/tech-ops-role-split-spec
git pull origin main --no-rebase   # optional if spec branch is stale vs main
git checkout -b feat/role-split-phase1
```

Expected: On branch `feat/role-split-phase1`.

- [ ] **Step 0.2: Confirm you can read the spec**

Run: `cat docs/superpowers/specs/2026-04-21-tech-ops-role-split-design.md | head -60`
Expected: Spec header and "Problem" section render.

- [ ] **Step 0.3: Confirm tests pass on the clean branch**

Run: `npx jest src/__tests__/lib/roles.test.ts --no-coverage`
Expected: All tests PASS. This is your baseline — the property-based tests should also auto-apply to roles you add.

---

## Task 1: Prisma migration — add 6 enum values

**Files:**
- Modify: `prisma/schema.prisma` (lines 17–33)
- Create: `prisma/migrations/<timestamp>_add_scoped_suite_roles/migration.sql`

**Why first:** All downstream code references `UserRole` from the generated Prisma client. If the enum values don't exist first, TypeScript will reject every subsequent change.

- [ ] **Step 1.1: Add 6 enum values to `schema.prisma`**

Edit `prisma/schema.prisma`. Locate the `UserRole` enum (starts at line 17). Insert six new lines after `TECH_OPS` and before `DESIGNER`:

```prisma
enum UserRole {
  ADMIN
  EXECUTIVE
  OWNER
  MANAGER
  OPERATIONS
  OPERATIONS_MANAGER
  SERVICE
  PROJECT_MANAGER
  SALES_MANAGER
  TECH_OPS
  DESIGN            // NEW — D&E suite only
  PERMIT            // NEW — P&I suite (permitting portion)
  INTERCONNECT      // NEW — P&I suite (IC portion)
  INTELLIGENCE      // NEW — Intelligence suite only
  ROOFING           // NEW — D&R + Roofing suite only
  MARKETING         // NEW — Sales & Marketing suite only
  DESIGNER          // Legacy — normalizes to TECH_OPS
  PERMITTING        // Legacy — normalizes to TECH_OPS
  VIEWER
  SALES
  ACCOUNTING
}
```

- [ ] **Step 1.2: Generate the migration SQL**

Run:
```bash
npx prisma migrate dev --name add_scoped_suite_roles --create-only
```

Expected: Creates `prisma/migrations/<YYYYMMDDHHMMSS>_add_scoped_suite_roles/migration.sql`. The `--create-only` flag generates the file without applying it (Prisma migrate deploy is orchestrator-run only per workspace convention).

- [ ] **Step 1.3: Verify migration SQL**

Run: `cat prisma/migrations/*_add_scoped_suite_roles/migration.sql`
Expected:
```sql
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DESIGN';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PERMIT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INTERCONNECT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'INTELLIGENCE';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ROOFING';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MARKETING';
```

If the file is missing `IF NOT EXISTS` or contains other content, hand-edit it to match the exact pattern above (identical to `20260421160100_add_accounting_user_role/migration.sql`).

- [ ] **Step 1.4: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client` in output. The generated `UserRole` enum at `src/generated/prisma/enums.ts` now includes the six new values.

- [ ] **Step 1.5: Verify generated enum includes new values**

Run: `grep -c "DESIGN\|PERMIT\|INTERCONNECT\|INTELLIGENCE\|ROOFING\|MARKETING" src/generated/prisma/enums.ts`
Expected: A number ≥ 6 (may count other enum members too, but must be non-zero).

- [ ] **Step 1.6: Confirm typecheck passes**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors (the new enum values aren't used anywhere yet, so nothing can break).

- [ ] **Step 1.7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/*_add_scoped_suite_roles/ src/generated/prisma/
git commit -m "feat(roles): add 6 enum values for scoped suite roles

Additive Prisma migration introducing DESIGN, PERMIT, INTERCONNECT,
INTELLIGENCE, ROOFING, and MARKETING to the UserRole enum. No user
data changes, no downstream code touches yet — enum declaration only.

Part of the role-split spec (Phase 1, task 1 of 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

**NOTE:** The migration file is staged but not yet applied to the database. Per project convention in `CLAUDE.md`, `prisma migrate deploy` runs manually via orchestrator with user approval, not automatically. Applying the migration to Neon is a separate step after the PR merges.

---

## Task 2: Add six `RoleDefinition` constants to `roles.ts`

**Files:**
- Modify: `src/lib/roles.ts`
- Test: `src/__tests__/lib/roles.test.ts` (property-based tests auto-apply; no explicit new test needed here yet — that comes in Task 3)

**Why before tests:** The property-based tests in `roles.test.ts` iterate `Object.entries(ROLES)`. They will fail if we register the new role in `ROLES` before adding its `RoleDefinition`. Order within this task: define each const, then register in the `ROLES` map at the bottom of the file.

- [ ] **Step 2.1: Add `DESIGN` role definition**

Open `src/lib/roles.ts`. After the `TECH_OPS` definition (ends around line 703) and before `SALES_MANAGER`, insert:

```typescript
const DESIGN: RoleDefinition = {
  label: "Design",
  description: "Only access to Design & Engineering Suite",
  normalizesTo: "DESIGN",
  visibleInPicker: true,
  suites: ["/suites/design-engineering"],
  allowedRoutes: [
    "/",
    "/suites/design-engineering",
    "/dashboards/design",
    "/dashboards/de-overview",
    "/dashboards/plan-review",
    "/dashboards/pending-approval",
    "/dashboards/design-revisions",
    "/dashboards/de-metrics",
    "/dashboards/design-pipeline-funnel",
    "/dashboards/clipping-analytics",
    "/dashboards/ahj-requirements",
    "/dashboards/utility-design-requirements",
    "/dashboards/solar-surveyor",
    "/dashboards/solar-designer",
    "/dashboards/bom",
    "/dashboards/bom/history",
    "/dashboards/product-catalog",
    "/dashboards/submit-product",
    "/dashboards/deals",
    "/dashboards/reviews",
    "/api/hubspot/da-rework-flags",
    "/api/solar-designer",
    "/api/projects",
    "/api/bom",
    "/api/catalog",
    "/api/products",
    "/api/deals",
    "/api/reviews",
    "/api/solar",
    "/api/activity/log",
    "/api/bugs",
    "/sop",
    "/api/sop",
    "/dashboards/idr-meeting",
    "/api/idr-meeting",
    "/dashboards/comms",
    "/dashboards/my-tasks",
    "/api/hubspot/tasks",
    "/dashboards/my-tickets",
    "/api/freshservice/my-tickets",
    "/api/comms",
    "/dashboards/on-call",
    "/api/on-call",
  ],
  landingCards: [
    { href: "/dashboards/design", title: "Design & Engineering", description: "Design progress, engineering approvals, and plan sets.", tag: "DESIGN", tagColor: "emerald" },
    { href: "/dashboards/plan-review", title: "Plan Review", description: "Plan-set review queue and design QA.", tag: "REVIEW", tagColor: "emerald" },
    { href: "/dashboards/design-revisions", title: "Design Revisions", description: "Track design-revision cycles and rework flags.", tag: "REVISIONS", tagColor: "emerald" },
  ],
  scope: "global",
  badge: { color: "emerald", abbrev: "DESIGN" },
  defaultCapabilities: {
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: true,
    canEditPermitting: false,
    canViewAllLocations: false,
  },
};
```

- [ ] **Step 2.2: Add `PERMIT` role definition**

Insert immediately after `DESIGN`:

```typescript
const PERMIT: RoleDefinition = {
  label: "Permitting",
  description: "Only access to Permitting & Interconnection Suite (permitting portion)",
  normalizesTo: "PERMIT",
  visibleInPicker: true,
  suites: ["/suites/permitting-interconnection"],
  allowedRoutes: [
    "/",
    "/suites/permitting-interconnection",
    "/dashboards/permitting",
    "/dashboards/pi-overview",
    "/dashboards/pi-metrics",
    "/dashboards/pi-permit-action-queue",
    "/dashboards/pi-permit-revisions",
    "/dashboards/pi-action-queue",
    "/dashboards/pi-revisions",
    "/dashboards/pi-timeline",
    "/dashboards/ahj-tracker",
    "/dashboards/ahj-requirements",
    "/dashboards/deals",
    "/dashboards/reviews",
    "/api/ahj",
    "/api/projects",
    "/api/deals",
    "/api/reviews",
    "/api/activity/log",
    "/api/bugs",
    "/sop",
    "/api/sop",
    "/dashboards/idr-meeting",
    "/api/idr-meeting",
    "/dashboards/comms",
    "/dashboards/my-tasks",
    "/api/hubspot/tasks",
    "/dashboards/my-tickets",
    "/api/freshservice/my-tickets",
    "/api/comms",
    "/dashboards/on-call",
    "/api/on-call",
  ],
  landingCards: [
    { href: "/dashboards/permitting", title: "Permitting", description: "Permit pipeline, action queue, and status tracking.", tag: "PERMIT", tagColor: "sky" },
    { href: "/dashboards/pi-permit-action-queue", title: "Permit Action Queue", description: "Permits requiring action — submit, respond, revise.", tag: "ACTION", tagColor: "sky" },
    { href: "/dashboards/ahj-tracker", title: "AHJ Tracker", description: "Track AHJ submission status and turnaround times.", tag: "AHJ", tagColor: "sky" },
  ],
  scope: "global",
  badge: { color: "sky", abbrev: "PERMIT" },
  defaultCapabilities: {
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: true,
    canViewAllLocations: false,
  },
};
```

- [ ] **Step 2.3: Add `INTERCONNECT` role definition**

Insert immediately after `PERMIT`:

```typescript
const INTERCONNECT: RoleDefinition = {
  label: "Interconnection",
  description: "Only access to Permitting & Interconnection Suite (IC portion)",
  normalizesTo: "INTERCONNECT",
  visibleInPicker: true,
  suites: ["/suites/permitting-interconnection"],
  allowedRoutes: [
    "/",
    "/suites/permitting-interconnection",
    "/dashboards/interconnection",
    "/dashboards/pi-overview",
    "/dashboards/pi-metrics",
    "/dashboards/pi-ic-action-queue",
    "/dashboards/pi-ic-revisions",
    "/dashboards/pi-action-queue",
    "/dashboards/pi-revisions",
    "/dashboards/pi-timeline",
    "/dashboards/utility-tracker",
    "/dashboards/utility-design-requirements",
    "/dashboards/deals",
    "/dashboards/reviews",
    "/api/utility",
    "/api/projects",
    "/api/deals",
    "/api/reviews",
    "/api/activity/log",
    "/api/bugs",
    "/sop",
    "/api/sop",
    "/dashboards/idr-meeting",
    "/api/idr-meeting",
    "/dashboards/comms",
    "/dashboards/my-tasks",
    "/api/hubspot/tasks",
    "/dashboards/my-tickets",
    "/api/freshservice/my-tickets",
    "/api/comms",
    "/dashboards/on-call",
    "/api/on-call",
  ],
  landingCards: [
    { href: "/dashboards/interconnection", title: "Interconnection", description: "Utility interconnection status and revisions.", tag: "IC", tagColor: "violet" },
    { href: "/dashboards/pi-ic-action-queue", title: "IC Action Queue", description: "Interconnection items requiring action.", tag: "ACTION", tagColor: "violet" },
    { href: "/dashboards/utility-tracker", title: "Utility Tracker", description: "Track utility interconnection submission and approval.", tag: "UTILITY", tagColor: "violet" },
  ],
  scope: "global",
  badge: { color: "violet", abbrev: "IC" },
  defaultCapabilities: {
    canScheduleSurveys: false,
    canScheduleInstalls: false,
    canScheduleInspections: false,
    canSyncZuper: false,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: true,
    canViewAllLocations: false,
  },
};
```

- [ ] **Step 2.4: Add `INTELLIGENCE` role definition**

```typescript
const INTELLIGENCE: RoleDefinition = {
  label: "Intelligence",
  description: "Only access to Intelligence Suite (analytics, QC, forecasting)",
  normalizesTo: "INTELLIGENCE",
  visibleInPicker: true,
  suites: ["/suites/intelligence"],
  allowedRoutes: [
    "/",
    "/suites/intelligence",
    "/dashboards/qc",
    "/dashboards/at-risk",
    "/dashboards/alerts",
    "/dashboards/pipeline",
    "/dashboards/optimizer",
    "/dashboards/forecast-schedule",
    "/dashboards/forecast-timeline",
    "/dashboards/forecast-accuracy",
    "/dashboards/design-pipeline-funnel",
    "/dashboards/territory-map",
    "/dashboards/office-performance",
    "/dashboards/preconstruction-metrics",
    "/dashboards/clipping-analytics",
    "/dashboards/timeline",
    "/dashboards/deals",
    "/api/projects",
    "/api/deals",
    "/api/forecasting",
    "/api/hubspot/qc-metrics",
    "/api/territory-map",
    "/api/office-performance",
    "/api/activity/log",
    "/api/bugs",
    "/sop",
    "/api/sop",
    "/dashboards/idr-meeting",
    "/api/idr-meeting",
    "/dashboards/comms",
    "/dashboards/my-tasks",
    "/api/hubspot/tasks",
    "/dashboards/my-tickets",
    "/api/freshservice/my-tickets",
    "/api/comms",
  ],
  landingCards: [
    { href: "/dashboards/qc", title: "QC Metrics", description: "Time-between-stages analytics by office and utility.", tag: "QC", tagColor: "fuchsia" },
    { href: "/dashboards/at-risk", title: "At-Risk Projects", description: "Overdue milestones, stalled stages, severity scoring.", tag: "AT-RISK", tagColor: "fuchsia" },
    { href: "/dashboards/pipeline", title: "Pipeline Overview", description: "Full pipeline with filters and milestone tracking.", tag: "PIPELINE", tagColor: "fuchsia" },
  ],
  scope: "global",
  badge: { color: "fuchsia", abbrev: "INTEL" },
  defaultCapabilities: {
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
};
```

- [ ] **Step 2.5: Add `ROOFING` role definition**

```typescript
const ROOFING: RoleDefinition = {
  label: "Roofing / D&R",
  description: "Only access to D&R + Roofing Suite",
  normalizesTo: "ROOFING",
  visibleInPicker: true,
  suites: ["/suites/dnr-roofing"],
  allowedRoutes: [
    "/",
    "/suites/dnr-roofing",
    "/dashboards/dnr",
    "/dashboards/roofing",
    "/dashboards/roofing-scheduler",
    "/dashboards/dnr-scheduler",
    "/dashboards/scheduler",
    "/dashboards/deals",
    "/api/projects",
    "/api/deals",
    "/api/zuper",
    "/api/activity/log",
    "/api/bugs",
    "/sop",
    "/api/sop",
    "/dashboards/idr-meeting",
    "/api/idr-meeting",
    "/dashboards/comms",
    "/dashboards/my-tasks",
    "/api/hubspot/tasks",
    "/dashboards/my-tickets",
    "/api/freshservice/my-tickets",
    "/api/comms",
    "/dashboards/on-call",
    "/api/on-call",
  ],
  landingCards: [
    { href: "/dashboards/roofing", title: "Roofing", description: "Roofing job pipeline and scheduling.", tag: "ROOFING", tagColor: "rose" },
    { href: "/dashboards/roofing-scheduler", title: "Roofing Schedule", description: "Roofing crew scheduling.", tag: "SCHEDULE", tagColor: "rose" },
    { href: "/dashboards/dnr", title: "D&R Pipeline", description: "Detach & reset jobs.", tag: "D&R", tagColor: "rose" },
  ],
  scope: "global",
  badge: { color: "rose", abbrev: "ROOFING" },
  defaultCapabilities: {
    canScheduleSurveys: false,
    canScheduleInstalls: true,
    canScheduleInspections: false,
    canSyncZuper: true,
    canManageUsers: false,
    canManageAvailability: false,
    canEditDesign: false,
    canEditPermitting: false,
    canViewAllLocations: true,
  },
};
```

- [ ] **Step 2.6: Add `MARKETING` role definition**

```typescript
const MARKETING: RoleDefinition = {
  label: "Marketing",
  description: "Read-only pipeline visibility via Sales & Marketing Suite",
  normalizesTo: "MARKETING",
  visibleInPicker: true,
  suites: ["/suites/sales-marketing"],
  allowedRoutes: [
    "/",
    "/suites/sales-marketing",
    "/dashboards/sales",
    "/dashboards/pipeline",
    "/dashboards/revenue",
    "/dashboards/deals",
    "/dashboards/forecast-timeline",
    "/dashboards/forecast-accuracy",
    "/api/deals",
    "/api/projects",
    "/api/forecasting",
    "/api/revenue-goals",
    "/api/activity/log",
    "/api/bugs",
    "/sop",
    "/api/sop",
    "/dashboards/idr-meeting",
    "/api/idr-meeting",
    "/dashboards/comms",
    "/dashboards/my-tasks",
    "/api/hubspot/tasks",
    "/dashboards/my-tickets",
    "/api/freshservice/my-tickets",
    "/api/comms",
  ],
  landingCards: [
    { href: "/dashboards/pipeline", title: "Pipeline Overview", description: "Full pipeline with filters and milestone tracking.", tag: "PIPELINE", tagColor: "pink" },
    { href: "/dashboards/revenue", title: "Revenue", description: "Revenue trends and goal tracking.", tag: "REVENUE", tagColor: "pink" },
    { href: "/dashboards/forecast-timeline", title: "Forecast Timeline", description: "Forward-looking pipeline projections.", tag: "FORECAST", tagColor: "pink" },
  ],
  scope: "global",
  badge: { color: "pink", abbrev: "MKTG" },
  defaultCapabilities: {
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
};
```

- [ ] **Step 2.7: Register all six in the `ROLES` export**

Locate the `ROLES` map near the bottom of `src/lib/roles.ts` (around line 965). Add the six new roles alphabetically placed, for readability:

```typescript
export const ROLES: Record<UserRole, RoleDefinition> = {
  ADMIN,
  EXECUTIVE,
  ACCOUNTING,
  OWNER,
  MANAGER,
  OPERATIONS,
  OPERATIONS_MANAGER,
  SERVICE,
  PROJECT_MANAGER,
  SALES_MANAGER,
  TECH_OPS,
  DESIGN,         // NEW
  PERMIT,         // NEW
  INTERCONNECT,   // NEW
  INTELLIGENCE,   // NEW
  ROOFING,        // NEW
  MARKETING,      // NEW
  DESIGNER,
  PERMITTING,
  VIEWER,
  SALES,
};
```

- [ ] **Step 2.8: Run property-based tests**

Run: `npx jest src/__tests__/lib/roles.test.ts --no-coverage`
Expected: All tests PASS. The `it.each(ROLE_ENTRIES)` tests automatically apply to the six new roles — they check:
- `ROLES` map has exactly one entry per `UserRole` enum value
- Each role's `normalizesTo` target has `visibleInPicker: true` (the six new roles normalize to themselves, so this passes)
- Each role has a tailwind-friendly badge color + truthy abbrev
- Each role has a valid scope

If a test fails, it will tell you which assertion failed for which role. Fix the role definition to match the contract, then re-run.

- [ ] **Step 2.9: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors. The `ROLES` map type `Record<UserRole, RoleDefinition>` enforces completeness — TypeScript will complain if any enum value is missing.

- [ ] **Step 2.10: Commit**

```bash
git add src/lib/roles.ts
git commit -m "feat(roles): add 6 scoped suite RoleDefinitions

Adds DESIGN, PERMIT, INTERCONNECT, INTELLIGENCE, ROOFING, and MARKETING
role definitions with strictly scoped allowedRoutes and single-suite
visibility. Each role has its own landing cards, badge color, and
capability booleans. No existing roles modified. Property-based tests
in roles.test.ts auto-validate shape.

Part of role-split spec (Phase 1, task 2 of 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Extend admin role-badge color map

**Files:**
- Modify: `src/app/admin/users/page.tsx` (around line 53–65)

The admin user page has a `ROLE_BADGE_BY_COLOR` map that resolves badge color strings to Tailwind classes. Five of the new roles use colors (`fuchsia`, `sky`, `violet`, `rose`, `pink`) that aren't in that map — badges will fall through to the `zinc` default.

- [ ] **Step 3.1: Add the missing colors**

Find `ROLE_BADGE_BY_COLOR` at `src/app/admin/users/page.tsx:53`. Insert the five new entries in alphabetical order:

```typescript
const ROLE_BADGE_BY_COLOR: Record<string, string> = {
  red: "bg-red-500/20 text-red-400 border-red-500/30",
  amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  orange: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  indigo: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  teal: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  emerald: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  yellow: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  zinc: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  purple: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  slate: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  fuchsia: "bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30",
  sky: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  violet: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  rose: "bg-rose-500/20 text-rose-400 border-rose-500/30",
  pink: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};
```

- [ ] **Step 3.2: Check for other badge-color maps in the codebase**

Run: `grep -rn "bg-red-500/20 text-red-400" src/ --include="*.tsx" --include="*.ts"`
Expected: Zero or a small number of files. Any other file with a similar pattern needs the same update. Likely candidates: `src/app/admin/directory/page.tsx`, `src/components/UserMenu.tsx`.

For each additional file found, apply the same color additions.

- [ ] **Step 3.3: Verify Tailwind safelisting (if configured)**

Run: `grep -n "safelist" tailwind.config.* 2>/dev/null | head -5`
If a `safelist` exists and includes specific `bg-*-500/20` patterns, the five new colors may need to be added there too. If no safelist, Tailwind v4 JIT handles this automatically via the string constants above.

- [ ] **Step 3.4: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | head -10 && npx eslint src/app/admin/users/page.tsx`
Expected: No errors.

- [ ] **Step 3.5: Commit**

```bash
git add src/app/admin/users/page.tsx src/app/admin/directory/page.tsx src/components/UserMenu.tsx 2>/dev/null
git commit -m "feat(admin): add badge colors for 6 new scoped roles

Adds fuchsia, sky, violet, rose, and pink to ROLE_BADGE_BY_COLOR so new
role badges (INTELLIGENCE, PERMIT, INTERCONNECT, ROOFING, MARKETING)
render with their intended Tailwind classes instead of falling back to
zinc.

Part of role-split spec (Phase 1, task 3 of 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Create Sales & Marketing suite landing page

**Files:**
- Create: `src/app/suites/sales-marketing/page.tsx`

Mirror the structure of `src/app/suites/intelligence/page.tsx` exactly — that page is the closest analog (read-only analytics suite, no scheduling).

- [ ] **Step 4.1: Read the reference page**

Run: `cat src/app/suites/intelligence/page.tsx`
Notice: it imports `SuitePageShell` and `SuitePageCard`, gets the current user, and returns the shell with an array of cards.

- [ ] **Step 4.2: Create the new page**

Write `src/app/suites/sales-marketing/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import SuitePageShell, { type SuitePageCard } from "@/components/SuitePageShell";
import { getCurrentUser } from "@/lib/auth-utils";

const LINKS: SuitePageCard[] = [
  {
    href: "/dashboards/pipeline",
    title: "Pipeline Overview",
    description: "Full pipeline with filters, priority scoring, and milestone tracking.",
    tag: "PIPELINE",
    icon: "📊",
    section: "Pipeline",
  },
  {
    href: "/dashboards/sales",
    title: "Sales Pipeline",
    description: "Active deals, funnel visualization, and proposal tracking.",
    tag: "SALES",
    icon: "💼",
    section: "Pipeline",
  },
  {
    href: "/dashboards/deals",
    title: "Deals",
    description: "All active deals across pipelines.",
    tag: "DEALS",
    icon: "🤝",
    section: "Pipeline",
  },
  {
    href: "/dashboards/revenue",
    title: "Revenue",
    description: "Revenue trends and goal tracking.",
    tag: "REVENUE",
    icon: "💰",
    section: "Performance",
  },
  {
    href: "/dashboards/forecast-timeline",
    title: "Forecast Timeline",
    description: "Forward-looking pipeline projections.",
    tag: "FORECAST",
    icon: "📈",
    section: "Performance",
  },
  {
    href: "/dashboards/forecast-accuracy",
    title: "Forecast Accuracy",
    description: "Historical forecast vs actual performance.",
    tag: "ACCURACY",
    icon: "🎯",
    section: "Performance",
  },
];

export default async function SalesMarketingSuitePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <SuitePageShell
      title="Sales & Marketing Suite"
      description="Pipeline visibility, revenue tracking, forecasting, and marketing analytics."
      accentColor="pink"
      roles={user.roles}
      cards={LINKS}
    />
  );
}
```

- [ ] **Step 4.3: Verify `SuitePageShell` accepts `accentColor="pink"`**

Run: `grep -n "accentColor" src/components/SuitePageShell.tsx | head -5`
Expected output will show the accentColor prop type. If it's typed as a literal union that doesn't include `"pink"`, you must either add `"pink"` to the union in `SuitePageShell.tsx` or choose an existing accent color. Pink should work — but verify.

If `accentColor` type needs updating, add `"pink"` to the allowed literals in `SuitePageShell.tsx`.

- [ ] **Step 4.4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4.5: Commit**

```bash
git add src/app/suites/sales-marketing/page.tsx src/components/SuitePageShell.tsx 2>/dev/null
git commit -m "feat(suites): add Sales & Marketing suite landing page

New 9th suite at /suites/sales-marketing, mirrors Intelligence suite
structure (read-only analytics suite). Populated with existing sales,
pipeline, revenue, and forecast dashboards. Marketing-specific dashboards
ship in follow-ups.

Part of role-split spec (Phase 1, task 4 of 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add suite-nav entry and extend existing roles' `suites` lists

**Files:**
- Modify: `src/lib/suite-nav.ts`
- Modify: `src/lib/roles.ts` (ADMIN, EXECUTIVE, SALES, SALES_MANAGER `suites` lists)

- [ ] **Step 5.1: Add Sales & Marketing to `SUITE_NAV_ENTRIES`**

In `src/lib/suite-nav.ts`, insert the new entry after the Accounting entry (line ~60) and before the Admin entry:

```typescript
  {
    href: "/suites/sales-marketing",
    title: "Sales & Marketing Suite",
    shortLabel: "Sales & Marketing",
    description: "Pipeline visibility, revenue tracking, forecasting, and marketing analytics.",
  },
```

Final order: Operations, D&E, P&I, Intelligence, Service, D&R+Roofing, Executive, Accounting, **Sales & Marketing**, Admin.

- [ ] **Step 5.2: Extend `ADMIN.suites` in `roles.ts`**

Find the `ADMIN` constant (line ~54). Add `/suites/sales-marketing` to its `suites` array:

```typescript
  suites: [
    "/suites/operations",
    "/suites/design-engineering",
    "/suites/permitting-interconnection",
    "/suites/intelligence",
    "/suites/service",
    "/suites/dnr-roofing",
    "/suites/executive",
    "/suites/accounting",
    "/suites/sales-marketing",  // NEW
  ],
```

Do NOT touch `ADMIN.allowedRoutes` — it's already `["*"]`.

- [ ] **Step 5.3: Extend `EXECUTIVE.suites`**

Same pattern as ADMIN. `EXECUTIVE.allowedRoutes` is also `["*"]`, so no route changes.

- [ ] **Step 5.4: Extend `SALES_MANAGER.suites`**

Find `SALES_MANAGER` (line ~705). Add `/suites/sales-marketing` to its suites array. SALES_MANAGER already has `/dashboards/sales`, `/dashboards/pipeline`, etc. in `allowedRoutes` so no route changes needed — just add the suite visibility.

- [ ] **Step 5.5: Extend `SALES.suites`**

`SALES.suites` is currently `[]` (per line ~784 in spec-pre-state). Set it to `["/suites/sales-marketing"]`. This gives sales users a suite landing page for the first time.

Also: add `/suites/sales-marketing` to `SALES.allowedRoutes` (sales users didn't previously have any `/suites/*` route).

- [ ] **Step 5.6: Run the full role test suite**

Run: `npx jest src/__tests__/lib/ --no-coverage`
Expected: All role-related tests PASS.

If any test fails — particularly `user-access.test.ts` or `role-resolution-full.test.ts` — it may be because a test has hardcoded expectations about which suites a role sees. If a test asserts `SALES.suites.length === 0`, update the assertion to reflect the new single-suite default.

- [ ] **Step 5.7: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/lib/roles.ts src/lib/suite-nav.ts`
Expected: No errors.

- [ ] **Step 5.8: Commit**

```bash
git add src/lib/suite-nav.ts src/lib/roles.ts
git commit -m "feat(suites): wire Sales & Marketing suite into nav and roles

Adds the new suite to SUITE_NAV_ENTRIES and extends the suites arrays on
ADMIN, EXECUTIVE, SALES_MANAGER, and SALES. SALES gets a primary suite
landing page for the first time (previously landed on bare dashboards).

Part of role-split spec (Phase 1, task 5 of 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Add explicit suite-scoping tests for new roles

**Files:**
- Modify: `src/__tests__/lib/roles.test.ts`

The existing property-based tests cover shape. Add explicit per-role tests so regressions that broaden or narrow a new role's access are caught.

- [ ] **Step 6.1: Add the new test block**

Append to `src/__tests__/lib/roles.test.ts`:

```typescript
describe("scoped suite roles (Phase 1)", () => {
  it.each([
    ["DESIGN", "/suites/design-engineering"],
    ["PERMIT", "/suites/permitting-interconnection"],
    ["INTERCONNECT", "/suites/permitting-interconnection"],
    ["INTELLIGENCE", "/suites/intelligence"],
    ["ROOFING", "/suites/dnr-roofing"],
    ["MARKETING", "/suites/sales-marketing"],
  ] as const)("%s has exactly one suite: %s", (role, expectedSuite) => {
    const def = ROLES[role as UserRole];
    expect(def.suites).toEqual([expectedSuite]);
  });

  it.each([
    "DESIGN",
    "PERMIT",
    "INTERCONNECT",
    "INTELLIGENCE",
    "ROOFING",
    "MARKETING",
  ] as const)("%s does NOT grant Operations suite access", (role) => {
    const def = ROLES[role as UserRole];
    expect(def.suites).not.toContain("/suites/operations");
    expect(def.allowedRoutes).not.toContain("/suites/operations");
  });

  it.each([
    "DESIGN",
    "PERMIT",
    "INTERCONNECT",
    "INTELLIGENCE",
    "ROOFING",
    "MARKETING",
  ] as const)("%s cannot manage users", (role) => {
    expect(ROLES[role as UserRole].defaultCapabilities.canManageUsers).toBe(false);
  });

  it("MARKETING is read-only (no scheduling, no Zuper sync)", () => {
    const caps = ROLES.MARKETING.defaultCapabilities;
    expect(caps.canScheduleSurveys).toBe(false);
    expect(caps.canScheduleInstalls).toBe(false);
    expect(caps.canScheduleInspections).toBe(false);
    expect(caps.canSyncZuper).toBe(false);
  });

  it("SALES now lands on Sales & Marketing suite", () => {
    expect(ROLES.SALES.suites).toContain("/suites/sales-marketing");
    expect(ROLES.SALES.allowedRoutes).toContain("/suites/sales-marketing");
  });

  it("ADMIN, EXECUTIVE, SALES_MANAGER include the new suite", () => {
    expect(ROLES.ADMIN.suites).toContain("/suites/sales-marketing");
    expect(ROLES.EXECUTIVE.suites).toContain("/suites/sales-marketing");
    expect(ROLES.SALES_MANAGER.suites).toContain("/suites/sales-marketing");
  });
});
```

- [ ] **Step 6.2: Run the new tests**

Run: `npx jest src/__tests__/lib/roles.test.ts --no-coverage`
Expected: All tests PASS — the original property-based tests plus the six new `describe` blocks.

- [ ] **Step 6.3: Run the full test suite once**

Run: `npx jest --no-coverage`
Expected: All tests PASS. If any unrelated test fails, investigate — the Phase 1 changes are additive and shouldn't break anything. Most likely unrelated tests failing would indicate a flaky test in the suite, not a regression from this work.

- [ ] **Step 6.4: Commit**

```bash
git add src/__tests__/lib/roles.test.ts
git commit -m "test(roles): explicit suite-scoping assertions for 6 new roles

Property-based tests cover shape; these new tests lock the semantic
contract — each new role has exactly one suite, none grant Operations
access, none can manage users, MARKETING is read-only, and SALES /
ADMIN / EXECUTIVE / SALES_MANAGER include the new Sales & Marketing
suite.

Part of role-split spec (Phase 1, task 6 of 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

Keep documentation honest. Two sections need updates:

1. The "Suite Navigation" section has a table listing suites vs. roles. Add Sales & Marketing.
2. The "User Roles" section has a table summarizing each role's scope. Add the six new roles.

Per memory: **no brittle counts** — prefer phrasing like "the suite switcher" over "the 8 suites."

- [ ] **Step 7.1: Read the current role/suite documentation**

Run: `grep -n "TECH_OPS\|Operations Suite\|Suite Navigation\|User Roles" CLAUDE.md | head -20`

- [ ] **Step 7.2: Add Sales & Marketing row to the suite-visibility table**

Find the table that starts with `| Suite | Roles in Switcher |` and add a new row:

```markdown
| Sales & Marketing | ADMIN, EXECUTIVE, SALES_MANAGER, SALES, MARKETING |
```

- [ ] **Step 7.3: Add the six new roles to the "User Roles" table**

Add rows to the role-scope table:

```markdown
| DESIGN | D&E suite only |
| PERMIT | P&I suite (permitting portion) |
| INTERCONNECT | P&I suite (IC portion) |
| INTELLIGENCE | Intelligence suite only |
| ROOFING | D&R + Roofing suite only |
| MARKETING | Sales & Marketing suite (read-only) |
```

- [ ] **Step 7.4: Update the role-count phrasing**

If CLAUDE.md says something like "11 roles defined in Prisma schema", re-run the count or switch to generic phrasing ("multi-role system defined in Prisma schema — see `prisma/schema.prisma` for current values").

Per project memory (`feedback_claudemd_no_brittle_counts`): avoid exact counts. Prefer `run ...` instructions or loose phrasing.

- [ ] **Step 7.5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(roles): update CLAUDE.md for Phase 1 role split

Adds Sales & Marketing suite row to the suite-visibility table and the
6 new roles (DESIGN, PERMIT, INTERCONNECT, INTELLIGENCE, ROOFING,
MARKETING) to the role-scope summary.

Part of role-split spec (Phase 1, task 7 of 7).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Verification before PR

- [ ] **Step V.1: Full typecheck**

Run: `npx tsc --noEmit 2>&1 | tee /tmp/tsc-output.txt`
Expected: exit code 0. If there are errors, fix them before proceeding.

- [ ] **Step V.2: Full test suite**

Run: `npx jest --no-coverage 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step V.3: ESLint on changed files**

Run:
```bash
npx eslint src/lib/roles.ts src/lib/suite-nav.ts \
  src/app/suites/sales-marketing/page.tsx \
  src/app/admin/users/page.tsx \
  src/__tests__/lib/roles.test.ts
```

Expected: No errors.

- [ ] **Step V.4: Next.js build**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds. The new `/suites/sales-marketing` route should appear in the route manifest output.

- [ ] **Step V.5: Smoke test in dev**

Run: `npm run dev` in the background.

Visit:
- `http://localhost:3000/suites/sales-marketing` — should render the suite landing (as admin).
- `http://localhost:3000/admin/users` — should show the six new roles in the role picker.

Manually verify: an admin can assign the `DESIGN` role to a test user, then the user can reach `/suites/design-engineering` but not `/suites/operations`.

Per project convention, don't use Claude-in-Chrome for dev server testing — use the preview tools or tell the user to verify in browser.

- [ ] **Step V.6: Push branch and open PR**

Run:
```bash
git push -u origin feat/role-split-phase1
gh pr create --base main --head feat/role-split-phase1 \
  --title "feat(roles): Phase 1 — add 6 scoped suite roles + Sales & Marketing suite" \
  --body "$(cat <<'EOF'
## Summary
Additive Phase 1 of the role-split spec. Introduces six new scoped roles and one new suite without changing any existing user's access:

- **New roles:** \`DESIGN\`, \`PERMIT\`, \`INTERCONNECT\`, \`INTELLIGENCE\`, \`ROOFING\`, \`MARKETING\` — each scoped to a single suite, no Operations bundled in.
- **New suite:** \`/suites/sales-marketing\` (9th suite) — pipeline visibility, revenue tracking, forecasting. Lightweight in Phase 1 — cards link to existing dashboards; marketing-specific dashboards ship in follow-ups.
- **Extended existing roles:** \`ADMIN\`, \`EXECUTIVE\`, \`SALES_MANAGER\`, and \`SALES\` now see the new suite.

Spec: \`docs/superpowers/specs/2026-04-21-tech-ops-role-split-design.md\`

## What's NOT in this PR (follow-ups)
- Phase 2 backfill script that adds new roles to existing \`TECH_OPS\` users.
- Phase 3 per-user pruning + tightening of existing broad roles (e.g., removing Intelligence from \`PROJECT_MANAGER\`'s default suites).
- Phase 4 \`TECH_OPS\` / \`DESIGNER\` / \`PERMITTING\` enum value cleanup.

## Test plan
- [ ] CI green on Vercel preview
- [ ] Full \`npx jest --no-coverage\` passes
- [ ] \`npx tsc --noEmit\` clean
- [ ] Manually assign \`DESIGN\` to a test user, confirm they land on D&E suite only
- [ ] Manually assign \`MARKETING\` to a test user, confirm they see Sales & Marketing suite cards but cannot reach \`/dashboards/scheduler\`
- [ ] Confirm TECH_OPS users still reach every route they had before (no access regressions)

## Migration note
The Prisma migration adds enum values only. It's included in this PR but **not yet applied** — per project convention, \`prisma migrate deploy\` runs manually after merge. Schema change is forward-compatible (additive enum values with \`IF NOT EXISTS\`), so the code in this PR works the same whether the migration is applied before or after deploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Follow-ups (out of scope for this plan)

These are captured from the spec but **not part of Phase 1**. Each should be a separate spec/plan/PR cycle.

1. **Phase 2: backfill existing `TECH_OPS` users** — idempotent script that adds `DESIGN`, `PERMIT`, `INTERCONNECT` to every user whose `roles[]` contains `TECH_OPS`. Dry-run first.
2. **Phase 3: per-user pruning + tightening existing roles** — admin-driven rolling review. Separately, narrow `PROJECT_MANAGER.suites` and `OPERATIONS_MANAGER.suites` to remove Intelligence / D&R where the user didn't actually need it.
3. **Phase 4: drop `TECH_OPS`, `DESIGNER`, `PERMITTING` legacy values** — paired with the Phase 4 DB rename on the 2026-03-23 timeline from memory (verify date before acting).
4. **Marketing-specific dashboards** — lead-source attribution, campaign tracking, conversion funnels. These become cards on the Sales & Marketing suite.
5. **SALES_MANAGER suite trim** — today `SALES_MANAGER` has access to Operations + Intelligence + Executive + Accounting suites. If that's over-broad, consider scoping to Sales & Marketing + maybe Accounting only.

---

## Design-for-isolation notes

- **`roles.ts` is the only file that describes access.** Everything else derives from it — middleware, resolver, admin UI, suite nav, tests. This plan preserves that single-source-of-truth property. Don't add role logic elsewhere.
- **Each new `RoleDefinition` is a self-contained unit.** You can understand what DESIGN grants by reading 50 lines; you can change those 50 lines without breaking other roles. Tests verify the contract boundary.
- **The suite page is a thin shell.** `/suites/sales-marketing/page.tsx` does nothing except declare cards and delegate to `SuitePageShell`. The moment it starts doing more, it becomes a dashboard, not a suite landing — at which point we've designed the wrong thing.

---

## Skill references

- `@superpowers:test-driven-development` — apply for every test-first step above
- `@superpowers:verification-before-completion` — run ALL verification steps (V.1–V.5) before claiming the PR is ready
- `@superpowers:requesting-code-review` — use when opening the PR for Claude-assisted review
