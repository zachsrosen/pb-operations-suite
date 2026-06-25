# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-25

### Participate Energy Integration (Major)
- HubSpot Deal card for Participate Energy status showing submitted/required counts with approved · under review · action required breakdown
- Sync button shared in the tab bar across all PE tabs; "Last synced X ago" indicator next to the button, reflecting the last successful pull
- Bill of Materials tracked as its own M1 document — conditionally required, syncs status to HubSpot, "Not Required" available as a real status for conditional docs
- "Last submitter" payment-ownership mode on the Doc Uploaders table
- Approved milestones now advance to Paid from the invoice paid-in-full date (gated by a SystemConfig flag for live toggling without redeploy)
- Auto-advance onboarding and internal rejections; loosened rejection-task matcher so task names are freely renameable

### Workflow Map (Major)
- New Workflow Map dashboard surfacing live HubSpot automation and SOP reference in one view
- Zoomable flowchart view (pipelines → stages → workflows) with name+status stage mapping and task edges
- Family-lane stage layout with write-only status mapping; date-stamp plumbing hidden for clarity
- Curated vertical-swimlane Process view (Design intertwines, Permitting parallel)
- Accurate Design process view: parallel tracks → AND-gate → stamps branch, with tighter pill wrapping
- Plain-English end-to-end pipeline walkthrough, expandable per stage
- Resumable backfill with maxDuration=300 and admin Build/Re-sync button

### Cohort Charts & Funnel Analytics
- Milestone Progression cohort chart added to the project pipeline funnel with pill selector, Sales Closed start, Lifecycle view, extended chain to Closed Out, weekly bins, PE-style sizing, and click-to-drill-down
- Funnel cohorts: on-hold segment, milestone lifecycle, richer drill-downs, label rename
- Cancelled and On Hold surfaced as their own segments
- Headline summary cards above the chart with drill-down on summary cards plus lifecycle DA metric
- Finer lifecycle, drill-down detail, week/month toggle, segment drill, sort + copy
- Revenue/count label placed directly above each bar

### Scheduler
- "New Construction" as its own tab between Ops Surveys and Pre-Sale
- "Needs Revisit" + "New Construction" surveys shown in three groups; revisits stay in Ops Surveys after status flips to Ready to Schedule
- Lenny Uematsu replaces Rolando for Colorado Springs surveys and all CO Springs field work
- DTC office filter no longer hides all survey availability
- Fixed empty "Needs Revisit" group caused by stale schedule date

### EagleView Orders
- Design Lead column on each order, resolved via owner map (was always blank)

### Configuration
- SystemConfig-backed runtime config wired through TrueDesign public-client

---

## 2026-06-05

### Participate Energy Doc Tracking
- UPLOADED and UNDER_REVIEW merged into a single "In Review" status
- Notes-only PE doc changes relabeled instead of showing "Uploaded → Uploaded"
- UPLOADED→UNDER_REVIEW convergence no longer logged as a change
- PE doc change digest improved with actionable sections + Drive links; mirror digest email follows the same structure
- Added replay endpoint for PE doc change batches (one-shot cron used and then removed)
- Daily digest restructured into 4 actionable sections; "Today's Changes" dropped; slim summary + tracker link variant added

### Monthly Activity Throughput
- New Monthly Activity throughput dashboard

### Google Chat OOO Bot (Major)
- New Google Chat OOO bot with SOP integration
- Multiple JWKS sources for Google Chat JWT auth; accepts multiple JWT audiences and logs claims
- Google Workspace add-on envelope format supported
- Static `waitUntil` import + async diagnostics; async post errors captured to DB with detailed Chat API errors
- Base64-encoded service account key handled in Chat API
- Replies post to main timeline instead of a thread
- Middleware allowlist added for `/api/cron/pe-doc-digest`

### Scheduler
- Weekend visibility toggle
- Weekend toggle no longer shifts events to Saturday; events render on weekend cells without stealing Monday

### Shop Health
- New Service + D&R/Roofing sections
- Lightweight overview path (1 Project fetch, no tickets); duplicate Project pipeline fetch removed
- Closed tickets cached; overview route made resilient with fail-open behavior on new Service/D&R fetches
- Surface shop-health overview errors for diagnosis

### PE Deals Dashboard
- Split into Pre-Construction vs Construction+ cards
- Pipeline bar split into stage buckets; report link removed
- "Awaiting PTO" segment added (hero card split reverted)
- "Customer Paid?" column added after the customer payment amount
- Multi-column sort, smarter "Cust Paid" sort, default sort by PE Total
- Cancelled deals excluded; Other → On Hold auto-rename
- x/y count switched to submitted total + under-review badge

### Project Funnel
- Design approval status now shown in the "Awaiting DA Send" column

### Performance
- Zuper: skip API sweep on DB-cache hits + cache `/jobs/by-category`; explicit caller attribution for `[zuper-call]` log; reduced `useCalendarData` polling
- Roofing scheduler: inlined `JOB_CATEGORY` UIDs to drop client→server import

### Bug Fixes
- PE scraper sync overrides `NOT_UPLOADED → UPLOADED` for unknown statuses with a submitted date
- Admin tickets: invalid `pageUrl` handled in ticket table render
- Daily focus: morning snapshot saved before sending emails
- EOD summary: "morning items resolved" now tracks actual action items

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
