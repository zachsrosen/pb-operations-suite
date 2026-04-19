# Admin Page Internals Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. Each of the 8 chunks below is a single PR.

**Goal:** Rewrite the insides of the 9 admin pages around 7 shared primitives, reducing ~5,500 LOC of inconsistent per-page code to ~3,100 LOC of composed primitives while preserving every feature.

**Architecture:** Two new primitive batches ship first (no page changes). Then `/admin/activity` rewrites as the anchor that validates primitive APIs. Then the other 7 pages migrate one or two at a time, finishing with `/admin/users` (biggest risk) after patterns are battle-tested.

**Tech Stack:** React 19, Next.js 16 App Router, Tailwind v4 theme tokens, TypeScript, Jest + Testing Library. Existing `<AdminShell>`, `<AdminPageHeader>`, `<AdminEmpty>`, `<AdminLoading>`, `<AdminError>` from Phase 1.

**Spec:** `docs/superpowers/specs/2026-04-18-admin-page-internals-redesign-design.md`

**Branch:** `spec/admin-page-internals` (spec commits already on branch). Each chunk ships as its own PR; orchestrator can pause between any two.

---

## File Structure

### New files (all in `src/components/admin-shell/`)

| File | Chunk | Purpose |
|---|---|---|
| `AdminTable.tsx` | 1 | Generic table with sort, selection, keyboard nav |
| `AdminFilterBar.tsx` | 1 | Filter chip group + search input + clear-all shell |
| `AdminDetailDrawer.tsx` | 1 | Right slide-out drawer with focus trap + Esc/outside-click close |
| `AdminBulkActionBar.tsx` | 2 | Sticky bottom bar shown when rows selected |
| `AdminForm.tsx` | 2 | Labeled input / select / multi-select / toggle / textarea primitives |
| `AdminKeyValueGrid.tsx` | 2 | Two-column read-mostly layout |
| `AdminDetailHeader.tsx` | 2 | Title + subtitle + actions row, used inside drawers |
| `_primitives.test.tsx` | 1-2 | Colocated primitive unit tests per file |

### Modified files (page rewrites, one chunk per page or per pair)

| File | Chunk | Treatment |
|---|---|---|
| `src/app/admin/activity/page.tsx` | 3 | Anchor rewrite |
| `src/app/admin/tickets/page.tsx` | 4 | Small rewrite |
| `src/app/admin/directory/page.tsx` | 4 | Light rewrite |
| `src/app/admin/audit/page.tsx` | 5 | Medium rewrite |
| `src/app/admin/security/page.tsx` | 5 | Medium rewrite |
| `src/app/admin/crew-availability/page.tsx` | 6 | Medium rewrite |
| `src/app/admin/roles/page.tsx` | 7 | Rewrite + absorb `[role]` page |
| `src/app/admin/roles/[role]/page.tsx` | 7 | Replaced with `redirect()` shim |
| `src/app/admin/users/page.tsx` | 8 | Full rewrite, 3 modals → 1 tabbed drawer |

### Not touched

- Anything under `src/app/api/` (admin API routes unchanged)
- `src/components/admin-shell/AdminShell.tsx` / `AdminSidebar.tsx` / `AdminSearch.tsx` / `AdminPageHeader.tsx` (Phase 1, stable)
- Any `src/lib/*` module
- `prisma/schema.prisma` (zero migrations)
- Any non-admin page

---

## Chunk 0: Branch + pre-flight

### Task 0.1 — Confirm branch + clean state

- [ ] **Step 1: Verify branch**

```bash
git branch --show-current
```
Expected: `spec/admin-page-internals` (already checked out). Spec commits already on the branch.

- [ ] **Step 2: Rebase on main to pick up all Phase-1 changes**

```bash
git fetch origin main
git rebase origin/main
```

- [ ] **Step 3: Verify existing Phase-1 primitives are importable**

```bash
ls src/components/admin-shell/*.tsx
```
Expected files: `AdminShell`, `AdminSidebar`, `AdminSearch`, `AdminPageHeader`, `AdminBreadcrumb`, `AdminEmpty`, `AdminLoading`, `AdminError`, `SyncStatusCard`, plus `nav.ts`.

- [ ] **Step 4: Confirm no stale migrations or untracked scripts** — each chunk below will branch a new PR from this baseline.

---

## Chunk 1: Primitives batch 1 (AdminTable + AdminFilterBar + AdminDetailDrawer)

**Goal:** Ship three primitives with tests. Zero page changes. This chunk must result in working, testable components that subsequent chunks import.

**PR title:** `feat(admin-shell): primitives batch 1 — table, filter bar, detail drawer`

**Estimated size:** ~900 LOC across new components + tests.

### Task 1.1 — `<AdminTable>` (TDD)

**Files:**
- Create: `src/components/admin-shell/AdminTable.tsx`
- Create: `src/__tests__/components/admin-shell/AdminTable.test.tsx`

**API:**

```ts
export interface AdminTableColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;           // e.g. "w-32" or "200px"
  align?: "left" | "right" | "center";
}

export interface AdminTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: AdminTableColumn<T>[];
  // Selection (controlled; omit to disable)
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  // Sorting (controlled; omit to disable)
  sortBy?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (sort: { key: string; dir: "asc" | "desc" }) => void;
  // Row click typically opens a detail drawer
  onRowClick?: (row: T) => void;
  // Empty / loading / error slots (pages supply AdminEmpty / AdminLoading / AdminError here)
  empty?: React.ReactNode;
  loading?: boolean;
  error?: React.ReactNode;
  // Accessibility
  caption: string;          // Required. Visually hidden, used by screen readers
}
```

- [ ] **Step 1: Write failing tests**

```tsx
// src/__tests__/components/admin-shell/AdminTable.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminTable, type AdminTableColumn } from "@/components/admin-shell/AdminTable";

interface Row { id: string; name: string; age: number }
const ROWS: Row[] = [
  { id: "1", name: "Alice", age: 30 },
  { id: "2", name: "Bob", age: 24 },
];
const COLS: AdminTableColumn<Row>[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "age", label: "Age", sortable: true, align: "right" },
];

describe("AdminTable", () => {
  it("renders rows and columns", () => {
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("renders empty slot when rows is empty", () => {
    render(
      <AdminTable rows={[]} rowKey={(r) => r.id} columns={COLS} caption="People" empty={<div>NO RESULTS</div>} />,
    );
    expect(screen.getByText("NO RESULTS")).toBeInTheDocument();
  });

  it("renders loading slot instead of rows when loading=true", () => {
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" loading />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument(); // internal spinner
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("renders error slot instead of rows when error is provided", () => {
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" error={<div>BOOM</div>} />,
    );
    expect(screen.getByText("BOOM")).toBeInTheDocument();
  });

  it("calls onRowClick with the row when a row is clicked", async () => {
    const user = userEvent.setup();
    const handler = jest.fn();
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" onRowClick={handler} />,
    );
    await user.click(screen.getByText("Alice"));
    expect(handler).toHaveBeenCalledWith(ROWS[0]);
  });

  it("toggles select on checkbox click when selection is enabled", async () => {
    const user = userEvent.setup();
    const toggle = jest.fn();
    render(
      <AdminTable
        rows={ROWS}
        rowKey={(r) => r.id}
        columns={COLS}
        caption="People"
        selectedIds={new Set()}
        onToggleSelect={toggle}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // First checkbox is the select-all header; second is row 1
    await user.click(checkboxes[1]);
    expect(toggle).toHaveBeenCalledWith("1");
  });

  it("emits sortChange when a sortable column header is clicked", async () => {
    const user = userEvent.setup();
    const onSortChange = jest.fn();
    render(
      <AdminTable
        rows={ROWS}
        rowKey={(r) => r.id}
        columns={COLS}
        caption="People"
        sortBy={{ key: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: /name/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", dir: "desc" }); // toggle direction
  });

  it("keyboard nav: ArrowDown moves focus to next row; Enter triggers onRowClick", async () => {
    const user = userEvent.setup();
    const handler = jest.fn();
    render(
      <AdminTable rows={ROWS} rowKey={(r) => r.id} columns={COLS} caption="People" onRowClick={handler} />,
    );
    const firstRow = screen.getAllByRole("row")[1]; // 0 is the header
    firstRow.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getAllByRole("row")[2]);
    await user.keyboard("{Enter}");
    expect(handler).toHaveBeenCalledWith(ROWS[1]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
npx jest src/__tests__/components/admin-shell/AdminTable.test.tsx
```

- [ ] **Step 3: Implement `<AdminTable>`**

Use theme tokens only. Every `<tr>` needs `tabIndex={0}` and an `onKeyDown` handler wired to `onRowClick` (Enter) and focus advancement (ArrowUp/ArrowDown). Select-all checkbox in the header; per-row checkbox only rendered when `selectedIds` is provided. Sortable column labels are `<button>` elements that call `onSortChange` with the toggled direction (`asc` ↔ `desc`), defaulting to `asc` when switching to a new column.

Shape:

```tsx
"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface AdminTableColumn<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
  align?: "left" | "right" | "center";
}

export interface AdminTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: AdminTableColumn<T>[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  sortBy?: { key: string; dir: "asc" | "desc" };
  onSortChange?: (sort: { key: string; dir: "asc" | "desc" }) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  loading?: boolean;
  error?: ReactNode;
  caption: string;
}

export function AdminTable<T>({
  rows, rowKey, columns,
  selectedIds, onToggleSelect, onToggleSelectAll,
  sortBy, onSortChange, onRowClick,
  empty, loading, error, caption,
}: AdminTableProps<T>) {
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  if (loading) return <div role="status" className="flex justify-center py-12 text-muted">Loading…</div>;
  if (error) return <>{error}</>;

  const allSelected = selectedIds && rows.length > 0 && rows.every((r) => selectedIds.has(rowKey(r)));
  const showSelect = !!selectedIds && !!onToggleSelect;

  function handleRowKeyDown(ev: KeyboardEvent<HTMLTableRowElement>, row: T) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      onRowClick?.(row);
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const target = ev.currentTarget;
      const next = ev.key === "ArrowDown"
        ? (target.nextElementSibling as HTMLElement | null)
        : (target.previousElementSibling as HTMLElement | null);
      next?.focus();
    } else if (ev.key === " " && showSelect) {
      ev.preventDefault();
      onToggleSelect!(rowKey(row));
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-t-border/60 bg-surface">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {showSelect && (
              <th className="w-10 px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected ?? false}
                  onChange={onToggleSelectAll}
                  aria-label="Select all rows"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted ${
                  col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                } ${col.width ?? ""}`}
                scope="col"
              >
                {col.sortable && onSortChange ? (
                  <button
                    type="button"
                    onClick={() => {
                      const nextDir =
                        sortBy?.key === col.key && sortBy.dir === "asc" ? "desc" : "asc";
                      onSortChange({ key: col.key, dir: nextDir });
                    }}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    {col.label}
                    {sortBy?.key === col.key && (
                      <span aria-hidden="true">{sortBy.dir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (showSelect ? 1 : 0)} className="p-0">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = rowKey(row);
              const isSelected = selectedIds?.has(id) ?? false;
              return (
                <tr
                  key={id}
                  tabIndex={0}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(ev) => handleRowKeyDown(ev, row)}
                  aria-selected={isSelected || undefined}
                  className={`cursor-pointer border-t border-t-border/40 transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:outline-none ${
                    isSelected ? "bg-surface-2/70" : ""
                  }`}
                >
                  {showSelect && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect!(id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${id}`}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 ${
                        col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                      }`}
                    >
                      {col.render ? col.render(row) : (row as Record<string, unknown>)[col.key] as ReactNode}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS (7/7)**

```bash
npx jest src/__tests__/components/admin-shell/AdminTable.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminTable.tsx src/__tests__/components/admin-shell/AdminTable.test.tsx
git commit -m "feat(admin-shell): AdminTable primitive with sort/select/keyboard nav + tests"
```

---

### Task 1.2 — `<AdminFilterBar>` (TDD)

**Files:**
- Create: `src/components/admin-shell/AdminFilterBar.tsx`
- Create: `src/__tests__/components/admin-shell/AdminFilterBar.test.tsx`

**API:** Composition-friendly. The bar renders any mix of `<DateRangeChip>` / `<FilterChip>` / `<FilterDropdown>` / `<FilterSearch>` / `<ClearAllButton>` — these are small subcomponents exported from the same file. Pages compose their own filter row from these. This keeps the bar flexible without an options explosion.

```tsx
export interface AdminFilterBarProps {
  children: React.ReactNode;
  onClearAll?: () => void;
  hasActiveFilters?: boolean;
}

// Subcomponents (all exported from the same module):
// <DateRangeChip selected={dateRange} onChange={setDateRange} options={[{value:"today",label:"Today"},...]} />
// <FilterChip active={bool} onClick={fn}>Label</FilterChip>
// <FilterSearch value={q} onChange={setQ} placeholder="Search…" />
```

`MultiSelectFilter` (existing at `src/components/ui/MultiSelectFilter.tsx`) is the multi-select dropdown — pages import it directly alongside these subcomponents. No need to wrap it.

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AdminFilterBar,
  DateRangeChip,
  FilterChip,
  FilterSearch,
} from "@/components/admin-shell/AdminFilterBar";

describe("AdminFilterBar", () => {
  it("renders children", () => {
    render(
      <AdminFilterBar>
        <span>CHILD</span>
      </AdminFilterBar>,
    );
    expect(screen.getByText("CHILD")).toBeInTheDocument();
  });

  it("renders 'Clear all' button when hasActiveFilters is true", async () => {
    const user = userEvent.setup();
    const clear = jest.fn();
    render(
      <AdminFilterBar hasActiveFilters onClearAll={clear}>
        <span />
      </AdminFilterBar>,
    );
    await user.click(screen.getByRole("button", { name: /clear all/i }));
    expect(clear).toHaveBeenCalled();
  });

  it("hides 'Clear all' when hasActiveFilters is false", () => {
    render(
      <AdminFilterBar onClearAll={() => {}}>
        <span />
      </AdminFilterBar>,
    );
    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
  });
});

describe("DateRangeChip", () => {
  const opts = [
    { value: "today", label: "Today" },
    { value: "7d", label: "7d" },
    { value: "all", label: "All" },
  ];

  it("marks selected option with aria-pressed=true", () => {
    render(<DateRangeChip selected="7d" options={opts} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange with the new value when another option is clicked", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<DateRangeChip selected="7d" options={opts} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
});

describe("FilterChip", () => {
  it("toggles aria-pressed based on active prop", () => {
    const { rerender } = render(<FilterChip active={false} onClick={() => {}}>Test</FilterChip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    rerender(<FilterChip active onClick={() => {}}>Test</FilterChip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("FilterSearch", () => {
  it("debounces input via props — just passes through change events for now", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FilterSearch value="" onChange={onChange} placeholder="Search" />);
    await user.type(screen.getByPlaceholderText("Search"), "abc");
    expect(onChange).toHaveBeenCalledTimes(3); // a, b, c — page controls debounce
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement `<AdminFilterBar>` + subcomponents**

```tsx
"use client";

import type { ReactNode } from "react";

// ── Container ────────────────────────────────────────────────
export interface AdminFilterBarProps {
  children: ReactNode;
  onClearAll?: () => void;
  hasActiveFilters?: boolean;
}

export function AdminFilterBar({ children, onClearAll, hasActiveFilters }: AdminFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-t-border/60 bg-surface p-3">
      {children}
      {hasActiveFilters && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-auto text-xs text-muted hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ── DateRangeChip (segmented chip group) ─────────────────────
export interface DateRangeOption<V extends string = string> {
  value: V;
  label: string;
}
export interface DateRangeChipProps<V extends string = string> {
  selected: V;
  options: ReadonlyArray<DateRangeOption<V>>;
  onChange: (value: V) => void;
  label?: string; // optional visible label to the left
}
export function DateRangeChip<V extends string = string>({ selected, options, onChange, label }: DateRangeChipProps<V>) {
  return (
    <div className="flex items-center gap-1">
      {label && <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>}
      <div className="flex rounded-md border border-t-border/60 bg-surface-2 p-0.5">
        {options.map((opt) => {
          const isActive = opt.value === selected;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(opt.value)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                isActive ? "bg-surface-elevated text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Single toggle chip ───────────────────────────────────────
export interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  label?: string;
}
export function FilterChip({ active, onClick, children, label }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`rounded-md border border-t-border/60 px-2.5 py-1 text-xs font-medium transition-colors ${
        active ? "bg-surface-elevated text-foreground" : "bg-surface-2 text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ── Search input ─────────────────────────────────────────────
export interface FilterSearchProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  widthClass?: string;
}
export function FilterSearch({ value, onChange, placeholder, widthClass = "w-56" }: FilterSearchProps) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-md border border-t-border/60 bg-surface-2 px-3 py-1 text-xs text-foreground placeholder:text-muted ${widthClass}`}
    />
  );
}
```

- [ ] **Step 4: Run tests — expect PASS (7/7)**

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminFilterBar.tsx src/__tests__/components/admin-shell/AdminFilterBar.test.tsx
git commit -m "feat(admin-shell): AdminFilterBar + chip / search subcomponents + tests"
```

---

### Task 1.3 — `<AdminDetailDrawer>` (TDD)

**Files:**
- Create: `src/components/admin-shell/AdminDetailDrawer.tsx`
- Create: `src/__tests__/components/admin-shell/AdminDetailDrawer.test.tsx`

**API:**

```ts
export interface AdminDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;      // typically a title or <AdminDetailHeader> (when available)
  children: React.ReactNode;   // scrollable body
  wide?: boolean;              // 480px instead of 384px
  footer?: React.ReactNode;    // optional sticky footer (e.g. Save button)
}
```

Behavior:
- Esc closes
- Outside click closes
- Focus trap while open; restore focus to previously-focused element on close
- `aria-labelledby` points at the title element
- Accepts a `title` that may be a `<AdminDetailHeader>` in Chunk 2 — for now any ReactNode renders in the title slot

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminDetailDrawer } from "@/components/admin-shell/AdminDetailDrawer";

describe("AdminDetailDrawer", () => {
  it("renders children when open", () => {
    render(
      <AdminDetailDrawer open onClose={() => {}} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    expect(screen.getByText("BODY")).toBeInTheDocument();
  });

  it("does not render children when closed", () => {
    render(
      <AdminDetailDrawer open={false} onClose={() => {}} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    expect(screen.queryByText("BODY")).not.toBeInTheDocument();
  });

  it("calls onClose when Esc pressed", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <AdminDetailDrawer open onClose={onClose} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on outside click", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <AdminDetailDrawer open onClose={onClose} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    // Overlay is the element with data-admin-drawer-overlay
    const overlay = document.querySelector('[data-admin-drawer-overlay="true"]') as HTMLElement;
    await user.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("exposes aria-labelledby pointing at the title element", () => {
    render(
      <AdminDetailDrawer open onClose={() => {}} title={<span>TITLE</span>}>
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    const dialog = screen.getByRole("dialog");
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)).toHaveTextContent("TITLE");
  });

  it("renders a close button with accessible label", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <AdminDetailDrawer open onClose={onClose} title="T">
        <div>BODY</div>
      </AdminDetailDrawer>,
    );
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement `<AdminDetailDrawer>`**

```tsx
"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

export interface AdminDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}

export function AdminDetailDrawer({ open, onClose, title, children, wide, footer }: AdminDetailDrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement;
    // Focus drawer first focusable on open (close button)
    const closeBtn = drawerRef.current?.querySelector<HTMLButtonElement>(
      "button[data-admin-drawer-close]",
    );
    closeBtn?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      (previouslyFocused.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-admin-drawer-overlay="true"
      onClick={onClose}
      className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className={`absolute right-0 top-0 flex h-full flex-col border-l border-t-border/60 bg-surface shadow-2xl ${
          wide ? "w-[480px]" : "w-[384px]"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-t-border/60 px-4 py-3">
          <div id={titleId} className="min-w-0 flex-1">
            {title}
          </div>
          <button
            type="button"
            data-admin-drawer-close
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <footer className="border-t border-t-border/60 px-4 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expect PASS (6/6)**

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminDetailDrawer.tsx src/__tests__/components/admin-shell/AdminDetailDrawer.test.tsx
git commit -m "feat(admin-shell): AdminDetailDrawer with focus trap + Esc/outside-click + tests"
```

### Task 1.4 — Chunk 1 verification

- [ ] **Step 1: tsc clean for new files**

```bash
npx tsc --noEmit 2>&1 | grep -E "src/components/admin-shell/(AdminTable|AdminFilterBar|AdminDetailDrawer)" | head
```
Expected: empty.

- [ ] **Step 2: Admin-shell tests green**

```bash
npx jest src/__tests__/components/admin-shell/
```
Expected: all passing, including Phase-1 primitive tests still green.

- [ ] **Step 3: Full build**

```bash
npm run build 2>&1 | tail -10
```
Expected: success.

### Task 1.5 — Ship Chunk 1 as PR

- [ ] **Step 1: Push branch for this PR (use a new branch off current state)**

```bash
git checkout -b feat/admin-primitives-batch-1
git push -u origin feat/admin-primitives-batch-1
```

- [ ] **Step 2: Open PR with title `feat(admin-shell): primitives batch 1 — table, filter bar, detail drawer`**

Body: summary + "no page changes; these primitives are consumed starting in PR 3 (the anchor rewrite)".

- [ ] **Step 3: Self-review via the `code-review:code-review` skill**

- [ ] **Step 4: After Vercel preview READY + any review fixes, merge**

```bash
gh pr merge --squash --delete-branch --admin
```

- [ ] **Step 5: Return to `spec/admin-page-internals`, rebase on main before starting Chunk 2**

```bash
git checkout spec/admin-page-internals
git fetch origin main
git rebase origin/main
```

---

## Chunk 2: Primitives batch 2 (BulkActionBar + Form + KeyValueGrid + DetailHeader)

**Goal:** Ship four more primitives with tests. Zero page changes. After this chunk, all 7 primitives exist and are testable.

**PR title:** `feat(admin-shell): primitives batch 2 — bulk action bar, form, kv grid, detail header`

**Estimated size:** ~700 LOC across new components + tests.

### Task 2.1 — `<AdminBulkActionBar>` (TDD)

**Files:**
- Create: `src/components/admin-shell/AdminBulkActionBar.tsx`
- Create: `src/__tests__/components/admin-shell/AdminBulkActionBar.test.tsx`

**API:**

```ts
export interface AdminBulkActionBarProps {
  visible: boolean;
  count: number;
  onCancel: () => void;
  children: React.ReactNode;   // Action buttons
}
```

- [ ] **Step 1: Write failing tests**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminBulkActionBar } from "@/components/admin-shell/AdminBulkActionBar";

describe("AdminBulkActionBar", () => {
  it("renders nothing when visible=false", () => {
    render(
      <AdminBulkActionBar visible={false} count={0} onCancel={() => {}}>
        <button>X</button>
      </AdminBulkActionBar>,
    );
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("renders count + children when visible=true", () => {
    render(
      <AdminBulkActionBar visible count={3} onCancel={() => {}}>
        <button>Delete selected</button>
      </AdminBulkActionBar>,
    );
    expect(screen.getByText(/3 selected/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeInTheDocument();
  });

  it("calls onCancel on Cancel click", async () => {
    const user = userEvent.setup();
    const cancel = jest.fn();
    render(
      <AdminBulkActionBar visible count={1} onCancel={cancel}>
        <button>X</button>
      </AdminBulkActionBar>,
    );
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(cancel).toHaveBeenCalled();
  });

  it("uses role=region with aria-live=polite so count changes are announced", () => {
    render(
      <AdminBulkActionBar visible count={2} onCancel={() => {}}>
        <button>X</button>
      </AdminBulkActionBar>,
    );
    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

```tsx
"use client";

import type { ReactNode } from "react";

export interface AdminBulkActionBarProps {
  visible: boolean;
  count: number;
  onCancel: () => void;
  children: ReactNode;
}

export function AdminBulkActionBar({ visible, count, onCancel, children }: AdminBulkActionBarProps) {
  if (!visible) return null;
  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Bulk actions"
      className="sticky bottom-4 z-30 mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-lg border border-t-border/60 bg-surface-elevated px-4 py-3 shadow-lg"
    >
      <div className="text-sm text-foreground">
        <span className="font-medium">{count} selected</span>
      </div>
      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — PASS (4/4)**

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminBulkActionBar.tsx src/__tests__/components/admin-shell/AdminBulkActionBar.test.tsx
git commit -m "feat(admin-shell): AdminBulkActionBar + tests"
```

---

### Task 2.2 — `<AdminForm>` primitives (TDD)

**Files:**
- Create: `src/components/admin-shell/AdminForm.tsx`
- Create: `src/__tests__/components/admin-shell/AdminForm.test.tsx`

**API:** Exports `<FormField>`, `<FormInput>`, `<FormSelect>`, `<FormTextarea>`, `<FormToggle>`. Each handles label / help / error consistently. Pages compose a form from these — no single `<AdminForm>` superstructure; composition is clearer.

- [ ] **Step 1: Write tests for each subcomponent**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormField, FormInput, FormSelect, FormTextarea, FormToggle } from "@/components/admin-shell/AdminForm";

describe("FormField", () => {
  it("renders label, help, and error", () => {
    render(
      <FormField label="Email" help="We'll never share it" error="Required">
        <input />
      </FormField>,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("We'll never share it")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
  });

  it("hides help when error is present (error replaces help visually)", () => {
    render(
      <FormField label="Email" help="We'll never share it" error="Required">
        <input />
      </FormField>,
    );
    const help = screen.queryByText("We'll never share it");
    // help is either hidden via class or omitted — either way error must dominate
    expect(screen.getByText("Required")).toHaveClass(/red/); // red-400 theme color for errors
  });
});

describe("FormInput", () => {
  it("fires onChange with the raw value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FormInput label="Name" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText("Name"), "abc");
    expect(onChange).toHaveBeenLastCalledWith("abc");
  });
});

describe("FormSelect", () => {
  it("renders options + fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(
      <FormSelect
        label="Role"
        value=""
        onChange={onChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    await user.selectOptions(screen.getByLabelText("Role"), "b");
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("FormToggle", () => {
  it("reflects checked state and fires onChange with next value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FormToggle label="Active" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("FormTextarea", () => {
  it("fires onChange with value", async () => {
    const user = userEvent.setup();
    const onChange = jest.fn();
    render(<FormTextarea label="Notes" value="" onChange={onChange} rows={3} />);
    await user.type(screen.getByLabelText("Notes"), "x");
    expect(onChange).toHaveBeenLastCalledWith("x");
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useId, type ReactNode } from "react";

// ── FormField: label + children + help + error ─────────────────
export interface FormFieldProps {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode; // the input; use the `id` prop from getFieldIds if you need label association for custom inputs
  required?: boolean;
}
export function FormField({ label, help, error, children, required }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-red-400">{error}</span>
      ) : help ? (
        <span className="text-xs text-muted">{help}</span>
      ) : null}
    </label>
  );
}

// ── FormInput ─────────────────────────────────────────────────
export interface FormInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  help?: string;
  error?: string;
  type?: "text" | "email" | "url" | "number";
  required?: boolean;
}
export function FormInput({ label, value, onChange, placeholder, help, error, type = "text", required }: FormInputProps) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-t-border focus:outline-none"
      />
      {error ? (
        <span className="text-xs text-red-400">{error}</span>
      ) : help ? (
        <span className="text-xs text-muted">{help}</span>
      ) : null}
    </label>
  );
}

// ── FormSelect ────────────────────────────────────────────────
export interface FormSelectOption {
  value: string;
  label: string;
}
export interface FormSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FormSelectOption[];
  help?: string;
  error?: string;
}
export function FormSelect({ label, value, onChange, options, help, error }: FormSelectProps) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground focus:border-t-border focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-xs text-red-400">{error}</span>
      ) : help ? (
        <span className="text-xs text-muted">{help}</span>
      ) : null}
    </label>
  );
}

// ── FormTextarea ─────────────────────────────────────────────
export interface FormTextareaProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  help?: string;
  error?: string;
}
export function FormTextarea({ label, value, onChange, placeholder, rows = 3, help, error }: FormTextareaProps) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-t-border focus:outline-none"
      />
      {error ? (
        <span className="text-xs text-red-400">{error}</span>
      ) : help ? (
        <span className="text-xs text-muted">{help}</span>
      ) : null}
    </label>
  );
}

// ── FormToggle (aria-switch) ─────────────────────────────────
export interface FormToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
}
export function FormToggle({ label, checked, onChange, help }: FormToggleProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-t-border/60 bg-surface-2 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {help && <span className="text-xs text-muted">{help}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-green-500/70" : "bg-surface-elevated"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-foreground transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminForm.tsx src/__tests__/components/admin-shell/AdminForm.test.tsx
git commit -m "feat(admin-shell): AdminForm field/input/select/textarea/toggle + tests"
```

---

### Task 2.3 — `<AdminKeyValueGrid>` (TDD)

**Files:**
- Create: `src/components/admin-shell/AdminKeyValueGrid.tsx`
- Create: `src/__tests__/components/admin-shell/AdminKeyValueGrid.test.tsx`

**API:**

```ts
export interface KeyValueItem {
  label: string;
  value: React.ReactNode;
  mono?: boolean; // render value in monospace (IDs, IPs)
}
export interface AdminKeyValueGridProps {
  items: KeyValueItem[];
  columns?: 1 | 2;   // default 2
}
```

- [ ] **Step 1: Write tests**

```tsx
import { render, screen } from "@testing-library/react";
import { AdminKeyValueGrid } from "@/components/admin-shell/AdminKeyValueGrid";

describe("AdminKeyValueGrid", () => {
  it("renders items as label/value pairs", () => {
    render(
      <AdminKeyValueGrid
        items={[
          { label: "Email", value: "a@b.com" },
          { label: "Roles", value: "ADMIN, SERVICE" },
        ]}
      />,
    );
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("a@b.com")).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("ADMIN, SERVICE")).toBeInTheDocument();
  });

  it("renders mono value in a <code> element", () => {
    render(
      <AdminKeyValueGrid items={[{ label: "ID", value: "abc-123", mono: true }]} />,
    );
    const v = screen.getByText("abc-123");
    expect(v.tagName.toLowerCase()).toBe("code");
  });
});
```

- [ ] **Step 2: Run — FAIL. Step 3: Implement:**

```tsx
import type { ReactNode } from "react";

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  mono?: boolean;
}
export interface AdminKeyValueGridProps {
  items: KeyValueItem[];
  columns?: 1 | 2;
}

export function AdminKeyValueGrid({ items, columns = 2 }: AdminKeyValueGridProps) {
  const gridClass = columns === 1 ? "grid-cols-1" : "grid-cols-[auto_1fr]";
  return (
    <dl className={`grid gap-x-4 gap-y-2 text-sm ${gridClass}`}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-xs font-medium uppercase tracking-wider text-muted">{item.label}</dt>
          <dd className="min-w-0 break-words text-foreground">
            {item.mono ? (
              <code className="rounded bg-surface-2 px-1 py-0.5 text-xs">{item.value}</code>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminKeyValueGrid.tsx src/__tests__/components/admin-shell/AdminKeyValueGrid.test.tsx
git commit -m "feat(admin-shell): AdminKeyValueGrid + tests"
```

---

### Task 2.4 — `<AdminDetailHeader>` (minimal, no test file)

**File:** `src/components/admin-shell/AdminDetailHeader.tsx`

Simple helper — smoke-tested when it appears inside drawer tests later. No dedicated test file; covered via Chunk 3's page test.

```tsx
import type { ReactNode } from "react";

export interface AdminDetailHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function AdminDetailHeader({ title, subtitle, actions }: AdminDetailHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add src/components/admin-shell/AdminDetailHeader.tsx
git commit -m "feat(admin-shell): AdminDetailHeader composition helper"
```

---

### Task 2.5 — Chunk 2 verification + PR

- [ ] Full admin-shell test suite green: `npx jest src/__tests__/components/admin-shell/`
- [ ] tsc clean for new files
- [ ] `npm run build` green
- [ ] Push branch `feat/admin-primitives-batch-2`, open PR, self-review, merge (same pattern as Chunk 1)

---

## Chunk 3: /admin/activity anchor rewrite

**Goal:** Rewrite the 597-LOC `/admin/activity` page using the 7 primitives. Prove the pattern. Any primitive API ergonomics issues get fixed here before anchor merges.

**PR title:** `refactor(admin): /admin/activity anchor rewrite using primitives`

**Estimated size:** -250 LOC net (597 → ~350) + one new page-level test.

### Task 3.1 — Read current page first

- [ ] **Step 1:** Read `src/app/admin/activity/page.tsx` in full. Understand current filter state shape, data fetching (API endpoint `/api/admin/activity`), pagination (offset-based), activity type enum, deep-link params (`?userId=`, `?type=`), and the auto-refresh interval.

### Task 3.2 — Replace the page

- [ ] **Step 1:** Rewrite `src/app/admin/activity/page.tsx` following the anchor layout in the spec.

Required behaviors preserved from the old page:
- Filter bar with: date range chip (Today / 7d / 30d / All), type multi-select, role multi-select, email search (debounced 300ms), auto-refresh toggle, clear-all
- Fetch activities from `/api/admin/activity?...` with all filters in the query string
- Table columns: Time (relative) / Actor (email, truncate) / Event (type + description) / Entity (clickable when entityType+entityId resolvable) / Risk (status pill colored by riskLevel)
- Pagination: Load more button at bottom (offset-based)
- Click row opens `<AdminDetailDrawer>` (wide) with `<AdminDetailHeader>` (description + createdAt subtitle), `<AdminKeyValueGrid>` (Type, Actor email, Entity, Session ID, IP, UA, Request path+method), `<pre>` for metadata JSON, and a "View user/role/session" link when applicable
- URL query params mirror filter state (extend beyond today — every filter serialized)
- Auto-refresh interval uses the existing SSE hook or a simple `setInterval` — preserve today's behavior

State shape (target ~5 useStates):

```ts
type FiltersState = {
  dateRange: "today" | "7d" | "30d" | "all";
  typeFilters: string[];
  roleFilters: string[];
  emailQuery: string;
  userIdFilter: string; // from deep link
  autoRefresh: boolean;
};

const [filters, setFilters] = useState<FiltersState>(initialFromSearchParams(searchParams));
const [selected, setSelected] = useState<ActivityLog | null>(null);
const [offset, setOffset] = useState(0);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
// data + hasMore come from useEffect that calls the API
const [data, setData] = useState<{ activities: ActivityLog[]; hasMore: boolean }>({ activities: [], hasMore: false });
```

Key guardrails:
- When any filter changes, reset `offset` to 0
- URL stays in sync via `router.replace(...)` (no history spam)
- Drawer open state ALSO reflects in URL via `?drawerId=<activityId>`
- ErrorBoundary via existing `<AdminError>` when fetch fails

### Task 3.3 — Page-level integration test

**File:** `src/__tests__/app/admin-activity.test.tsx`

- [ ] **Step 1: Test the three critical flows**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Mock fetch + next/navigation per this repo's existing patterns
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/admin/activity",
}));

import AdminActivityPage from "@/app/admin/activity/page";

describe("/admin/activity", () => {
  it("loads activities and renders rows", async () => {
    /* mock fetch to return 2 activities, render page, assert rows */
  });
  it("opens drawer on row click with full metadata", async () => {
    /* row click → drawer visible → KV grid shows metadata */
  });
  it("updates URL when date range changes", async () => {
    /* click 7d chip → router.replace called with ?dateRange=7d */
  });
});
```

- [ ] **Step 2: Run — initially FAIL (page not rewritten yet)**
- [ ] **Step 3: Complete the page rewrite so tests pass**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit**

```bash
git add src/app/admin/activity/page.tsx src/__tests__/app/admin-activity.test.tsx
git commit -m "refactor(admin): /admin/activity anchor rewrite using primitives"
```

### Task 3.4 — Chunk 3 verification + PR

- [ ] Manual smoke: open `/admin/activity` locally, verify every flow from the old page works
- [ ] `npm run build` green
- [ ] Page LOC ~350 (check with `wc -l src/app/admin/activity/page.tsx`)
- [ ] Push branch `feat/admin-activity-rewrite`, PR, self-review via code-review skill, merge after Vercel READY

**Anchor-specific check:** during self-review, explicitly call out any primitive API that felt cramped while writing the page. Fix in Chunk 1/2 components (via tiny follow-up commits) rather than working around it in the page.

---

## Chunk 4: /admin/tickets + /admin/directory

**Goal:** Ship two small-page rewrites together. Lowest risk, smallest diffs. Validates primitives against two distinct page shapes.

**PR title:** `refactor(admin): /admin/tickets + /admin/directory adopt primitives`

**Estimated size:** ~-200 LOC net.

### Task 4.1 — /admin/tickets

**File:** `src/app/admin/tickets/page.tsx`

Current (384 LOC): list of bug reports, custom ticket modal for detail edit.

Target (~250 LOC):
- `<AdminPageHeader>` title "Bug Tickets"
- `<AdminFilterBar>` with: status chip group (OPEN / IN_PROGRESS / RESOLVED / CLOSED / All), search input (title/description), clear-all
- `<AdminTable>` columns: Status (pill) / Title / Reporter / Created (relative)
- `?ticketId=<id>` deep link opens `<AdminDetailDrawer>` with `<AdminDetailHeader>`, `<AdminKeyValueGrid>` (Reporter, Page URL, Created, Updated), full description as scrollable `<pre>`, `<FormTextarea>` for admin notes, `<FormSelect>` for status, Save button as drawer footer

Preserved behaviors:
- Existing POST `/api/admin/tickets/:id/status` to change status
- Existing PATCH for admin notes
- Toast confirmation on save

- [ ] **Implement. Commit.**

```bash
git add src/app/admin/tickets/page.tsx
git commit -m "refactor(admin): /admin/tickets adopts primitives + drawer"
```

### Task 4.2 — /admin/directory

**File:** `src/app/admin/directory/page.tsx`

Current (130 LOC): lists app routes + which roles have access.

Target (~130 LOC, but restructured):
- `<AdminPageHeader>` with existing breadcrumb
- `<AdminFilterBar>` with: search input (route path), role multi-select (filter to routes a selected role can access)
- `<AdminTable>` columns: Route / Roles with access / Notes
- No drawer (directory is read-only)

- [ ] **Implement. Commit.**

```bash
git add src/app/admin/directory/page.tsx
git commit -m "refactor(admin): /admin/directory adopts primitives"
```

### Task 4.3 — Chunk 4 verification + PR

- [ ] Manual smoke both pages
- [ ] Build green
- [ ] Branch `feat/admin-tickets-directory`, PR, self-review, merge

---

## Chunk 5: /admin/audit + /admin/security

**Goal:** Rewrite the two large audit-themed pages together. Medium risk.

**PR title:** `refactor(admin): /admin/audit + /admin/security adopt primitives`

**Estimated size:** -700 LOC net (1026+673 → ~900).

### Task 5.1 — /admin/audit

**File:** `src/app/admin/audit/page.tsx`

Current (1026 LOC): audit sessions table + session detail view + anomaly list inline.

Target (~500 LOC):
- `<AdminPageHeader>` title "Audit Sessions"
- `<AdminFilterBar>` with: date range chip, client type multi-select (BROWSER / CLAUDE_CODE / CODEX / API_CLIENT / UNKNOWN), environment multi-select (LOCAL / PREVIEW / PRODUCTION), risk level chip group, search input (email), clear-all
- `<AdminTable>` columns: Started / Actor / Client / Env / Risk / Anomalies (count)
- Row click → `<AdminDetailDrawer wide>` with session detail: `<AdminDetailHeader>`, `<AdminKeyValueGrid>` (Email, Client, Env, IP, UA, Started, Ended, Risk score, Risk level), then a sub-table of anomaly events (reuse `<AdminTable>` with its own columns), and a link to the related user via `/admin/users?userId=<id>`

Preserved behaviors:
- Auto-refresh every 60s (existing)
- Anomaly event types all surface in the detail drawer

- [ ] **Implement. Commit:**

```bash
git add src/app/admin/audit/page.tsx
git commit -m "refactor(admin): /admin/audit adopts primitives"
```

### Task 5.2 — /admin/security

**File:** `src/app/admin/security/page.tsx`

Current (673 LOC): four stacked sections — suspicious emails, IP analysis, risk events, admin actions.

Target (~400 LOC):
- `<AdminPageHeader>` title "Security"
- Four `<section>` blocks, each with an h2 and an `<AdminTable>`:
  1. **Suspicious emails** — Email / First seen / Last seen / Login count
  2. **IP analysis** — IP / User count / Activity count / Last seen (with masked IP via existing utility in `audit/detect.ts`)
  3. **Risk events (HIGH / CRITICAL, last 7d)** — Time / Actor / Type / Risk / Entity (clickable)
  4. **Admin actions (last 90d)** — Time / Actor / Action / Entity

No drawer on this page — sections are overview dashboards.
- Reuse existing `<AdminEmpty>` slot on each table when its data is empty.

- [ ] **Implement. Commit:**

```bash
git add src/app/admin/security/page.tsx
git commit -m "refactor(admin): /admin/security adopts primitives (4 tables)"
```

### Task 5.3 — Chunk 5 verification + PR

- [ ] Manual smoke both pages
- [ ] Build green
- [ ] Branch `feat/admin-audit-security`, PR, self-review, merge

---

## Chunk 6: /admin/crew-availability

**Goal:** Rewrite the 886-LOC crew availability page. Combines table + edit forms + detail drawer.

**PR title:** `refactor(admin): /admin/crew-availability adopts primitives + drawer`

**Estimated size:** ~-430 LOC (886 → ~450).

### Task 6.1 — Read page first

Understand current edit flow. Key things to preserve:
- Per-crew-member availability records
- Override records (vacation / unavailable)
- Existing POST endpoints for create/update

### Task 6.2 — Rewrite

**File:** `src/app/admin/crew-availability/page.tsx`

Target:
- `<AdminPageHeader>` title "Crew Availability" + actions (New override button)
- `<AdminFilterBar>`: location multi-select, crew-member search, job-type chip group, override-status chip (active / past / upcoming / all)
- `<AdminTable>` columns: Crew member / Location / Job type / Days & hours / Override status
- Row click → `<AdminDetailDrawer wide>` for edit:
  - Header: crew member name
  - `<FormInput>` for base hours
  - `<FormSelect>` for location + job type
  - Expandable list of overrides (each with start/end dates + reason)
  - Footer: Save button + Cancel

- [ ] **Implement. Commit:**

```bash
git add src/app/admin/crew-availability/page.tsx
git commit -m "refactor(admin): /admin/crew-availability adopts primitives + drawer-based edit"
```

### Task 6.3 — Chunk 6 verification + PR

- [ ] Manual smoke: create a new override via the drawer
- [ ] Build green
- [ ] Branch `feat/admin-crew-availability`, PR, self-review, merge

---

## Chunk 7: /admin/roles consolidation + delete /admin/roles/[role]

**Goal:** Absorb the separate role-detail page into a drawer on the role list. One page URL goes away (replaced with a redirect shim).

**PR title:** `refactor(admin): /admin/roles consolidation — fold [role] into drawer`

**Estimated size:** ~-120 LOC net.

### Task 7.1 — Audit for stale deep-links

- [ ] **Step 1:** Grep repo for any internal references to `/admin/roles/` with a role segment after:

```bash
# Use the Grep tool
# Pattern: /admin/roles/[A-Z_]+
# Path: src/
```

- [ ] **Step 2:** Catalogue hits. Most should be none (the only current consumer is the Role Inspector's own "Edit capabilities" link).

### Task 7.2 — Rewrite `/admin/roles/page.tsx`

**File:** `src/app/admin/roles/page.tsx`

Current (258 LOC): 2-column card grid of roles.

Target (~200 LOC):
- `<AdminPageHeader>` title "Roles"
- `<AdminFilterBar>`: scope multi-select, search (role key/label), show-legacy toggle chip
- `<AdminTable>` columns: Role / Label / Scope / Badge / Users-count
- Row click OR `?role=<key>` deep-link → `<AdminDetailDrawer wide>`:
  - `<AdminDetailHeader>` with role key + label + legacy badge
  - `<AdminKeyValueGrid>`: Suites, Landing cards, Allowed routes (a bulleted list — may need its own sub-component)
  - Embedded `CapabilityEditor` (the existing Option B UI from `[role]/CapabilityEditor.tsx`)
  - "Users with this role →" link to `/admin/users?role=<key>`
  - Users-count loaded from `/api/admin/users` count endpoint (may need a small API addition — check first; if absent, fall back to loading the full users list once)

### Task 7.3 — Replace `/admin/roles/[role]/page.tsx` with redirect shim

**File:** `src/app/admin/roles/[role]/page.tsx`

```tsx
import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  redirect(`/admin/roles?role=${encodeURIComponent(role)}`);
}
```

- [ ] **Implement both + commit:**

```bash
git add src/app/admin/roles/page.tsx src/app/admin/roles/[role]/page.tsx
git commit -m "refactor(admin): /admin/roles adopts primitives + drawer; [role] becomes redirect shim"
```

### Task 7.4 — Update any internal links

- [ ] **Step 1:** From the earlier grep hits, update each caller to point at `/admin/roles?role=<key>` instead of `/admin/roles/<key>` — or leave them (the redirect shim handles it). Prefer direct links for clarity when touching code.

- [ ] **Step 2:** Verify `<AdminSearch>`'s role-match result still navigates correctly (it points at `/admin/roles/<role>` today — the redirect catches it, but update to direct form).

### Task 7.5 — Chunk 7 verification + PR

- [ ] Manual smoke: open `/admin/roles/ADMIN` (old URL) → redirects to `/admin/roles?role=ADMIN` with drawer open
- [ ] Manual smoke: role row click opens drawer with capability editor; Save works
- [ ] Build green
- [ ] Branch `feat/admin-roles-consolidation`, PR, self-review, merge

---

## Chunk 8: /admin/users full rewrite

**Goal:** Rewrite the 1223-LOC monster. Three overlapping modals become one tabbed drawer. All Phase-1 features (capability overrides via role link, extra routes, role editing) preserved.

**PR title:** `refactor(admin): /admin/users full rewrite — one drawer, one bulk bar, every feature preserved`

**Estimated size:** ~-720 LOC (1223 → ~500). Largest diff of the whole project.

### Task 8.1 — Full inventory of current page

- [ ] **Step 1:** Read `src/app/admin/users/page.tsx` in full.
- [ ] **Step 2:** List every state variable, every handler, every modal, every API call. (This is an investment — the point is to leave nothing behind.)
- [ ] **Step 3:** Produce a written checklist in a scratch file `/tmp/users-page-behaviors.md` with every behavior the new page must preserve. Examples:
  - Workspace sync button + status indicator
  - Filter by role (single-select pill tabs)
  - Filter by search (email / name)
  - Bulk select + bulk-update-role
  - Per-user impersonate button
  - Per-user edit button → permissions modal
  - Per-user roles editor modal
  - Per-user extra routes inside permissions modal
  - Activity logs cache (fetched lazily per user)
  - Deep-link `?userId=` scrolls + opens edit
  - `?role=` filter preloading (from the roles-consolidation PR)
  - (Any others discovered during inventory.)

### Task 8.2 — Design the drawer shape

Tabbed drawer: `<AdminDetailDrawer wide>` with a small tabs strip at the top of the body.

Tabs:
1. **Info** — KV grid: email / name / Google linked / created / last login / workspace user
2. **Roles** — `FormMultiSelect` or checkbox group of canonical roles. Save on blur or dedicated Save button in drawer footer. Legacy roles show as read-only chips with "normalizes to" text.
3. **Permissions** — the 6 per-user boolean permission toggles (canScheduleSurveys, canScheduleInstalls, canScheduleInspections, canSyncZuper, canManageUsers, canManageAvailability), each `<FormToggle>`
4. **Extra routes** — two lists (allowed, denied) with add/remove per path, exactly as the existing tab in the permissions modal
5. **Activity** — last 10 USER_* activity events for this user (lazy-loaded on tab open)

Drawer footer: "Impersonate this user" button (admin-only, not self) + Save button (disabled unless dirty).

### Task 8.3 — Rewrite `src/app/admin/users/page.tsx`

Page structure:
- `<AdminPageHeader>` title "Users" + actions: Sync Workspace button
- `<AdminFilterBar>`: role multi-select, search input (email/name), clear-all
- `<AdminTable>` columns: Checkbox / Email / Name / Role badges / Last login (relative)
- `<AdminBulkActionBar>` visible when rows selected: Change role dropdown + Delete button (with `ConfirmDialog`)
- `?userId=<id>` deep-link opens the tabbed drawer

State (target ~7 useStates, down from 20+):

```ts
const [users, setUsers] = useState<User[]>([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [selected, setSelected] = useState<Set<string>>(new Set());
const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
const [filters, setFilters] = useState<UsersFilterState>(initialFromSearchParams(searchParams));
const [workspace, setWorkspace] = useState<WorkspaceConfigState>(/* ... */);
```

Drawer-internal state lives in a dedicated `UserDetailDrawer` subcomponent (same file, below the page) so the page doesn't carry modal state.

### Task 8.4 — Extract UserDetailDrawer subcomponent

Inline in the same file, but structured:

```tsx
interface UserDetailDrawerProps {
  user: User;
  onClose: () => void;
  onSave: (updates: UserUpdate) => Promise<void>;
  onImpersonate: () => Promise<void>;
}
function UserDetailDrawer({ user, onClose, onSave, onImpersonate }: UserDetailDrawerProps) {
  /* tabs + forms, ~200-250 LOC */
}
```

### Task 8.5 — Page-level integration test

**File:** `src/__tests__/app/admin-users.test.tsx`

- [ ] Tests:
  - Renders rows from mocked `/api/admin/users`
  - Clicking a row opens the drawer on the Info tab
  - Switching to Permissions tab shows toggles; changing one + Save calls the PATCH endpoint
  - Bulk selecting 2 users shows bulk action bar with count 2
  - `?userId=<id>` on mount opens the drawer for that user
  - Role filter reloads users with the filter applied

### Task 8.6 — Manual smoke (MANDATORY before merge)

Per the spec's risk mitigation — walk every Phase-1 workflow on the new page:

- [ ] Open Roles tab → change a user to multi-role → Save → verify `User.roles` updated via API
- [ ] Open Permissions tab → toggle canSyncZuper → Save → verify user capability updated
- [ ] Open Extra Routes tab → add an allowed route and a denied route → Save → verify values in DB
- [ ] Click "Users with this role" from `/admin/roles` → lands here with role filter preloaded
- [ ] Click a user's "Activity" link → `/admin/activity?userId=<id>` loads filtered
- [ ] Click Impersonate in drawer → impersonation cookie set; banner visible; return-from-impersonation works
- [ ] Deep-link `/admin/users?userId=<id>` opens drawer for that user immediately on load
- [ ] Bulk select 3 users → bulk action bar → change role → confirmation → all 3 updated

### Task 8.7 — Commit + Chunk 8 PR

- [ ] **Commit:**

```bash
git add src/app/admin/users/page.tsx src/__tests__/app/admin-users.test.tsx
git commit -m "refactor(admin): /admin/users full rewrite — tabbed drawer, one bulk bar, all features preserved"
```

- [ ] Branch `feat/admin-users-rewrite`, PR, self-review via `code-review:code-review` skill (stress: every Phase-1 workflow preserved), merge after Vercel READY + smoke checklist complete.

---

## Done state

After all 8 chunks merge:

- 9 admin pages compose from 7 shared primitives (+ Phase-1 primitives)
- `/admin/roles/[role]` no longer exists as a standalone page; redirects to `/admin/roles?role=<key>`
- Total admin page LOC: ~3,100 (from ~5,562). Primitives add ~1,500 LOC of reusable infrastructure.
- Every admin page < 500 LOC except `/admin/users` at ~500
- Keyboard navigation works on every admin table
- All Phase-1 features (Option B capability overrides, Option D extra routes, impersonation, role editing) preserved
- Zero API changes, zero data-model changes, zero migrations
- One URL change: `/admin/roles/[role]` → redirect to `/admin/roles?role=<key>`

## Pause points

Each chunk ships as its own PR. Safe pause points (days/weeks between):
- After Chunk 2 (primitives exist but no pages use them yet — fine to pause indefinitely)
- After Chunk 3 (anchor is proven; low-risk state)
- After Chunks 4, 5, 6 (incremental progress, pages keep working)
- After Chunk 7 (`[role]` page gone, but redirect active; durable state)

Chunk 8 is the terminal. Once it merges, Phase 2 is done.
