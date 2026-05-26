# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-26

### Project Pipeline Funnel (Major - New)
- New 9-stage sales-to-construction pipeline funnel card in the Executive suite (#829)
- Milestones inferred from deal pipeline stage instead of date fields for accurate stage attribution
- Survey Scheduled stage added with cleaned-up hero card layout
- Monthly Activity table breaks down deal flow by month
- Named timeframe presets (MTD, QTD, YTD, etc.) for quick filtering (#830)
- Close-out stage, activity table, and per-row drill-down dates (#831)
- Staff assignment columns added to drill-down tables (#832)

### Shop Health (Major)
- Contact response metrics wired into Customer Success scorecard (#821)
- Multiple bottleneck entries per shop per week now supported (#825)
- Drill-down tables added to all count-based metrics (#826)
- Drill-downs added to Customer Success metrics (#827)
- Drill-downs added for sentiment, 5-star reviews, and response time (#828)
- Response rollups switched from contact-level to deal-level; review drill-down fixed (#843)

### Enphase Enlighten Integration (Major - New)
- Full Enphase Enlighten API integration at PowerHub parity (#824) — OAuth2 with DB-persisted refresh token rotation, token bucket rate limiter (8 req/sec), telemetry endpoints, fleet discovery
- Three cron jobs: fleet discovery (daily 9am), telemetry snapshots (every 15 min), micro health monitoring (every 30 min)
- Address-hash auto-linking to HubSpot Property cache via crosslink cascade
- HMAC-signed HubSpot card showing production, battery SoC, and micro health
- Partner OAuth setup route added for installer credential flow (#834) — simpler than per-homeowner authorization code dance
- 8 new `enphase_*` columns on `HubSpotPropertyCache` + `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` models

### EagleView Integration (New)
- New EagleView Orders dashboard page (#842) for measurement report order tracking
- Production PlaceOrder request format fixed (#839)
- Auto-pull enabled for incoming reports

### PE Deals & Scraper
- PE Deals dashboard now groups deals by pipeline stage with stage distribution in hero (#820)
- Stage groups fixed and reordered, sections made collapsible (#822)
- Doc status diff tracking between sync runs (#796) — enables event-driven notifications
- Instant email notifications on PE doc status changes (#815)
- Full status breakdown shown in PE digest "Nearly Complete" section (#813)
- Removed broken PE scraper GCS cron — webhook is now the sole sync path (#838)

### Customer Survey Portal
- Redesigned customer survey portal, hid chatbot, fixed URL newline issue
- Subdomain isolation, brand color, inline cancel, and scroll fixes (#840)
- Brand palette swapped to match photonbrothers.com (#841)
- New service-to-service survey invite endpoint for Olivia automation

### Master Scheduler
- Editable date picker added to drag-drop reschedule confirmation (#818, #626)
- Completed Zuper jobs no longer appear as overdue (#814)
- Pre-sale jobs (purple cards) properly distinguished from regular surveys (#794)
- Orphaned resurvey/re-inspection jobs now appear in master scheduler (#819, #563)
- Orphaned jobs fixed: no longer show as unscheduled in sidebar
- Orphaned job location now falls back to deal's `pb_location`
- Batch Freshservice ticket fixes (#535, #563, #624, #633) (#817)

### PowerHub / Tesla
- Primary site selection now prefers sites with equipment over empty sites (#833)
- All Tesla device serials and model numbers pushed to Zuper Property/Job
- Tesla device model numbers shown alongside serials in HubSpot card
- Prisma migration adds Tesla device model columns

### Zuper Performance
- Zuper API calls reduced ~97% by caching job list in lookup endpoint
- `zuper-property-sync` cron cut from every 15 min to every 30 min
- `sync-cache` cron reduced from every 30 min to every 4 hours
- New `--skip-zuper` flag on property backfill script to avoid API bursts

### HubSpot Card Signature Verification
- Lean v3 signature verifier — signs with URL-decoded query-param values
- `HUBSPOT_CARD_SKIP_SIG_VERIFY` env var removed (verification always on)

### Bug Fixes
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
