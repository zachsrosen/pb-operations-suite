# TECH_OPS Role Split — Design Spec

**Date:** 2026-04-21
**Status:** Draft — awaiting approval
**Author:** Zach + Claude

## Problem

Two related pain points:

1. **Naming collision.** We just rebranded the product to "PB Tech Ops Suite" (PR #287). The `TECH_OPS` role (designers + permitting coordinators) now shares a name with the entire product. Users reading "You have Tech Ops access" can't tell if that means "designer/permitter" or "whole product."
2. **Role-suite coupling is loose.** `TECH_OPS` grants access to three suites at once (D&E, P&I, Operations). There's no way to grant a designer D&E access without also granting P&I access — which matters if we ever want to lock down design-rework-flags, permit revisions, or IC action queues by function.

Phase 2 multi-role support shipped already, so any one user can hold multiple roles. This unlocks a clean split.

## Non-goals

- Dropping `TECH_OPS` immediately. This spec explicitly keeps it alive during migration.
- Reworking route allowlists beyond what's needed to define the new roles. Existing cross-suite routes on TECH_OPS stay reachable via the union of new roles.
- Touching `OPERATIONS` role. TECH_OPS currently has Operations suite access; anyone who needs that during/after migration gets OPERATIONS added alongside.

## Approaches considered

**A. Relabel only (smallest).** Change the `TECH_OPS` label from "Tech Ops" to "Design & Permitting" in `roles.ts`. Zero data migration. Solves pain point #1. Leaves pain point #2 untouched.

**B. Parallel roles + gradual migration (recommended).** Add three new enum values (`DESIGN`, `PERMITTING`, `INTERCONNECTION`). Backfill existing `TECH_OPS` users with all three alongside their existing role. Leave `TECH_OPS` in the enum and allowlist tables as a deprecated superset. New users only get granular roles. Eventually drop `TECH_OPS` in a cleanup migration once the multi-role Phase 4 DB rename is done.

**C. Hard cutover.** Add new roles, migrate all users in one shot, mark `TECH_OPS` as legacy (`normalizesTo` one of the new roles). Less long-term drift; more risk on the cutover day.

**Recommendation: B.** The user explicitly asked for gradual. It matches the pattern already established for `MANAGER → PROJECT_MANAGER` and `DESIGNER/PERMITTING → TECH_OPS` normalization. It also lets us observe whether any users *actually* need all three new roles before deciding whether TECH_OPS-as-shorthand has long-term value.

## Design

### New roles

| Enum | Label | Badge | Default suite(s) |
|---|---|---|---|
| `DESIGN` | Design | emerald / `DESIGN` | `/suites/design-engineering` |
| `PERMIT` | Permitting | sky / `PERMIT` | `/suites/permitting-interconnection` |
| `INTERCONNECT` | Interconnection | violet / `IC` | `/suites/permitting-interconnection` |
| `INTELLIGENCE` | Intelligence | fuchsia / `INTEL` | `/suites/intelligence` |
| `ROOFING` | Roofing / D&R | rose / `ROOFING` | `/suites/dnr-roofing` |
| `MARKETING` | Marketing | pink / `MKTG` | `/suites/sales-marketing` (NEW suite — see below) |

All six are strictly scoped to their primary suite — no Operations bundled in. The existing TECH_OPS role's cross-suite superset behavior is preserved only during migration, not replicated in the new roles. Anyone who needs additional suites stacks roles (e.g., a roofing manager who also schedules solar installs gets `ROOFING` + `OPERATIONS`).

Route allowlists:

- **DESIGN** — D&E suite, design revisions, plan review, DA rework flags, clipping analytics, AHJ *requirements* (design-facing), solar designer/surveyor, utility design requirements, pending approval, BOM tools, catalog (partitioned from TECH_OPS)
- **PERMIT** — P&I suite chrome, permit action queue, permit revisions, AHJ *tracker* (tracking-facing, not requirements), PI timeline + overview (partitioned from TECH_OPS)
- **INTERCONNECT** — P&I suite chrome, IC action queue, IC revisions, utility tracker, PI timeline + overview (partitioned from TECH_OPS)
- **INTELLIGENCE** — Intelligence suite chrome, `/dashboards/qc`, `/dashboards/at-risk`, `/dashboards/alerts`, `/dashboards/pipeline`, `/dashboards/optimizer`, `/dashboards/forecast-*`, `/dashboards/design-pipeline-funnel`, `/dashboards/territory-map`, `/dashboards/office-performance`, `/dashboards/preconstruction-metrics` (partitioned from PROJECT_MANAGER/OPERATIONS_MANAGER)
- **ROOFING** — D&R+Roofing suite chrome, `/dashboards/dnr`, `/dashboards/roofing`, `/dashboards/roofing-scheduler`, `/dashboards/dnr-scheduler` (partitioned from OPERATIONS)
- **MARKETING** — Sales & Marketing suite chrome, `/dashboards/sales`, `/dashboards/pipeline`, `/dashboards/deals`, `/dashboards/revenue`, `/dashboards/forecast-timeline`, `/dashboards/forecast-accuracy`, `/api/deals`, `/api/projects`, `/api/forecasting`, `/api/revenue-goals`. Read-only (no scheduling, no Zuper sync).
- **Shared baseline** across all six (deduplicated) — `/`, deals, projects, SOP, comms, my-tasks, my-tickets, idr-meeting, activity log, bugs, on-call viewing

Suites default to only their primary area — **no Operations suite access from any of the three new roles.** Someone who does both permitting and IC gets both roles and sees the full P&I suite dashboard set. Someone who does all three (what TECH_OPS is today) gets all three roles. Anyone who also needs Operations suite access (scheduling, construction) gets the `OPERATIONS` role added alongside.

### Landing cards

Each new role gets 2–3 focused landing cards for its primary suite:

- DESIGN → `/dashboards/design`, `/dashboards/plan-review`, `/dashboards/design-revisions`
- PERMIT → `/dashboards/permitting`, `/dashboards/pi-permit-action-queue`, `/dashboards/ahj-tracker`
- INTERCONNECT → `/dashboards/interconnection`, `/dashboards/pi-ic-action-queue`, `/dashboards/utility-tracker`
- INTELLIGENCE → `/dashboards/qc`, `/dashboards/at-risk`, `/dashboards/pipeline`
- ROOFING → `/dashboards/roofing`, `/dashboards/roofing-scheduler`, `/dashboards/dnr`
- MARKETING → `/dashboards/pipeline`, `/dashboards/revenue`, `/dashboards/forecast-timeline`

### New suite: Sales & Marketing

Adds a 9th suite at `/suites/sales-marketing` (10th with Admin). Renders existing sales dashboards as suite cards initially — marketing-specific dashboards (lead-source attribution, campaign tracking, etc.) ship in follow-ups as they're built. Accessible to:

- `MARKETING` (new, scoped to this suite)
- `SALES` (existing — re-scoped to have this as primary landing suite; retains site-survey-scheduler access)
- `SALES_MANAGER` (existing — add this suite to its visible list alongside current access)
- `ADMIN`, `EXECUTIVE` (add this suite)

Files created:
- `src/app/suites/sales-marketing/page.tsx` — suite landing page (mirror the structure of existing `/src/app/suites/intelligence/page.tsx`)
- Suite nav entry in `src/lib/suite-nav.ts`

The suite is purposefully lightweight in Phase 1: suite chrome + cards linking to existing `/dashboards/sales`, `/dashboards/pipeline`, `/dashboards/revenue`, `/dashboards/forecast-*`. No new dashboards.

### TECH_OPS treatment during migration

- Stays canonical (`normalizesTo: "TECH_OPS"`) — not flipped to a new role.
- Stays in the picker until Phase 2 migration completes, then `visibleInPicker: false`.
- `allowedRoutes` unchanged for now so existing sessions don't break.
- Label stays `"Tech Ops"` during Phase 1 → relabeled to `"Tech Ops (legacy)"` at Phase 2.
- The existing legacy `DESIGNER` and `PERMITTING` enum values need a decision:
  - **Option X:** Re-promote `PERMITTING` to canonical as-is (rename label from "Permitting (legacy)"); rename `DESIGNER` → `DESIGN` (new enum, drop the legacy one).
  - **Option Y:** Add all three as brand-new enum values (`DESIGN`, `PERMIT`, `INTERCONNECT`). Leave `DESIGNER` and `PERMITTING` legacy as-is.
  - **Recommendation: Y.** Cleaner names, avoids Prisma enum rename hazard (enum value renames are not safe in Postgres without shadow columns). The legacy DESIGNER/PERMITTING enum values can be dropped in the same final migration that drops TECH_OPS.

### Phased rollout

**Phase 1 — Ship new roles alongside TECH_OPS.** (This PR)
- Add `DESIGN`, `PERMITTING`, `INTERCONNECTION` to `UserRole` enum (Prisma migration).
- Add three new `RoleDefinition`s to `roles.ts` with partitioned allowlists, landing cards, badges.
- Add the three suites-switcher entries through the existing `suites` field.
- Update `suite-nav.ts` visibility table in `CLAUDE.md`.
- Add role-picker UI entries for admin user-management.
- **No existing user data changes.** Admins can start assigning new roles to *new* users and to existing users who want to test.
- Ship gate: manual smoke test by an admin assigning DESIGN to one user and verifying D&E suite loads.

**Phase 2 — Backfill.** (2–7 days after Phase 1 is stable)
- Script: for every user with `TECH_OPS` in `roles[]`, append the three new roles (`DESIGN`, `PERMITTING`, `INTERCONNECTION`). Idempotent; skips users who already have any of them. Dry-run first.
- Mark `TECH_OPS` label as `"Tech Ops (legacy)"` and set `visibleInPicker: false`.
- Email affected users: "Your access hasn't changed. Your role list now lists the specific functions you have access to."
- Gate: Phase 3 waits until there's a 1–2 week observation window with zero "I lost access" reports.

**Phase 3 — Per-user pruning + access tightening.** (Manual, rolling, admin-driven)
- Admin reviews each multi-role-TECH_OPS user against their actual job function (e.g., Vishtik designer = `DESIGN` only; Sean = `PERMIT` + `INTERCONNECT`; PMs keep all three).
- Removes roles they don't need. TECH_OPS stays on every user's list during this phase as a safety net.
- **Tighten existing roles:** separately, admin reviews who *today* has access to Intelligence + D&R/Roofing via manager/OPS role bundling. Users who should NOT have that access get the broader role removed and replaced with the new scoped role if needed. Examples:
  - An `OPERATIONS` user who only does roofing → swap for `ROOFING` alone.
  - A `PROJECT_MANAGER` who shouldn't see Intelligence dashboards → consider removing `/suites/intelligence` from `PROJECT_MANAGER`'s default suite list (schema change, separate micro-migration).

**Phase 4 — Drop TECH_OPS.** (Future, paired with Phase 4 DB rename on 2026-03-23 timeline — note from memory, verify date)
- Remove `TECH_OPS`, `DESIGNER`, `PERMITTING` legacy values from enum.
- Remove `TECH_OPS` from every user's `roles[]`.
- Remove legacy normalization logic.

### Schema change

Single Prisma migration in Phase 1 adds six enum values:

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
  DESIGN            // NEW
  PERMIT            // NEW
  INTERCONNECT      // NEW
  INTELLIGENCE      // NEW
  ROOFING           // NEW
  MARKETING         // NEW
  DESIGNER          // legacy — normalizes to TECH_OPS (unchanged)
  PERMITTING        // legacy — normalizes to TECH_OPS (unchanged)
  VIEWER
  SALES
  ACCOUNTING
}
```

**Naming notes:**
- `PERMIT` (not `PERMITTING`) to avoid collision with the existing legacy `PERMITTING` enum value. Labels can still read "Permitting" in the UI — the enum identifier doesn't leak to end users.
- `INTERCONNECT` (not `INTERCONNECTION`) for consistency with `PERMIT` (short verb form) and to keep all three new P&I/D&E enum values at ≤12 chars.
- Legacy `DESIGNER`, `PERMITTING` stay as-is (deprecated, still normalize to `TECH_OPS`) and get dropped in Phase 4.

### Files touched (Phase 1)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `DESIGN`, `PERMIT`, `INTERCONNECT`, `INTELLIGENCE`, `ROOFING`, `MARKETING` to `UserRole` enum; migration file |
| `src/lib/roles.ts` | Add six `RoleDefinition`s; update `SALES` + `SALES_MANAGER` + `ADMIN` + `EXECUTIVE` `suites` lists to include `/suites/sales-marketing`; register in `ROLES` export |
| `src/lib/suite-nav.ts` | Add `Sales & Marketing` entry to `SUITE_NAV_ENTRIES` |
| `src/app/suites/sales-marketing/page.tsx` | NEW — suite landing page (mirror `/suites/intelligence/page.tsx` structure) |
| `src/lib/user-access.ts` | No change (resolver already handles multi-role union) |
| `src/lib/role-resolution.ts` | No change (normalization already handles new canonical values by default) |
| `src/middleware.ts` | No change (route allowlist derives from `roles.ts`) |
| `src/app/admin/users/page.tsx` | Add six new picker options with descriptions |
| `src/app/admin/directory/page.tsx` | Badge abbrev colors for six new roles |
| `CLAUDE.md` | Update suite-switcher visibility table + role enum summary; bump suite count from 8 to 9 |

**Subsequent phase scripts:**

- `scripts/backfill-tech-ops-to-granular.ts` — Phase 2 backfill (write in Phase 1, run in Phase 2)

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Partitioning routes wrong — a designer loses access to a tool they need | Phase 1 makes new roles additive, not replacements. TECH_OPS stays a superset during the full migration window. |
| Enum rename / data loss during Prisma migration | Only *additions* in Phase 1. Removal happens in Phase 4 only after all users migrated. |
| Multi-role resolver performance regression | Resolver already handles multi-role; no change needed. Spot-check `resolveEffectiveRole` with 4-role user at start of Phase 2. |
| Naming drift — "Design" vs "Designer" vs "DESIGN" | Pick one (label: "Design"; enum: `DESIGN`) and document at top of `roles.ts`. |

## Resolved design decisions

- **Keep the 3-role P&I/D&E split.** Permitting and Interconnection are sometimes separate at PB — keeping them as distinct roles means a permit-only person doesn't get IC access and vice versa.
- **Add `INTELLIGENCE` and `ROOFING` roles.** Today those suites are only reachable through broader manager/OPS roles, which grants access to people who shouldn't have it. Dedicated scoped roles let admin right-size.
- **Add `MARKETING` role + Sales & Marketing Suite.** New 9th suite with full pipeline visibility for the role (read-only — no scheduling/Zuper). Starts with existing sales dashboards; marketing-specific dashboards ship in follow-ups.
- **None of the new roles get Operations suite access by default.** Strictly their primary suite. Rationale: leaves room to grant scoped access to someone without also giving them scheduling or full ops. Anyone who needs more adds additional roles.

## Success criteria

- Phase 1 merges with zero access regressions (existing `TECH_OPS` users still reach every route they had before).
- At least one non-admin user tests a new granular role end-to-end before Phase 2 backfill runs.
- Post-Phase-2: admin can answer "what suites does this user see?" by reading their role badges, without consulting the code.
