# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-22

### Enphase Enlighten Integration (Major)
- New Enphase monitoring integration at full parity with Tesla PowerHub (`lib/enphase-enlighten.ts`, `lib/enphase-crosslink.ts`)
- OAuth2 auth code flow with DB-persisted refresh token rotation (SystemConfig, not env var)
- Token bucket rate limiter (8 req/sec) with optional Fly.io proxy via `ENPHASE_PROXY_URL`
- DB models: `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` + 8 `enphase_*` columns on `HubSpotPropertyCache`
- Three crons: asset discovery (daily 9am, address-hash auto-linking), telemetry sync (every 15 min), status check (every 30 min, micro health transitions)
- HubSpot UI Extension card at `/api/hubspot-card/enphase/` with HMAC v3 signature verification
- Partner OAuth setup route (`grant_type=password`) for installer credentials — simpler than per-homeowner authorize/callback dance
- Feature flags: `ENPHASE_ENABLED`, `ENPHASE_CROSSLINK_ENABLED`, `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED`

### Project Pipeline Funnel (Major)
- New 9-stage sales-to-construction funnel card on Executive suite (`#829`)
- Stages: Sales Closed → Survey Scheduled → Survey Complete → Design → Permitting → IC → Ready to Build → Install Scheduled → Construction → Close Out
- Drill-down tables per stage with project number, amount, days-in-stage, PM, and stage-specific date columns
- Staff assignment columns added to drill-down tables (`#832`)
- Awaiting Close Out backlog bucket — deals with PTO granted but not yet in Close Out
- Monthly Activity table tracking Sales Closed and Closed Out by month
- Named timeframe presets (Last 30 Days, MTD, QTD, YTD, Last Quarter, custom)
- Funnel milestones now inferred from deal pipeline stage instead of property timestamps

### Shop Health Dashboard
- Drill-down tables added to all 17 count-based metrics across Pipeline, Preconstruction, Scheduling, Operations, and Inspections sections (`#826`)
- New `DrilldownMetricCard` component (chevron indicator, click-to-toggle, scrollable 256px-capped table)
- Drill-downs extended to Customer Success metrics: sentiment, 5-star reviews, response time (`#827`, `#828`)
- Contact response metrics replaced with deal-level rollups (`no_same_day_response`, `average_customer_response_time`) — eliminates 2 API call rounds per load (`#843`)
- Wired no-same-day-response and average-time-to-respond into Customer Success section, replacing Coming Soon cards (`#821`)
- Bottleneck entries: dropped unique constraint on (location, weekStart) so managers can log multiple per shop per week, with inline autosave + delete (`#825`)
- 5-star review cache reshaped from location→count to location→dealIds for drill-down resolution

### EagleView Integration
- New EagleView Orders dashboard page with unified deal + ticket search (`#842`)
- `EagleViewOrder.ticketId` column for linking orders triggered from Service ticket context
- `GET /api/eagleview/search` searches HubSpot deals and tickets in parallel, hydrates existing orders
- `POST /api/eagleview/order` extended to accept `ticketId`
- Switched to production PlaceOrder request format (`#839`)
- Auto-pull enabled

### Master Scheduler
- Show orphaned resurvey/re-inspection jobs — Zuper jobs whose deal moved past schedulable stages (e.g., into D&E) now appear via `/api/zuper/jobs/orphaned` (`#819`)
- Use deal's `pb_location` for orphaned job location instead of derived defaults
- Fix orphaned jobs showing as unscheduled in sidebar
- Editable date picker on drag-drop reschedule confirmation with weekend/holiday/same-date warnings (`#818`)
- Site Survey scheduler: only pre-sale jobs render as purple cards — regular surveys without `zuperJobUid` no longer mis-rendered (`#794`)
- Fix completed Zuper jobs showing as overdue (`#814`)

### Customer Survey Portal
- Full redesign matching photonbrothers.com brand — navy gradient header, orange accents, light background, elevated white cards, progress stepper
- Hide `ChatWidget` on `/portal/*` paths (customers shouldn't see it)
- Subdomain isolation, inline cancel popups, scroll behavior fixes (`#840`)
- Brand palette aligned with photonbrothers.com (`#841`)
- Fix `.trim()` on `PORTAL_BASE_URL` to strip trailing newline that was breaking portal URLs
- New `POST /api/portal/survey/invite/service` endpoint for service-to-service invites (Olivia bot) — bearer-token auth, skips customer email

### PowerHub (Tesla) Enhancements
- Push all Tesla device serials + models to Zuper Property/Job (9 new fields, 21 total)
- Prisma migration for Tesla device model columns
- `PropertyFieldSource` extended with 8 SINGLE_LINE + 1 MULTI_LINE summary fields
- PowerHub primary site selection now prefers sites with equipment over empty ones (`#833`)
- HubSpot card shows Tesla device model numbers alongside serials

### PE Scraper & PE Deals
- Track doc status diffs between sync runs (`#796`)
- Instant email notification to ops on PE doc status changes from both webhook and cron handlers (`#815`)
- PE digest: show full status breakdown in "Nearly Complete" section (`#813`)
- PE Deals dashboard: group by pipeline stage with stage distribution in hero (`#820`)
- Fix stage groups, reorder, collapsible sections (`#822`)
- Removed broken PE scraper GCS cron — webhook is now the sole sync path (was failing with 502 due to service account permissions) (`#838`)

### HubSpot Card v3 Signature
- Lean v3 signature verifier — sign canonical URL with query-param values DECODED to match HubSpot's hubspot.fetch proxy behavior
- Removed `HUBSPOT_CARD_SKIP_SIG_VERIFY` env var bypass

### Zuper Cost Reductions
- Job lookup endpoint: ~97% API call reduction via 5-min server-side cache with request coalescing — was doing 20 API calls per invocation, scheduler pages firing 3 parallel lookups every 5 min per user (~83K calls/day → minimal)
- Cron schedule trims: `zuper-property-sync` from every 15 min → 30 min, `sync-cache` from every 30 min → 4 hours
- Backfill script: new `--skip-zuper` flag to avoid Zuper API burst

### Freshservice Ticket Batch Fixes (`#817`)
- Bundled fixes for tickets #535, #563, #624, #633

### Bug Fixes
- Jinko manufacturer typo corrected ("Jinco" → "Jinko") in MANUFACTURERS list (`#816`)
- Catalog product fetch limit raised from 500 to 2000 so late-sorting categories (PROJECT_MILESTONES, SERVICE) aren't truncated
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
