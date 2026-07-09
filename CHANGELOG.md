# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-22

### Enphase Enlighten Integration (Major)
- Full Enphase monitoring API integration at parity with Tesla PowerHub (production, consumption, battery SoC, micro health)
- OAuth2 auth code flow with DB-persisted refresh token rotation (SystemConfig table, not env var)
- Token bucket rate limiter (8 req/sec, under Enphase's ~10 limit) with optional Fly.io proxy via `ENPHASE_PROXY_URL`
- Partner OAuth setup route (`/api/admin/enphase/oauth/partner-setup`) using `grant_type=password` for installer accounts (10+ systems)
- Developer OAuth flow (`/authorize` + `/callback`) for per-homeowner approval on Watt/Kilowatt/Megawatt plans
- New DB models: `EnphaseSite`, `EnphaseTelemetrySnapshot`, `EnphaseTelemetryHistory` + 8 `enphase_*` columns on `HubSpotPropertyCache`
- Three cron jobs: assets discovery (daily 9am), telemetry (15-min), micro health status check (30-min)
- HMAC-signed HubSpot card at `/api/hubspot-card/enphase/` with production, battery SoC, micro health, portal link
- Crosslink follows the PowerHub cascade: resolvePrimarySite → pushToHubSpotForProperty → Zuper dirty flag
- Feature flags: `ENPHASE_ENABLED`, `ENPHASE_CROSSLINK_ENABLED`, `NEXT_PUBLIC_UI_ENPHASE_VIEWS_ENABLED`

### Project Pipeline Funnel (Major)
- 9-stage sales-to-construction funnel card on Executive suite (Survey Scheduled → Close Out)
- Milestones inferred from deal pipeline stage rather than scheduled dates
- Monthly Activity table with stage-by-stage counts and named timeframe presets (MTD, QTD, YTD, etc.)
- Drill-down dialogs include staff assignment columns and per-stage entry/exit dates
- Hero card layout cleaned up; Survey Scheduled added as distinct stage
- Close Out stage added to terminal view

### Weekly Shop Health Dashboard (Major)
- New dashboard tracking 5 locations on operational health metrics, contact response, customer success
- Multiple bottleneck entries allowed per shop per week (replaces single-entry constraint)
- Drill-down tables across all count-based metrics, Customer Success metrics, sentiment, 5-star reviews, and response time
- Contact response metrics wired into Customer Success section
- Week-util helpers extracted to dedicated module to prevent client/server boundary violation

### PE File Preparation (Major)
- AI vision audit using Claude with few-shot reference library + AVL (Approved Vendor List) cross-check
- PandaDoc auto-pull with name-only search fallback when template discovery fails
- Prep dashboard with clickable PandaDoc links and PE doc status breakdown
- Photo triage batched: 1 API call replaces 36+ (massive perf win)
- Pre-upload photos + cache Anthropic file IDs to eliminate redundant work across audit runs
- Vision results cached; proposal misclassification blocked to prevent audit timeout
- Parallelized pre-work with fixed doc classification race condition
- User OAuth token used for GDrive access (was failing with service account)
- Diagnostic logging exposes folder/vision errors directly
- Instant email notification on PE doc status changes
- `pe-scraper` tracks doc status diffs between sync runs
- Full status breakdown shown in PE digest "Nearly Complete" section
- New `pe-file-prep` skill documentation with full operational context

### PE Submission Gap (Major)
- 4-tab split: M1, M2, Onboarding, Complete with dollar amounts and date columns
- Stage groups corrected with strict bucketing; M1 includes Close Out stage
- Complete tab requires Paid status (not Approved); shows both M1/M2 statuses
- Approved deals now appear on M1/M2 tabs; Fully Submitted metric corrected
- Document-level progress shown per deal with inspection pass / PTO granted dates
- Real deal stage and close date displayed
- Onboarding tab shows all pre-PTO project pipeline stages
- PE Deals grouped by pipeline stage with stage distribution on hero, collapsible sections, reordered

### Tesla PowerHub Enhancements
- All Tesla device serials + model numbers pushed to Zuper Property/Job (not just gateway)
- Primary site selection prefers sites with equipment (fixes wrong-site selection when fleet has multiple registrations)
- Tesla device model numbers shown alongside serials on HubSpot card
- Compact Tesla PowerHub sidebar card in HubSpot extensions
- Prisma migration for `tesla_*_model` columns
- HubSpot v3 signature verification reworked: lean verifier signs with decoded URL values (after exhaustive sweep of candidates and persisted diagnostics)

### Zuper Property Sync (Write Direction)
- Property data now writes from PB Ops Suite → Zuper (previously read-only)
- Zuper properties associated with customer on create/update
- Project-to-property linking in Zuper sync (with safety toggle)
- Ticket-only properties included in sync
- Customers with no UID filtered out to prevent malformed updates
- Stale deal/ticket links removed during property reconcile
- Safety checks added to prevent Zuper property misassociation

### Master Scheduler Fixes
- Editable date picker added to drag-drop reschedule confirmation (Freshservice #626)
- Pre-sale jobs shown as purple cards; regular surveys no longer styled as pre-sale
- Orphaned resurvey/re-inspection jobs surfaced in master scheduler (Freshservice #563)
- Orphaned jobs no longer shown as unscheduled in sidebar
- Orphaned job location now derived from deal's `pb_location`
- Completed Zuper jobs no longer show as overdue
- Batch Freshservice ticket fixes for #535, #563, #624, #633

### Shovels API Integration
- Property enrichment with permit history, residents, and contractor data via Shovels API
- Cron batch size increased to 75 with reduced delay for faster backfill

### IDR Meeting BOM Editor
- BOM Review & Line Item Editor for IDR (Initial Design Review) meetings
- Catalog limit raised to 2000 items
- Jinko manufacturer typo fixed

### Property Sync Reliability
- Address match verified for single-candidate property links (prevents misassociation when only one candidate exists)
- Duplicate `deals` field removed from `PropertyDetail` interface
- Extended rollup fields removed from Prisma update where columns don't exist yet (`closedTicketsCount`, `installAgeMonths`, `daysSinceLastService`)
- Drive OAuth token resolution fixed by passing correct cookie name to `getToken`

### HubSpot Extensions / Cards
- Compact Tesla PowerHub sidebar card added to HubSpot extensions
- Button `href` prop used instead of `window.open` (sandboxed iframe compatibility); OAuth scope added
- `hubspot-extensions` excluded from Next.js type-check (separate build)
- Sig diagnostic persisted to SystemConfig for debugging v3 signature mismatches
- `HUBSPOT_CARD_SKIP_SIG_VERIFY` env var removed after signature verifier hardened

### Misc
- EagleView auto-pull enabled (production credentials)

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
