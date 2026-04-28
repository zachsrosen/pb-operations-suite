# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-04-28

### SOP Guide (Major)
- WYSIWYG TipTap editor replaces raw HTML CodeMirror across all sections (#425)
- Auto-link `<code>/route</code>` mentions to actual app pages (#426)
- Tech Ops tab split into Design / Permitting / Interconnection (#424)
- Role-gated tabs and sections — stops info leaking to wrong teams (#421)
- Drafts tab with PM Guide rewrite + Pipeline Overview aligned to actual 8 deal stages (#434, #436)
- Submit-a-new-SOP feature with admin review queue (#435)
- Hub-mode visibility flip — sections open by default (#437)
- New SOP content: Suites tab (#415), Tools tab expansion covering BOM, AI Design Review, Pricing, P&I Hubs, Surveyor, Schedule, Optimizer, Map (#416, #417, #418), Action Queues tab, Workflow Builder, Property Drawer, Deal Detail, Equipment Backlog (#418)
- Batch SOPs for Catalog, Service, Scheduling, Forecast, AHJ & Utility (#414)
- Submitting a New Product SOP added to ops tab (#412)
- Executive + Accounting + Sales & Marketing tabs added (role-gated) (#422)
- Meta-SOP — "How to Use the SOP Guide" (#423)

### Shit Show Meeting Hub (Major)
- New meeting hub for tracking blocked deals across IDR snapshot helpers (#429)
- Auto-snapshot on session create, always-on add button, refresh button (#431)
- IDR snapshot helpers used for owners, statuses, equipment (#432)
- Decoupled queue from active session — queue persists across sessions (#433)

### Permitting & Interconnection Hubs (Major)
- Interconnection Hub v1 (#392)
- Permit Hub queue redesign: sticky action panel, grouped queue, multiselect location (#387)
- Inline action panel, permit-lead filter, stacked filter row (#388)
- Aligned queue with daily-focus email + fixed action-panel overlap (#386)
- Resolved names + header quick-links + AHJ fallback (#389)
- Shared inbox thread fetch on correspondence tab (#390)
- Per-inbox OAuth workaround for blocked DWD scope (#400)
- Broader Gmail search with OR context clauses (#391)

### EagleView / TrueDesign (Major)
- TrueDesign auto-pull pipeline (Tasks 1–9) (#404)
- EagleViewPanel renders in solar-surveyor when `?dealId=` URL param is set (#406)
- Read deal-style HubSpot address fields (#427)
- Rollout runbook documented (#405)

### Catalog Hardening (Major)
- Phase B operational: HubSpot manufacturer enum + Zoho category mapping
- Switched Zoho writes from `group_name` to `category_id` (M3.1)
- Phased HubSpot manufacturer enum enforcement (Task 2.4)
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps
- Zuper product create: spec-derived custom fields via `meta_data` (M3.4), dimensions passthrough
- Race-safe external-record create + link-back; cross-link writer extracted to shared helper
- Sync Modal now writes cross-link IDs back
- Sync Modal executions logged to ActivityLog (Task 1.4); `logCatalogSync` wired into `executeCatalogPushApproval` (Task 1.3)
- Sync observability enums and watermark columns added
- Phase B data hygiene: test products purged, casing normalized, Generic rebrand
- Integrity audit + auto-fixable repairs
- Zoho orphan reconciliation: 302 new InternalProducts created, 311-row CSV exported for review
- Backfill script for Zoho item images from historical pushes (#398)
- Zoho propagates description + part_number on item update (#401)
- Product photo pushed to Zoho Inventory on approval (#396)
- Routed spec changes via `meta_data` on Zuper update path (#413)
- Hardening plan, mappings spec, and audit scripts documented

### Map & Quick Actions
- Call + add-note quick actions on the map view (#394)
- Office pins moved to real street addresses (#385)
- Resolved Zuper crew names; excluded RTB-Blocked from schedulable (#382)

### Activity Logging & IT
- Read-only activity-log export API for IT team (#298)
- Audit-sessions, anomaly-events, and user-roster endpoints for IT (#402)
- `getActivityTypes` includes all enum values (#404 follow-up)
- Catalog activity-log helpers added; `notImplementedCount` split, userName/source added to update helper

### Schedule & Operations
- ScheduleEventLog captures Zuper reschedules and crew changes (#399)
- On-call: Sun–Sat weeks + 6pm–10pm weekday / 8am–12pm weekend shifts (#409)
- DC_QUALIFYING_MODULE_BRANDS clarified as empty by design (#420)

### Bug Fixes
- `request-product`: removed env-flag page redirect + deduped cache rules (#384)
- Zuper: write spec custom fields via `meta_data` instead of `custom_fields`

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
