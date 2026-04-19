# Admin Page Internals Redesign — Design Spec

**Date:** 2026-04-18
**Status:** Spec
**Author:** Zach Rosen (via Claude brainstorm)
**Phase:** 2 of the admin IA overhaul. Phase 1 shipped `<AdminShell>` + the `/admin` landing; this phase rebuilds the insides of the 9 admin pages.

## Problem

The nine `/admin/*` pages now share a unified shell (PR #213, #214) but their bodies are still the hand-rolled tables, filter rows, and modals from several different eras:

- `/admin/users` is 1,223 lines with 20+ `useState` hooks and three overlapping modals (permissions, roles editor, extra routes). Three features shipped tonight bolted more onto it.
- `/admin/audit` is 1,026 lines.
- `/admin/crew-availability` is 886 lines.
- `/admin/security` is 673 lines.
- Total admin page code: ~5,500 LOC across nine files.

Each page picked its own approach to filter UI, table rendering, bulk actions, and detail views. The code is functional but neither consistent nor maintainable. A new hire reading `/admin/users` would see patterns that show up nowhere else in the codebase.

This spec redesigns the insides of those nine pages around a small shared component library, with a specific treatment for each page and a phased rollout.

## Goals

1. Every admin page composes the same seven primitives instead of hand-rolling its own table, filters, modals, and forms.
2. `/admin/users` reduces from three overlapping modals to one coherent detail drawer with tabbed sections. All three Phase-1 features (per-role capability overrides, per-user extra routes, role editing) preserved.
3. Admin page code drops from ~5,500 LOC to ~3,100 LOC (~44% reduction) — not by removing features, by removing duplication.
4. `/admin/roles/[role]` folds into a drawer inside `/admin/roles`, reducing one page URL to a query param. This is the only opportunistic C-class pruning in this spec.
5. Keyboard navigation works across every admin table (tab / arrow keys / enter / esc).

## Non-goals

- No new admin features. Every feature present today survives into the new design (except the dedicated `/admin/roles/[role]` URL, which becomes a drawer).
- No changes to admin API routes. The redesign is purely frontend.
- No data-model changes. No migrations.
- No changes to any non-admin surface.
- No URL changes except the single route deletion (with a redirect).
- No new accessibility features beyond keyboard nav on tables (e.g., no screen-reader audit pass, no high-contrast mode).

## Architecture

### Pattern library — seven shared primitives

All in `src/components/admin-shell/`. Each under ~250 LOC. Each composable via props/slots, not configuration.

| Component | Responsibility |
|---|---|
| `<AdminTable>` | Rows, sortable columns, selection checkboxes, sticky header, hover states, empty-state slot, row-click handler (typically opens detail drawer) |
| `<AdminFilterBar>` | Filter chips, multi-select dropdowns, date-range picker, search input, "clear all" action |
| `<AdminDetailDrawer>` | Right-side slide-out (384px default, 480px with `wide` prop). Scrollable body. Tabbed sections optional. Close via Esc / outside click / explicit close button |
| `<AdminBulkActionBar>` | Sticky bottom bar that appears when rows are selected. Selection count, cancel, action buttons |
| `<AdminForm>` | Label + input + help text + error pattern. Supports text / select / multi-select / toggle / textarea inputs |
| `<AdminKeyValueGrid>` | Two-column read-mostly layout for detail panels |
| `<AdminDetailHeader>` | Tiny composition helper: title + subtitle + actions row. Used inside drawers |

### What gets reused (not rebuilt)

- `ConfirmDialog` at `src/components/ui/ConfirmDialog.tsx`
- `MultiSelectFilter` at `src/components/ui/MultiSelectFilter.tsx` — wrapped inside `AdminFilterBar`
- `ToastContext` for notifications
- `AdminEmpty`, `AdminLoading`, `AdminError` from Phase 1
- `AdminPageHeader` from Phase 1
- Existing date-range picker patterns on scheduler pages (don't duplicate)

### Per-page treatment

| Page | Today LOC | Target LOC | Treatment |
|---|---:|---:|---|
| `/admin` (landing) | 320 | 320 | **No changes.** Already clean from Phase 1. |
| `/admin/users` | 1,223 | ~500 | **Full rewrite.** Three modals (permissions / roles editor / extra routes) merge into one `<AdminDetailDrawer>` with tabbed sections: *Info / Roles / Permissions / Extra Routes / Activity*. Bulk action bar via `<AdminBulkActionBar>`. All Phase-1 features (Option B capability overrides surfaced via role link, Option D extra routes, role editing) preserved. |
| `/admin/roles` | 258 | ~200 | Light rewrite. Role cards → `<AdminTable>` (columns: Role / Label / Scope / Badge / Users). Row click → `<AdminDetailDrawer>` containing the role's capability editor (the Option B UI, moved from `/admin/roles/[role]`). |
| `/admin/roles/[role]` | 65 | **0 (deleted)** | Route deleted. Page redirects to `/admin/roles?role=X`. Deep-link preserved via query param. |
| `/admin/directory` | 130 | ~130 | Light rewrite using `<AdminTable>` + `<AdminFilterBar>`. Already clean. |
| `/admin/crew-availability` | 886 | ~450 | Rewrite. Filter bar + table + `<AdminDetailDrawer>` for edit (replaces inline forms). |
| `/admin/tickets` | 384 | ~250 | Rewrite. `<AdminTable>` + `<AdminDetailDrawer>` (replaces existing ticket modal). |
| `/admin/activity` | 597 | ~350 | **Anchor page.** Full rewrite establishing patterns. See detail below. |
| `/admin/audit` | 1,026 | ~500 | Rewrite. Filter bar + table + drawer for session detail. |
| `/admin/security` | 673 | ~400 | Rewrite. Four existing sections (suspicious emails, IP analysis, risk events, admin actions) each become a `<AdminTable>` instance. |
| **Total** | **~5,562** | **~3,100** | **~44% reduction.** |

### Anchor page detail — `/admin/activity`

Chosen as anchor because its patterns (filter bar + table + detail drawer + pagination) recur on five other pages. Designing this page well establishes the primitives' final shape. Any primitive behavior that feels wrong here gets fixed before the anchor PR merges.

**Layout:**

```
<AdminPageHeader title="Activity Log" breadcrumb={["Admin","Audit","Activity log"]} />

<AdminFilterBar>
  — Date range chip (Today / 7d / 30d / All)
  — Type multi-select
  — Role multi-select
  — Email search input
  — Auto-refresh toggle chip
  — Clear all
</AdminFilterBar>

<AdminTable
  columns={[Time, Actor, Event, Entity, Risk]}
  onRowClick={activity => openDrawer(activity)}
/>

<Pagination offset-based />

<AdminDetailDrawer open={selectedActivity !== null}>
  <AdminDetailHeader title={activity.description} subtitle={activity.createdAt} />
  <AdminKeyValueGrid items={[
    Type, Actor email, Entity, Session ID, IP, UA, Request path/method
  ]} />
  <pre>{JSON.stringify(activity.metadata, null, 2)}</pre>
  <Link>View user / role / related entity →</Link>
</AdminDetailDrawer>
```

Client-side state reduced from today's ~15 `useState` hooks to ~5 (filter state object, selected row, pagination cursor, loading, error). All filter state serialized to URL query params (already partial — extend fully).

## Data flow

- Every page keeps its existing data-fetching approach (React Query hook or server component). The pattern library is UI only.
- `<AdminFilterBar>` reports filter state via a single `onChange(state)` callback. Pages are responsible for applying filter state to their query.
- `<AdminTable>` is controlled: pages pass `rows`, `selectedIds`, `sortBy`. No internal state except hover / keyboard-focus indicators.
- `<AdminDetailDrawer>` is controlled: page owns the "selected row" state and the open/close lifecycle.
- URL query params are the source of truth for deep-linkable filter state. Drawer-open state is also in URL (`?drawerId=X`) so deep-links into a specific user/role/session work.

## Error handling

- Every page wraps its data fetch in an error boundary. Errors render `<AdminError>` with retry.
- `<AdminTable>`'s empty-state slot shows `<AdminEmpty>` when filter state returns zero rows.
- Drawer close is tolerant: Esc, outside click, explicit close button, browser back button.
- Bulk action failures surface a toast with retry affordance; partial successes show per-row status in the bar.

## Accessibility

- `<AdminTable>` keyboard nav: arrow up/down moves focus between rows, Enter opens the drawer, Space toggles selection checkbox.
- `<AdminDetailDrawer>` traps focus while open, restores focus to the triggering row on close. Uses `aria-labelledby` pointing at the drawer title.
- `<AdminBulkActionBar>` has `role="region"` with `aria-live="polite"` so count changes are announced.
- `<AdminFilterBar>` chips are real buttons with `aria-pressed` reflecting active state.

## Testing

- Unit tests per primitive: rendering, keyboard nav, controlled props, accessibility attributes.
- One representative page-level test per treatment category:
  - **Table-heavy page:** `/admin/activity` — filter → row click → drawer → URL state.
  - **Drawer-with-tabs page:** `/admin/users` — tab switching, bulk action, deep-link preservation.
  - **Light rewrite:** `/admin/directory` — smoke test only.
- Manual smoke for every rewritten page before its PR merges.
- No new integration or E2E tests (none exist today; adding them is out of scope).

## Rollout — eight PRs

Each PR is independently mergeable. You can pause between any two.

1. **PR 1 — Primitives batch 1.** `<AdminTable>` + `<AdminFilterBar>` + `<AdminDetailDrawer>` + tests. No page changes; pure component additions.
2. **PR 2 — Primitives batch 2.** `<AdminBulkActionBar>` + `<AdminForm>` + `<AdminKeyValueGrid>` + `<AdminDetailHeader>` + tests. No page changes.
3. **PR 3 — Anchor.** `/admin/activity` rewritten using the primitives. If any primitive behavior feels wrong, fix it here and re-run PR 1/2 tests.
4. **PR 4 — Small pages.** `/admin/tickets` + `/admin/directory` rewrites (lowest risk, smallest diffs).
5. **PR 5 — Audit stack.** `/admin/audit` + `/admin/security` rewrites.
6. **PR 6 — Crew.** `/admin/crew-availability` rewrite.
7. **PR 7 — Roles consolidation.** `/admin/roles` rewrite + delete `/admin/roles/[role]` (redirect shim preserves `?role=X` deep-link).
8. **PR 8 — Users.** `/admin/users` full rewrite. Last because highest risk and biggest diff; by PR 7 the primitives are battle-tested.

## Risks

| Risk | Mitigation |
|---|---|
| Users' muscle memory breaks — people are used to where specific buttons live on `/admin/users`. | Anchor + light pages ship first; `/admin/users` is last, after patterns are validated on low-risk pages. Before merging PR 8, a walk-through with Zach of each tonight's Option B/D/E flow. |
| `<AdminDetailDrawer>` gets bloated trying to handle every case (tabs, forms, bulk context, deep-links). | Hard cap at 250 LOC. If it bulges, extract a `<AdminDrawerTabs>` helper and limit the drawer itself to layout. |
| Deleting `/admin/roles/[role]` breaks external links / SOPs / email templates. | Redirect shim at the old URL: `redirect(/admin/roles?role=${role})`. Grep for `/admin/roles/` across repo before merging PR 7 to catch any internal links. |
| Admin code drops 2,400 LOC but the primitives add ~1,500 LOC, so the net is smaller than 44%. Still a real win but worth saying honestly. | Acknowledge in the PR summary. Net LOC including primitives is ~4,600 (~17% reduction) but per-page reason-ability is what actually matters, not the raw line count. |
| Tonight's Option B/D/E features on `/admin/users` have brand-new state/modal behavior that could easily be lost in a rewrite. | PR 8 includes an explicit test-plan checklist walking every Option B/D/E workflow. No merge until each passes manually. |

## Open questions

- Should `<AdminTable>` support row expansion (expand-in-place to show detail) as an alternative to the drawer? Current answer: no — picking one pattern keeps pages consistent; drawer wins because it scales to more content. Revisit if any single page actually needs expand-in-place.
- Should `<AdminDetailDrawer>` support a stacked / nested drawer (user drawer opens, user clicks "view activity" → activity drawer opens on top)? Current answer: no in Phase 2 — one drawer at a time. Links navigate to the other page's URL with the drawer open via query param.

## Success criteria

- All 9 admin pages recompose from the seven primitives, with no per-page filter, table, modal, or bulk-action components outside them.
- `/admin/users` presents one detail drawer with tabbed sections, not three overlapping modals, and every Phase-1 feature still works.
- Admin page code totals under 3,300 LOC (target: ~3,100).
- Each admin page under 500 LOC except `/admin/users` under 700.
- Keyboard navigation works across every admin table (arrows, enter, esc, space).
- No new dependencies added.

## What comes after

Phase 3+ candidates (deferred):
- Same pattern applied to non-admin pages — a future `<SuiteTable>` / `<SuiteFilterBar>` / etc. for the dashboards under `/dashboards/*`.
- Admin-level keyboard shortcut system (`⌘K` for search already exists; could add `⌘G` to go to a specific admin page, `⌘F` to focus the page filter, etc.).
- Saved filters (admins can save a filter combination and give it a name). Requires a new Prisma model, hence out of scope here.
