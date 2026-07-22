# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-22

### Operations Scorecard (Major)
- New living Operations Scorecard dashboard: captures gross/net conventions, cancellation cohorts (same-age + eventual), time-metric exclusions, CC capacity model, run-rate methodology, Pueblo/COSP merge
- Same-point year comparison, mean + median turnarounds, calendar-month trailing rate
- Sale → DA approved and Sale → CC forecasting legs; leads and consults rows added to top of funnel
- Trend coloring, prior-year revenue lost, sales-first charts, net vs total sales everywhere
- Quarter-over-quarter tables + monthly funnel; YTD totals and split count/revenue trend colors on monthly tables
- Full-year projection column, CO/CA rollups, turnaround stat toggle, "Full year" wording
- `first_consult_date` property + consult-driven sales forecast
- Interactive goal planner: sales target → expected DA/CC flow with presets (current pace, sustain, $3.5M)
- Reverse goal planner: CC goal → required funnel; mix-weighted per-office conversion; net + total on forward-pace columns
- Conversion trend added to capacity table
- "Why deals cancel" reason breakdown by sold-year cohort using `cancellationReasonCategory` (18-bucket taxonomy, backfilled 2024+)
- Guardrailed AI commentary section with verbatim, unit-aware constraints
- Per-section "how these numbers are calculated" explainers
- Number-vetting sweep: basis consistency + tested invariants; consistent total-basis sustain comparison + cache warmer
- Fixes: goal planner TOTAL vs net input, phantom DA bulge in transition months, green trend color on final arrow values, rollup border rendering, `maxDuration=120` on API route

### PI Hub & Approval Signals (Major)
- Approval signals: detect issued/approved/granted/passed verdicts from shared inbox evidence
- Inspection signals mapped to the permit team (not IC); only surface for deals without `pto_status`
- Signal callouts are suggestion-only — no set-status action
- Signal-only deals now surface in the queue; separate Inspection section in the Permit view
- Per-deal time budget on approval-scan cron so runs never 504 mid-progress
- Read emails in-app from the correspondence tab (server-side Gmail body fetch via stored inbox OAuth — works around Gmail's inability to deep-link delegated mailboxes)
- Dual-application IA lists — tokenizer + merging loader for shared inbox
- Xcel chatter emails linked via the IA number crosswalk in IC Hub
- Overview panel now shows application # and Xcel IA #
- Correspondence identifiers include `xcel_ia_number`
- Collapse other projects' messages inside matched Gmail threads
- Deep-link threads to `#all` so archived mail resolves
- Team-switch loading state + prefetch of other teams
- Server-side queue cache with 120s budget for cold builds

### On-Call Reminders
- New Monday 15:00 UTC cron: reminder emails to electricians holding days in the current week ("you're on call this week") and the next ("next week")
- Fixes gap where on-call weeks were only visible via silently-added calendar events (Google `sendUpdates=externalOnly` never emails same-domain guests)

### Location Rename
- Colorado Springs office renamed to Pueblo throughout the app (labels, filters, config)

### Suite Landing Pages
- Auto-dulled Legacy sections on suite landing pages, driven by page-traffic data
- Legacy-path computation with retention guard and 1h negative cache
- `partitionLegacyCards` helper splits active vs legacy shortcuts per suite

### Worklists & Bot
- Site survey worklists flag upcoming surveys, not just overdue ones
- Bot remembers the worklists it sends and searches before asking

### Preconstruction Metrics
- Historical milestone counts now include completed deals (was undercounting the sold-year cohort)

### Bug Fixes
- HubSpot taxonomy field renamed to `cancellationReasonCategory` (fixed main build)
- Shared inbox deep-links resolve archived mail via `#all` query

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
