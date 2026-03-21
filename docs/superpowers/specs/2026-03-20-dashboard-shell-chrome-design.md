# DashboardShell Chrome Polish — Phase 2 Design Spec

## Goal

Restructure the DashboardShell header so the page title reads as identity, not as one more control in a toolbar. Align the design language with the Phase 1 suite page polish.

## Design Principle

**Page identity first, utility controls second.** Suite accent = wayfinding (where am I in the product?). Page accent = content identity (what specific dashboard is this?).

## Scope

**In scope:** `DashboardShell.tsx` header chrome, shared suite accent module extraction.
**Out of scope:** MetricCard components (Phase 3), individual dashboard page content, suite pages (already done in Phase 1).

## Current State

The DashboardShell header (`src/components/DashboardShell.tsx`) is a sticky glassmorphic bar containing:
- Breadcrumbs (top row): Home / {Suite} / {optional crumbs}
- Main row: back arrow SVG, PB logo badge (hidden on mobile), title + subtitle, "Updated X ago", export button, theme toggle, `headerRight` slot

Every element has equal visual weight. The title competes with navigation and utility controls instead of anchoring the page.

## Design Changes

### 1. Extract Shared Suite Accent Map

**Before:** `SUITE_ACCENT_COLORS` lives inside `SuitePageShell.tsx` as a local constant.
**After:** Move to `src/lib/suite-accents.ts` as a shared export. Both `SuitePageShell.tsx` and `DashboardShell.tsx` import from there.

```typescript
// src/lib/suite-accents.ts
export interface SuiteAccent {
  color: string;
  light: string;
}

export const SUITE_ACCENT_COLORS: Record<string, SuiteAccent> = {
  "/suites/operations":                 { color: "#f97316", light: "#fb923c" },
  "/suites/design-engineering":         { color: "#6366f1", light: "#818cf8" },
  "/suites/permitting-interconnection": { color: "#06b6d4", light: "#22d3ee" },
  "/suites/service":                    { color: "#06b6d4", light: "#22d3ee" },
  "/suites/dnr-roofing":                { color: "#a855f7", light: "#c084fc" },
  "/suites/intelligence":               { color: "#3b82f6", light: "#60a5fa" },
  "/suites/executive":                  { color: "#f59e0b", light: "#fbbf24" },
  "/suites/admin":                      { color: "#f97316", light: "#fb923c" },
};

export const DEFAULT_SUITE_ACCENT: SuiteAccent = { color: "#f97316", light: "#fb923c" };
```

`SuitePageShell.tsx` is updated to import from this module instead of defining the map locally. Delete `SUITE_ACCENT_COLORS` and `DEFAULT_ACCENT` from `SuitePageShell.tsx` and import `SUITE_ACCENT_COLORS` and `DEFAULT_SUITE_ACCENT` from `@/lib/suite-accents` instead. Update the reference on the `accent` resolution line from `DEFAULT_ACCENT` to `DEFAULT_SUITE_ACCENT`. `SECTION_COLORS` and `DEFAULT_SECTION_COLOR` remain local to `SuitePageShell.tsx` — they are not part of this extraction.

**Note:** Service (`/suites/service`) and P&I (`/suites/permitting-interconnection`) intentionally share the same cyan accent `#06b6d4`. This is a deliberate design choice, not an oversight.

### 2. Header Structure — Two Visual Tiers

The sticky header keeps its glassmorphism (`bg-surface-elevated/80 backdrop-blur-sm border-b border-t-border/80`) but the content inside is restructured into clearer tiers:

**Top tier — Breadcrumbs (wayfinding):**

Breadcrumbs stay above the main row, functionally unchanged. Any breadcrumb whose `href` is a key in `SUITE_ACCENT_COLORS` gets the suite accent color via inline style (`color: SUITE_ACCENT_COLORS[crumb.href].color`). This works for both auto-generated single-crumb arrays and explicit multi-crumb arrays passed via the `breadcrumbs` prop. Non-suite breadcrumb links remain `text-muted hover:text-foreground`.

Example: `Home / Operations / Master Schedule` where "Operations" renders in the suite's orange accent because `/suites/operations` is in `SUITE_ACCENT_COLORS`.

**Bottom tier — Identity + Controls:**

| Left zone | Right zone |
|-----------|------------|
| PB badge (back-to-suite) + title block with suite accent border | Utility controls (muted) |

### 3. PB Badge as Back-to-Suite Affordance

**Before:** Back arrow SVG (`DashboardShell.tsx:233-251`) + separate PB badge (`DashboardShell.tsx:252`).
**After:** PB badge replaces the back arrow entirely.

- Uses `<PhotonBrothersBadge>` with the existing `label` prop (added in Phase 1).
- `href={parentSuite.href}` when a parent suite exists; `href="/"` as fallback.
- `label="Back to {parentSuite.label} Suite"` when parent suite exists; `label="Back to Dashboard"` as fallback.
- The back arrow SVG button and its `handleBack` callback are removed. **This is an intentional behavioral change:** the current `handleBack` uses `router.back()` when browser history exists, which returns the user to wherever they came from (e.g., a search result, another dashboard). The new PB badge always navigates deterministically to the parent suite. This trades contextual back-navigation for predictable wayfinding — the user always knows where the badge takes them. This is the right tradeoff for a product where suite pages are the primary navigation hub.
- The PB badge is always visible (remove `hidden sm:inline-flex` — it was hidden on mobile to save space alongside the back arrow, but without the arrow it can always show). On very narrow screens (320px), the badge is ~52px wide in compact mode, leaving ~150-160px for the title after padding and right controls. This is tight but workable given `truncate` on the title.

**Edge case — non-suite SUITE_MAP entries:** The AI dashboard entry (`"/dashboards/ai": { href: "/dashboards/ai", label: "AI Skills" }`) has a self-referential href that is not a `/suites/*` path. For badge and accent logic, treat `parentSuite` as `null` when `parentSuite.href` does not start with `/suites/`. This means the AI dashboard (and any future non-suite entries) gets the fallback behavior: badge links to `/`, label is "Back to Dashboard", accent is `DEFAULT_SUITE_ACCENT`.

```typescript
const parentSuite = getParentSuiteForPath(pathname);
const isRealSuite = parentSuite?.href?.startsWith("/suites/") ?? false;
const effectiveParent = isRealSuite ? parentSuite : null;
const suiteAccent = effectiveParent
  ? (SUITE_ACCENT_COLORS[effectiveParent.href] || DEFAULT_SUITE_ACCENT)
  : DEFAULT_SUITE_ACCENT;
```

### 4. Title Block with Suite Accent Border

**Before:** Title and subtitle sit in a plain `<div>` with just text.
**After:** Title block gets a subtle left accent border (3px, suite accent color) that visually connects the dashboard to its parent suite's color lane — the same pattern used for section headers and card accent bars in Phase 1.

```tsx
<div
  className="min-w-0 pl-3 border-l-[3px]"
  style={{ borderColor: suiteAccent.color }}
>
  <h1 className={`text-lg sm:text-xl font-bold truncate ${colorMap[accentColor]}`}>
    {title}
  </h1>
  {subtitle && (
    <p className="text-xs text-muted truncate">{subtitle}</p>
  )}
</div>
```

The title color stays per-page via `accentColor` (content identity). The left border uses the suite accent (wayfinding).

When no parent suite exists (unmapped dashboards), the border falls back to `DEFAULT_SUITE_ACCENT.color` (orange).

### 5. Utility Controls — Recede

**Before:** Right-side controls use the same visual weight as the title.
**After:** Controls use `text-muted` by default with `hover:text-foreground focus:text-foreground` transitions. This makes them visually available but subordinate to the title.

Specific changes:
- "Updated X ago" text: already `text-xs text-muted` — no change needed.
- Export button: change from `text-muted hover:text-foreground` to same — already muted, no change.
- Theme toggle: verify it uses `text-muted hover:text-foreground` — adjust if it doesn't.
- `headerRight` slot: no change (consumers control their own styling).

**No blanket opacity.** Each control uses text color tokens that respect all three themes.

### 6. Suite Accent Resolution in DashboardShell

DashboardShell already has `SUITE_MAP` which maps dashboard paths to `{ href, label }`. To resolve the suite accent, use the parent suite's `href` as the lookup key into `SUITE_ACCENT_COLORS`, with the non-suite edge case guard described in Section 3:

```typescript
const parentSuite = getParentSuiteForPath(pathname);
const isRealSuite = parentSuite?.href?.startsWith("/suites/") ?? false;
const effectiveParent = isRealSuite ? parentSuite : null;
const suiteAccent = effectiveParent
  ? (SUITE_ACCENT_COLORS[effectiveParent.href] || DEFAULT_SUITE_ACCENT)
  : DEFAULT_SUITE_ACCENT;
```

The PB badge uses `effectiveParent` for href and label:
```typescript
<PhotonBrothersBadge
  href={effectiveParent?.href ?? "/"}
  compact
  label={effectiveParent ? `Back to ${effectiveParent.label} Suite` : "Back to Dashboard"}
/>
```

No changes to `SUITE_MAP` or `getParentSuiteForPath` are needed — the existing mapping already provides the suite href. The `isRealSuite` guard ensures non-suite entries (like the AI dashboard) fall back gracefully.

## Preserved Behavior

- **`SUITE_MAP` routing logic** — unchanged, still maps dashboard paths to parent suites.
- **`getParentSuiteForPath` prefix matching** — unchanged, supports dynamic routes.
- **`fullWidth` prop** — unchanged, controls container width.
- **`exportData` functionality** — unchanged, CSV export with activity tracking.
- **`headerRight` slot** — unchanged, consumers provide their own content.
- **`dealId` prop** — unchanged (passed through but not used in header rendering currently).
- **Breadcrumb auto-generation** — unchanged, `effectiveBreadcrumbs` logic preserved.
- **Main content area** — unchanged, `<main>` with container class.
- **Atmospheric background gradient** — unchanged.

## Theme Compatibility

- **Suite accent colors**: Fixed hex values applied via inline styles — consistent across all three themes (dark, light, sunset).
- **Title accent colors**: Existing Tailwind `colorMap` classes — already theme-compatible.
- **Breadcrumb links**: `text-muted hover:text-foreground` — theme-aware tokens.
- **Utility controls**: `text-muted hover:text-foreground` — theme-aware tokens.
- **Title block left border**: Inline style with fixed hex — consistent across themes.

## Mobile Behavior

- PB badge always visible (no longer hidden behind `hidden sm:inline-flex`).
- Title truncates on small screens (existing `truncate` behavior preserved).
- Breadcrumbs render normally on mobile (existing behavior).
- Right-side controls: "Updated X ago" stays `hidden sm:inline` (only visible on desktop).

## Files Modified

| File | Change |
|------|--------|
| `src/lib/suite-accents.ts` | **New file.** Shared `SUITE_ACCENT_COLORS` map, `SuiteAccent` type, `DEFAULT_SUITE_ACCENT`. |
| `src/components/SuitePageShell.tsx` | Remove local `SUITE_ACCENT_COLORS` and `DEFAULT_ACCENT`, import from `suite-accents.ts` instead. |
| `src/components/DashboardShell.tsx` | Import suite accents, resolve suite accent from parent suite, replace back arrow with PB badge, add title block left border, accent-color breadcrumb parent link. Remove `handleBack` callback and back arrow SVG. |

No changes to any dashboard page files. All existing props (`accentColor`, `breadcrumbs`, `fullWidth`, `exportData`, `headerRight`, etc.) continue to work identically.

## What This Does NOT Change

- Dashboard page content or layouts
- MetricCard/StatCard components (Phase 3)
- Suite landing pages (Phase 1, already shipped)
- Theme token definitions in `globals.css`
- Routing, URLs, or navigation targets
- The `SUITE_MAP` data or `getParentSuiteForPath` logic
- The `colorMap` for per-page accent colors
