# Suite Page Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine all 8 suite landing pages from functional card grids to a polished spatial UI with integrated headers, color-coded sections, emoji icons, and accent bars.

**Architecture:** Single shared component (`SuitePageShell.tsx`) gets the visual overhaul — new header layout, color maps, card redesign. Each suite page file gets data updates (icons, tagColor removal, section renames). No new files or dependencies.

**Tech Stack:** Next.js, React, Tailwind v4 CSS variables, inline styles for runtime accent colors.

**Spec:** `docs/superpowers/specs/2026-03-20-suite-page-polish-design.md`

---

## Chunk 1: SuitePageShell Refactor

### Task 1: Add color maps and update types

**Files:**
- Modify: `src/components/SuitePageShell.tsx`

- [ ] **Step 1: Add `icon` to `SuitePageCard` interface**

At line 7, update the interface — add `icon?: string` after `description`:

```typescript
export interface SuitePageCard {
  href: string;
  title: string;
  description: string;
  tag: string;
  tagColor?: string;       // deprecated — no longer read by renderer
  icon?: string;            // emoji character, e.g. "📅"
  section?: string;
  hardNavigate?: boolean;
  disabled?: boolean;
}
```

- [ ] **Step 2: Remove deprecated props from `SuitePageShellProps`**

Remove `hoverBorderClass`, `tagColorClass` from `SuitePageShellProps` (lines 24–25) and from the destructured params (lines 69–70). Keep `columnsClassName` and `heroContent`.

```typescript
interface SuitePageShellProps {
  currentSuiteHref: string;
  title: string;
  subtitle: string;
  cards: SuitePageCard[];
  role?: UserRole;
  columnsClassName?: string;
  heroContent?: ReactNode;
}
```

- [ ] **Step 3: Add `SUITE_ACCENT_COLORS` map**

Add above the component function, after the `groupCards` function:

```typescript
const SUITE_ACCENT_COLORS: Record<string, { color: string; light: string }> = {
  "/suites/operations":                 { color: "#f97316", light: "#fb923c" },
  "/suites/design-engineering":         { color: "#6366f1", light: "#818cf8" },
  "/suites/permitting-interconnection": { color: "#06b6d4", light: "#22d3ee" },
  "/suites/service":                    { color: "#06b6d4", light: "#22d3ee" },
  "/suites/dnr-roofing":                { color: "#a855f7", light: "#c084fc" },
  "/suites/intelligence":               { color: "#3b82f6", light: "#60a5fa" },
  "/suites/executive":                  { color: "#f59e0b", light: "#fbbf24" },
  "/suites/admin":                      { color: "#f97316", light: "#fb923c" },
};

const DEFAULT_ACCENT = { color: "#f97316", light: "#fb923c" };
```

- [ ] **Step 4: Add `SECTION_COLORS` map**

Add after `SUITE_ACCENT_COLORS`:

```typescript
const SECTION_COLORS: Record<string, string> = {
  "Scheduling & Planning": "#3b82f6",
  "Site Survey": "#22c55e",
  "Construction": "#f97316",
  "Inspections": "#eab308",
  "Inventory & Equipment": "#06b6d4",
  "Catalog & Inventory": "#06b6d4",
  "Design Pipeline": "#6366f1",
  "Analytics": "#8b5cf6",
  "Reference": "#64748b",
  "Tools": "#14b8a6",
  "Pipeline": "#06b6d4",
  "Tracking": "#3b82f6",
  "Programs": "#f59e0b",
  "Service": "#06b6d4",
  "D&R": "#8b5cf6",
  "Roofing": "#ec4899",
  "Risk & Quality": "#f97316",
  "Pipeline & Forecasting": "#3b82f6",
  "Management": "#22c55e",
  "Executive Views": "#f59e0b",
  "Command & Planning": "#ef4444",
  "Sales": "#06b6d4",
  "Field Performance": "#ef4444",
  "Meta": "#3b82f6",
  "Admin Tools": "#f97316",
  "Documentation": "#22c55e",
  "Prototypes": "#ec4899",
  "API Shortcuts": "#06b6d4",
  "Legacy Dashboards": "#64748b",
};

const DEFAULT_SECTION_COLOR = "#64748b";
```

- [ ] **Step 5: Resolve accent in the component body**

At the top of the component function, after `backHref`, add:

```typescript
const accent = SUITE_ACCENT_COLORS[currentSuiteHref] || DEFAULT_ACCENT;
```

- [ ] **Step 6: Update imports**

Delete the `PhotonBrothersBadge` import. Add `CSSProperties` to the React import:

```typescript
import type { ReactNode, CSSProperties } from "react";
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`

Expected: Errors about `hoverBorderClass` / `tagColorClass` in suite pages that still pass them — these will be fixed in Chunk 2. The shell itself should have no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/SuitePageShell.tsx
git commit -m "refactor(suite-shell): add color maps, icon field, remove deprecated props"
```

---

### Task 2: Redesign the header

**Files:**
- Modify: `src/components/SuitePageShell.tsx`

- [ ] **Step 1: Replace the header block**

Find the `<div className="mb-6">` block that contains the back link, `PhotonBrothersBadge`, `<h1>`, and subtitle. Replace the entire block with:

```tsx
<div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-8">
  {/* Left: PB mark + title */}
  <div>
    <div className="flex items-center gap-3 mb-1">
      <Link
        href={backHref}
        aria-label="Back to Dashboard"
        title="Back to Dashboard"
        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-extrabold text-xs text-white"
        style={{ background: `linear-gradient(135deg, ${accent.color}, ${accent.light})` }}
      >
        PB
      </Link>
      <h1
        className="text-2xl font-bold"
        style={{
          background: `linear-gradient(135deg, ${accent.color}, ${accent.light})`,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {title}
      </h1>
    </div>
    <p className="text-sm text-muted">{subtitle}</p>
  </div>

  {/* Right: inline suite switcher */}
  {visibleSuites.length > 0 && (
    <div className="flex flex-wrap gap-1.5">
      {visibleSuites.map((suite) => {
        const isCurrent = suite.href === currentSuiteHref;
        return (
          <Link
            key={suite.href}
            href={suite.href}
            className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${
              isCurrent ? "" : "bg-surface-elevated/50 text-muted hover:text-foreground"
            }`}
            style={isCurrent ? {
              background: `rgba(${hexToRgb(accent.color)}, 0.15)`,
              color: accent.color,
            } : undefined}
            title={suite.description}
          >
            {suite.shortLabel}
          </Link>
        );
      })}
    </div>
  )}
</div>
```

- [ ] **Step 2: Remove the old suite switcher block**

Find and delete the `{visibleSuites.length > 0 && (` block — the one with the "Suite Switcher" label, boxed panel with `bg-gradient-to-br from-surface-elevated/85`, and wrapped pills. This is now rendered inline in the header above.

- [ ] **Step 3: Add `hexToRgb` helper**

Add above the component function:

```typescript
/** Convert "#f97316" → "249, 115, 22" for use in rgba() */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}
```

- [ ] **Step 4: Verify it renders**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors in `SuitePageShell.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/SuitePageShell.tsx
git commit -m "refactor(suite-shell): integrated header with PB mark and inline switcher"
```

---

### Task 3: Redesign section headers and cards

**Files:**
- Modify: `src/components/SuitePageShell.tsx`

- [ ] **Step 1: Replace section header**

Find the `<h2 className="text-lg font-semibold text-foreground/80 mb-4">{section}</h2>` inside the `sections.map()` callback. Replace it with:

```tsx
<div className="flex items-center gap-2 mb-4">
  <div
    className="w-1 h-4 rounded-sm"
    style={{
      background: `linear-gradient(to bottom, ${SECTION_COLORS[section] || DEFAULT_SECTION_COLOR}, transparent)`,
    }}
  />
  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
    {section}
  </h2>
</div>
```

- [ ] **Step 2: Replace card rendering**

Replace the entire `{row.cards.map((item) => { ... })}` block (the card class computation and content rendering) with updated card content that includes the left accent bar, emoji icon, open affordance, and removes the tag badge. The full replacement for the `{row.cards.map((item) => { ... })}` block:

```tsx
{row.cards.map((item) => {
  const sectionColor = SECTION_COLORS[item.section || ""] || DEFAULT_SECTION_COLOR;

  const cardClass = item.disabled
    ? "block rounded-xl border border-t-border/50 bg-gradient-to-br from-surface-elevated/50 via-surface/40 to-surface-2/30 p-5 shadow-card backdrop-blur-sm opacity-60 cursor-default relative overflow-hidden"
    : "group block rounded-xl border border-t-border/80 bg-gradient-to-br from-surface-elevated/80 via-surface/70 to-surface-2/50 p-5 shadow-card backdrop-blur-sm hover:bg-surface transition-all relative overflow-hidden";

  const content = (
    <>
      {/* Left accent bar */}
      <div
        className="absolute top-0 left-0 w-[3px] h-full"
        style={{
          background: `linear-gradient(to bottom, ${sectionColor}, transparent)`,
          opacity: item.disabled ? 0.3 : 1,
        }}
      />
      {/* Title row with emoji */}
      <div className="flex items-center gap-2 mb-1">
        {item.icon && (
          <span
            className="text-lg leading-none"
            style={item.disabled ? { filter: "grayscale(1) opacity(0.5)" } : undefined}
          >
            {item.icon}
          </span>
        )}
        <h3
          className={`font-semibold transition-colors ${
            item.disabled ? "text-muted" : "text-foreground"
          }`}
        >
          <span className="group-hover:hidden">{item.title}</span>
          <span
            className="hidden group-hover:inline"
            style={{ color: accent.color }}
          >
            {item.title}
          </span>
        </h3>
      </div>
      {/* Description */}
      <p className="text-sm text-muted">{item.description}</p>
      {/* Footer: Open → or disabled tag */}
      <div className="mt-2 text-xs text-muted opacity-30 group-hover:opacity-60 transition-opacity">
        {item.disabled ? item.tag : "Open →"}
      </div>
    </>
  );

  // Hover border via inline CSS variable
  const hoverStyle = !item.disabled ? {
    "--hover-border": `rgba(${hexToRgb(accent.color)}, 0.5)`,
  } as CSSProperties : undefined;

  const hoverClass = !item.disabled ? "[&:hover]:border-[var(--hover-border)]" : "";

  if (item.disabled) {
    return (
      <div key={item.href || item.title} className={cardClass}>
        {content}
      </div>
    );
  }

  if (item.hardNavigate) {
    return (
      <a
        key={item.href}
        href={item.href}
        className={`${cardClass} ${hoverClass}`}
        style={hoverStyle}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      key={item.href}
      href={item.href}
      prefetch={false}
      className={`${cardClass} ${hoverClass}`}
      style={hoverStyle}
    >
      {content}
    </Link>
  );
})}
```

**Note on hover title color:** The dual-span approach (`group-hover:hidden` / `hidden group-hover:inline`) avoids inline-style `:hover` limitations. When CSS variable hover is insufficient due to Tailwind v4's behavior, this is the cleanest server-component-compatible approach.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors in SuitePageShell.tsx.

- [ ] **Step 4: Commit**

```bash
git add src/components/SuitePageShell.tsx
git commit -m "refactor(suite-shell): section accent bars, card accent bars, emoji icons, remove tag badges"
```

---

## Chunk 2: Suite Page Data Updates

### Task 4: Update Operations suite

**Files:**
- Modify: `src/app/suites/operations/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`, rename Admin section**

Update the LINKS array. For each card object:
- Add `icon: "<emoji>"` using the spec's emoji table
- Remove any `tagColor` property
- For the 3 cards with `section: "Admin"`, change to `section: "Catalog & Inventory"`

Icons from spec:
- Master Schedule: 📅, Forecast Schedule: 📊, Equipment Backlog: 📦
- Site Survey Schedule: 🗓️, Site Survey Execution: ✅, Survey Metrics: 📈
- Construction Schedule: 🏗️, Construction Execution: 🔨, Construction Completion Metrics: ⏱️
- Inspection Schedule: 📋, Inspections Execution: 🔍
- Product Catalog: 🛒, Planset BOM: 📐, Submit New Product: ➕
- Inventory Hub: 🏭, Catalog Management: ⚙️, Product Catalog Comparison: 🔗

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call**

In the `<SuitePageShell>` JSX, remove `hoverBorderClass="hover:border-orange-500/50"` and `tagColorClass="bg-blue-500/20 text-blue-400 border-blue-500/30"`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "suites/operations" | head -5`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/suites/operations/page.tsx
git commit -m "refactor(ops-suite): add icons, remove tagColor, rename Admin section"
```

---

### Task 5: Update Design & Engineering suite

**Files:**
- Modify: `src/app/suites/design-engineering/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`**

Icons from spec:
- D&E Overview: 🎯, Plan Review Queue: 📝, Design Approval Queue: ✏️, Design Revisions: 🔄
- D&E Metrics: 📊, Clipping & System Analytics: ⚡, D&E Dept Analytics: 📉
- AHJ Design Requirements: 📖, Utility Design Requirements: 🔌
- Solar Surveyor: ☀️
- Design & Engineering (Legacy): 📁

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call**

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "design-engineering" | head -5`

```bash
git add src/app/suites/design-engineering/page.tsx
git commit -m "refactor(de-suite): add icons, remove tagColor and deprecated props"
```

---

### Task 6: Update Permitting & Interconnection suite

**Files:**
- Modify: `src/app/suites/permitting-interconnection/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`**

Icons from spec:
- P&I Overview: 🎯, Permit Action Queue: 📋, IC & PTO Action Queue: ⚡
- Permit Revisions: 🔄, IC Revisions: 🔁
- P&I Metrics: 📊, Timeline & SLA: ⏱️
- AHJ Tracker: 🏛️, Utility Tracker: 🔌
- Incentives: 💵, P&I Dept Analytics: 📉
- Combined Action Queue: 📋, Combined Revisions: 🔄
- Permitting (Legacy): 📁, Interconnection (Legacy): 📁

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call**

- [ ] **Step 3: Verify and commit**

```bash
git add src/app/suites/permitting-interconnection/page.tsx
git commit -m "refactor(pi-suite): add icons, remove tagColor and deprecated props"
```

---

### Task 7: Update Service suite

**Files:**
- Modify: `src/app/suites/service/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`**

Icons from spec:
- Service Overview: 🎯, Ticket Board: 🎫, Customer History: 👤
- Service Schedule: 📅, Service Equipment Backlog: 📦
- Service Pipeline: 🔧, Service Catalog: 🛒

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call**

- [ ] **Step 3: Verify and commit**

```bash
git add src/app/suites/service/page.tsx
git commit -m "refactor(service-suite): add icons, remove tagColor and deprecated props"
```

---

### Task 8: Update D&R + Roofing suite

**Files:**
- Modify: `src/app/suites/dnr-roofing/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`**

Icons from spec:
- D&R Pipeline: 🔩, D&R Scheduler: 📅
- Roofing Pipeline: 🏠, Roofing Scheduler: 🗓️

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call**

- [ ] **Step 3: Verify and commit**

```bash
git add src/app/suites/dnr-roofing/page.tsx
git commit -m "refactor(dnr-suite): add icons, remove tagColor and deprecated props"
```

---

### Task 9: Update Intelligence suite

**Files:**
- Modify: `src/app/suites/intelligence/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`**

Icons from spec:
- At-Risk Projects: ⚠️, QC Metrics: ✅, Alerts: 🔔
- Timeline View: ⏳, Pipeline Overview: 📊, Pipeline Optimizer: 🧮
- Project Management: 📋

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call (if present)**

- [ ] **Step 3: Verify and commit**

```bash
git add src/app/suites/intelligence/page.tsx
git commit -m "refactor(intelligence-suite): add icons, remove tagColor and deprecated props"
```

---

### Task 10: Update Executive suite

**Files:**
- Modify: `src/app/suites/executive/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`, rename Admin section**

Icons from spec:
- Revenue: 💰, Executive Summary: 📊, Revenue Calendar: 📅
- Command Center: 🎛️, Capacity Planning: 📐, Location Comparison: 🗺️
- Sales Pipeline: 💼, PE Dashboard: ⚡
- Zuper Compliance: ✅
- Forecast Accuracy: 🎯, Forecast Timeline: ⏳

For the 3 cards with `section: "Admin"`, change to `section: "Command & Planning"`.

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call (if present)**

- [ ] **Step 3: Verify and commit**

```bash
git add src/app/suites/executive/page.tsx
git commit -m "refactor(exec-suite): add icons, remove tagColor, rename Admin section"
```

---

### Task 11: Update Admin suite

**Files:**
- Modify: `src/app/suites/admin/page.tsx`

- [ ] **Step 1: Add `icon` to every card, remove `tagColor`**

Icons from spec:
- Users: 👥, Activity Log: 📜, Security: 🔒, Bug Reports: 🐛
- Page Directory: 🗂️, Zuper Status Comparison: 🔄, Mobile Dashboard: 📱, Availability Approvals: ✅
- Updates: 📢, Guide: 📖, Roadmap: 🗺️, Handbook: 📚, SOPs: 📝
- Home Refresh Prototypes: 🧪, Layout Refresh Prototypes: 🧪, Solar Checkout Experience: ☀️
- Projects + Stats API: 🔗, PE Projects API: 🔗, Scheduling Projects API: 🔗

- [ ] **Step 2: Remove `hoverBorderClass` and `tagColorClass` from SuitePageShell call (if present)**

- [ ] **Step 3: Verify and commit**

```bash
git add src/app/suites/admin/page.tsx
git commit -m "refactor(admin-suite): add icons, remove tagColor and deprecated props"
```

---

## Chunk 3: Verification

### Task 12: Targeted build verification

**Files:** None (verification only)

**Note:** This branch has pre-existing TypeScript errors in unrelated files (`scripts/backfill-so-deal-ids.ts`, `src/app/api/inventory/products/backfill-zuper-hubspot/route.ts`, etc.). Verification confirms no **new** errors were introduced by suite-page changes.

- [ ] **Step 1: TypeScript check on touched files only**

Run targeted tsc on the files we modified:

```bash
npx tsc --noEmit --pretty 2>&1 | grep -E "(SuitePageShell|suites/)" | head -20
```

Expected: No errors mentioning `SuitePageShell.tsx` or any `suites/*/page.tsx` file.

- [ ] **Step 2: Lint touched files only**

```bash
npx eslint src/components/SuitePageShell.tsx src/app/suites/*/page.tsx
```

Expected: No errors.

- [ ] **Step 3: Verify build completes for suite pages**

Run: `npm run build 2>&1 | tail -30`

If the build fails, check whether the failure is in a suite page or a pre-existing issue. Suite page compilation errors must be fixed; unrelated failures are pre-existing and do not block this work.

- [ ] **Step 4: Visual QA (manual)**

This step requires a human to verify in a browser. Start the dev server and check:

```bash
npm run dev
```

**Checklist for manual review:**
1. `/suites/operations` — PB mark links home, gradient title, inline switcher, section accent bars, card accent bars + icons, "Open →" affordance, disabled Product Catalog card shows "INCOMING" text
2. `/suites/design-engineering` — indigo accent, all icons render
3. `/suites/permitting-interconnection` — cyan accent, legacy section is slate
4. `/suites/service` — cyan accent, single section with green accent
5. `/suites/dnr-roofing` — purple accent, 2 sections with 2 cards each
6. `/suites/intelligence` — blue accent, all icons render
7. `/suites/executive` — amber accent, heroContent (RevenueGoalTracker) renders above sections, "Command & Planning" section renamed
8. `/suites/admin` — orange accent, 4 sections render with distinct colors
9. Toggle all 3 themes (dark, light, sunset) — verify inactive pills are readable in light mode

- [ ] **Step 5: Commit any fixes if needed, then final commit**

```bash
git add -A
git commit -m "feat(suite-pages): complete Phase 1 visual polish"
```
