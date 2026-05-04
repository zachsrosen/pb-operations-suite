# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-04

### On-Call Electrician System (Major)
- New on-call dispatch form with roofing issue type, 3-way outcome (resolved/dispatched/no-action), and pool-filtered crew dropdown
- Sun-Sat scheduling weeks with 6pm–10pm weekday / 8am–12pm weekend shift coverage
- Per-state Google Calendar staging (CO + CA) — calendars created without invites, flipped on at go-live
- Auto-create HubSpot service ticket from on-call follow-ups
- On-call call log captures customer phone/address with automatic HubSpot contact resolution
- 6-month horizon publish window with extended publish timeout
- "Schedule starts" message data-driven from `pool.startDate` instead of hardcoded copy
- Tracey's Apr 28 go-live policy: per-state calendars, manual creation flow, `calendar.events` scope only
- Prefill dispatch timestamps; VIEWER role granted access to `/dashboards/on-call`

### Aircall Call Analytics (Major)
- Phase 1 call analytics dashboard with per-user answer rates via ring tracking
- Phase 2 executive dashboard with deeper rollups
- Import path for Aircall Analytics+ ringing-attempts CSV (historical backfill)
- On-Call Calls section sourced from `OnCallCallLog` (cross-references with on-call dispatch records)

### SOP Operations Guide (Major)
- WYSIWYG TipTap editor replaces raw HTML CodeMirror
- Submit-a-new-SOP feature with admin review queue
- Hub-mode visibility flipped — sections open by default
- Tech Ops tab split into Design / Permitting / Interconnection
- Role-gated tabs and sections to stop information leaking to wrong teams
- Auto-link `<code>/route</code>` mentions to actual app pages
- New tabs: Suites (per-suite SOPs), Action Queues, Drafts (with PM Guide rewrite + Pipeline Overview)
- Tools tab expanded — BOM, AI Design Review, Pricing, P&I Hubs, Solar Surveyor, Schedule, Optimizer, Map, Workflow Builder, Property Drawer, Deal Detail, Equipment Backlog
- New SOPs: Executive, Accounting, Sales & Marketing tabs; Catalog, Service, Scheduling, Forecast, AHJ & Utility batch
- "Submitting a New Product" SOP and meta-SOP "How to Use the SOP Guide"
- Pipeline Overview realigned to actual 8 deal stages

### IDR Meeting Hub & Pricing (Major)
- IDR Meeting Hub: SS note line, ops revision notes, tier adders, 10% pricing-threshold warning
- HubSpot roof type auto-populate; adder amount HubSpot property; % of deal + waiver warnings
- Show adder rates when system size is unknown
- Pricing checklist redesign — removed `PricingBreakdown` component, adder costs shown inline
- Replaced pricing calculator delta with user-entered `salesChangeAmount` field
- Documented `DC_QUALIFYING_MODULE_BRANDS` is empty by design

### Shit Show Meeting Hub
- New meeting hub for high-risk projects (alongside IDR hub)
- Auto-snapshot on session create; always-on add button; refresh control
- Reuses IDR snapshot helpers for owners, statuses, and equipment
- Queue decoupled from active session for independent management

### Construction Scheduler Sub-Jobs
- Solar / Battery / EV sub-job split for construction cards
- Sub-job breakdown view (only renders for deals with 2+ sub-jobs)
- Zuper job status surfaced in all scheduler modals
- Day view timed grid for surveys/inspections
- On-call electrician overlay on master schedule with overdue/completed flags
- Grouped scheduler overlay filters

### PM Accountability & Flags
- PM Accountability dashboard with weekly digest (Phase 1)
- Exception-based PM assignment system with kill switch and scoping
- Live mode: page-load evaluation replaces daily cron
- Compound-risk and shit-show rules; null-safe booleans; aggressive thresholds; stage-id fix
- Assignment copy reflects deal-PM as primary
- PM queue: accurate at read time, milestone evaluation fixed, reconciliation moved off page load
- Criteria spec documented for HubSpot workflow build

### Cost Audit (New Feature)
- Cross-reference Zoho bills against InternalProduct purchase rates
- Surface sales price, margin, and cross-system link badges
- Bulk-sync costs to latest bill with suggested sales price

### Catalog Hygiene & Sync Health
- New Sync Health page: drift rollup across InternalProduct / HubSpot / Zoho / Zuper
- Phase B data hygiene: test product cleanup, casing normalization, "Generic" rebrand
- Integrity audit with auto-fixable repairs
- Zoho orphan reconciliation: 302 new InternalProducts created + Zuper backfill, 311-row CSV export
- HubSpot orphan list with Zoho/Zuper matcher
- Auto-add unknown brands to HubSpot manufacturer enum + notify TechOps
- Phase B operational: HubSpot enum + Zoho categories
- Canonical `writeCrossLinkIds` used for all systems
- Zuper spec custom fields written via `meta_data` (not legacy `custom_fields`); spec-derived fields plumbed on product create (M3.4)
- BOM table: Catalogs column consolidated into product badge
- Backfill script for Zoho item images from historical pushes
- Zoho item update propagates description + part_number

### Service BOM
- New Service BOM page covering deals + tickets with ticket-keyed snapshots
- Fixed ticket-context links and cleaned dealname rendering
- `bom-so-create` falls back without ticket custom field if Zoho org lacks it
- `zoho-inventory` retries on Access Denied during token refresh

### EagleView / TrueDesign Pipeline
- TrueDesign auto-pull pipeline (9 tasks)
- Solar Surveyor renders `EagleViewPanel` when `?dealId=` URL param is set
- Reads deal-style HubSpot address fields
- Rollout runbook documented

### Permit Hub
- Per-inbox OAuth workaround for blocked DWD scope
- Token-exchange error body surfaced in probe response for diagnosis

### Office Performance
- Combined SLO + Camarillo into a single California dashboard
- Fixed California goals-pipeline route 404

### Other Features
- Schedule Event Log captures Zuper reschedules and crew changes
- Persist Zuper assignment metadata on confirm
- IT endpoints: audit-sessions, anomaly-events, user-roster
- Breadcrumbs: 23 missing SUITE_MAP entries added; stale overrides removed
- Pending Zuper survey holds handled locally with slot fallback and downstream follow-up
- Admin testing suite added

### Bug Fixes
- Production build: `product-comparison` wrapped in `Suspense`
- React hooks ordering fixed in IDR `ProjectDetail`
- Removed duplicate `pricingDeltaPct` definition from squash merge
- Multiple pending-Zuper deploy type errors resolved
- Reverted "Comms: include HubSpot emails outside inbox" (#482)

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
