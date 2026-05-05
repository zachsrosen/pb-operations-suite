# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-04-29

### PM Exception Flag System (Major)
- Replaces day-to-day PM ownership with exception-based round-robin assignment: when a deal is flagged (auto by HubSpot workflow callout or manually in-app), the system routes it to the least-loaded active PM and detaches when the flag resolves
- New Prisma models: `PmFlag`, `PmFlagEvent`, 5 enums, 8 `ActivityType` entries
- Core lib `lib/pm-flags.ts`: idempotent `createFlag` (on source+externalRef), `assignNextPm` round-robin, acknowledge / resolve / reassign / note / cancel transitions
- API: `POST/GET /api/pm-flags` + per-flag transition endpoints, dual-auth (session for manual, `API_SECRET_TOKEN` for HubSpot workflows)
- UI: `/dashboards/pm-action-queue` with severity tiers, Mine / Unassigned / All tabs, drawer with full event timeline; `RaiseFlagButton` drop-in for manual escalation
- Email template `PmFlagAssigned` with severity color + deep-link
- `raise-pm-flag` action registered in admin workflow palette
- Live mode: page-load eval replaces daily cron (immediate flag visibility)
- Null-safe boolean evaluation, aggressive thresholds, stage-id fix, compound-risk + shit-show rules
- Kill switch + scope guard + assign-by-PM safety on rollout

### PM Accountability Dashboard + Weekly Digest (Phase 1)
- Defense brief for PM role under HR/ownership scrutiny — `/dashboards/pm-accountability` audience-gated to `PM_TRACKER_AUDIENCE` allowlist
- New `PMSnapshot` model with per-PM nightly metric writes
- Phase 1 metrics: engagement (ghost rate, median days since touch, 30d frequency), readiness (permit/BOM/customer-confirm checklist, day-of failures), hygiene (required-fields population, stale data), rescue (stuck count from `hs_date_entered_<stage>`)
- Snapshot orchestrator runs all metrics in parallel; continues on per-PM failures
- Cron jobs: nightly snapshot at 02:00 MT, weekly digest Monday 08:00 MT (idempotent via `IdempotencyKey` on iso-week)
- API routes: `/api/pm/scorecard`, `/api/pm/team-summary`, `/api/pm/at-risk`
- `TeamComparisonTable` with default sort by ghost rate ascending; per-PM `PmScorecardTab` with KPI strip + at-risk list
- Phase 2 (saves detector, reviewRate, complaintRatePer100, GHOSTED) deferred

### On-Call Schedule Go-Live (Major)
- Aligned with Tracey's Apr 28 policy — 2-week advance notice for shift changes, per-state Google Calendar
- Sun-Sat work weeks; weekday shifts 6pm-10pm, weekend shifts 8am-12pm
- Two-stage Google Calendar rollout: stage events without invites for admin review, then invite-blast pass via `scripts/send-on-call-invites.ts` (stable sha1 event ids let updates add attendees in place)
- Switched to `calendar.events` scope (matches existing DWD config); manual calendar creation required (admin shares with service account, pastes ID into `OnCallPool.googleCalendarId`)
- HeroStrip "Schedule starts" message data-driven from `pool.startDate`
- Granted VIEWER role access to `/dashboards/on-call` + `/api/on-call` so unboarded electricians (auto-VIEWER) don't 403

### SOP System Overhaul (Major)
- **WYSIWYG editor**: replaces raw HTML CodeMirror with TipTap rich editor across all SOP sections
- **Role-gating**: tabs and sections gated to prevent info leaking — public tabs (hubspot, ops, ref), PM Guide gated by first-name match, Tech Ops tab restricted, admin-only sections (`ref-user-roles`, `ref-system`)
- **Tech Ops split**: single Tech Ops tab broken into Design / Permitting / Interconnection (mirroring DESIGN, PERMIT, INTERCONNECT roles)
- **Suites tab**: per-suite SOPs with overview index for all 9 suites
- **Tools tab expansion**: BOM, AI Design Review, Pricing, P&I Hubs, Surveyor, Schedule, Optimizer, Map, Workflow Builder, Property Drawer, Deal Detail, Equipment Backlog
- **Action Queues tab**: dedicated SOPs for queue management
- **Drafts tab**: PM Guide rewrite + Pipeline Overview (aligned to 8 actual deal stages)
- **Submit-a-new-SOP**: user submission flow with admin review queue
- **Hub-mode flip**: SOP open by default, no longer hidden behind a toggle
- **Auto-link `<code>/route</code>` mentions** to live app pages
- Catalog, Service, Scheduling, Forecast, AHJ & Utility batch SOPs added
- Executive, Accounting, Sales & Marketing tabs (role-gated)
- Meta-SOP "How to Use the SOP Guide" + "Submitting a New Product" SOP for ops tab

### Shit Show Meeting Hub (Major)
- New meeting hub at `/dashboards/shit-show` for triaging at-risk deals during weekly meetings
- Auto-snapshot on session create using IDR snapshot helpers (owners, statuses, equipment)
- Always-on add button + manual refresh button
- Queue decoupled from active session — backlog persists across meetings

### Catalog Phase B — Operational Sync (Major)
- HubSpot manufacturer enum auto-add: unknown brands now auto-create as HubSpot enum values + notify TechOps via email (no more "missing manufacturer" sync failures)
- Zoho item categories now sync as `group_name` (proper inventory categorization)
- Zuper custom fields written via `meta_data` instead of `custom_fields` payload (matches Zuper API contract on update path)
- Zuper product create now plumbs spec-derived custom fields (M3.4)
- Catalog data hygiene pass: test product cleanup, brand casing normalization, "Generic" rebrand, integrity audit + auto-fixable repairs
- 311-row Zoho orphan reconciliation: 302 new `InternalProduct` records created with Zuper sync; CSV export of HubSpot orphans for manual review
- Catalog-sync `meta_data` routing on Zuper update path (fixes spec changes silently dropping)
- Script `_create-zuper-product-customfields.ts` to seed required Zuper custom fields
- Backfill script for Zoho item images from historical pushes
- Rollout runbook (PR #407)

### EagleView / TrueDesign Auto-Pull (Major)
- TrueDesign auto-pull pipeline (Tasks 1-9) — automated EagleView report fetching
- `EagleViewPanel` renders in Solar Surveyor when `?dealId=` URL param is set
- Fixed deal-style HubSpot address field reads (was missing fields when address came from deal vs contact)
- Rollout runbook documenting pipeline + recovery flows

### Schedule Event Log (Major)
- New `ScheduleEventLog` model + capture path for Zuper reschedules and crew changes
- Records who changed what when across all schedule mutations (foundation for SLA tracking + audit trail)

### Office Performance — California Combined Dashboard
- Office Performance TV system now treats SLO + Camarillo as one "California" group (mirrors revenue tracking + install calendar grouping)
- New `DashboardLocationGroup` abstraction in `lib/dashboard-location-groups.ts`
- Goals summed across SLO + Camarillo `OfficeGoal` rows; default fallback applied once if neither has a row
- Compliance: single `computeLocationCompliance` call per stage with primary canonical + union dealIds (correct because both shops share Zuper team)
- Legacy slugs (`san-luis-obispo`, `camarillo`) client-side redirect to `/california`
- All-locations rollup now shows 4 rows (was 5)
- Per-location `goals-pipeline` route uses `resolveDashboardGroup` (fixes 404 on `/california`)

### Scheduler
- Flag overdue/completed Zuper overlay jobs visually so dispatch can clear stale state

### IT / Admin Endpoints
- New `/api/it/audit-sessions`, `/api/it/anomaly-events`, `/api/it/user-roster` endpoints for IT integration / external monitoring

### Permit Hub
- Per-inbox OAuth workaround for blocked DWD scope (`gmail.send` blocked at workspace level requires individual user authorization)
- Token-exchange error body now surfaced in probe response for diagnostics

### Bug Fixes
- Zoho item update now propagates `description` + `part_number` (was silently dropping on update)
- EagleView reads deal-style HubSpot address fields (street/city/state/zip on deal, not just contact)
- Pricing: clarified `DC_QUALIFYING_MODULE_BRANDS` empty by design (intentional, not a config gap)
- SOP draft Pipeline Overview aligned to actual 8 deal stages (was showing legacy stage names)

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
