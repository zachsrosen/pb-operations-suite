# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-20

### PE File Preparation (Major)
- AI vision audit of PE submission documents with Claude vision classifier
- Few-shot reference library + AVL (Approved Vendor List) cross-check for classification accuracy
- PandaDoc auto-pull with template discovery + name-only search fallback when metadata misses
- Clickable PandaDoc links surfaced on PE prep page
- `PeAuditRun` Prisma model persists audit runs; vision results cached to prevent timeouts
- Batched photo triage — single API call replaces 36+ per-photo calls
- Pre-upload photos + cache Anthropic file IDs to eliminate redundant uploads
- Parallel pre-work + race-condition fix in document classification
- User OAuth token used for Google Drive access (replaces service account fallback)
- `pe-file-prep` skill with full operational context for Claude-driven runs

### PE Submission Gap Dashboard (Major)
- 4-tab split (M1, M2, Complete, Onboarding) with dollar amounts and date columns
- Document-level progress per deal with milestone-correct stage scoping
- Real deal stage + close date shown alongside inspection-pass and PTO-granted dates
- Complete tab requires Paid (not just Approved); shows both M1/M2 statuses
- M1 bucket includes Close Out; Onboarding tab includes all pre-PTO project pipeline stages
- `peDocs` query key added for doc fetching with proper invalidation
- Doc statuses now read from HubSpot deal properties instead of DB (refactor)

### Tesla PowerHub Monitoring (Major)
- Full telemetry signal capture + alert metadata per Tesla site
- Per-device part # and serial # surfaced (every Tesla device on site)
- Equipment summary view with battery SoC derived from energy-remaining when SoC signal missing
- Geo-coordinate matching via portal-imported lat/lng
- `API_SECRET_TOKEN` auth allowed on import-locations route
- Script to unlink heuristic-only `PowerhubSite` links
- Prisma schema aligned with prod Tesla device denorm columns

### Tesla PowerHub HubSpot UI Extension (Major)
- Native HubSpot UI Extension card for Tesla PowerHub data
- Compact Tesla PowerHub sidebar card variant
- HubSpot v3 signature verification implemented (signs with decoded URL query-param values)
- `Button` uses `href` prop instead of `window.open` for in-context navigation
- Extensive signature-debugging instrumentation persisted to `SystemConfig` for diagnosis
- `tsconfig` excludes `hubspot-extensions` from Next.js type-check (separate build context)

### Weekly Shop Health Dashboard (Major)
- Per-location weekly health metrics based on Tracey Mallory's P&L Ownership Framework
- Customer Success section with sentiment scoring and 5-star review aggregation
- Preconstruction section expanded with throughput and cycle times
- "Permits Issued" terminology replaces "Permits Approved"
- Revenue display rounding fixed ($1.25M no longer shows as $1.3M)
- `ShopHealthBottleneck` model persists per-location per-week bottleneck entries
- Refactored to use `OfficeGoal` DB targets instead of hardcoded `REVENUE_GROUPS`
- Week utils extracted to prevent client/server boundary violation

### Zuper Property Sync — Write Direction (Major)
- Project-to-property linking during Zuper sync (Zuper jobs now write to `HubSpotPropertyCache`)
- Customer association on Zuper property create/update
- Safety checks prevent Zuper property misassociation
- Ticket-only properties included in sync
- Filter out customers with no UID when updating Zuper property
- Stale deal/ticket links removed during property reconcile

### IDR Meeting Tools (Major)
- BOM Review & Line Item Editor for in-meeting equipment edits (#805)
- Planset layout vs DA layout comparison in design review (#768)
- Stale numeric lead IDs resolved in completed snapshots
- Revision status override fixed on Vercel (now fires reliably)

### Shovels API Property Enrichment
- Permits, residents, and contractors enriched onto property records (#700)
- Cron batch size increased to 75 with reduced delay

### Property Hub
- HubSpot line items surfaced in Equipment tab
- Activity tab enriched with engagement metadata
- Ticket enum values resolved to human-readable labels with links
- Property ID resolved before querying `PowerhubSite` (fixes monitoring lookup)
- Address match verified for single-candidate property links (#687)

### Pre-Sale Survey Scheduling
- Pre-sale survey cards rendered on scheduler calendar
- Dedup logic for pre-sale cards + click-to-open modal
- Zuper pre-sale job creation: omit `job_type`, fix customer name, skip then restore `custom_fields`
- One-off SLO slot added for Nick on 2026-05-20

### AHJ / Utility
- Bulk spreadsheet update script for AHJ and Utility custom objects (#449)

### Refactors
- `PendingPropertyOverride` cron replaced with HubSpot workflow properties (#789)

### Bug Fixes
- `deal-reader` Project return type now includes customer-sentiment fields
- Drive OAuth token resolution passes correct cookie name to `getToken`
- HubSpot engagements use `appCache.get()` new return shape
- Removed duplicate `deals` field and stale fields (`closedTicketsCount`, extended rollups) from Prisma updates where columns don't yet exist
- Unused helpers removed (`totalDocsForDeal`, `dealStageDisplayLabel`, `installAgeMonths`, `daysSinceLastService`)

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
