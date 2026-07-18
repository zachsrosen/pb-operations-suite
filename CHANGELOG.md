# Changelog

All notable changes to the PB Tech Ops Suite are documented here.

---

## 2026-07-17

### Permitting & Interconnection Hub (Major)
- Tabbed Hub queues by group (Ready, Waiting, Rejected, Other) instead of one long list, with deal stage shown on each row
- Added an "Other" tab in both Permit Hub and IC Hub for statuses that don't map to the main workflow buckets
- IC Hub now maps the as-built round trip to real action kinds
- Excluded roofing terminal stages from hub queues; dropped in-flight revision statuses and "Rejected" from Permit Hub (those belong to design)
- Dropped IC "Rejected - Revisions Needed" from the main queue after the Other tab absorbed it
- Display HubSpot status labels instead of internal enum values
- Scoped Hub correspondence to the project instead of the shared utility/AHJ inbox
- Corrected California shared-inbox addresses
- Tab strip stability: wrap instead of horizontal scroll, tightened so all five tabs fit one row, and stopped the tab strip and lead-filter dropdown from dragging the queue panel sideways

### SolarEdge Fleet Monitor (Major, New)
- Live SolarEdge fleet monitor with schema, sync pipeline, and dashboard
- Customer/deal links, open-ticket enrichment, and table polish
- Named alerts sourced from SolarEdge export with alert-type filter

### PowerHub Fleet Monitor
- Dedicated Monitor column on every fleet row; alert chips returned to plain badges
- Monitor link surfaced for sites with no active alerts, and each alert chip links directly to the site's live monitoring
- Alert Type filter on the fleet table; show all alert chips per row (dropped the +N overflow)
- Fleet-table info columns, voltage-based grid cell, and Active Alerts toggle
- Fixed Powerwall 3 being counted as gateways instead of batteries
- Device-count backfill made idempotent (array-based)

### Google Chat Bot
- Per-rep daily worklist: each rep gets their own deals, split into 4 sections
- Sales reps scoped to their own deals; company-wide aggregates blocked
- All outbound bot messages mirrored to the oversight space
- New `get_pe_docs` tool for bulk PE document-status lookup (action required / rejected)
- Worklist delivery routes deactivated owners to their manager and stopped double-mirroring
- Bot returns full pbtechops.com URLs for app pages instead of bare SOP paths
- Raised google-chat webhook maxDuration from 60s to 300s to fit heavy queries

### Funnel / Pipeline
- New Construction indicator with hide/show toggle in the pipeline view
- Close Out stage and backlog now driven by Close Out Status
- Blocked toggle plus waiting-since/scheduled dates surfaced in drill-downs
- Stopped `total:0` empty searches from blanking the pipeline

### Deal Sync
- 15-minute cron with a visible "deals synced N ago" freshness badge
- Scheduled the cron, batched the writes, stabilized the diff, and added a staleness alert

### Scheduler
- Re-enabled PM survey invite with status badges and gated button
- Survey invite button generates a copyable link (no email sent)

### Team Activity
- Weekly report-card email digest
- Tasks/day and Property updates/day metrics added to the report

### RTB
- Ready tab "Released" reads `pm_rtb_approved_date` instead of the flag
- Re-blocked deals now read un-released until Release is pressed again
- RTB-Blocked notes edit control always visible

### Service & PE
- Time-in-stage measured from stage-entry date, not the deal's modified date
- Stabilized `pe_doc_*_notes` ordering to stop duplicate rejection emails

### Infrastructure & Fixes
- Allowlisted `zuper-field-activity-sync` and `product-sync` crons in middleware

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
