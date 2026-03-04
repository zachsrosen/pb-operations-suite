# Dashboard Reorganization Design

**Date:** 2026-03-02
**Status:** Draft

## Summary

Three dashboard changes: relocate Project Management out of D&E, regroup P&I Metrics within its suite, and replace the Solar Surveyor prototype with the live Vercel site.

## Changes

### 1. Project Management → Intelligence Suite (temporary)

**Current:** `/dashboards/project-management` in D&E Suite under "Analytics" section.
**New:** Listed in Intelligence Suite.

> **Note:** Intelligence Suite is slated for dissolution. PM lives here temporarily until a permanent home is decided. This move simply removes it from D&E where it doesn't belong.

**Role/discoverability impact:**
- TECH_OPS, DESIGNER, PERMITTING lose suite-level discovery (they have D&E access but not Intelligence access)
- Direct URL `/dashboards/project-management` still works for all authenticated users — no route-level gate
- OPERATIONS_MANAGER gains discovery (has Intelligence but not D&E)
- Accepted as intentional given Intelligence Suite's impending dissolution

**Files:**
- `src/app/suites/design-engineering/page.tsx` — remove PM card from "Analytics" section
- `src/app/suites/intelligence/page.tsx` — add PM card
- `src/components/DashboardShell.tsx` — update `SUITE_MAP` entry: `/dashboards/project-management` → intelligence

### 2. P&I Metrics → "Analytics" section within P&I Suite

**Current:** `/dashboards/pi-metrics` in P&I Suite under "Pipeline" section.
**New:** Moved to "Analytics" section (alongside Timeline & SLA, P&I Dept Analytics).

**Files:**
- `src/app/suites/permitting-interconnection/page.tsx` — move P&I Metrics card from "Pipeline" to "Analytics" section

### 3. Solar Surveyor — replace prototype with live site

**Current:** Embeds `/prototypes/solar-surveyor-v11.html` with a pink "PROTOTYPE" badge.
**New:** Embeds `https://solarsurveyor.vercel.app` as iframe. Remove PROTOTYPE badge.

**Embed compatibility (verified):**
- Target site (`solarsurveyor.vercel.app`): No `X-Frame-Options` or CSP `frame-ancestors` headers — allows framing
- This app's CSP: `default-src 'self'` with no `frame-src` — **must add** `frame-src 'self' https://solarsurveyor.vercel.app`

**Files:**
- `src/app/dashboards/solar-surveyor/page.tsx` — change iframe src, remove PROTOTYPE badge, update title
- `src/middleware.ts` — add `frame-src 'self' https://solarsurveyor.vercel.app;` to CSP header

## Out of scope

- Intelligence Suite dissolution (separate effort)
- Permanent home for Project Management dashboard
- Route-level access gating changes
- Cleanup of `/public/prototypes/solar-surveyor-v11.html` (can be done later)
