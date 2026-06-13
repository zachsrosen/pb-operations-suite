# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-27

### Enphase Enlighten Integration (Major)
- Full PowerHub-parity monitoring integration: API client, crosslink, three cron jobs, HubSpot UI card
- OAuth2 with DB-persisted refresh token rotation (token bucket rate limiter at 8 req/sec)
- Prisma models: `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` + 8 `enphase_*` columns on `HubSpotPropertyCache`
- Cron jobs: asset discovery (daily 9am) with address-hash auto-linking, telemetry snapshots (every 15 min), micro health monitoring (every 30 min)
- HubSpot UI Extension card backend with HMAC signing — production, battery SoC, micro health, portal link
- Partner OAuth setup route (`grant_type=password` for installers with 10+ systems) in addition to per-homeowner authorization-code flow
- Feature flags: `ENPHASE_ENABLED`, `ENPHASE_CROSSLINK_ENABLED`, `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED`
- CLAUDE.md Section 12 documents the integration

### Project Pipeline Funnel (Major)
- New full-lifecycle Executive dashboard extending the design funnel through PTO Granted
- 11 stages: Sales Closed → Survey Scheduled → Survey Done → DA Sent → DA Approved → Design Complete → Permits Submitted → Permits Issued → Construction Scheduled → Construction Complete → Inspection Passed → PTO Granted
- Hero stat cards, pipeline backlog with drill-down tables, throughput bars with conversion % and median days
- Monthly cohort trend chart, cohort detail table, current pipeline position view
- Named timeframe presets (Last 30 / 90 days, This Quarter, YTD, etc.)
- Monthly Activity table tracking stage transitions over time
- Drill-down columns include staff assignment (designer, permit owner, project manager)
- Drill-downs show correct HubSpot status per stage (DA, design, permitting, construction, inspection, PTO)
- On Hold deals (stage 20440344) excluded from counts/cohorts/medians; Project Complete deals satisfy all milestone flags
- Executive suite home card links to the funnel

### EagleView Orders Dashboard
- New `/dashboards/eagleview-orders` page with unified search across HubSpot deals and tickets
- Order placement, retry, and status UI hydrated with existing `EagleViewOrder` rows
- `POST /api/eagleview/order` now accepts `ticketId` in addition to `dealId`; resolves the associated deal via HubSpot ticket associations
- `EagleViewOrder.ticketId` column (nullable) links Service-triggered orders to their tickets
- Suite cards added on Operations, Design & Engineering, and Service suites
- Route allowlisted for OPS_MGR, PM, OPS, SERVICE, TECH_OPS, DESIGN
- Production PlaceOrder request format adopted; live credentials enabled

### Shop Health Dashboard
- Drill-down tables added to all count-based Customer Success metrics (sentiment, 5-star reviews, response time, etc.)
- Switched response-time metric to deal-level rollups (fixes review drill-down accuracy)
- New Service and D&R/Roofing sections expand the dashboard beyond Sales

### PE Deals Dashboard
- Card split into Pre-Construction vs Construction+ for clearer funnel state
- Pipeline bar split into per-stage buckets; report link removed
- Awaiting PTO segment added; previous hero card split reverted
- Cancelled deals excluded; "Other" auto-renames to "On Hold"
- New "Customer Paid?" column with smarter sort logic
- Multi-column sort; default sort changed to PE Total
- x/y count switched to submitted total; under-review badge added

### Customer Survey Portal
- Full redesign aligned to photonbrothers.com brand palette
- Subdomain isolation prevents auth cookie leakage between portal and main app
- Inline cancel + reschedule flow; scroll bug fixed
- ChatWidget hidden on portal routes; stale URL newline bug fixed
- Unrecognized phone number removed from footer
- New service-to-service survey invite endpoint for Olivia (internal automation)

### Zuper API Call Reduction (Major)
- ~97% reduction in Zuper API calls via job-list caching in lookup endpoint
- Skip API sweep when DB-cache hits succeed; cache `/jobs/by-category` responses
- Per-endpoint API call counter with admin read endpoint for visibility
- Every outbound call now logs with source file attribution (`[zuper-call]`)
- `useCalendarData` polling cadence slashed
- Cron throttling: `zuper-property-sync` 15min → 30min → cut further to 6h; `zuper-job-backfill` hourly → 6h; `zuper-sync-cache` 30m → 4h
- Roofing-scheduler: inlined JOB_CATEGORY UIDs to drop a client→server import chain
- Zuper call counter lazy-imports prisma to keep it out of client bundles

### PowerHub Tesla Integration
- Push all Tesla device serials + models to Zuper Property and Job records
- Prisma migration adds `tesla_device_model` columns
- Fixed primary site selection: now prefers sites with equipment over empty sites

### Daily Focus / EOD Summary
- Morning snapshot now saved before emails are sent (prevents data loss on send failure)
- EOD summary tracks actual action items resolved (was previously over-counting)

### PE Scraper
- Removed broken GCS cron; webhook is the sole sync path
- Override `NOT_UPLOADED → UPLOADED` for unknown statuses with a submitted date present

### Backfill & Infrastructure
- `scripts/backfill-properties.ts` gains `--skip-zuper` flag to avoid Zuper API bursts during backfill runs

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
