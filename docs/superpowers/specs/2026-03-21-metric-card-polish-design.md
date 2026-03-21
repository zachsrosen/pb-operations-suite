# Metric Card Polish — Phase 3 Design Spec

## Goal

Differentiate the 3 metric card tiers so each reads distinctly at a glance: hero, standard, and compact. Deprecate SummaryCard by absorbing it into MetricCard.

## Design Principle

**Differentiate through scale, density, and surface treatment — not accent bars.** Accent bars are reserved for navigation/wayfinding (Phase 1 suite pages, Phase 2 dashboard header). Metric cards use weight and elevation to establish hierarchy.

## Scope

**In scope:** `MetricCard.tsx` component refactor, SummaryCard deprecation, call-site migration for SummaryCard.
**Out of scope:** Individual dashboard page layouts, adding new data (sparklines, trends, targets), suite pages, DashboardShell.

## Current State

`src/components/ui/MetricCard.tsx` (162 lines) exports 4 components that all follow the same visual pattern: rounded bordered box → big value → label/subtitle. The tiers collapse visually — hard to tell hero from detail at a glance.

| Component | Usage | Visual Treatment |
|-----------|-------|-----------------|
| StatCard | Hero metrics (38+ call sites across dashboards) | Gradient bg, border, p-6, text-3xl value |
| MiniStat | Compact summary rows | bg-surface/50, p-4, text-xl value, centered |
| MetricCard | Detail grids | bg-surface, p-5, text-3xl value, label above |
| SummaryCard | Simple key-value (0 dashboards, 1 test only) | bg-surface, p-4, text-3xl value, label below |

The problem: StatCard, MetricCard, and SummaryCard all use `text-3xl` values with similar padding and surface treatments. At a glance they're the same card in slightly different clothes.

## Design Changes

### Tier 1: StatCard (Hero)

The one metric you look at first. Owns the richest visual treatment.

**Changes:**
- **Value size:** `text-3xl` → `text-4xl` — larger, clearly dominant
- **Padding:** `p-6` → `p-7` (28px) — more breathing room
- **Gradient depth:** Deepen color stops from `from-{color}-500/20 to-{color}-500/5` to `from-{color}-500/25 to-{color}-500/5` — slightly richer without being garish
- **Shadow:** `shadow-card` → `shadow-card-lg` (uses the existing `--card-shadow-lg` CSS variable) — lifts the hero off the page. **Note:** This is a global visual change across all 38+ dashboards that use StatCard. The stronger shadow is most noticeable in light mode on dense grids (e.g., forecast-timeline with 5 StatCards in a row). This should be verified in context during visual QA, not just on one page.

**No inner glow.** Keep it subtle — the gradient + stronger shadow + larger value are enough to signal importance without decoration.

**Unchanged:** `ACCENT_CLASSES` map, `animate-value-flash`, `key={String(value)}`, `memo()`, `href` support, loading skeleton, label/subtitle positioning.

### Tier 2: MetricCard (Standard Workhorse)

The structured detail card. No gradients — solid and clean.

**Changes:**
- **Background:** `bg-surface` → `bg-surface-2` — slightly more saturated/distinct surface across all three themes. (`bg-surface-elevated` was considered but is near-background in light/sunset mode, making cards visually disappear. `bg-surface-2` is consistently darker/more saturated than `bg-surface` in all themes, creating reliable visual distinction.)
- **Value size:** stays `text-3xl` — same as before, clearly smaller than StatCard's new `text-4xl`
- **Padding:** stays `p-5` — slightly less than StatCard's `p-7`
- **Add `href` support:** Same pattern as StatCard — wrap in `<Link>` when `href` is provided, add `hover:brightness-110 transition-all cursor-pointer`. This becomes the standard interactive card pattern for the whole metric system.
- **Add `color` prop:** Alias for `valueColor` to absorb SummaryCard's API. Both `color` and `valueColor` are accepted; `valueColor` takes precedence if both are provided. **Semantics note:** MetricCard's `color` accepts a Tailwind class string (e.g., `"text-red-400"`), not a color name. This differs from StatCard's `color` prop which accepts a color name (e.g., `"orange"`) for gradient lookup. Callers should prefer `valueColor` when clarity matters.

**New interface:**
```typescript
interface MetricCardProps {
  label: string;
  value: string | number | null;  // widen from string to match StatCard
  sub?: string;
  border?: string;
  valueColor?: string;
  subColor?: string;
  color?: string;      // alias for valueColor (SummaryCard compat)
  href?: string;       // clickable card support
}
```

**Value type widened** from `string` to `string | number | null`. This matches StatCard's type and enables the loading skeleton pattern (null → skeleton). Currently MetricCard only accepts `string`, which means callers have to stringify values and can't show loading state.

**Loading skeleton:** When `value` is `null`, render the same skeleton as StatCard (`h-9 w-20 bg-skeleton rounded animate-pulse`).

**Fix `key={value}` → `key={String(value)}`:** The current MetricCard uses `key={value}` without stringification. After the type widening to `string | number | null`, this must be `key={String(value)}` to avoid React warnings on null/number keys.

**Unchanged:** label-above-value layout, `animate-value-flash`, `memo()`, `border` prop, `subColor` prop.

### Tier 3: MiniStat (Compact/Supporting)

Intentionally quiet. Clearly subordinate.

**Changes:**
- **Value size:** `text-xl` → `text-lg` — smaller, clearly the lightest tier
- **Padding:** `p-4` → `p-3` — tighter
- **Background:** `bg-surface/50` → `bg-surface/30` — more transparent, recedes further
- **Shadow:** remove `shadow-card` — flat, no elevation. MiniStat sits on the surface, doesn't float above it.

**Unchanged:** centered layout, `alert` prop with red border/text, `animate-value-flash`, `memo()`, loading skeleton.

### SummaryCard Deprecation

**Migration path:** `SummaryCard(value, label, color)` → `MetricCard(label, value, valueColor: color)`

Note the argument order difference: SummaryCard takes `value, label` (value first in the interface), MetricCard takes `label, value` (label first). The migration must swap the prop order.

**Call sites to migrate:**
1. `src/__tests__/components/ui.test.tsx` — the only file importing SummaryCard (besides the definition itself)

No dashboard page imports SummaryCard. (`pe/page.tsx` defines its own local `MilestoneSummaryCard` which is unrelated.)

**Deprecation approach:** Remove SummaryCard entirely in this phase. With only 1 test call site, a full removal is clean. Update the test to cover MetricCard's equivalent behavior instead.

**Test cleanup:** The existing StatCard test passes `color="text-blue-400"` which is the wrong format (StatCard expects a color name like `"blue"`, not a class string). Fix this while updating the test file.

### ACCENT_CLASSES Expansion

The existing `ACCENT_CLASSES` map in StatCard is missing `indigo` and `teal` (same gap we fixed in DashboardShell's `colorMap` in Phase 2). Expand it:

```typescript
const ACCENT_CLASSES: Record<string, string> = {
  orange: "from-orange-500/25 to-orange-500/5 border-orange-500/30",
  green: "from-green-500/25 to-green-500/5 border-green-500/30",
  emerald: "from-emerald-500/25 to-emerald-500/5 border-emerald-500/30",
  blue: "from-blue-500/25 to-blue-500/5 border-blue-500/30",
  red: "from-red-500/25 to-red-500/5 border-red-500/30",
  purple: "from-purple-500/25 to-purple-500/5 border-purple-500/30",
  yellow: "from-yellow-500/25 to-yellow-500/5 border-yellow-500/30",
  cyan: "from-cyan-500/25 to-cyan-500/5 border-cyan-500/30",
  indigo: "from-indigo-500/25 to-indigo-500/5 border-indigo-500/30",
  teal: "from-teal-500/25 to-teal-500/5 border-teal-500/30",
};
```

Note: the `/20` → `/25` change on the first stop applies to all colors (the gradient depth increase from Tier 1 design).

## Interactive Card Pattern

When `href` is provided on StatCard or MetricCard:
- Wrap content in `<Link href={href}>`
- Add `hover:brightness-110 transition-all cursor-pointer` to the card className
- Non-clickable cards remain `<div>` with no hover treatment

MiniStat does not support `href` — it's a supporting display element, not a navigation target.

## Theme Compatibility

All changes use existing CSS variable tokens:
- `bg-surface-2`, `bg-surface`, `shadow-card`, `shadow-card-lg`, `border-t-border` — all theme-aware
- `text-foreground`, `text-muted` — all theme-aware
- Gradient classes use Tailwind color utilities — work across all themes
- `bg-skeleton` for loading states — theme-aware

No new CSS variables or theme tokens needed.

## Files Modified

| File | Change |
|------|--------|
| `src/components/ui/MetricCard.tsx` | StatCard: text-4xl, p-7, deeper gradient, shadow-card-lg. MetricCard: bg-surface-2, add href/color/null support, widen value type, fix key stringification. MiniStat: text-lg, p-3, bg-surface/30, no shadow. Remove SummaryCard export. Expand ACCENT_CLASSES with indigo + teal. |
| `src/__tests__/components/ui.test.tsx` | Remove SummaryCard test, fix StatCard test color format, add MetricCard tests: `href` renders link variant, `value={null}` renders loading skeleton |

No new files. No new dependencies.

## What This Does NOT Change

- Dashboard page layouts or which component each page uses
- StatCard's href support (already exists)
- The `animate-value-flash` animation or `key={String(value)}` pattern
- `memo()` wrapping on all components
- Suite pages or DashboardShell (Phases 1-2, already shipped)
- Any other UI components
