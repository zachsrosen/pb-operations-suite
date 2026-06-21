# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-06-02

### Google Chat OOO Bot (Major)
- New Google Chat bot that responds to messages when a user is out of office, drafted from their HubSpot/Zuper context and SOP knowledge
- JWT auth hardened to accept multiple audiences and try multiple JWKS sources for Google Chat verification
- Service account key supports base64-encoded format for safer Vercel env var storage
- Supports the Google Workspace add-on envelope format alongside the standard Chat payload
- Replies post to the main message timeline instead of nesting in a thread (matches Chat UX expectations)
- Static `waitUntil` import + async diagnostics so post failures surface in logs
- Captures async post errors to DB and emits detailed Chat API error context for triage

### PE Doc Digest & PE Deals Dashboard
- Daily PE doc digest restructured into 4 actionable sections (ready to submit, awaiting upload, recently submitted, exceptions)
- Each digest row now links to the deal's Google Drive folder for one-click document access
- Email slimmed to a summary + tracker link; "Today's Changes" section removed; in-app tracker now mirrors the email layout with actionable sections + Drive links
- `/api/cron/pe-doc-digest` allowlisted in middleware so the cron can fire without auth blocks
- PE Deals card split into Pre-Construction vs Construction+ segments with a separate Awaiting PTO segment
- Pipeline bar split into stage buckets; redundant report link removed
- New "Customer Paid?" column with a smarter Cust Paid sort
- Multi-column sort support; default sort switched to PE Total
- x/y count switched to submitted total and a new "under review" badge added
- Cancelled deals excluded; legacy "Other" status auto-renames to "On Hold"
- pe-scraper-sync overrides `NOT_UPLOADED → UPLOADED` when an unknown status has a submitted date

### Shop Health Dashboard
- Added Service and D&R/Roofing sections to the Shop Health overview
- Switched response rollups from ticket-level to deal-level + fixed the review drill-down link
- Lightweight overview path: 1 Project pipeline fetch, no ticket lookups for the summary view
- Cached closed tickets and made the overview route resilient to upstream API failures
- Fail-open behavior on new Service/D&R fetches so a single API outage no longer blanks the page
- Removed duplicate Project pipeline fetch; diagnostics surface overview errors instead of silently failing

### Scheduler — Weekend Visibility
- New toggle to show/hide weekend events in the master scheduler
- Fixed weekend events incorrectly shifting onto Saturday when the toggle was off
- Weekend cells now render their own events without stealing Monday's column

### Zuper Throttling & Observability
- New per-endpoint Zuper API call counter with an admin-only read endpoint
- Every outbound Zuper call now logs with the source file for caller attribution
- Skip the full Zuper API sweep on DB-cache hits and cache `/jobs/by-category` lookups
- `useCalendarData` polling slashed to reduce idle Zuper traffic
- zuper-job-backfill throttled from hourly → every 6h; property-sync cron dropped from every 2h → every 6h; misc additional cron throttling
- Lazy-imported the call counter so client bundles no longer pull Prisma
- Inlined `JOB_CATEGORY` UIDs in roofing-scheduler to drop a client→server import

### Project Funnel & Daily Focus
- Project funnel now shows design approval status in the "Awaiting DA Send" column
- Daily focus saves the morning snapshot before sending the email (prevents drift when send fails)
- EOD summary's "morning items resolved" count now tracks actual action items instead of a static list

### Bug Fixes
- Admin tickets table renders gracefully when `pageUrl` is invalid
- Customer portal footer no longer shows an unrecognized phone number

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
