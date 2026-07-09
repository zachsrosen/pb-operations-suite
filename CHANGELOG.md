# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-22

### Enphase Enlighten Integration (Major)
- Full Enphase Enlighten API integration at PowerHub parity (#824)
- OAuth2 auth code flow with DB-persisted refresh token rotation in SystemConfig
- Token-bucket rate limiter (8 req/sec) with optional Fly.io proxy
- Cron jobs: fleet discovery (daily), telemetry snapshots (15m), micro health checks (30m)
- HubSpot card with HMAC signing showing production, battery SoC, micro health, portal link
- Partner OAuth setup route for installer-credentials flow (#834) — simpler than per-homeowner authorization_code
- 8 new `enphase_*` columns on `HubSpotPropertyCache`, `EnphaseSite` / `EnphaseTelemetrySnapshot` / `EnphaseTelemetryHistory` models
- Feature-flagged via `ENPHASE_ENABLED`, `ENPHASE_CROSSLINK_ENABLED`, `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED`

### Project Pipeline Funnel (Major)
- New 9-stage sales-to-construction funnel on Executive suite (#829)
- Stages inferred from deal pipeline (not custom date properties) for accuracy
- Added Survey Scheduled stage and cleaned up hero card layout
- Monthly Activity table with named timeframe presets (#830)
- Close-out stage, activity drill-down dates, staff assignment columns (#831, #832)

### Shop Health Dashboard
- Switched scoring to deal-level response rollups + fix review drill-down (#843)
- Drill-down tables for sentiment, 5-star reviews, response time (#828)
- Drill-down tables across all Customer Success metrics (#827) and count-based metrics (#826)
- Multiple bottleneck entries per shop per week supported (#825)
- Customer Success metrics wired to contact response data (#821)

### EagleView Orders
- New EagleView Orders dashboard page (#842)
- Switched to production PlaceOrder request format (#839)

### Customer Survey Portal
- Full redesign of customer survey portal; chatbot hidden, URL newline fix (#837)
- Subdomain isolation, brand palette match to photonbrothers.com, inline cancel, scroll fix (#840, #841)
- New service-to-service survey invite endpoint for Olivia (#836)

### PowerHub / Tesla
- PowerHub primary site selection now prefers sites with equipment (#833)
- Push all Tesla device serials + model numbers to Zuper Property and Job custom fields
- HubSpot card shows Tesla device model numbers alongside serials
- Prisma migration for new Tesla device model columns

### Zuper Performance
- Job-list cache in lookup endpoint reduces Zuper API calls ~97%
- `zuper-property-sync` cron cut from /15min to /30min
- `sync-cache` cron reduced from /30min to every 4h
- Backfill script gains `--skip-zuper` flag to avoid API burst

### Master Scheduler
- Show orphaned resurvey/re-inspection jobs (#563, #819)
- Editable date picker added to drag-drop reschedule confirmation (#626, #818)
- Fix completed Zuper jobs showing as overdue (#814)
- Pre-sale jobs render as purple cards (regular surveys unaffected) (#794)
- Orphaned job locations resolve from deal `pb_location`; no longer show as unscheduled

### PE Deals & Scraper
- Group deals by pipeline stage with stage distribution in hero (#820)
- Fixed stage groups, reorder, collapsible sections (#822)
- Instant email notification on PE doc status changes (#815)
- PE scraper tracks doc status diffs between sync runs (#796)
- Full status breakdown shown in digest Nearly Complete section (#813)
- Removed broken PE scraper GCS cron — webhook is now the sole sync path (#838)

### HubSpot Card v3 Signing
- Lean v3 signature verifier: sign with URL-decoded query-param values
- Removed `HUBSPOT_CARD_SKIP_SIG_VERIFY` escape hatch after fix landed

### Bug Fixes
- Batch Freshservice ticket fixes (#535, #563, #624, #633, #817)
- Jinko manufacturer typo fixed; catalog limit raised to 2000 (#816)
- Removed unused `teslaProductFromPartNumber` import

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
