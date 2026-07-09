# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-08

### PowerHub & Tesla Integration (Major)
- Capture every Tesla telemetry signal and alert metadata from grid
- Surface every Tesla device on site with part number and serial number
- Push all Tesla device serials and models to Zuper Property/Job for sync
- Show Tesla device model numbers alongside serials in HubSpot Card
- Geo-coordinate matching via portal-imported latitude/longitude
- Cross-system Tesla portal URL linking across HubSpot, Zuper, and Suite
- Enrich SiteDetail with HubSpot deal, property, contacts, and system details
- Admin linkage manager for Tesla site-to-deal associations
- Batch telemetry and alert polls to prevent function timeout
- Handle missing SoC signal by deriving from energy-remaining
- Auto-link Tesla sites to HubSpot properties with greedy scoring
- Backfill site addresses from linked HubSpot deals
- Fleet monitoring dashboard with expandable site table
- Cron handlers for asset sync, telemetry, and alerts
- PowerHub alert scoring rolled into service priority queue
- JWT auth with rate limiting for Tesla API
- Native Tesla PowerHub UI Extension card for HubSpot Deal view
- Compact Tesla PowerHub sidebar card showing device status

### Enphase Enlighten Integration (Major)
- Full Enphase API integration at feature parity with Tesla PowerHub
- Partner OAuth setup route for installer authentication flow
- DB-persisted refresh token rotation in SystemConfig
- Token bucket rate limiter at 8 req/sec under Enphase 10/sec limit
- Cron jobs: fleet discovery (daily), telemetry snapshots (15m), micro health (30m)
- HMAC-signed HubSpot card showing production, battery SoC, and micro health
- Address-hash auto-linking to Property cache

### IDR Meeting Hub (Major)
- BOM Review & Line Item Editor in meeting context
- Previous review notes for re-reviews with richer search results
- Resolve design/permit lead owner names and IDs via Owners API
- Fix stale numeric lead IDs in completed snapshots
- Recover from accidental "End without syncing" with dedup and auto-join
- Open access to all authenticated roles (no role gating)
- Survey Zuper link, design approval status, and tag fixes
- Design revision toggle and auto-advance on Zuper sync
- PandaDoc DA link and plan documents in meeting context
- Re-review toggle with auto-appear and revision reason sync
- IDR pricing and adders implementation with cost tiers
- Staff assignment columns in pipeline funnel drill-downs
- Clarify AC disconnect and production meter labels in utility codes

### Shop Health Dashboard (Major)
- Lightweight overview path with single Project fetch and no ticket queries
- Cache closed tickets and make overview route resilient to upstream failures
- Fail open on new Service/D&R fetches to prevent cascade failures
- Drill-downs for customer sentiment, 5-star reviews, and response time
- Wire contact response metrics into Customer Success section
- Expand Preconstruction section with throughput and cycle time metrics
- Customer Success section with sentiment scoring and 5-star review breakdowns
- Allow multiple bottleneck entries per shop per week
- Rename Permits Approved → Permits Issued in Preconstruction
- Service + D&R/Roofing sections added

### PE Document Digest (Major)
- Restructured daily digest into 4 actionable sections (summary + tracker link)
- Google Drive folder link per deal for direct document access
- Mirror digest email with deal-specific navigation and actionable sections
- Dropped Today's Changes to reduce noise; relabel notes-only changes
- Instant email notifications on PE document status changes
- Replay endpoint for delivering standout doc change batches
- Track document status diffs between sync runs for audit trail
- Merge UPLOADED and UNDER_REVIEW into a single "In Review" status
- Don't log UPLOADED→UNDER_REVIEW convergence as a change

### Google Chat OOO Bot (Major)
- Full Google Chat integration for out-of-office automation
- Support for Google Workspace add-on envelope format
- Multiple JWT audiences and JWKS sources for auth
- Handle base64-encoded service account keys
- Post replies to main timeline instead of nested threads
- Async post errors captured to database with detailed Chat API logging
- SOP integration patterns documented

### PE Deals Dashboard (Major)
- Multi-column sort with smarter Customer Paid sorting; default to PE Total
- Split PE Deals card into Pre-Construction vs Construction+ sections
- Pipeline bar split into stage buckets; report link removed
- Awaiting PTO segment for deal-status visibility
- Customer Paid? column after customer payment amount
- Exclude Cancelled and auto-rename Other → On Hold
- x/y count switched to submitted total with under-review badge

### Master Scheduler
- Weekend visibility toggle with proper cell alignment
- Fix weekend events stealing Monday slots or shifting to Saturday
- Show orphaned resurvey/re-inspection jobs in scheduler
- Editable date picker in drag-drop reschedule confirmation modal
- Render pre-sale survey cards on calendar with click modal
- Dedup pre-sale cards and add slot-matching logic
- Show completed Zuper jobs without overdue flags
- Preserve deal's pb_location for orphaned job assignment

### Project Pipeline Funnel
- 9-stage sales-to-construction pipeline funnel for executive visibility
- Close-out projects column, activity table, and drill-down dates
- Named timeframe presets (Today, This Week, This Month, etc.)
- Monthly Activity throughput dashboard
- Survey Scheduled stage added; hero card layout cleaned up
- Infer funnel milestones from deal pipeline stage
- Design approval status shown in Awaiting DA Send column

### EagleView Integration
- EagleView Orders dashboard page for order tracking
- TrueDesign auto-pull pipeline for imaging syncs
- Production PlaceOrder request format
- Normalize PascalCase API response keys to camelCase
- Sandbox integration test page for Go-Live proof

### Catalog Product Management
- Auto-add unknown brands to HubSpot manufacturer enum with TechOps notification
- Write Zuper cross-link IDs via meta_data, not custom_fields
- Switch Zoho writes from group_name to category_id
- Phased HubSpot manufacturer enum enforcement across sync workflows
- Log Sync Modal executions to ActivityLog for audit trail
- Sync observability enums and watermark columns
- Push product photo to Zoho Inventory on approval
- Auto-commit custom brand on blur/click-outside in form
- Raise catalog limit to 2000 products
- Race-safe external-record create and link-back mechanism
- Photo upload works against private Blob store
- Auto-approve user submissions with photo upload

### Zuper Performance & Reliability
- Reduce API calls 97% by caching job list in lookup endpoint
- Per-endpoint API call counter with admin read endpoint for visibility
- Explicit caller attribution in [zuper-call] logs (source file)
- Skip API sweep on DB-cache hits to reduce redundant calls
- Cache /jobs/by-category endpoint
- Drop property-sync cron from every 2h to every 6h
- Throttle zuper-job-backfill from hourly to every 6h
- Cut zuper-property-sync from /15m to /30m
- Reduce sync-cache cron from /30m to every 4h
- Fix pre-sale job creation (omit job_type, fix customer name)
- Restore custom_fields for pre-sale jobs after rollback
- Explicitly set primary job status to Scheduled after reschedule
- Per-sub-type evaluation and install_status rollup integrity check
- PM dashboard for Zuper↔HubSpot status drift detection

### Customer Portal
- Redesigned customer survey portal with brand color updates
- Subdomain isolation matching photonbrothers.com palette
- Inline cancel, scroll fixes, and chatbot hidden
- Service-to-service survey invite endpoint for Olivia integration
- Removed unrecognized phone number from footer
- Fixed URL newline rendering issues

### HubSpot Extensions & Cards
- HubSpot card v3 signature verification with URL+body candidate sweep
- Match HubSpot v3 sig with URL query-param values decoded correctly
- Persisted hubspot-card sig diagnostic via GET endpoint
- Log canonical components even when skip-sig is on
- Use Button href prop instead of window.open with OAuth scope
- TypeScript errors fixed in extensions via tsconfig exclusion
- Enriched Activity tab with engagement metadata
- HubSpot line items shown in Equipment tab
- Resolve ticket enum values to labels with links

### Property Hub Enhancements
- Photos tab populated with Zuper job photos
- HubSpot and Zuper external links added to Property Hub tabs
- Full equipment summaries and revenue on header
- Zuper link added to property overview

### Daily Operations
- Instant email notifications on PE document status changes
- Weekly goals digest email per office
- Save morning snapshot before sending daily focus emails
- Track actual action items in morning snapshot for EOD comparison

### Bug Fixes
- Fix design approval status to show in Awaiting DA Send column
- Fix completed Zuper jobs showing as overdue
- Fix orphaned jobs showing as unscheduled in sidebar
- Fix Jinko manufacturer typo in catalog
- Lazy-import counter to prevent Prisma in client bundles
- Inline JOB_CATEGORY UIDs to drop client→server imports
- Fix OfficeGoal target revenue display rounding ($1.25M was showing as $1.3M)
- Handle invalid pageUrl in admin ticket table rendering

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
