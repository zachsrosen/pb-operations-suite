# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-12

### Ready to Build Review Queue (Major)
- New "Ready to Build" tab on the review queue, alongside Blocked
- Ready tab "Released" state now reads `pm_rtb_approved_date` instead of the boolean flag, so a re-blocked deal correctly reads un-released until Release is pressed again
- Editable RTB-Blocked notes with a clarified header
- Payment method, loan status, and earliest install availability columns
- Permitting status column added; all un-merged columns now fully sortable
- Always-visible line items and a days-in-stage column
- Review queue condensed from 17 to 11 columns
- Semicolon-separated project types now stack one per line

### PowerHub Fleet Monitor (Major)
- Sortable columns, filters, and CSV export on the fleet monitor
- Fleet table info columns, voltage-based grid cell, and Active Alerts toggle
- Inline alert names + open-ticket links on the fleet table
- Tesla concern ticket links and a customer column
- Live HubSpot label resolution — real deal names, ticket subjects, contact names, stage labels
- Grid status now derived from grid voltage instead of the dead `grid_connected_status` signal
- Calmer UI: stable rows, customer-first identity, visible sort
- Customer resolution via `PropertyDealLink` for GEO-linked sites
- Alert severity refreshes on existing rows during polling
- Tesla RMA severity captured; unmapped alerts no longer dropped
- Tesla auth token persisted in `SystemConfig` to stop token-endpoint throttling

### Chat Bot / AI Assistant
- `get_deal` returns a full labeled status snapshot (including DA / layout_status) and answers "why is PROJ-X <any state>" from the real reason fields
- `get_deal` exposes the sales-change / rejection reason note
- Bulk state reasons via `query_projects includeReason` — no per-deal fan-out
- PE dollars use payment amount, not deal amount (`get_pe_payments` basis/location)
- Stage breakdowns ordered by pipeline sequence, not by size
- Real tables via monospace code blocks (markdown tables banned in chat rendering)
- Polish: no markdown tables in chat + a help/menu reply
- Fixed cross-question list contamination, mid-list doubt, and truncation
- Prompt-cached the system prompt and tool schemas in the toolRunner for faster responses

### Team Activity
- Weekly report-card email digest
- New Tasks/day and Property updates/day metrics
- Deals-touched per day metric
- Copy-paste report card; PE uploads count as deal touches
- PTO days (calendar OOO) excluded from averages
- Dropped integration-app Drive events from the Google source

### Sales Funnel
- Blocked toggle + waiting-since / scheduled dates in drill-downs
- Sales Funnel now defaults to This Year with drill-down polish
- "Hide cancelled" toggle (mirrors on-hold / rejected)

### Service
- Ticket age scored in the priority queue
- Type dropdown filter on the service overview header
- Priority-queue overrides restricted to ADMIN only

### Worklists
- Manager rollup worklists: Ben Minarick now receives every active deal with layout_status "Pending Sales Changes" grouped by rep, sourced from `SystemConfig.bottleneck_manager_worklists`
- Active-only fetch keeps the daily worklist and ad-hoc bot answers in sync
- Bottleneck managers excluded from per-rep delivery to avoid duplicate views

### Production Guarantee
- Production-guarantee fix verification & approval workflow
- Required due date now passed on task creation

### IDR Detail Panel
- Escalation photos shown above site photos
- Restored escalation gallery and D&R / Service pills clobbered by #1356

### Bug Fixes & Infrastructure
- Repointed `HubSpotProjectCache` readers to the Deal mirror table — the old cache had never had a writer, so crew-schedule / scheduler-v2 / zuper compliance / orphaned jobs / office-performance / powerhub-sync / pe-clawback-alert were all silently degraded
- Vishtik `Get-Project` uses offset pagination, lifting a silent ~2,280-row fetch cap
- Middleware allowlist covers `zuper-field-activity-sync` and `product-sync` crons

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
