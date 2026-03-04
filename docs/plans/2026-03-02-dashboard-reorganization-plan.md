# Dashboard Reorganization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Relocate Project Management to Intelligence Suite, regroup P&I Metrics into Analytics section, and replace Solar Surveyor prototype with live Vercel site.

**Architecture:** Three independent config/UI changes across suite pages, DashboardShell breadcrumb mappings, the Solar Surveyor page component, and the middleware CSP header. No database or API changes.

**Tech Stack:** Next.js pages (React server components), middleware.ts (security headers)

**Design doc:** `docs/plans/2026-03-02-dashboard-reorganization-design.md`

---

### Task 1: Move Project Management card from D&E to Intelligence Suite

**Files:**
- Modify: `src/app/suites/design-engineering/page.tsx:71-77`
- Modify: `src/app/suites/intelligence/page.tsx:5-53`

**Step 1: Remove PM card from D&E suite**

In `src/app/suites/design-engineering/page.tsx`, delete the Project Management card object (lines 71-77):

```tsx
  // DELETE this entire card object from the LINKS array:
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Analytics",
  },
```

**Step 2: Add PM card to Intelligence suite**

In `src/app/suites/intelligence/page.tsx`, add this card to the end of the `LINKS` array (before the closing `];`):

```tsx
  {
    href: "/dashboards/project-management",
    title: "Project Management",
    description: "PM workload, DA backlog, stuck deals, and revenue tracking.",
    tag: "PM",
    tagColor: "bg-green-500/20 text-green-400 border-green-500/30",
    section: "Management",
  },
```

**Step 3: Verify both suite pages render**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds, no errors related to suite pages.

**Step 4: Commit**

```bash
git add src/app/suites/design-engineering/page.tsx src/app/suites/intelligence/page.tsx
git commit -m "feat: move Project Management dashboard from D&E to Intelligence suite"
```

---

### Task 2: Update DashboardShell breadcrumb mapping for Project Management

**Files:**
- Modify: `src/components/DashboardShell.tsx:65`

**Step 1: Update SUITE_MAP entry**

In `src/components/DashboardShell.tsx`, find line 65:

```tsx
  "/dashboards/project-management": { href: "/suites/design-engineering", label: "D&E" },
```

Replace with:

```tsx
  "/dashboards/project-management": { href: "/suites/intelligence", label: "Intelligence" },
```

**Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/components/DashboardShell.tsx
git commit -m "fix: update PM dashboard breadcrumb to point to Intelligence suite"
```

---

### Task 3: Move P&I Metrics to Analytics section within P&I Suite

**Files:**
- Modify: `src/app/suites/permitting-interconnection/page.tsx:13-18`

**Step 1: Change section from "Pipeline" to "Analytics"**

In `src/app/suites/permitting-interconnection/page.tsx`, find the P&I Metrics card (lines 13-18):

```tsx
  {
    href: "/dashboards/pi-metrics",
    title: "P&I Metrics",
    description: "Permits submitted/issued/pending, interconnection apps, PTO status, revenue and deal counts.",
    tag: "METRICS",
    section: "Pipeline",
  },
```

Change `section: "Pipeline"` to `section: "Analytics"`:

```tsx
  {
    href: "/dashboards/pi-metrics",
    title: "P&I Metrics",
    description: "Permits submitted/issued/pending, interconnection apps, PTO status, revenue and deal counts.",
    tag: "METRICS",
    section: "Analytics",
  },
```

**Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/app/suites/permitting-interconnection/page.tsx
git commit -m "feat: move P&I Metrics to Analytics section within P&I suite"
```

---

### Task 4: Add frame-src to CSP for Solar Surveyor embed

**Files:**
- Modify: `src/middleware.ts:60-63`

**Step 1: Add frame-src directive to CSP header**

In `src/middleware.ts`, find the CSP header (line 60-63):

```tsx
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
  );
```

Add `frame-src 'self' https://solarsurveyor.vercel.app;` after the `connect-src` directive:

```tsx
  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self' https://solarsurveyor.vercel.app; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
  );
```

**Step 2: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat: add frame-src CSP directive for Solar Surveyor embed"
```

---

### Task 5: Replace Solar Surveyor prototype with live site

**Files:**
- Modify: `src/app/dashboards/solar-surveyor/page.tsx` (full rewrite)

**Step 1: Rewrite the Solar Surveyor page**

Replace the entire contents of `src/app/dashboards/solar-surveyor/page.tsx` with:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

export default async function SolarSurveyorPage() {
  const session = await auth();
  if (!session?.user?.email) redirect("/login?callbackUrl=/dashboards/solar-surveyor");

  const user = await getUserByEmail(session.user.email);
  if (!user) redirect("/");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-t-border px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/suites/design-engineering" className="text-xs text-muted hover:text-foreground transition-colors">
            &larr; D&E Suite
          </Link>
          <span className="text-t-border">|</span>
          <h1 className="text-sm font-semibold text-foreground">Solar Surveyor</h1>
        </div>
        <a
          href="https://solarsurveyor.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted hover:text-orange-400 transition-colors"
        >
          Open in new tab &rarr;
        </a>
      </header>
      <iframe
        src="https://solarsurveyor.vercel.app"
        className="flex-1 w-full border-none"
        title="Solar Surveyor"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
```

Changes from original:
- iframe `src` → `https://solarsurveyor.vercel.app`
- Removed PROTOTYPE badge span
- Title: "Solar Surveyor v11" → "Solar Surveyor"
- "Open in new tab" link → `https://solarsurveyor.vercel.app`
- Added `allow="clipboard-read; clipboard-write"` for clipboard permissions
- iframe `title` → "Solar Surveyor" (no prototype reference)

**Step 2: Update D&E suite card**

In `src/app/suites/design-engineering/page.tsx`, update the Solar Surveyor card (lines 63-69):

```tsx
  // BEFORE:
  {
    href: "/dashboards/solar-surveyor",
    title: "Solar Surveyor",
    description: "Interactive solar site survey prototype tool.",
    tag: "PROTOTYPE",
    tagColor: "bg-pink-500/20 text-pink-400 border-pink-500/30",
    section: "Tools",
  },

  // AFTER:
  {
    href: "/dashboards/solar-surveyor",
    title: "Solar Surveyor",
    description: "Interactive solar site survey tool.",
    tag: "TOOL",
    section: "Tools",
  },
```

Changes: description drops "prototype", tag "PROTOTYPE" → "TOOL", remove pink tagColor (uses suite default).

**Step 3: Verify build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 4: Manual verification after deploy**

After deploying, verify the iframe loads by visiting `/dashboards/solar-surveyor`. Check browser console for CSP violations. If the iframe is blocked, check:
- Browser console for `Refused to frame` errors
- Response headers on `solarsurveyor.vercel.app` for `X-Frame-Options`

**Step 5: Commit**

```bash
git add src/app/dashboards/solar-surveyor/page.tsx src/app/suites/design-engineering/page.tsx
git commit -m "feat: replace Solar Surveyor prototype with live Vercel site"
```

---

### Task 6: Final build verification

**Step 1: Full build**

Run: `npx next build 2>&1 | tail -30`
Expected: Build succeeds with no errors.

**Step 2: Verify all changed files are committed**

Run: `git status`
Expected: Clean working tree, all changes committed.
