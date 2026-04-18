# Admin Suite Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the 9 `/admin/*` pages behind a shared `<AdminShell>` layout — persistent sidebar + breadcrumb + in-shell search + new landing page — with zero URL changes and no data-model changes.

**Architecture:** New client component `<AdminShell>` wraps all admin children via `src/app/admin/layout.tsx`. Each existing admin page drops its `<DashboardShell>` wrapper and adopts a small `<AdminPageHeader>` at the top of its output. Three shared primitives (`<AdminEmpty>`, `<AdminLoading>`, `<AdminError>`) replace ad-hoc empty/error UI. A new `/api/admin/search` route powers in-shell search across users/roles/activity/tickets.

**Tech Stack:** Next.js 16 App Router (client components for interactive shell, server components for data-heavy pages), Tailwind v4 theme tokens, React Query / react hooks, Prisma 7 on Neon, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-04-18-admin-suite-redesign-design.md`

**Branch:** `spec/admin-suite-redesign` (spec commit already on branch; plan + implementation continue here; one PR)

---

## File Structure

### New files

| File | Responsibility |
|------|----------------|
| `src/components/admin-shell/AdminShell.tsx` | Client component. Sidebar + header slot + collapse. Wraps all `/admin/*` pages via layout. |
| `src/components/admin-shell/AdminSidebar.tsx` | Client component. Nav groups (People / Operations / Audit). Pathname-driven active state. |
| `src/components/admin-shell/AdminSearch.tsx` | Client component. Debounced search input + dropdown with a11y keyboard nav. |
| `src/components/admin-shell/AdminPageHeader.tsx` | Client component. Per-page breadcrumb + title + actions block. |
| `src/components/admin-shell/AdminBreadcrumb.tsx` | Tiny presentational component used inside AdminPageHeader. Renders a trail. |
| `src/components/admin-shell/AdminEmpty.tsx` | Presentational. Icon + label + description + optional CTA. |
| `src/components/admin-shell/AdminLoading.tsx` | Presentational. Centered spinner + optional label. |
| `src/components/admin-shell/AdminError.tsx` | Presentational. Error card with message + optional retry. |
| `src/components/admin-shell/nav.ts` | Shared data. The sidebar nav structure (groups + items). Single source of truth. |
| `src/app/admin/layout.tsx` | Server component. Auth gate (redirect non-admins). Renders `<AdminShell>{children}</AdminShell>`. |
| `src/app/admin/page.tsx` | Server component. The new landing page. Replaces today's redirect. |
| `src/app/api/admin/search/route.ts` | API. Admin-gated. Parallel-fires users/roles/activity/tickets queries. |
| `src/__tests__/components/admin-shell/AdminShell.test.tsx` | Component test. Sidebar active state, collapse, children rendering. |
| `src/__tests__/components/admin-shell/AdminSearch.test.tsx` | Component test. Debounce, dropdown a11y (keyboard nav, aria roles), error states. |
| `src/__tests__/components/admin-shell/AdminPrimitives.test.tsx` | Tests for AdminEmpty / AdminLoading / AdminError. |
| `src/__tests__/api/admin-search.test.ts` | API test. Auth gate, four-entity matching, take:5 cap, partial-failure shape. |

### Modified files

| File | Change |
|------|--------|
| `src/app/admin/users/page.tsx` | Remove internal DashboardShell/header. Add `<AdminPageHeader>`. Consume `?userId=` query param (scroll to match + open edit modal). Add "View activity" cross-link on each user row. |
| `src/app/admin/roles/page.tsx` | Remove DashboardShell. Add `<AdminPageHeader>`. Add "N users with this role" cross-link on each role card. |
| `src/app/admin/roles/[role]/page.tsx` | Remove DashboardShell. Add `<AdminPageHeader>` with breadcrumb `Admin / People / Roles / {role}`. |
| `src/app/admin/directory/page.tsx` | Remove DashboardShell (if present). Add `<AdminPageHeader>`. |
| `src/app/admin/crew-availability/page.tsx` | Add `<AdminPageHeader>`. Replace ad-hoc empty states with `<AdminEmpty>`. |
| `src/app/admin/tickets/page.tsx` | Add `<AdminPageHeader>`. Consume `?ticketId=` query param. Replace empty states with `<AdminEmpty>`. |
| `src/app/admin/activity/page.tsx` | Add `<AdminPageHeader>`. Consume `?userId=` and `?type=` query params (preload filters). Add clickable `entityName` cells for user/role entities. |
| `src/app/admin/audit/page.tsx` | Remove DashboardShell. Add `<AdminPageHeader>`. Link audit session's `userEmail` to `/admin/users?userId=<id>`. |
| `src/app/admin/security/page.tsx` | Add `<AdminPageHeader>`. Replace empty states with `<AdminEmpty>`. |

### Not touched (deliberate)

- `src/components/DashboardShell.tsx` — stays as-is; other surfaces still use it. AdminShell is a sibling, not a replacement.
- `src/components/GlobalSearch.tsx` — stays as-is. Admin search is a separate in-shell experience.
- `src/lib/roles.ts` — `/api/admin` prefix is already in `ADMIN_ONLY_ROUTES`; no allowlist change needed.
- Any non-`/admin` page, component, or route.

---

## Chunk 1: Foundation — primitives and shared nav data

This chunk lays the simplest pieces first so later chunks have stable components to import.

### Task 1.0: Branch sanity check

- [ ] **Step 1: Confirm current branch is `spec/admin-suite-redesign`**

```bash
git branch --show-current
```
Expected: `spec/admin-suite-redesign`. If not, `git checkout spec/admin-suite-redesign` (or create from main if missing).

- [ ] **Step 2: Confirm working tree is clean**

```bash
git status --short
```
Expected: no unstaged changes (spec + plan commits already present on branch).

---

### Task 1.1: Shared nav data

**Files:**
- Create: `src/components/admin-shell/nav.ts`

- [ ] **Step 1: Create `nav.ts` as the single source of truth for sidebar structure**

```ts
// src/components/admin-shell/nav.ts
//
// Single source of truth for the admin sidebar. Any new admin page added
// later should be registered here AND have its `/admin/<path>` route exist.

export interface AdminNavItem {
  label: string;
  href: string;
  /** Lucide icon name or a local symbol; resolved by the sidebar. */
  iconName: "users" | "shield" | "list" | "calendar" | "ticket" | "activity" | "eye" | "alert";
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "People",
    items: [
      { label: "Users", href: "/admin/users", iconName: "users" },
      { label: "Roles", href: "/admin/roles", iconName: "shield" },
      { label: "Directory", href: "/admin/directory", iconName: "list" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Crew availability", href: "/admin/crew-availability", iconName: "calendar" },
      { label: "Tickets", href: "/admin/tickets", iconName: "ticket" },
    ],
  },
  {
    label: "Audit",
    items: [
      { label: "Activity log", href: "/admin/activity", iconName: "activity" },
      { label: "Audit sessions", href: "/admin/audit", iconName: "eye" },
      { label: "Security alerts", href: "/admin/security", iconName: "alert" },
    ],
  },
];

/**
 * Given the current pathname, return the ADMIN_NAV item whose href is the
 * best match (exact or longest prefix). Used by the sidebar to highlight
 * the active link and by the breadcrumb to name the current section.
 */
export function findActiveAdminNavItem(pathname: string): { group: AdminNavGroup; item: AdminNavItem } | null {
  let bestMatch: { group: AdminNavGroup; item: AdminNavItem; length: number } | null = null;
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (!bestMatch || item.href.length > bestMatch.length) {
          bestMatch = { group, item, length: item.href.length };
        }
      }
    }
  }
  if (!bestMatch) return null;
  const { group, item } = bestMatch;
  return { group, item };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/admin-shell/nav.ts
git commit -m "feat(admin-shell): add shared nav data"
```

---

### Task 1.2: AdminEmpty primitive

**Files:**
- Create: `src/components/admin-shell/AdminEmpty.tsx`
- Test: `src/__tests__/components/admin-shell/AdminPrimitives.test.tsx` (covers Empty, Loading, Error)

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/components/admin-shell/AdminPrimitives.test.tsx
import { render, screen } from "@testing-library/react";
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";

describe("AdminEmpty", () => {
  it("renders label + description", () => {
    render(<AdminEmpty label="No users" description="Try changing filters" />);
    expect(screen.getByText("No users")).toBeInTheDocument();
    expect(screen.getByText("Try changing filters")).toBeInTheDocument();
  });

  it("renders an optional action node", () => {
    render(
      <AdminEmpty
        label="No users"
        action={<button>Invite user</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Invite user" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx`
Expected: FAIL with "Cannot find module '@/components/admin-shell/AdminEmpty'"

- [ ] **Step 3: Implement AdminEmpty**

```tsx
// src/components/admin-shell/AdminEmpty.tsx
import type { ReactNode } from "react";

export interface AdminEmptyProps {
  label: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

/**
 * Standardized empty-state card for admin pages. Replaces ad-hoc "no results"
 * UI across the 9 admin pages. Theme-token colors only — no hardcoded greys.
 */
export function AdminEmpty({ label, description, action, icon }: AdminEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-t-border/60 bg-surface p-8 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx -t AdminEmpty`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminEmpty.tsx src/__tests__/components/admin-shell/AdminPrimitives.test.tsx
git commit -m "feat(admin-shell): AdminEmpty primitive + tests"
```

---

### Task 1.3: AdminLoading primitive

**Files:**
- Create: `src/components/admin-shell/AdminLoading.tsx`
- Modify: `src/__tests__/components/admin-shell/AdminPrimitives.test.tsx` (append)

- [ ] **Step 1: Append failing test**

```tsx
// append to src/__tests__/components/admin-shell/AdminPrimitives.test.tsx
import { AdminLoading } from "@/components/admin-shell/AdminLoading";

describe("AdminLoading", () => {
  it("renders optional label", () => {
    render(<AdminLoading label="Loading users…" />);
    expect(screen.getByText("Loading users…")).toBeInTheDocument();
  });

  it("sets role='status' for screen readers", () => {
    render(<AdminLoading />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx -t AdminLoading`
Expected: FAIL with missing module.

- [ ] **Step 3: Implement AdminLoading**

```tsx
// src/components/admin-shell/AdminLoading.tsx

export interface AdminLoadingProps {
  label?: string;
}

/**
 * Centered spinner for admin suspense boundaries / pending states.
 * Uses the existing animate-spin utility. Role="status" keeps it accessible.
 */
export function AdminLoading({ label }: AdminLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 py-12"
    >
      <div
        aria-hidden="true"
        className="h-6 w-6 animate-spin rounded-full border-2 border-t-border/30 border-t-foreground"
      />
      {label && <p className="text-xs text-muted">{label}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx -t AdminLoading`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminLoading.tsx src/__tests__/components/admin-shell/AdminPrimitives.test.tsx
git commit -m "feat(admin-shell): AdminLoading primitive + tests"
```

---

### Task 1.4: AdminError primitive

**Files:**
- Create: `src/components/admin-shell/AdminError.tsx`
- Modify: `src/__tests__/components/admin-shell/AdminPrimitives.test.tsx` (append)

- [ ] **Step 1: Append failing test**

```tsx
import { AdminError } from "@/components/admin-shell/AdminError";

describe("AdminError", () => {
  it("renders error message", () => {
    render(<AdminError error="Database unreachable" />);
    expect(screen.getByText("Database unreachable")).toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", async () => {
    const onRetry = jest.fn();
    const user = (await import("@testing-library/user-event")).default.setup();
    render(<AdminError error="Failed" onRetry={onRetry} />);
    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx -t AdminError`
Expected: FAIL.

- [ ] **Step 3: Implement AdminError**

```tsx
// src/components/admin-shell/AdminError.tsx
"use client";

export interface AdminErrorProps {
  error: string;
  onRetry?: () => void;
}

/**
 * Error card for admin data-fetching failures. `onRetry` wires to a React
 * Query `refetch()` or similar. Without it, the button is hidden.
 */
export function AdminError({ error, onRetry }: AdminErrorProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-8 text-center"
    >
      <p className="text-sm font-medium text-red-400">Something went wrong</p>
      <p className="text-xs text-muted">{error}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-t-border/60 bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-elevated"
        >
          Retry
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx -t AdminError`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminError.tsx src/__tests__/components/admin-shell/AdminPrimitives.test.tsx
git commit -m "feat(admin-shell): AdminError primitive + tests"
```

---

### Task 1.5: AdminBreadcrumb + AdminPageHeader

**Files:**
- Create: `src/components/admin-shell/AdminBreadcrumb.tsx`
- Create: `src/components/admin-shell/AdminPageHeader.tsx`
- Test: `src/__tests__/components/admin-shell/AdminPrimitives.test.tsx` (append)

- [ ] **Step 1: Append failing test**

```tsx
import { AdminBreadcrumb } from "@/components/admin-shell/AdminBreadcrumb";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";

describe("AdminBreadcrumb", () => {
  it("renders segments separated by slashes", () => {
    render(<AdminBreadcrumb segments={["Admin", "People", "Users"]} />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    // Separators
    expect(screen.getAllByText("/")).toHaveLength(2);
  });
});

describe("AdminPageHeader", () => {
  it("renders title + breadcrumb + actions", () => {
    render(
      <AdminPageHeader
        title="Role Inspector"
        breadcrumb={["Admin", "People", "Roles"]}
        actions={<button>New role</button>}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Role Inspector" })).toBeInTheDocument();
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New role" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx -t AdminBreadcrumb`
Expected: FAIL.

- [ ] **Step 3: Implement both components**

```tsx
// src/components/admin-shell/AdminBreadcrumb.tsx

export interface AdminBreadcrumbProps {
  segments: string[];
}

export function AdminBreadcrumb({ segments }: AdminBreadcrumbProps) {
  if (segments.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted">
      {segments.map((seg, i) => (
        <span key={`${i}-${seg}`} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-muted/50">/</span>}
          <span className={i === segments.length - 1 ? "text-foreground/80" : undefined}>
            {seg}
          </span>
        </span>
      ))}
    </nav>
  );
}
```

```tsx
// src/components/admin-shell/AdminPageHeader.tsx
import type { ReactNode } from "react";
import { AdminBreadcrumb } from "./AdminBreadcrumb";

export interface AdminPageHeaderProps {
  title: string;
  breadcrumb?: string[];
  actions?: ReactNode;
  subtitle?: string;
}

/**
 * Per-page header block. Every admin page renders this at the top of its
 * output. AdminShell provides outer chrome; this provides the page's
 * identity (title, breadcrumb, page-local actions).
 */
export function AdminPageHeader({ title, breadcrumb, actions, subtitle }: AdminPageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 border-b border-t-border/60 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && <AdminBreadcrumb segments={breadcrumb} />}
        <h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/__tests__/components/admin-shell/AdminPrimitives.test.tsx`
Expected: PASS (all primitive tests green).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminBreadcrumb.tsx src/components/admin-shell/AdminPageHeader.tsx src/__tests__/components/admin-shell/AdminPrimitives.test.tsx
git commit -m "feat(admin-shell): AdminBreadcrumb + AdminPageHeader + tests"
```

---

## Chunk 2: AdminShell core + sidebar

### Task 2.1: AdminSidebar

**Files:**
- Create: `src/components/admin-shell/AdminSidebar.tsx`
- Test: covered by AdminShell tests in next task

- [ ] **Step 1: Implement AdminSidebar**

```tsx
// src/components/admin-shell/AdminSidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, findActiveAdminNavItem } from "./nav";

export interface AdminSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ICON_PATHS: Record<string, string> = {
  // Simple single-path SVGs (heroicons-style) chosen to stay lib-free.
  users: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  shield: "M12 3l8 3v5c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3z",
  list: "M4 6h16M4 12h16M4 18h16",
  calendar: "M8 2v4M16 2v4M3 10h18M5 6h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z",
  ticket: "M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 100-4V8zM13 6v12",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  alert: "M12 9v4m0 4h.01M5 20h14a2 2 0 001.7-3L13.7 5a2 2 0 00-3.4 0L3.3 17A2 2 0 005 20z",
};

function NavIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function AdminSidebar({ collapsed, onToggleCollapsed }: AdminSidebarProps) {
  const pathname = usePathname() ?? "/admin";
  const active = findActiveAdminNavItem(pathname);

  return (
    <aside
      aria-label="Admin navigation"
      className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-t-border/60 bg-surface/50 transition-[width] duration-150 ${
        collapsed ? "w-[64px]" : "w-[220px]"
      }`}
    >
      <div className="flex items-center justify-between px-3 py-4">
        <Link
          href="/admin"
          className={`text-xs font-bold tracking-wider text-foreground ${collapsed ? "hidden" : ""}`}
        >
          ADMIN
        </Link>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <path d={collapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
          </svg>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="mt-2">
            {!collapsed && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted/80">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = active?.item.href === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "bg-surface-elevated font-medium text-foreground"
                          : "text-muted hover:bg-surface-2 hover:text-foreground"
                      }`}
                    >
                      <NavIcon name={item.iconName} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/admin-shell/AdminSidebar.tsx
git commit -m "feat(admin-shell): AdminSidebar with pathname-driven active state"
```

---

### Task 2.2: AdminShell + collapse behavior + integration test

**Files:**
- Create: `src/components/admin-shell/AdminShell.tsx`
- Create: `src/__tests__/components/admin-shell/AdminShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/__tests__/components/admin-shell/AdminShell.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminShell } from "@/components/admin-shell/AdminShell";

// Next.js usePathname mock — must be set via jest.mock for each test
jest.mock("next/navigation", () => ({
  usePathname: jest.fn(),
}));
const { usePathname } = jest.requireMock("next/navigation");

// matchMedia shim for JSDOM
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width: 1280"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

describe("AdminShell", () => {
  beforeEach(() => {
    (usePathname as jest.Mock).mockReturnValue("/admin/users");
  });

  it("renders children", () => {
    render(
      <AdminShell>
        <div>PAGE BODY</div>
      </AdminShell>,
    );
    expect(screen.getByText("PAGE BODY")).toBeInTheDocument();
  });

  it("marks the matching sidebar link as active", () => {
    render(
      <AdminShell>
        <div />
      </AdminShell>,
    );
    const activeLink = screen.getByRole("link", { name: /Users/ });
    expect(activeLink).toHaveAttribute("aria-current", "page");
  });

  it("toggles sidebar collapse when the toggle button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <AdminShell>
        <div />
      </AdminShell>,
    );
    const toggle = screen.getByRole("button", { name: /collapse sidebar/i });
    await user.click(toggle);
    expect(
      screen.getByRole("button", { name: /expand sidebar/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/__tests__/components/admin-shell/AdminShell.test.tsx`
Expected: FAIL — missing module.

- [ ] **Step 3: Implement AdminShell**

```tsx
// src/components/admin-shell/AdminShell.tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { AdminSearch } from "./AdminSearch";

export interface AdminShellProps {
  children: ReactNode;
}

/**
 * Outer layout for every page under `/admin/*`. Provides:
 *   - Left sidebar with nav groups (People / Operations / Audit)
 *   - Top header bar containing the in-shell admin search box
 *   - Main content slot that children render into
 *
 * Pages render their own `<AdminPageHeader>` at the top of their body.
 * AdminShell does not read child props — it's pure chrome.
 *
 * Auto-collapse: below 1280px viewport width the sidebar auto-collapses.
 * State is local — no persistence in phase 1.
 */
export function AdminShell({ children }: AdminShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1280px)");
    // matches = true means viewport is >=1280, so NOT collapsed
    setCollapsed(!mq.matches);
    const onChange = (ev: MediaQueryListEvent) => setCollapsed(!ev.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <AdminSidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-t-border/60 bg-surface/60 px-6 py-3 backdrop-blur-sm">
          <div className="min-w-0 flex-1" />
          <AdminSearch />
        </div>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: AdminSearch stub**

We need a minimal `AdminSearch.tsx` shim so the above compiles. The real implementation happens in Chunk 3. Stub it for now so Chunk 2 ships green:

```tsx
// src/components/admin-shell/AdminSearch.tsx (stub — replaced in Chunk 3)
"use client";

export function AdminSearch() {
  return (
    <div className="h-8 w-64 rounded-lg border border-t-border/60 bg-surface-2 px-3 text-xs text-muted/60 leading-8">
      Search users, roles, activity…
    </div>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx jest src/__tests__/components/admin-shell/AdminShell.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add src/components/admin-shell/AdminShell.tsx src/components/admin-shell/AdminSearch.tsx src/__tests__/components/admin-shell/AdminShell.test.tsx
git commit -m "feat(admin-shell): AdminShell + AdminSearch stub + tests"
```

---

## Chunk 3: Admin search — route + component

### Task 3.1: `/api/admin/search` route

**Files:**
- Create: `src/app/api/admin/search/route.ts`
- Test: `src/__tests__/api/admin-search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/api/admin-search.test.ts
const mockAuth = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockUserFindMany = jest.fn();
const mockActivityFindMany = jest.fn();
const mockBugReportFindMany = jest.fn();

jest.mock("@/auth", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: (...a: unknown[]) => mockUserFindMany(...a) },
    activityLog: { findMany: (...a: unknown[]) => mockActivityFindMany(...a) },
    bugReport: { findMany: (...a: unknown[]) => mockBugReportFindMany(...a) },
  },
  getUserByEmail: (email: string) => mockGetUserByEmail(email),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/search/route";

function req(q: string) {
  return new NextRequest(`http://localhost/api/admin/search?q=${encodeURIComponent(q)}`);
}

describe("GET /api/admin/search", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { email: "admin@photonbrothers.com" } });
    mockGetUserByEmail.mockResolvedValue({ id: "a1", email: "admin@photonbrothers.com", roles: ["ADMIN"] });
    mockUserFindMany.mockResolvedValue([]);
    mockActivityFindMany.mockResolvedValue([]);
    mockBugReportFindMany.mockResolvedValue([]);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(req("zach"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated user is not an admin", async () => {
    mockGetUserByEmail.mockResolvedValue({ id: "u1", email: "zach@photonbrothers.com", roles: ["SERVICE"] });
    const res = await GET(req("zach"));
    expect(res.status).toBe(403);
  });

  it("returns empty shape for empty query", async () => {
    const res = await GET(req(""));
    const body = await res.json();
    expect(body).toEqual({ users: [], roles: [], activity: [], tickets: [] });
  });

  it("searches across all four entity types with take:5 per category", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "u1", email: "nick@x.com", name: "Nick" }]);
    mockActivityFindMany.mockResolvedValue([
      { id: "a1", type: "LOGIN", description: "Nick logged in", userEmail: "nick@x.com", createdAt: new Date() },
    ]);
    mockBugReportFindMany.mockResolvedValue([]);
    const res = await GET(req("nick"));
    const body = await res.json();
    expect(body.users).toHaveLength(1);
    expect(body.activity).toHaveLength(1);
    expect(body.tickets).toHaveLength(0);
    // role matches are computed from the static ROLES map, not Prisma
    expect(Array.isArray(body.roles)).toBe(true);
    expect(mockUserFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it("returns partial results when one query errors", async () => {
    mockUserFindMany.mockResolvedValue([{ id: "u1", email: "a@b.com", name: "A" }]);
    mockActivityFindMany.mockRejectedValue(new Error("DB blip"));
    const res = await GET(req("a"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.users).toHaveLength(1);
    expect(body.activity).toEqual([]); // partial failure
  });

  it("matches roles by label or key", async () => {
    const res = await GET(req("admin"));
    const body = await res.json();
    // ROLES.ADMIN has label "Administrator" (or similar) — match expects non-empty
    expect(body.roles.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/__tests__/api/admin-search.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/admin/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma, getUserByEmail } from "@/lib/db";
import { ROLES } from "@/lib/roles";
import type { UserRole } from "@/generated/prisma/enums";

const TAKE_PER_CATEGORY = 5;
const ACTIVITY_WINDOW_DAYS = 30;

interface SearchUser {
  id: string;
  email: string;
  name: string | null;
}
interface SearchRole {
  role: UserRole;
  label: string;
}
interface SearchActivity {
  id: string;
  type: string;
  description: string;
  userEmail: string | null;
  createdAt: string;
}
interface SearchTicket {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}
interface SearchResponse {
  users: SearchUser[];
  roles: SearchRole[];
  activity: SearchActivity[];
  tickets: SearchTicket[];
}

/**
 * GET /api/admin/search?q=<query>
 *
 * Admin-only. Returns up to TAKE_PER_CATEGORY matches across four entity
 * types for a single query string. Partial failures in any one category
 * degrade to an empty array for that category so the dropdown stays useful
 * if e.g. the activity log query times out.
 *
 * Route is already admin-gated via the `/api/admin` prefix in
 * `ADMIN_ONLY_ROUTES`. The handler re-checks from a fresh DB read because
 * the JWT role can be stale (matches the pattern in `/api/admin/users`).
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const currentUser = await getUserByEmail(session.user.email);
  if (!currentUser || !currentUser.roles?.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const empty: SearchResponse = { users: [], roles: [], activity: [], tickets: [] };

  if (!q) {
    return NextResponse.json(empty);
  }
  if (!prisma) {
    return NextResponse.json(empty);
  }

  const db = prisma;
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const insensitive = { contains: q, mode: "insensitive" as const };

  const [users, activity, tickets] = await Promise.all([
    db.user
      .findMany({
        where: {
          OR: [{ email: insensitive }, { name: insensitive }],
        },
        select: { id: true, email: true, name: true },
        take: TAKE_PER_CATEGORY,
      })
      .catch((e: unknown) => {
        console.error("[admin-search] user query failed:", e);
        return [] as SearchUser[];
      }),
    db.activityLog
      .findMany({
        where: {
          createdAt: { gte: since },
          OR: [{ description: insensitive }, { userEmail: insensitive }],
        },
        select: { id: true, type: true, description: true, userEmail: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: TAKE_PER_CATEGORY,
      })
      .catch((e: unknown) => {
        console.error("[admin-search] activity query failed:", e);
        return [];
      }),
    db.bugReport
      .findMany({
        where: { OR: [{ title: insensitive }, { description: insensitive }] },
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: TAKE_PER_CATEGORY,
      })
      .catch((e: unknown) => {
        console.error("[admin-search] ticket query failed:", e);
        return [];
      }),
  ]);

  const qLower = q.toLowerCase();
  const roles: SearchRole[] = (Object.entries(ROLES) as Array<[UserRole, (typeof ROLES)[UserRole]]>)
    .filter(([role, def]) =>
      role.toLowerCase().includes(qLower) ||
      def.label.toLowerCase().includes(qLower),
    )
    .slice(0, TAKE_PER_CATEGORY)
    .map(([role, def]) => ({ role, label: def.label }));

  const response: SearchResponse = {
    users: users.map((u) => ({ id: u.id, email: u.email, name: u.name })),
    roles,
    activity: activity.map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description,
      userEmail: a.userEmail,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    })),
    tickets: tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
    })),
  };

  return NextResponse.json(response);
}
```

- [ ] **Step 4: Run the test**

Run: `npx jest src/__tests__/api/admin-search.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/search/route.ts src/__tests__/api/admin-search.test.ts
git commit -m "feat(admin-shell): /api/admin/search route + tests"
```

---

### Task 3.2: AdminSearch component (replaces stub)

**Files:**
- Modify: `src/components/admin-shell/AdminSearch.tsx` (replace stub)
- Create: `src/__tests__/components/admin-shell/AdminSearch.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/__tests__/components/admin-shell/AdminSearch.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminSearch } from "@/components/admin-shell/AdminSearch";

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      users: [{ id: "u1", email: "nick@x.com", name: "Nick" }],
      roles: [{ role: "ADMIN", label: "Administrator" }],
      activity: [],
      tickets: [],
    }),
  });
});

describe("AdminSearch", () => {
  it("renders with aria combobox role", () => {
    render(<AdminSearch />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("debounces input and queries /api/admin/search", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(
      () => expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/admin/search?q=nick"),
        expect.anything(),
      ),
      { timeout: 500 },
    );
  });

  it("renders results in a listbox", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    expect(screen.getByText("nick@x.com")).toBeInTheDocument();
    expect(screen.getByText("Administrator")).toBeInTheDocument();
  });

  it("closes the dropdown on Escape", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("moves aria-activedescendant on ArrowDown", async () => {
    const user = userEvent.setup();
    render(<AdminSearch />);
    await user.type(screen.getByRole("combobox"), "nick");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument());
    await user.keyboard("{ArrowDown}");
    const combobox = screen.getByRole("combobox");
    expect(combobox.getAttribute("aria-activedescendant")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/components/admin-shell/AdminSearch.test.tsx`
Expected: FAIL (stub component has no combobox role, listbox, etc.).

- [ ] **Step 3: Implement AdminSearch (replace stub)**

```tsx
// src/components/admin-shell/AdminSearch.tsx
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchUser {
  id: string;
  email: string;
  name: string | null;
}
interface SearchRole {
  role: string;
  label: string;
}
interface SearchActivity {
  id: string;
  type: string;
  description: string;
  userEmail: string | null;
  createdAt: string;
}
interface SearchTicket {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}
interface SearchResponse {
  users: SearchUser[];
  roles: SearchRole[];
  activity: SearchActivity[];
  tickets: SearchTicket[];
}

interface Flattened {
  key: string;
  label: string;
  detail: string;
  href: string;
  group: "Users" | "Roles" | "Activity" | "Tickets";
}

const DEBOUNCE_MS = 200;
const EMPTY_GRACE_MS = 300;

function flatten(r: SearchResponse): Flattened[] {
  const out: Flattened[] = [];
  for (const u of r.users) {
    out.push({
      key: `u-${u.id}`,
      label: u.name || u.email,
      detail: u.email,
      href: `/admin/users?userId=${encodeURIComponent(u.id)}`,
      group: "Users",
    });
  }
  for (const role of r.roles) {
    out.push({
      key: `r-${role.role}`,
      label: role.label,
      detail: role.role,
      href: `/admin/roles/${encodeURIComponent(role.role)}`,
      group: "Roles",
    });
  }
  for (const a of r.activity) {
    out.push({
      key: `a-${a.id}`,
      label: a.description,
      detail: `${a.userEmail ?? "system"} · ${a.type}`,
      href: `/admin/activity?type=${encodeURIComponent(a.type)}`,
      group: "Activity",
    });
  }
  for (const t of r.tickets) {
    out.push({
      key: `t-${t.id}`,
      label: t.title,
      detail: t.status,
      href: `/admin/tickets?ticketId=${encodeURIComponent(t.id)}`,
      group: "Tickets",
    });
  }
  return out;
}

/**
 * In-shell admin search. Lives in the AdminShell header. Queries
 * /api/admin/search with debounce + keyboard nav + aria combobox/listbox.
 * On Enter / click, navigates to the appropriate admin URL.
 */
export function AdminSearch() {
  const router = useRouter();
  const listboxId = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Flattened[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced fetch
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setError(null);
      setShowEmpty(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}`, {
          credentials: "same-origin",
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = (await res.json()) as SearchResponse;
        if (cancelled) return;
        const flat = flatten(data);
        setResults(flat);
        setError(null);
        setActiveIdx(0);
        if (flat.length === 0) {
          setTimeout(() => !cancelled && setShowEmpty(true), EMPTY_GRACE_MS);
        } else {
          setShowEmpty(false);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const showList = open && q.trim().length > 0;

  function handleKeyDown(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (ev.key === "ArrowDown" && results.length > 0) {
        setOpen(true);
      }
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      setOpen(false);
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      const pick = results[activeIdx];
      if (pick) {
        setOpen(false);
        setQ("");
        router.push(pick.href);
      }
    }
  }

  const activeId = showList && results[activeIdx] ? `${listboxId}-${results[activeIdx].key}` : undefined;

  return (
    <div ref={containerRef} className="relative w-64 shrink-0">
      <input
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        placeholder="Search users, roles, activity…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="h-8 w-full rounded-lg border border-t-border/60 bg-surface-2 px-3 text-xs text-foreground placeholder:text-muted focus:border-t-border focus:outline-none"
      />
      {showList && (
        <div className="absolute right-0 mt-1 w-96 rounded-lg border border-t-border/60 bg-surface-elevated shadow-xl">
          {error && (
            <p className="px-3 py-2 text-xs text-red-400">{error}</p>
          )}
          {!error && results.length === 0 && showEmpty && (
            <p className="px-3 py-2 text-xs text-muted">No results</p>
          )}
          {results.length > 0 && (
            <ul id={listboxId} role="listbox" className="max-h-80 overflow-y-auto py-1">
              {results.map((r, idx) => (
                <li
                  key={r.key}
                  id={`${listboxId}-${r.key}`}
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    router.push(r.href);
                  }}
                  className={`cursor-pointer px-3 py-2 text-xs ${
                    idx === activeIdx ? "bg-surface-2" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-foreground">{r.label}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted">
                      {r.group}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-muted">{r.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx jest src/__tests__/components/admin-shell/AdminSearch.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin-shell/AdminSearch.tsx src/__tests__/components/admin-shell/AdminSearch.test.tsx
git commit -m "feat(admin-shell): AdminSearch (debounce + a11y + keyboard nav) + tests"
```

---

## Chunk 4: Layout wiring + new /admin landing page

### Task 4.1: Wire `/admin/layout.tsx`

**Files:**
- Create: `src/app/admin/layout.tsx`

- [ ] **Step 1: Implement the layout**

```tsx
// src/app/admin/layout.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import { AdminShell } from "@/components/admin-shell/AdminShell";

/**
 * Applies the AdminShell chrome to every `/admin/*` page.
 *
 * Auth: middleware already gates `/admin` as admin-only via ADMIN_ONLY_ROUTES.
 * We also do a server-side check here so a stale JWT can't bypass it — admin
 * access is high-risk enough to warrant the double check (matches the pattern
 * in each admin page today).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?callbackUrl=/admin");
  if (!user.roles?.includes("ADMIN")) redirect("/unassigned");

  return <AdminShell>{children}</AdminShell>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat(admin-shell): wire /admin/layout.tsx with AdminShell + auth gate"
```

---

### Task 4.2: New `/admin` landing page

**Files:**
- Create: `src/app/admin/page.tsx` (replacing the current redirect to `/suites/admin`)

Prior to this task, `src/app/admin/page.tsx` does not exist — visiting `/admin` currently hits the fallback (redirect or 404 depending on the project's routing). Verify first:

- [ ] **Step 1: Confirm no existing `/admin/page.tsx` — skip if present**

```bash
ls src/app/admin/page.tsx 2>/dev/null
```
If the file exists with a redirect, keep the old body in git so we can reference it, but overwrite with the new landing.

- [ ] **Step 2: Implement the landing page**

```tsx
// src/app/admin/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import type { ActivityType } from "@/generated/prisma/enums";

const ADMIN_ACTIVITY_TYPES: ActivityType[] = [
  "USER_ROLE_CHANGED",
  "USER_PERMISSIONS_CHANGED",
  "USER_CREATED",
  "USER_DELETED",
  "ROLE_CAPABILITIES_CHANGED",
  "ROLE_CAPABILITIES_RESET",
  "USER_EXTRA_ROUTES_CHANGED",
  "SETTINGS_CHANGED",
];

async function loadOverview() {
  if (!prisma) {
    return {
      usersTotal: null as number | null,
      usersActive7d: null as number | null,
      riskEvents7d: null as number | null,
      lastRiskAt: null as Date | null,
      openTickets: null as number | null,
      activity: [] as Array<{
        id: string;
        type: string;
        description: string;
        userEmail: string | null;
        createdAt: Date;
        entityType: string | null;
        entityId: string | null;
        entityName: string | null;
      }>,
      errors: { users: true, risk: true, tickets: true, activity: true },
    };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    usersTotal,
    usersActive7d,
    riskEvents7d,
    lastRiskRow,
    openTickets,
    activity,
  ] = await Promise.all([
    prisma.user.count().catch(() => null),
    prisma.user.count({ where: { lastLoginAt: { gt: sevenDaysAgo } } }).catch(() => null),
    prisma.activityLog
      .count({
        where: {
          riskLevel: { in: ["HIGH", "CRITICAL"] },
          createdAt: { gt: sevenDaysAgo },
        },
      })
      .catch(() => null),
    prisma.activityLog
      .findFirst({
        where: {
          riskLevel: { in: ["HIGH", "CRITICAL"] },
          createdAt: { gt: sevenDaysAgo },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      })
      .catch(() => null),
    prisma.bugReport
      .count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } })
      .catch(() => null),
    prisma.activityLog
      .findMany({
        where: { type: { in: ADMIN_ACTIVITY_TYPES } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          type: true,
          description: true,
          userEmail: true,
          createdAt: true,
          entityType: true,
          entityId: true,
          entityName: true,
        },
      })
      .catch(() => [] as never[]),
  ]);

  return {
    usersTotal,
    usersActive7d,
    riskEvents7d,
    lastRiskAt: lastRiskRow?.createdAt ?? null,
    openTickets,
    activity,
    errors: {
      users: usersTotal === null,
      risk: riskEvents7d === null,
      tickets: openTickets === null,
      activity: false,
    },
  };
}

function formatRelative(date: Date): string {
  const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function entityHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId) return null;
  if (entityType === "user") return `/admin/users?userId=${encodeURIComponent(entityId)}`;
  if (entityType === "role") return `/admin/roles/${encodeURIComponent(entityId)}`;
  return null;
}

export default async function AdminLandingPage() {
  const data = await loadOverview();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Admin"
        breadcrumb={["Admin"]}
        subtitle="Overview of admin-relevant activity across the system."
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          label="Users"
          primary={data.usersTotal !== null ? String(data.usersTotal) : "—"}
          detail={
            data.usersActive7d !== null
              ? `${data.usersActive7d} active in last 7d`
              : "Data unavailable"
          }
          errored={data.errors.users}
        />
        <KpiTile
          label="Risk events (7d)"
          primary={data.riskEvents7d !== null ? String(data.riskEvents7d) : "—"}
          detail={
            data.lastRiskAt
              ? `HIGH · last: ${formatRelative(data.lastRiskAt)}`
              : data.errors.risk
                ? "Data unavailable"
                : "None in last 7d"
          }
          errored={data.errors.risk}
          accent="risk"
        />
        <KpiTile
          label="Open bug tickets"
          primary={data.openTickets !== null ? String(data.openTickets) : "—"}
          detail={data.errors.tickets ? "Data unavailable" : "0 flagged urgent"}
          errored={data.errors.tickets}
        />
      </div>

      {/* Recent admin activity */}
      <section className="rounded-lg border border-t-border/60 bg-surface">
        <header className="flex items-center justify-between border-b border-t-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Recent admin activity</h2>
          <Link href="/admin/activity" className="text-xs text-muted hover:text-foreground">
            View all →
          </Link>
        </header>
        {data.activity.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted">No admin activity yet.</p>
        ) : (
          <ul className="divide-y divide-t-border/60">
            {data.activity.map((a) => {
              const href = entityHref(a.entityType, a.entityId);
              return (
                <li key={a.id} className="px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-foreground">{a.description}</span>
                    <span className="shrink-0 text-muted">{formatRelative(a.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                    <span className="font-mono">{a.type}</span>
                    {a.userEmail && <span>· by {a.userEmail}</span>}
                    {href && a.entityName && (
                      <Link href={href} className="text-foreground/80 hover:text-foreground">
                        · {a.entityName}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiTile({
  label,
  primary,
  detail,
  errored,
  accent,
}: {
  label: string;
  primary: string;
  detail: string;
  errored: boolean;
  accent?: "risk";
}) {
  return (
    <div className="rounded-lg border border-t-border/60 bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${
          accent === "risk" && !errored && primary !== "0" && primary !== "—"
            ? "text-orange-400"
            : "text-foreground"
        }`}
      >
        {primary}
      </p>
      <p className={`mt-1 text-xs ${errored ? "text-red-400" : "text-muted"}`}>{detail}</p>
    </div>
  );
}
```

- [ ] **Step 3: Run build to verify it compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/app/admin/(page|layout)\.tsx' | head`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "feat(admin-shell): new /admin landing page (KPI tiles + activity feed)"
```

---

## Chunk 5: Migrate the 9 existing admin pages

This chunk is mechanical: each page drops its outer DashboardShell (if any), adds `<AdminPageHeader>`, and swaps ad-hoc empty/error UI for the primitives.

**Per-page pattern:**

1. Remove `import DashboardShell from "@/components/DashboardShell"` where present.
2. Remove the `<DashboardShell title=… accentColor=…>` wrapper; return its children directly.
3. Import `AdminPageHeader` from `@/components/admin-shell/AdminPageHeader`.
4. Add `<AdminPageHeader title="…" breadcrumb={[…]} actions={…} />` at the top of the rendered JSX.
5. Replace any ad-hoc "no results" / "error" / "loading" UI with the primitives.
6. Add cross-link / query-param changes as documented below per page.
7. Commit per page.

All 9 pages stay in place (same URLs). None change their data fetching.

---

### Task 5.1: `/admin/users`

**Files:**
- Modify: `src/app/admin/users/page.tsx`

- [ ] **Step 1: Remove any DashboardShell wrapping + add AdminPageHeader**

```tsx
// Near top of file, replace imports:
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";

// In the rendered output, wrap the body with AdminPageHeader at top:
return (
  <>
    <AdminPageHeader
      title="Users"
      breadcrumb={["Admin", "People", "Users"]}
      actions={
        <button onClick={/* existing "Sync Google Workspace" handler */} className="…">
          Sync Workspace
        </button>
      }
    />
    {/* existing page body unchanged */}
  </>
);
```

- [ ] **Step 2: Consume `?userId=` query param to scroll-to + open edit modal**

Inside the component (already `"use client"`):

```tsx
import { useSearchParams } from "next/navigation";
// ...
const searchParams = useSearchParams();
const deepLinkedUserId = searchParams.get("userId");
useEffect(() => {
  if (!deepLinkedUserId || users.length === 0) return;
  const target = users.find((u) => u.id === deepLinkedUserId);
  if (!target) return;
  openPermissionsModal(target); // existing handler that opens the edit modal
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-user-id="${deepLinkedUserId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}, [deepLinkedUserId, users]);
```

Add `data-user-id={u.id}` on each user row's container.

- [ ] **Step 3: Add "View activity" link on each user row**

In the user row JSX, add:

```tsx
<Link
  href={`/admin/activity?userId=${encodeURIComponent(u.id)}`}
  className="text-xs text-muted hover:text-foreground"
>
  Activity
</Link>
```

- [ ] **Step 4: Run the project locally (optional smoke)**

Skip for the subagent — we'll do end-to-end smoke in Chunk 7.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/users/page.tsx
git commit -m "refactor(admin-shell): /admin/users adopts AdminShell + deep-link + activity cross-link"
```

---

### Task 5.2: `/admin/roles`

**Files:**
- Modify: `src/app/admin/roles/page.tsx`

- [ ] **Step 1: Remove DashboardShell and add AdminPageHeader**

```tsx
// Replace:
//   import DashboardShell from "@/components/DashboardShell";
//   <DashboardShell title="Role Inspector" accentColor="orange">…</DashboardShell>
// With:
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
// ...
return (
  <div className="space-y-6">
    <AdminPageHeader
      title="Role Inspector"
      breadcrumb={["Admin", "People", "Roles"]}
    />
    {/* the existing roles body unchanged */}
  </div>
);
```

- [ ] **Step 2: Add "users with this role" cross-link**

Within each `RoleCard`:

```tsx
<Link
  href={`/admin/users?role=${encodeURIComponent(role)}`}
  className="text-xs text-muted hover:text-foreground"
>
  Users with this role →
</Link>
```

Keep the existing "Edit capabilities" link; this is additive.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/roles/page.tsx
git commit -m "refactor(admin-shell): /admin/roles adopts AdminShell + users cross-link"
```

---

### Task 5.3: `/admin/roles/[role]`

**Files:**
- Modify: `src/app/admin/roles/[role]/page.tsx`

- [ ] **Step 1: Remove DashboardShell and add AdminPageHeader**

```tsx
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
// ...
return (
  <div className="space-y-6">
    <AdminPageHeader
      title={`Role · ${role}`}
      breadcrumb={["Admin", "People", "Roles", role]}
    />
    {/* existing body */}
  </div>
);
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/roles/[role]/page.tsx
git commit -m "refactor(admin-shell): /admin/roles/[role] adopts AdminShell"
```

---

### Task 5.4: `/admin/directory`

**Files:**
- Modify: `src/app/admin/directory/page.tsx`

- [ ] **Step 1: Replace top-level wrapper and add AdminPageHeader**

```tsx
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
// ...
return (
  <div className="space-y-6">
    <AdminPageHeader title="Page Directory" breadcrumb={["Admin", "People", "Directory"]} />
    {/* existing directory body */}
  </div>
);
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/directory/page.tsx
git commit -m "refactor(admin-shell): /admin/directory adopts AdminShell"
```

---

### Task 5.5: `/admin/crew-availability`

**Files:**
- Modify: `src/app/admin/crew-availability/page.tsx`

- [ ] **Step 1: Add AdminPageHeader at top**

```tsx
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
// ...
return (
  <>
    <AdminPageHeader title="Crew Availability" breadcrumb={["Admin", "Operations", "Crew availability"]} />
    {/* existing body */}
  </>
);
```

- [ ] **Step 2: Replace any "no crew members" / "no availability" empty states with `<AdminEmpty>`**

Find the hardcoded empty messages and swap in:

```tsx
import { AdminEmpty } from "@/components/admin-shell/AdminEmpty";
// ...
<AdminEmpty label="No crew members found" description="Sync from Zuper to import crews." />
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/crew-availability/page.tsx
git commit -m "refactor(admin-shell): /admin/crew-availability adopts AdminShell + empty primitive"
```

---

### Task 5.6: `/admin/tickets`

**Files:**
- Modify: `src/app/admin/tickets/page.tsx`

- [ ] **Step 1: Add AdminPageHeader + consume `?ticketId=`**

```tsx
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { useSearchParams } from "next/navigation";
// ...
const searchParams = useSearchParams();
const deepLinkedTicketId = searchParams.get("ticketId");
useEffect(() => {
  if (!deepLinkedTicketId || tickets.length === 0) return;
  const t = tickets.find((x) => x.id === deepLinkedTicketId);
  if (t) setSelectedTicket(t); // existing state setter that opens the detail view
}, [deepLinkedTicketId, tickets]);

// At top of return:
return (
  <>
    <AdminPageHeader title="Bug Tickets" breadcrumb={["Admin", "Operations", "Tickets"]} />
    {/* existing body */}
  </>
);
```

- [ ] **Step 2: Swap empty state for `<AdminEmpty>`**

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/tickets/page.tsx
git commit -m "refactor(admin-shell): /admin/tickets adopts AdminShell + deep-link"
```

---

### Task 5.7: `/admin/activity`

**Files:**
- Modify: `src/app/admin/activity/page.tsx`

- [ ] **Step 1: Add AdminPageHeader + consume `?userId=` and `?type=`**

```tsx
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
import { useSearchParams } from "next/navigation";
// Near existing filter-state setup:
const searchParams = useSearchParams();
useEffect(() => {
  const urlUserId = searchParams.get("userId");
  const urlType = searchParams.get("type");
  if (urlUserId) setFilterUserId(urlUserId);  // adjust name to match existing state
  if (urlType) setFilterType([urlType]);       // adjust shape to the multi-select pattern
}, [searchParams]);

return (
  <>
    <AdminPageHeader title="Activity Log" breadcrumb={["Admin", "Audit", "Activity log"]} />
    {/* existing body */}
  </>
);
```

- [ ] **Step 2: Clickable `entityName` for user/role entities**

Where the table renders `entityName`:

```tsx
{activity.entityType === "user" && activity.entityId ? (
  <Link href={`/admin/users?userId=${encodeURIComponent(activity.entityId)}`}>
    {activity.entityName}
  </Link>
) : activity.entityType === "role" && activity.entityId ? (
  <Link href={`/admin/roles/${encodeURIComponent(activity.entityId)}`}>
    {activity.entityName}
  </Link>
) : (
  activity.entityName ?? "—"
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/activity/page.tsx
git commit -m "refactor(admin-shell): /admin/activity adopts AdminShell + deep-link + entity links"
```

---

### Task 5.8: `/admin/audit`

**Files:**
- Modify: `src/app/admin/audit/page.tsx`

- [ ] **Step 1: Remove DashboardShell, add AdminPageHeader**

```tsx
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
// ...
return (
  <>
    <AdminPageHeader title="Audit Sessions" breadcrumb={["Admin", "Audit", "Audit sessions"]} />
    {/* existing body */}
  </>
);
```

- [ ] **Step 2: Link `userEmail` to `/admin/users?userId=<id>` where the userId is available**

Only add the link if the session row has a resolvable user id. If only email is stored, leave it as a plain string (no guessing).

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/audit/page.tsx
git commit -m "refactor(admin-shell): /admin/audit adopts AdminShell + user cross-link"
```

---

### Task 5.9: `/admin/security`

**Files:**
- Modify: `src/app/admin/security/page.tsx`

- [ ] **Step 1: Add AdminPageHeader**

```tsx
import { AdminPageHeader } from "@/components/admin-shell/AdminPageHeader";
// ...
return (
  <>
    <AdminPageHeader title="Security" breadcrumb={["Admin", "Audit", "Security alerts"]} />
    {/* existing body */}
  </>
);
```

- [ ] **Step 2: Swap empty states for `<AdminEmpty>`**

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/security/page.tsx
git commit -m "refactor(admin-shell): /admin/security adopts AdminShell"
```

---

## Chunk 6: Build + full test pass

### Task 6.1: TypeScript + build

- [ ] **Step 1: Run tsc**

Run: `npx tsc --noEmit 2>&1 | grep -v __tests__ | grep "error TS"`
Expected: no errors.

If errors exist in the migrated pages (likely pattern: old props that were passed to DashboardShell are now dead), remove them.

- [ ] **Step 2: Run `npm run build`**

Run: `npm run build`
Expected: success. In the route list, confirm:
- `/admin` is listed (the new landing)
- `/admin/layout.tsx` is picked up (reflected in `.next/server/app/admin/layout.js`)
- `/api/admin/search` is listed

- [ ] **Step 3: Run targeted test suites**

Run:
```
npx jest \
  src/__tests__/components/admin-shell/ \
  src/__tests__/api/admin-search.test.ts
```
Expected: all passing.

- [ ] **Step 4: Commit any fixups**

If any fixups were needed:

```bash
git add -A
git commit -m "fix(admin-shell): resolve post-migration type + build errors"
```

---

### Task 6.2: Final wiring check

- [ ] **Step 1: Verify layout covers all children**

Confirm there's a single `src/app/admin/layout.tsx` and each page under `src/app/admin/*/page.tsx` renders its own body (no surprise top-level wrappers).

- [ ] **Step 2: Confirm no page uses `<DashboardShell>` under `/admin`**

Use the Grep tool (or `grep -rn "DashboardShell" src/app/admin`).
Expected: no matches outside tests.

- [ ] **Step 3: Confirm no page renders its own `<html>`, `<body>`, or global styles**

Use the Grep tool with pattern `<(html|body)\\b` over `src/app/admin`.
Expected: no matches.

---

## Chunk 7: Self-review + ship

### Task 7.1: Self-review via code-review skill

- [ ] **Step 1: Push the branch**

```bash
git push -u origin spec/admin-suite-redesign
```

- [ ] **Step 2: Open PR**

Title: `feat(admin): unified AdminShell + /admin landing + search (phase 1 IA)`

Body: summary from the spec, test plan checklist, link to spec doc.

- [ ] **Step 3: Run the `code-review:code-review` skill against the PR**

The skill loads full agent orchestration (CLAUDE.md compliance, bug scan, git history, prior PR comments, inline comments). Feed it the PR number + spec doc path. Fix anything scoring ≥80 confidence. For anything below 80, note why it's not blocking.

- [ ] **Step 4: Verify Vercel preview deploy is green**

Wait for Vercel preview READY. Visit the preview URL, smoke-test:
- `/admin` landing renders; KPI tiles populated
- Click each sidebar item; active state follows
- Collapse / expand toggle works
- Type in search box; dropdown appears; arrow keys move selection; Enter navigates
- `/admin/users?userId=<some-real-id>` scrolls + opens modal
- `/admin/activity?type=USER_ROLE_CHANGED` loads with filter applied

- [ ] **Step 5: Merge**

```bash
gh pr merge --squash --delete-branch --admin
```

---

### Task 7.2: Cleanup

- [ ] **Step 1: Stop the brainstorm visual companion server**

```bash
/Users/zach/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.2/skills/brainstorming/scripts/stop-server.sh "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite/.superpowers/brainstorm/97107-1776531915"
```

- [ ] **Step 2: Follow-up tracking**

Anything that comes up during code review or smoke test that is NOT blocking for this PR gets a `spawn_task` or a line in `docs/superpowers/followups/`. Do not scope-creep this PR.

---

## Done state

After all chunks complete:
- 9 admin pages share the `<AdminShell>` layout
- `/admin` has a functional landing page
- In-shell search works across users / roles / activity / tickets
- Cross-links connect users ↔ activity, roles ↔ users, audit → users
- All tests pass; `npm run build` is green; Vercel prod deploy is READY
- The `<AdminShell>` pattern is ready to reuse for Operations/Engineering/Service shells in phase 2+

A separate brainstorm — not this plan — picks up the Lifecycle-vs-Workflow-vs-Department question for the rest of the app after the admin shell has been in prod for a week.
