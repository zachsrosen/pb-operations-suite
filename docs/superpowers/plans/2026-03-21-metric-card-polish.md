# Metric Card Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Differentiate the 3 metric card tiers visually (hero, standard, compact), deprecate SummaryCard, and add MetricCard href + null value support.

**Architecture:** Refactor the single `MetricCard.tsx` file — adjust styling per tier, widen MetricCard's type, remove SummaryCard. Update the test file to match.

**Tech Stack:** React, Tailwind v4, Jest/React Testing Library.

**Spec:** `docs/superpowers/specs/2026-03-21-metric-card-polish-design.md`

---

## Chunk 1: Tests First

### Task 1: Update tests for new MetricCard behaviors

**Files:**
- Modify: `src/__tests__/components/ui.test.tsx`

- [ ] **Step 1: Fix StatCard test color format**

Find the StatCard tests. The first test passes `color="text-blue-400"` — this is wrong, StatCard expects a color name like `"blue"`. Fix both StatCard test calls:

```tsx
// BEFORE:
render(<StatCard value="42" label="Total Projects" color="text-blue-400" />);
// AFTER:
render(<StatCard value="42" label="Total Projects" color="blue" />);

// BEFORE:
render(<StatCard value="42" label="Total" subtitle="$1.5M" color="text-green-400" />);
// AFTER:
render(<StatCard value="42" label="Total" subtitle="$1.5M" color="green" />);
```

- [ ] **Step 2: Remove SummaryCard import and test**

Update the import line — remove `SummaryCard`:
```tsx
import { StatCard, MiniStat, MetricCard } from "@/components/ui/MetricCard";
```

Delete the entire `describe("SummaryCard", ...)` block (lines 120-126).

- [ ] **Step 3: Add MetricCard href test**

Add to the existing `describe("MetricCard", ...)` block:

```tsx
it("renders as link when href is provided", () => {
  render(<MetricCard label="Revenue" value="$2.4M" href="/dashboards/revenue" />);
  const link = screen.getByRole("link");
  expect(link).toBeTruthy();
  expect(link.getAttribute("href")).toBe("/dashboards/revenue");
});
```

- [ ] **Step 4: Add MetricCard null value (loading skeleton) test**

Add to the same `describe("MetricCard", ...)` block:

```tsx
it("renders loading skeleton when value is null", () => {
  render(<MetricCard label="Pipeline" value={null} />);
  expect(document.querySelector(".animate-pulse")).toBeTruthy();
  expect(screen.getByText("Pipeline")).toBeTruthy();
});
```

- [ ] **Step 5: Add MetricCard color alias test**

Add to the same `describe("MetricCard", ...)` block:

```tsx
it("applies color as valueColor alias", () => {
  render(<MetricCard label="Count" value="7" color="text-emerald-400" />);
  const valueEl = screen.getByText("7");
  expect(valueEl.className).toContain("text-emerald-400");
});
```

- [ ] **Step 6: Run tests — expect failures for new tests**

Run: `npx jest src/__tests__/components/ui.test.tsx --verbose 2>&1 | tail -20`

Expected:
- StatCard tests: PASS (color format fix is backward-compatible — `"blue"` maps correctly)
- SummaryCard test: gone (no failure)
- MetricCard href test: FAIL (MetricCard doesn't support href yet)
- MetricCard null value test: FAIL (MetricCard doesn't accept null yet)
- MetricCard color alias test: FAIL (MetricCard doesn't have color prop yet)
- Existing MetricCard tests: PASS

- [ ] **Step 7: Commit**

```bash
git add src/__tests__/components/ui.test.tsx
git commit -m "test: update metric card tests — add href, null, color; remove SummaryCard; fix StatCard color"
```

---

## Chunk 2: Component Refactor

### Task 2: Refactor MetricCard.tsx

**Files:**
- Modify: `src/components/ui/MetricCard.tsx`

- [ ] **Step 1: Expand ACCENT_CLASSES and deepen gradient**

Find the `ACCENT_CLASSES` constant. Replace it with the expanded version — adds `indigo` + `teal` and deepens the first gradient stop from `/20` to `/25`:

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

- [ ] **Step 2: Update StatCard styling**

In the StatCard component, make these changes:

Value size: find `text-3xl font-bold` in the value div, change to `text-4xl font-bold`.

Padding: find the className string that builds the card class. Change `p-6` to `p-7`.

Shadow: in the same className string, change `shadow-card` to `shadow-card-lg`.

The className line should end up as:
```typescript
const className = `bg-gradient-to-br ${ACCENT_CLASSES[color] || ACCENT_CLASSES.blue} border rounded-xl p-7 shadow-card-lg${href ? " hover:brightness-110 transition-all cursor-pointer" : ""}`;
```

- [ ] **Step 3: Update MetricCard interface and implementation**

Replace the entire MetricCard interface and component with:

```tsx
interface MetricCardProps {
  label: string;
  value: string | number | null;
  sub?: string;
  border?: string;
  valueColor?: string;
  subColor?: string;
  color?: string;
  href?: string;
}

export const MetricCard = memo(function MetricCard({
  label,
  value,
  sub,
  border,
  valueColor,
  subColor,
  color,
  href,
}: MetricCardProps) {
  const effectiveValueColor = valueColor || color || "text-foreground";

  const content = (
    <>
      <div className="text-muted text-sm font-medium">{label}</div>
      {value === null ? (
        <div className="h-9 w-20 bg-skeleton rounded animate-pulse mt-1" />
      ) : (
        <div
          key={String(value)}
          className={`text-3xl font-bold mt-1 animate-value-flash ${effectiveValueColor}`}
        >
          {value}
        </div>
      )}
      {sub && (
        <div className={`text-sm mt-1 ${subColor || "text-muted"}`}>
          {sub}
        </div>
      )}
    </>
  );

  const className = `bg-surface-2 rounded-xl border border-t-border p-5 shadow-card ${border || ""}${href ? " hover:brightness-110 transition-all cursor-pointer" : ""}`;

  if (href) {
    return <Link href={href} className={className}>{content}</Link>;
  }
  return <div className={className}>{content}</div>;
});
```

Key changes from current:
- `value` type widened to `string | number | null`
- `color` prop added as alias for `valueColor`
- `href` support with Link wrapping
- `key={String(value)}` instead of `key={value}`
- `bg-surface` → `bg-surface-2`
- Loading skeleton for null values

- [ ] **Step 4: Update MiniStat styling**

In the MiniStat component, make these changes:

Value size: find `text-xl font-bold`, change to `text-lg font-bold`.

Padding: find `p-4`, change to `p-3`.

Background: find `bg-surface/50`, change to `bg-surface/30`.

Shadow: find `shadow-card` in the className, remove it.

The outer div className should become:
```tsx
className={`bg-surface/30 border rounded-lg p-3 text-center ${
  alert ? "border-red-500/50" : "border-t-border"
}`}
```

- [ ] **Step 5: Remove SummaryCard**

Delete the entire SummaryCard section: the interface (`SummaryCardProps`), the component, and its comment header (`// ---- SummaryCard (simple, minimal) ----`). This is approximately lines 140-161 of the current file.

Also remove `SummaryCard` from the file's exports (it's exported inline via `export const`, so deleting the component handles this).

- [ ] **Step 6: Run tests**

Run: `npx jest src/__tests__/components/ui.test.tsx --verbose 2>&1 | tail -25`

Expected: All tests PASS — including the 3 new MetricCard tests (href, null, color).

- [ ] **Step 7: Run TypeScript check**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "MetricCard" | head -10`

Expected: No errors in MetricCard.tsx. May see errors in other files that import `SummaryCard` — but per our audit, only the test file imported it, and we already fixed that.

- [ ] **Step 8: Lint**

Run: `npx eslint src/components/ui/MetricCard.tsx src/__tests__/components/ui.test.tsx`

Expected: Clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/MetricCard.tsx src/__tests__/components/ui.test.tsx
git commit -m "refactor(metric-cards): differentiate 3 tiers, add href/null support, remove SummaryCard"
```

---

## Chunk 3: Verification

### Task 3: Targeted verification

**Files:** None (verification only)

**Note:** This branch has pre-existing TypeScript errors in unrelated files. Verification confirms no new errors.

- [ ] **Step 1: TypeScript check on touched files**

```bash
npx tsc --noEmit --pretty 2>&1 | grep -E "(MetricCard|ui\.test)" | head -20
```
Expected: No errors.

- [ ] **Step 2: Full test run**

```bash
npx jest src/__tests__/components/ui.test.tsx --verbose
```
Expected: All tests pass.

- [ ] **Step 3: Visual QA (manual)**

Start dev server and check dashboards that use metric cards:

```bash
npm run dev
```

**Checklist:**
1. `/dashboards/executive` — StatCards should be noticeably larger (text-4xl), richer gradients, stronger shadow
2. `/dashboards/de-overview` — MetricCards should have `bg-surface-2` background, visually distinct from StatCards
3. `/dashboards/pi-overview` — MiniStats should be compact, no shadow, clearly subordinate
4. `/dashboards/forecast-timeline` — 5 StatCards in a row, verify stronger shadow doesn't look excessive
5. Toggle all 3 themes: dark, light, sunset — verify `bg-surface-2` MetricCards are visible (not washed out) in light mode
6. Check any clickable StatCard (e.g., home page hero stats) — verify link behavior still works

- [ ] **Step 4: Commit any fixes if needed**

```bash
git add -A
git commit -m "feat(metric-cards): complete Phase 3 visual polish"
```
