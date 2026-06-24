# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-24

### Workflow Map (Major)
- New Workflow Map dashboard — live HubSpot automation + SOP reference, built from synced workflow/stage/task data
- Zoomable flowchart view rolling up pipelines → stages → workflows with name+status stage mapping and task edges
- Process view: plain-English, expandable end-to-end pipeline walkthrough per stage
- Curated vertical-swimlane layout — Design tracks intertwine, Permitting runs parallel, AND-gate before Stamps branch
- Family-lane stage layout with write-only status mapping; date-stamp plumbing hidden, minimap removed
- Resumable backfill with `maxDuration=300` and admin Build/Re-sync button on the dashboard

### Funnel & Cohort Charts (Major)
- New Milestone Progression cohort chart on the project pipeline funnel
- Pill selector with Sales Closed start, Lifecycle view, chain extended through Closed Out (IC dropped)
- Weekly bins with PE-style sizing and click-to-drill-down on every bar
- Lifecycle surfaces Cancelled and On Hold as their own segments alongside active stages
- Funnel cohorts: on-hold segment, milestone lifecycle, richer drill-downs, renamed labels
- Cohort charts polish: headline summary cards above the chart, drill-down from summary cards, lifecycle DA metric, week/month toggle, segment drill, sort + copy, revenue/count labels placed directly above each bar

### Participate Energy (Major)
- New HubSpot Deal card surfacing live Participate Energy status
- Bill of Materials tracked as its own M1 document — synced to HubSpot, conditionally required (only where PE asks), with "Not Required" as a real status for skipped docs
- Sync button now shared across all PE tabs in the tab bar; "Last synced X ago" reflects the last *successful* PE pull
- "Last submitter" payment-ownership mode on the Doc Uploaders table
- Auto-advance Rejected → Ready to Resubmit when rejection tasks are done; also covers onboarding and internal rejections
- Loosened rejection-task matcher so task names can be renamed freely
- Reviewer notes (`pe_doc_*_notes`) now populated from real `PeActionItem` reviewer comments
- Stopped webhook retry storm that was regenerating duplicate rejection tasks
- Stopped exhausting the PE daily API quota

### PE Reviewer-Notes Reliability (Bug Fixes)
- Doc statuses now push to HubSpot *after* action items are written — the real cause of blank Notes
- Guaranteed reviewer notes on NEW rejections via must-pull-first + retry; status is never held back
- Rejection notes pulled only for new/changed docs, so fresh rejections never sync note-less

### Master Scheduler
- New Construction surveys promoted to their own tab between Ops Surveys and Pre-Sale
- Needs Revisit + New Construction surveys now shown in three groups
- Needs Revisit group no longer empty — stale schedule dates were hiding revisits
- Revisits stay in Ops Surveys after status flips to Ready to Schedule
- DTC office filter no longer hides all survey availability
- Rolando → Lenny Uematsu swap for all Colorado Springs field work

### EagleView Orders
- Design Lead surfaced on each order (was always blank — resolved via owner map)
- Shade files saved as `.zip` with backfill for late-arriving measurement files
- Drive folder ID extracted from URL before delivery upload

### Atlas Map
- Atlas map card surfaced in Operations, PM, and Service suites

### Infrastructure
- `SystemConfig`-backed runtime config wired to the TrueDesign public client (no redeploy needed for config changes)

---

## 2026-03-14

### Catalog Product Wizard (Major)
- 4-step product wizard (Start Mode → Basics → Details → Review) replacing the 660-line monolithic form
- Clone search with live search against /api/catalog/search and prefill confidence highlights
- AI datasheet extraction via Claude API with category-aware tool schema for full spec extraction
- Product photo upload via Vercel Blob with JPEG/PNG/WebP validation
- Duplicate detection with debounced multi-field lookup and merge tool
- Field tooltips, showWhen conditional fields, and category defaults
- 24 unit tests covering reducer actions, prefill flows, and category defaults

### SOP Operations Guide (Major)
- Phase 3: DB-backed sections with CodeMirror HTML editor
- Admin edit and non-admin suggest mode with optimistic locking and 409 conflict detection
- Revision history and suggestion review workflow (submit → pending → approve/reject)
- HTML sanitizer with class allowlist, cross-section deep links, URL-synced navigation

### Master Scheduler
- One-click reschedule for confirmed installs, surveys, and inspections
- Auto-sync to Zuper, Google Calendar, and crew email on reschedule
- Preserves existing crew assignments; pre-fills construction days from schedule duration

### Catalog & Notifications
- Admin email notifications on new catalog push requests
- Approval warnings for partial syncs with pending tab deep links in notification URLs
- Battery built-in inverter specs toggle for combo units (Powerwall 3, Enphase IQ)
- Edit form fields now have visible labels instead of placeholder-only

### Email & Infrastructure
- Email routing consolidated through Google Workspace with Resend fallback (catalog + audit alerts)
- Forecast accuracy API refactored to single-pass computation with caching (prevents Vercel timeout)

### Zuper Integration
- Dynamic category resolution via /product_categories API with 10-min TTL cache (replaces static map)
- Enrichment capped at 50 jobs with concurrency=5 to prevent API blast radius
- Duplicate detection excludes all terminal statuses to reduce false positives
- Zoho inventory/accounting defaults (FIFO, correct account names) preserved on product creation

### Bug Fixes
- Catalog approval route always returns JSON (fixes "Unexpected end of JSON" toast)
- pdf-parse pinned to v1.1.1 with direct lib import for serverless compatibility
- Fixed RESEND_FROM_EMAIL env var (was reading undefined RESEND_FROM)
- showWhen conditional fields clear stale data on toggle-off
- Sam Paro survey slots updated in hardcoded availability fallback

---

## 2026-03-07

### Solar Surveyor (Major)
- Migrated from cross-origin iframe to same-origin static serving (`public/solar-surveyor/`)
- Removed cross-origin bridge architecture (SolarIframeBridge, solar-cors, postMessage relay)
- Fixed login loop caused by cross-origin cookie policy (`SameSite=None` → `Lax`, removed `COOKIE_DOMAIN`)
- Rotated auth cookie names to `pbops.*` namespace to avoid legacy domain-scoped cookie collisions
- Fixed OAuth redirect landing on `/` instead of dashboard — now uses `window.top` navigation
- Added `allow-top-navigation` to iframe sandbox for OAuth flow
- Fixed session endpoint crash (unhandled Prisma error when table missing) that triggered login loop
- Fixed asset paths: set `VITE_BASE_PATH=/solar-surveyor/` so CSS/JS resolve correctly
- Added `build:solar` script to automate Vite build + copy

### AI Skills Hub
- New AI Skills dashboard page and hub component
- Granted access to ADMIN, OWNER, MANAGER, OPS_MANAGER, PM, TECH_OPS roles
- Fixed TECH_OPS missing from AI hub access (allowedRoutes, page guard, suite filter)

### Catalog & Approvals
- Replaced auto-create HubSpot/Zuper products with pending catalog approval queue
- Hard-gated line item creation without linked product ID
- De-duplicated `pendingCatalogPush` on HubSpot and Zuper push routes
- Logged SO creation success/failure and catalog match pipeline to activity log

### On Hold Stage
- Added On Hold stage color, stat card on home page, and stage filter
- Fixed On Hold showing 0 projects — normalized stage name ("On-Hold" → "On Hold"), removed from `INACTIVE_STAGE_IDS`

### Security & Auth Hardening
- Required auth on activity log endpoint to prevent audit pollution
- Validated `uploadId` as UUID in BOM chunk route to prevent path traversal
- Required `hubspotProductId` on `createDealLineItem` (no orphan line items)
- Fail-closed on cron notify when `CRON_SECRET` not configured
- Moved auth check before DB check in BOM history route

### Zuper Integration
- Removed 6 dead Zuper API endpoints, kept only `/product`
- Added `zuperCategory` to all `CATEGORY_CONFIGS` entries
- Added "Parts" fallback in `createOrUpdateZuperPart`

### Solar Projects
- Renamed `energyBalance` → `homeConsumptionConfig` (schema migration + API updates)
- Added `geoJsonUrl`, `radianceDxfUrl`, `shadeDataUrl` to project creation
- Expanded `/api/solar` access to 8 additional roles
- Shifted cleanup-pending cron from 6AM to 1PM UTC

### Tracking & Analytics
- Added ClickTracker component wired into layout
- Track CSV exports in DashboardShell
- ChatWidget supports `data-open-chat-widget` trigger attribute

---

## 2026-03-06

### SOP Guide (Major)
- Added role-specific guide tabs: Operations, Design & Permitting, Sales, and PM Guide (CO project lifecycle)
- Added deep linking support via URL hash for sharing specific sections
- Added Simple/Technical view toggle for different audience levels
- Added collapsible sidebar sections with HubSpot Guide at top
- Implemented auth requirement — all logged-in users can access
- Admin-only TBD system for unreviewed sections (restricted to ADMIN role)
- Auth uses `/api/auth/sync` GET for role check (respects impersonation)
- Added SOP Guide link to user dropdown menu
- Multiple UX fixes: hard refresh default section, Pinned Notes per-stage, wireframe cleanup, tab naming consistency
- Moved to `/sop-guide.html` to avoid app route conflict; excluded `/prototypes` from middleware matcher

### Install Photo Review
- New feature: AI comparison of install photos vs permitted planset (pass/fail equipment match report)
- Source install photos from Google Drive + plansets from permit folder
- Recursive Drive install folder search for photos
- Persist install review results to `ProjectReview` table
- Handle HEIC photos and large PDFs
- Upload photos to Files API to avoid 413 errors
- Multi-planset retry + photo-only fallback for large PDFs

### BOM & Sales Orders
- BOM page redesign with improved UX
- BOM snapshot matching refactor
- Added pagination limit to BOM history endpoint (default 200, max 500)
- Removed `(TEST)` suffix from auto-generated SO numbers

### Build & Infrastructure
- Added missing solar surveyor schema + API routes to fix Vercel build
- Fixed code review findings: `forceOverwrite` crash, feedback 404, rate limit docs
- Resolved scheduler hydration error + added missing `ZohoDedupRun` migration

### Catalog & Product
- Catalog delete functionality added

### Scheduling
- Resolved deal owner for pre-sale surveys, improved tentative scheduling UX

### Dashboards
- Renamed execution dashboards
- Removed passed/pass rate from inspections view
- Filtered inspections dashboard to only show Inspection-stage projects

### Portal & Notifications
- Portal emails now use first name + Google Workspace
- Cancel prompts now trigger reschedule flow

### Zuper Integration
- Zuper enhancements and direct function call for job lookup in install-review
