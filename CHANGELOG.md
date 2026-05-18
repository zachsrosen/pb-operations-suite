# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-05-17

### PE File Preparation Tool (Major)
- New PE Prep landing page with deal queue filtered by deal stage, plus audit history overlay for re-running and reviewing prior audits
- Two-pipeline PE audit (docs + photos) with independent timeouts to prevent one slow side from blocking the other
- Deep PE verification for both photos and documents with cached vision results and Anthropic file IDs to eliminate redundant work
- Batch photo triage replaces 36+ vision calls with a single API call; triage max_tokens now scales with photo count
- PandaDoc integration: clickable doc links on PE Prep, draft pulls, PE_CON contract support, name-only search fallback, multi-template-id support, and 4 progressively permissive search strategies for hard-to-find docs
- Surface all Zuper job photos on the PE Prep detail page, with PE-named photos prioritized in triage
- Recursive Drive subfolder listing for doc candidates; user OAuth token used for Drive access (with service-account fallback for write)
- Performance: parallelized Zuper enumeration, parallelized PandaDoc per-key search and per-doc download, 6-way vision concurrency cap, fixed doc classification race condition
- PE Action Tasks Cross-Reference MVP — spec, plan, chunks 1-3, and dashboard (#741)

### PE & Compliance Suite
- New suite consolidating PE Prep, PE Deals, PE Action Queue, and existing compliance pages under one roof (#735)

### Weekly Shop Health Dashboard
- New dashboard summarizing shop-level health metrics by week (#706)
- Extracted shop-health week utils to a server-only module to fix a client/server boundary violation

### Zuper Property Sync (Write Direction)
- New write-direction sync: PB Property Object → Zuper customer property record (#709)
- Associate Zuper properties with the customer on create/update, with safety checks to prevent misassociation
- Link Zuper projects to properties during sync; include ticket-only properties in the sync set
- Filter out customers with no UID before updating Zuper property
- Reconcile cron now removes stale deal/ticket links so Zuper doesn't carry dead associations

### Property Hub Enhancements
- Header expanded with equipment summaries, revenue, and a direct Zuper link
- New Photos tab pulling Zuper job photos for the property
- HubSpot and Zuper external links added to Property Hub tabs
- Extended rollup fields cached locally on `HubSpotPropertyCache` and exposed in `PropertyDetail`
- Design spec checked in under `docs/`

### Bug Fixes
- Drive OAuth: pass correct cookie name to `getToken` so PE audit and other Drive integrations resolve user tokens reliably
- PE audit: classifier accuracy improvements, correct deal links in the UI, block proposal misclassification
- PandaDoc: pull drafts (not just sent docs), correct IA folder path, name-only search fallback when template discovery fails

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
