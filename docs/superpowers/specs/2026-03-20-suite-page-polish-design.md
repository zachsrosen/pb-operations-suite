# Suite Page Visual Polish — Phase 1 Design Spec

## Goal

Refine the 8 suite landing pages from "functional card grid" to "polished spatial UI" without changing navigation structure, routing, or functionality. Same layout direction (card-rich, color-coded), elevated execution.

## Scope

**In scope:** All 8 suite landing pages rendered by `SuitePageShell`.
**Out of scope (future phases):** DashboardShell chrome (Phase 2), MetricCard components (Phase 3), individual dashboard layouts.

## Current State

All suite pages use `<SuitePageShell>` which renders:
- A "Back to Dashboard" text link
- A `<PhotonBrothersBadge compact />` logo
- A colored `<h1>` title + subtitle
- A boxed "Suite Switcher" panel with pill links
- Section headers (`<h2>`) with card grids below
- Cards: glassmorphic background, tag badge (top-right), title, description

The result is uniform and functional but visually flat — every card looks identical, sections lack visual distinction, and the header area has too many separate elements competing for attention.

## Design Changes

### 1. Integrated Header

**Before:** Four stacked elements — back link, PB badge, title, subtitle.
**After:** Single row with two zones:

| Left | Right |
|------|-------|
| PB brand mark (32px square, gradient orange, white "PB" text) + page title (gradient text) | Inline suite switcher pills |

- Title uses `background: linear-gradient(135deg, <suite-accent>, <suite-accent-light>)` with `background-clip: text`.
- Subtitle stays below the title, `text-sm text-muted`.
- The "Back to Dashboard" text link is removed. The PB mark is a link using the same computed `backHref` logic already in the component (`canAccessRoute(role, "/") ? "/" : getDefaultRouteForRole(role)`). To preserve discoverability after removing the text link, the PB mark link must include `aria-label="Back to Dashboard"` and `title="Back to Dashboard"` so the navigation affordance is accessible and visible on hover.
- `<PhotonBrothersBadge>` is replaced by a new inline PB mark built directly in `SuitePageShell.tsx` (not a separate component). The existing `PhotonBrothersBadge` import is removed from `SuitePageShell` but the component itself is preserved for use elsewhere.

### 2. Inline Suite Switcher

**Before:** Boxed panel below the header with label "Suite Switcher", full-width with wrapped pills.
**After:** Compact pill row aligned to the top-right of the header.

- Remove the container box, background, border, and "Suite Switcher" label.
- Pills use shortened labels (already `shortLabel` from `suite-nav.ts`).
- Active pill: styled via inline `style` using the suite's accent color from `SUITE_ACCENT_COLORS` — `background: rgba(<accent>, 0.15); color: <accent>`. Tailwind utility classes cannot be used here because the accent color is a runtime hex value, not a static class.
- Inactive pills: `bg-surface-elevated/50 text-muted` — theme-aware, recedes in all three themes.
- **Wrapping behavior**: On desktop, the pill row uses `flex-wrap` — if all 8 pills don't fit in one row (admin users), they wrap to a second line. On mobile (< md): pills always wrap below the title as a second row. No horizontal scrolling.

### 3. Section Headers with Color Accent Bars

**Before:** `<h2 className="text-lg font-semibold text-foreground/80">`.
**After:** Flex row with a 4px-wide, 16px-tall rounded accent bar + uppercase tracked label.

```
[colored bar] SCHEDULING & PLANNING
```

- Each section gets a color from a defined palette (see Section Color Map below).
- Label: `text-xs font-semibold uppercase tracking-wider text-muted`.
- The accent bar uses `background: linear-gradient(to bottom, <section-color>, transparent)`.

### 4. Card Redesign

**Before:** Uniform glassmorphic cards with tag badge + title + description.
**After:** Cards with left-edge accent bar, emoji icon, and open affordance.

Changes per card:
- **Left accent bar**: 3px wide, full height, gradient from section color to transparent. Implemented as an absolute-positioned `<div>` inside the card (requires `relative` + `overflow-hidden` on the card container, which preserves `rounded-xl`).
- **Emoji icon**: New `icon` field on `SuitePageCard`. Displayed at 18px next to the title. Each card gets a contextually appropriate emoji.
- **Tag badge removed**: Tags are no longer rendered as badges. The `tag` field remains on the type (required string) and keeps its existing values in all suite pages — it is simply not rendered for enabled cards. For disabled cards, the tag text is displayed in place of "Open →" (see Section 5).
- **`tagColor` cleanup**: All `tagColor` values are removed from card definitions in suite pages during this phase. The prop stays on the interface as optional but is no longer read by the renderer.
- **"Open →" affordance**: `text-xs text-muted` at the bottom of the card. Opacity 0.3, increases on hover.
- **Card background**: Keep the existing Tailwind gradient classes (`bg-gradient-to-br from-surface-elevated/80 via-surface/70 to-surface-2/50`) which already adapt across all three themes. No inline rgba styles.
- **Hover**: Left accent bar brightens, title shifts to suite accent color (existing behavior preserved).

### 5. Disabled Cards

Current disabled treatment (opacity-60, cursor-default) is preserved. Additionally:
- Left accent bar renders at 30% opacity.
- Emoji renders in grayscale via `filter: grayscale(1) opacity(0.5)`.
- "Open →" text replaced with tag text (e.g., "Incoming") in muted style.

### 6. Hero Content Slot

The Executive Suite uses `heroContent={<RevenueGoalTracker />}`. This slot is preserved — it renders between the header and the first section, unchanged.

## Data Changes

### SuitePageCard Type Update

```typescript
export interface SuitePageCard {
  href: string;
  title: string;
  description: string;
  tag: string;             // required (unchanged), but no longer rendered as badge; shown on disabled cards as status text
  icon?: string;           // emoji character, e.g. "📅"
  tagColor?: string;       // deprecated — no longer read by renderer, will be removed from card definitions
  section?: string;
  hardNavigate?: boolean;
  disabled?: boolean;
}
```

### Suite Accent Color Map

Maps `currentSuiteHref` to its accent color. Used for the gradient title, active suite pill, and hover title color. Defined in `SuitePageShell.tsx`:

```typescript
const SUITE_ACCENT_COLORS: Record<string, { color: string; light: string }> = {
  "/suites/operations":                { color: "#f97316", light: "#fb923c" },  // orange
  "/suites/design-engineering":        { color: "#6366f1", light: "#818cf8" },  // indigo
  "/suites/permitting-interconnection":{ color: "#06b6d4", light: "#22d3ee" },  // cyan
  "/suites/service":                   { color: "#06b6d4", light: "#22d3ee" },  // cyan
  "/suites/dnr-roofing":               { color: "#a855f7", light: "#c084fc" },  // purple
  "/suites/intelligence":              { color: "#3b82f6", light: "#60a5fa" },  // blue
  "/suites/executive":                 { color: "#f59e0b", light: "#fbbf24" },  // amber
  "/suites/admin":                     { color: "#f97316", light: "#fb923c" },  // orange
};
```

Fallback: `{ color: "#f97316", light: "#fb923c" }` (orange).

The `hoverBorderClass` prop is replaced by this map — card hover border color is applied via inline `style` (`border-color: rgba(<accent>, 0.5)`) since the accent is a runtime value. The hover state is handled with a `group-hover:` Tailwind transition on border opacity, with the target color set as an inline CSS variable (e.g., `--suite-accent: #f97316`) on the card container.

### Section Color Map

Each section name maps to a color. Defined as a constant in `SuitePageShell.tsx`:

```typescript
const SECTION_COLORS: Record<string, string> = {
  // Operations
  "Scheduling & Planning": "#3b82f6",
  "Site Survey": "#22c55e",
  "Construction": "#f97316",
  "Inspections": "#eab308",
  "Inventory & Equipment": "#06b6d4",
  // Design & Engineering
  "Design Pipeline": "#6366f1",
  "Analytics": "#8b5cf6",
  "Reference": "#64748b",
  "Tools": "#14b8a6",
  // Permitting & Interconnection
  "Pipeline": "#06b6d4",
  "Tracking": "#3b82f6",
  "Programs": "#f59e0b",
  // Service
  "Service": "#06b6d4",
  // D&R + Roofing
  "D&R": "#8b5cf6",
  "Roofing": "#ec4899",
  // Intelligence
  "Risk & Quality": "#f97316",
  "Pipeline & Forecasting": "#3b82f6",
  "Management": "#22c55e",
  // Executive
  "Executive Views": "#f59e0b",
  "Sales": "#06b6d4",
  "Field Performance": "#ef4444",
  "Meta": "#3b82f6",
  // Admin
  "Admin Tools": "#f97316",
  "Documentation": "#22c55e",
  "Prototypes": "#ec4899",
  "API Shortcuts": "#06b6d4",
  // Shared
  "Legacy Dashboards": "#64748b",
};
```

Fallback for unmapped sections: `#64748b` (slate).

**Section renames** (to resolve "Admin" collision — the Operations and Executive suites both use `section: "Admin"` for active tool cards, but slate makes them look deprecated):
- Operations suite: `"Admin"` → `"Catalog & Inventory"` (mapped to `"#06b6d4"` cyan)
- Executive suite: `"Admin"` → `"Command & Planning"` (mapped to `"#ef4444"` red)

Add these to the map:
```typescript
  "Catalog & Inventory": "#06b6d4",
  "Command & Planning": "#ef4444",
```

### Emoji Icon Assignments

Each suite page's LINKS array gets an `icon` field. Representative examples:

**Operations:**
| Card | Icon |
|------|------|
| Master Schedule | 📅 |
| Forecast Schedule | 📊 |
| Equipment Backlog | 📦 |
| Site Survey Schedule | 🗓️ |
| Site Survey Execution | ✅ |
| Survey Metrics | 📈 |
| Construction Schedule | 🏗️ |
| Construction Execution | 🔨 |
| Construction Completion Metrics | ⏱️ |
| Inspection Schedule | 📋 |
| Inspections Execution | 🔍 |
| Product Catalog | 🛒 |
| Planset BOM | 📐 |
| Submit New Product | ➕ |
| Inventory Hub | 🏭 |
| Catalog Management | ⚙️ |
| Product Catalog Comparison | 🔗 |

**Design & Engineering:**
| Card | Icon |
|------|------|
| D&E Overview | 🎯 |
| Plan Review Queue | 📝 |
| Design Approval Queue | ✏️ |
| Design Revisions | 🔄 |
| D&E Metrics | 📊 |
| Clipping & System Analytics | ⚡ |
| D&E Dept Analytics | 📉 |
| AHJ Design Requirements | 📖 |
| Utility Design Requirements | 🔌 |
| Solar Surveyor | ☀️ |
| Design & Engineering (Legacy) | 📁 |

**Executive:**
| Card | Icon |
|------|------|
| Revenue | 💰 |
| Executive Summary | 📊 |
| Revenue Calendar | 📅 |
| Command Center | 🎛️ |
| Capacity Planning | 📐 |
| Location Comparison | 🗺️ |
| Sales Pipeline | 💼 |
| PE Dashboard | ⚡ |
| Zuper Compliance | ✅ |
| Forecast Accuracy | 🎯 |
| Forecast Timeline | ⏳ |

**Permitting & Interconnection:**
| Card | Icon |
|------|------|
| P&I Overview | 🎯 |
| Permit Action Queue | 📋 |
| IC & PTO Action Queue | ⚡ |
| Permit Revisions | 🔄 |
| IC Revisions | 🔁 |
| P&I Metrics | 📊 |
| Timeline & SLA | ⏱️ |
| AHJ Tracker | 🏛️ |
| Utility Tracker | 🔌 |
| Incentives | 💵 |
| P&I Dept Analytics | 📉 |
| Combined Action Queue | 📋 |
| Combined Revisions | 🔄 |
| Permitting (Legacy) | 📁 |
| Interconnection (Legacy) | 📁 |

**Service:**
| Card | Icon |
|------|------|
| Service Overview | 🎯 |
| Ticket Board | 🎫 |
| Customer History | 👤 |
| Service Schedule | 📅 |
| Service Equipment Backlog | 📦 |
| Service Pipeline | 🔧 |
| Service Catalog | 🛒 |

**D&R + Roofing:**
| Card | Icon |
|------|------|
| D&R Pipeline | 🔩 |
| D&R Scheduler | 📅 |
| Roofing Pipeline | 🏠 |
| Roofing Scheduler | 🗓️ |

**Intelligence:**
| Card | Icon |
|------|------|
| At-Risk Projects | ⚠️ |
| QC Metrics | ✅ |
| Alerts | 🔔 |
| Timeline View | ⏳ |
| Pipeline Overview | 📊 |
| Pipeline Optimizer | 🧮 |
| Project Management | 📋 |

**Admin:**
| Card | Icon |
|------|------|
| Users | 👥 |
| Activity Log | 📜 |
| Security | 🔒 |
| Bug Reports | 🐛 |
| Page Directory | 🗂️ |
| Zuper Status Comparison | 🔄 |
| Mobile Dashboard | 📱 |
| Availability Approvals | ✅ |
| Updates | 📢 |
| Guide | 📖 |
| Roadmap | 🗺️ |
| Handbook | 📚 |
| SOPs | 📝 |
| Home Refresh Prototypes | 🧪 |
| Layout Refresh Prototypes | 🧪 |
| Solar Checkout Experience | ☀️ |
| Projects + Stats API | 🔗 |
| PE Projects API | 🔗 |
| Scheduling Projects API | 🔗 |

## Preserved Behavior

- **`getGridRows()` logic**: The existing function that applies special grid layouts for sections with 2, 4, 5, or 7 cards is preserved unchanged. No layout changes are part of this phase.
- **`groupCards()` logic**: Section grouping and ordering is preserved unchanged.
- **Role-based card filtering**: The `canAccessRoute` check is preserved unchanged.

## Theme Compatibility

All new styles use CSS custom properties (`--background`, `--surface`, `--foreground`, `--muted`, `--border`) and existing Tailwind theme token classes. The changes work across dark, light, and sunset themes.

- **Section/card accent bars**: Use fixed hex colors from `SECTION_COLORS` — these are intentional brand colors that stay consistent across themes.
- **Card backgrounds**: Keep existing `bg-gradient-to-br from-surface-elevated/80 via-surface/70 to-surface-2/50` Tailwind classes (already theme-aware).
- **Suite switcher inactive pills**: Use `bg-surface-elevated/50 text-muted` (theme-aware tokens, not hardcoded white/black rgba).
- **Gradient title text**: Uses fixed accent colors via inline style — renders consistently across themes since it's foreground text, not background.

## Mobile Behavior

- Suite switcher pills wrap below title on screens < md.
- Cards stack to single column on screens < md (existing behavior, preserved).
- Section accent bars and card accent bars render at same size on mobile.
- Emoji icons render at same size (18px) — no scaling needed.

## Files Modified

| File | Change |
|------|--------|
| `src/components/SuitePageShell.tsx` | Header redesign, add `SUITE_ACCENT_COLORS` + `SECTION_COLORS` maps, section accent bars, card accent bars, emoji support, remove tag badge rendering, remove `hoverBorderClass` / `tagColorClass` from shell props, remove renderer support for `tagColor` on cards (prop stays on `SuitePageCard` as deprecated/inert), remove `PhotonBrothersBadge` import |
| `src/app/suites/operations/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass`, rename `"Admin"` section to `"Catalog & Inventory"` |
| `src/app/suites/design-engineering/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass` |
| `src/app/suites/permitting-interconnection/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass` |
| `src/app/suites/service/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass` |
| `src/app/suites/dnr-roofing/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass` |
| `src/app/suites/intelligence/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass` |
| `src/app/suites/executive/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass`, rename `"Admin"` section to `"Command & Planning"` |
| `src/app/suites/admin/page.tsx` | Add `icon` to each card, remove `tagColor` + `hoverBorderClass` + `tagColorClass` |

No new files. No new dependencies.

## What This Does NOT Change

- Routing, page URLs, or navigation targets
- Role-based visibility logic
- `heroContent` slot behavior
- `hardNavigate` vs Link behavior
- `DashboardShell` (Phase 2)
- MetricCard/StatCard components (Phase 3)
- Individual dashboard page content or layout
- Dark/light/sunset theme token definitions
- The atmospheric background gradients and noise texture
