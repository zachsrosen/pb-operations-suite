# DashboardShell Chrome Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the DashboardShell header so the page title reads as identity (not toolbar control), aligned with Phase 1 suite page polish.

**Architecture:** Extract shared suite accent map to `src/lib/suite-accents.ts`, update SuitePageShell to import from there, then refactor DashboardShell header — replace back arrow with PB badge, add suite accent border on title block, accent-color breadcrumb links, expand colorMap, mobile stacking layout.

**Tech Stack:** Next.js, React, Tailwind v4 CSS variables, inline styles for runtime accent colors.

**Spec:** `docs/superpowers/specs/2026-03-20-dashboard-shell-chrome-design.md`

---

## Chunk 1: Extract Shared Suite Accent Map

### Task 1: Create `src/lib/suite-accents.ts` and update SuitePageShell

**Files:**
- Create: `src/lib/suite-accents.ts`
- Modify: `src/components/SuitePageShell.tsx`

- [ ] **Step 1: Create `src/lib/suite-accents.ts`**

```typescript
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

- [ ] **Step 2: Update SuitePageShell imports**

In `src/components/SuitePageShell.tsx`:
- Add import: `import { SUITE_ACCENT_COLORS, DEFAULT_SUITE_ACCENT } from "@/lib/suite-accents";`
- Delete the local `SUITE_ACCENT_COLORS` constant (the full `Record<string, { color: string; light: string }>` block)
- Delete the local `DEFAULT_ACCENT` constant
- Find the line `const accent = SUITE_ACCENT_COLORS[currentSuiteHref] || DEFAULT_ACCENT;` and change `DEFAULT_ACCENT` to `DEFAULT_SUITE_ACCENT`

**Important:** Do NOT touch `SECTION_COLORS`, `DEFAULT_SECTION_COLOR`, or `hexToRgb` — those remain local to SuitePageShell.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "(suite-accents|SuitePageShell)" | head -10`
Expected: No errors.

- [ ] **Step 4: Verify suite pages still render**

Run: `npx eslint src/lib/suite-accents.ts src/components/SuitePageShell.tsx`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/suite-accents.ts src/components/SuitePageShell.tsx
git commit -m "refactor: extract suite accent colors to shared module"
```

---

## Chunk 2: DashboardShell Chrome Refactor

### Task 2: Refactor DashboardShell header

**Files:**
- Modify: `src/components/DashboardShell.tsx`

- [ ] **Step 1: Add imports**

Add at the top of `DashboardShell.tsx`:
```typescript
import { SUITE_ACCENT_COLORS, DEFAULT_SUITE_ACCENT } from "@/lib/suite-accents";
```

Also add `PhotonBrothersBadge` import (it's already imported but verify):
```typescript
import PhotonBrothersBadge from "./PhotonBrothersBadge";
```

- [ ] **Step 2: Expand `colorMap`**

Find the `colorMap` constant and add `indigo` and `teal`:

```typescript
const colorMap: Record<string, string> = {
  orange: "text-orange-400",
  green: "text-green-400",
  red: "text-red-400",
  blue: "text-blue-400",
  purple: "text-purple-400",
  emerald: "text-emerald-400",
  cyan: "text-cyan-400",
  yellow: "text-yellow-400",
  indigo: "text-indigo-400",
  teal: "text-teal-400",
};
```

- [ ] **Step 3: Add suite accent resolution**

After `const parentSuite = getParentSuiteForPath(pathname);` (currently the only line that uses `parentSuite`), add:

```typescript
const isRealSuite = parentSuite?.href?.startsWith("/suites/") ?? false;
const effectiveParent = isRealSuite ? parentSuite : null;
const suiteAccent = effectiveParent
  ? (SUITE_ACCENT_COLORS[effectiveParent.href] || DEFAULT_SUITE_ACCENT)
  : DEFAULT_SUITE_ACCENT;
```

Update the existing `effectiveBreadcrumbs` to use `effectiveParent` instead of `parentSuite` for auto-generated breadcrumbs (so non-suite entries like AI don't generate misleading breadcrumbs). **Both** the condition check AND the two property accesses inside the array must change from `parentSuite` to `effectiveParent`:

```typescript
// BEFORE:
const effectiveBreadcrumbs = breadcrumbs || (parentSuite
  ? [{ label: parentSuite.label, href: parentSuite.href }]
  : undefined);

// AFTER:
const effectiveBreadcrumbs = breadcrumbs || (effectiveParent
  ? [{ label: effectiveParent.label, href: effectiveParent.href }]
  : undefined);
```

- [ ] **Step 4: Remove `handleBack` and `useRouter`**

Delete the entire `handleBack` callback (the `const handleBack = useCallback(...)` block) and the `const router = useRouter();` line.

Update the navigation import — remove `useRouter`, keep `usePathname`:
```typescript
import { usePathname } from "next/navigation";
```

Keep `useCallback` in the React import — it's still used by `handleExport`:
```typescript
import { ReactNode, useCallback } from "react";
```

- [ ] **Step 5: Refactor breadcrumb rendering with suite accent**

Find the breadcrumb `{crumb.href ? (` link rendering block. Update it to apply suite accent color when the crumb links to a suite:

```tsx
{crumb.href ? (
  <Link
    href={crumb.href}
    className="hover:text-foreground transition-colors"
    style={
      SUITE_ACCENT_COLORS[crumb.href]
        ? { color: SUITE_ACCENT_COLORS[crumb.href].color }
        : undefined
    }
  >
    {crumb.label}
  </Link>
) : (
  <span className="text-foreground/70">{crumb.label}</span>
)}
```

Non-suite crumbs keep the default `text-muted` from the parent `<nav>` className, with `hover:text-foreground` on the link. Suite crumbs get their accent color via inline style, which overrides the inherited muted color.

- [ ] **Step 6: Replace back arrow + PB badge with unified PB badge affordance**

Find the `<div className="flex items-center justify-between gap-4">` block (the bottom tier). Replace its left zone content.

**Remove:** The `<button onClick={handleBack}>` with the back arrow SVG (the entire button element) and the `<PhotonBrothersBadge compact className="hidden sm:inline-flex" />` element.

**Replace with:** A single PB badge that serves as the back-to-suite affordance:

```tsx
<PhotonBrothersBadge
  href={effectiveParent?.href ?? "/"}
  compact
  label={effectiveParent ? `Back to ${effectiveParent.label} Suite` : "Back to Dashboard"}
/>
```

- [ ] **Step 7: Add suite accent left border to title block**

Find the title `<div>` (the one containing `<h1>` with the title and optional subtitle). Currently it's:
```tsx
<div className="min-w-0">
```

Replace with:
```tsx
<div
  className="min-w-0 pl-3 border-l-[3px]"
  style={{ borderColor: suiteAccent.color }}
>
```

- [ ] **Step 8: Update bottom tier for mobile stacking**

The bottom tier container is currently:
```tsx
<div className="flex items-center justify-between gap-4">
```

Change to:
```tsx
<div className="flex flex-wrap items-center gap-4">
```

The left zone (badge + title) wrapping:
```tsx
<div className="flex items-center gap-3 sm:gap-4 min-w-0 w-full sm:w-auto">
```

The right zone (controls):
```tsx
<div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
```

This makes the left zone take full width on mobile (pushing controls to a second row) and share the row on `sm+`.

- [ ] **Step 9: Verify ThemeToggle uses muted styling**

Open `src/components/ThemeToggle.tsx`. Confirm the toggle button uses `text-muted hover:text-foreground` or equivalent muted token styling. If it uses a hardcoded bright color (e.g., `text-white`, `text-zinc-300`), update the button's className to use `text-muted hover:text-foreground transition-colors` so it recedes with the other utility controls. If it already uses muted tokens, no change needed.

- [ ] **Step 10: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "DashboardShell" | head -10`
Expected: No errors.

- [ ] **Step 11: Lint**

Run: `npx eslint src/components/DashboardShell.tsx`
Expected: Clean.

- [ ] **Step 12: Commit**

```bash
git add src/components/DashboardShell.tsx
git commit -m "refactor(dashboard-shell): suite accent header, PB badge nav, title border, mobile stacking"
```

---

## Chunk 3: Verification

### Task 3: Targeted verification

**Files:** None (verification only)

**Note:** This branch has pre-existing TypeScript errors in unrelated files. Verification confirms no new errors were introduced.

- [ ] **Step 1: TypeScript check on touched files**

```bash
npx tsc --noEmit --pretty 2>&1 | grep -E "(DashboardShell|SuitePageShell|suite-accents)" | head -20
```
Expected: No errors.

- [ ] **Step 2: Lint all touched files**

```bash
npx eslint src/lib/suite-accents.ts src/components/SuitePageShell.tsx src/components/DashboardShell.tsx
```
Expected: Clean.

- [ ] **Step 3: Visual QA (manual)**

Start dev server and check dashboards in the browser:

```bash
npm run dev
```

**Checklist:**
1. `/dashboards/deals` (Operations) — PB badge links to `/suites/operations`, "Operations" breadcrumb in orange, title has orange left border
2. `/dashboards/de-overview` (D&E) — PB badge links to `/suites/design-engineering`, breadcrumb in indigo, left border in indigo (title color depends on the page's `accentColor` prop — not changed by this plan)
3. `/dashboards/pi-overview` (P&I) — PB badge links to `/suites/permitting-interconnection`, breadcrumb in cyan, left border in cyan
4. `/dashboards/executive` (Executive) — amber breadcrumb, amber left border
5. `/dashboards/ai` (no real suite) — PB badge links to `/`, label "Back to Dashboard", default orange left border
6. `/dashboards/site-survey` — title renders in teal (previously fell back to orange)
7. `/dashboards/design` — title renders in indigo (previously fell back to orange)
8. Mobile: resize to 375px width — verify badge + title on row 1, controls on row 2
9. Toggle all 3 themes: dark, light, sunset — breadcrumb accent colors readable, controls muted

- [ ] **Step 4: Commit any fixes if needed**

```bash
git add -A
git commit -m "feat(dashboard-shell): complete Phase 2 chrome polish"
```
